import { useEffect, useState } from 'react';
import {
    getReaderLevel,
    getWordDifficulties,
    lookupBookLevelSurfaces,
    lookupKnowledgeEvidence,
} from '../services/Database';
import { buildWordKnowledge, signalsFromEvidenceRows } from '../services/levelEngine';
import { buildLevelUnderlineTerms, rowDifficulty } from '../services/levelUnderlineTerms';

/**
 * Load the graded-word underline snapshot for an indexed text (a book, or a
 * song via its `song:<id>` book_index URI): the reader's level, their history
 * with every word in the language (for word families and Chinese characters),
 * and each word's difficulty, shaded with buildLevelUnderlineTerms.
 *
 * The snapshot only refreshes when `bookUri`, `language`, `ownerId` or
 * `refreshKey` change — the level moves on every lookup, and re-shading
 * mid-read would make words silently change color under the reader.
 */
export const loadLevelUnderlineTerms = async ({ ownerId, bookUri, language }) => {
    if (!bookUri) {
        return [];
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
    const missing = Array.from(new Set(events.map((event) => event.stem))).filter((stem) => !difficulties.has(stem));
    if (missing.length > 0) {
        const extra = await getWordDifficulties(language, missing).catch(() => ({}));
        Object.entries(extra).forEach(([stem, entry]) => difficulties.set(stem, entry.difficulty));
    }

    const knowledge = buildWordKnowledge({ language, reader, difficulties, events, saved });
    return buildLevelUnderlineTerms(rows, language, reader.theta, { knowledge });
};

const useLevelUnderlineTerms = ({ ownerId, bookUri, language, refreshKey }) => {
    const [terms, setTerms] = useState([]);

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
    }, [ownerId, bookUri, language, refreshKey]);

    return terms;
};

export default useLevelUnderlineTerms;
