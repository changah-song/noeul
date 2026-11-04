import { useEffect, useState } from 'react';
import {
    getReaderLevel,
    getWordDifficulties,
    lookupBookLevelSurfaces,
    lookupKnowledgeEvidence,
    onReaderLevelChanged,
} from '../services/Database';
import {
    buildWordKnowledge,
    compoundDifficulty,
    compoundSplits,
    signalsFromEvidenceRows,
} from '../services/levelEngine';
import { buildLevelExposureTerms, buildLevelUnderlineTerms, rowDifficulty } from '../services/levelUnderlineTerms';
import { isCjkCompoundSurface, isPhraseSurface } from '../services/readerAnnotations';

/**
 * loadLevelReaderTerms — load the graded-word underline snapshot for an indexed text (a book, or a
 * song via its `song:<id>` book_index URI): the reader's level, their history
 * with every word in the language (for word families and Chinese characters),
 * and each word's difficulty, shaded with buildLevelUnderlineTerms.
 *
 * The snapshot only refreshes when `bookUri`, `language`, `ownerId` or
 * `refreshKey` change — the level moves on every lookup, and re-shading
 * mid-read would make words silently change color under the reader.
 */
export const loadLevelReaderTerms = async ({ ownerId, bookUri, language }) => {
    if (!bookUri) {
        return { terms: [], exposureTerms: [], phraseSurfaces: [], termRanks: new Map() };
    }
    const [reader, rows, evidenceRows] = await Promise.all([
        getReaderLevel({ ownerId, language }),
        lookupBookLevelSurfaces(ownerId, bookUri, 1, { language }),
        lookupKnowledgeEvidence(ownerId, language).catch(() => []),
    ]);

    const difficulties = new Map();
    (rows || []).forEach((row) => {
        const stem = typeof row?.stem === 'string' ? row.stem.trim() : '';
        if (!stem) return;
        const difficulty = rowDifficulty(row, language);
        if (!difficulties.has(stem) || difficulty > difficulties.get(stem)) {
            difficulties.set(stem, difficulty);
        }
    });
    const { events, saved } = signalsFromEvidenceRows(evidenceRows);
    // Words the reader has history with but the book doesn't grade, and the
    // parts of the book's Chinese compounds.
    const parts = Array.from(difficulties.keys())
        .flatMap((stem) => compoundSplits(language, stem).flatMap((split) => split.parts));
    const missing = Array.from(new Set([...events.map((event) => event.stem), ...parts]))
        .filter((stem) => !difficulties.has(stem));
    const extra = missing.length > 0 ? await getWordDifficulties(language, missing).catch(() => ({})) : {};
    const graded = new Map(difficulties);
    Object.entries(extra).forEach(([stem, entry]) => {
        if (!entry.isFallback) graded.set(stem, entry.difficulty);
        if (!difficulties.has(stem)) difficulties.set(stem, entry.difficulty);
    });
    // Score compounds from their parts as the level engine does
    // (Database.getWordDifficulties), so underlines and the level agree.
    Array.from(difficulties.keys()).forEach((stem) => {
        const compound = compoundDifficulty(
            language, stem, (part) => (graded.has(part) ? graded.get(part) : null), difficulties.get(stem)
        );
        if (compound) difficulties.set(stem, compound.difficulty);
    });

    const knowledge = buildWordKnowledge({ language, reader, difficulties, events, saved });
    const terms = buildLevelUnderlineTerms(rows, language, reader.theta, { knowledge });
    // Every phrase in the book ("gave up") and every Chinese word of two or
    // more characters, underlined or not: the reader is told about all of them
    // so a tap on any of their words opens the phrase, and the characters of
    // an easy word (如果, 只有) are not glossed one by one (withPhraseTapTerms).
    const isChinese = String(language || '').startsWith('zh');
    const spansWord = (surface) => isPhraseSurface(surface) || (isChinese && isCjkCompoundSurface(surface));
    const phraseSurfaces = Array.from(new Set((rows || [])
        .map((row) => (typeof row?.surface === 'string' ? row.surface.trim() : ''))
        .filter(spansWord)));
    // Chinese: how common each word is, so the reader can settle two
    // overlapping words of one length (不知道: 知道, not 不知).
    const termRanks = new Map();
    if (isChinese) {
        (rows || []).forEach((row) => {
            const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
            const zipf = Number(row?.zipf);
            if (!surface || row?.zipf == null || !Number.isFinite(zipf)) return;
            if (!(termRanks.get(surface) >= zipf)) termRanks.set(surface, zipf);
        });
    }
    return { terms, exposureTerms: buildLevelExposureTerms(rows, terms), phraseSurfaces, termRanks };
};

/**
 * loadLevelUnderlineTerms — the underline terms alone (see loadLevelReaderTerms
 * for the exposure-only words that go with them).
 */
export const loadLevelUnderlineTerms = async (args) => (await loadLevelReaderTerms(args)).terms;

const useLevelUnderlineTerms = ({ ownerId, bookUri, language, refreshKey }) => {
    const [terms, setTerms] = useState([]);
    // A picked level or a word check re-shades at once.
    const [levelVersion, setLevelVersion] = useState(0);
    useEffect(() => onReaderLevelChanged(() => setLevelVersion((value) => value + 1)), []);

    useEffect(() => {
        if (!bookUri) {
            setTerms([]);
            return undefined;
        }
        let isActive = true;
        loadLevelUnderlineTerms({ ownerId, bookUri, language })
            .then((next) => {
                if (isActive) {
                    setTerms(next);
                }
            })
            .catch((error) => {
                console.error('[useLevelUnderlineTerms] Failed to load level surfaces:', error);
                if (isActive) {
                    setTerms([]);
                }
            });
        return () => {
            isActive = false;
        };
    }, [ownerId, bookUri, language, refreshKey, levelVersion]);

    return terms;
};

export default useLevelUnderlineTerms;
