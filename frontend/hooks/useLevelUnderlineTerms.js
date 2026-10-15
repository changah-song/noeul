import { useEffect, useState } from 'react';
import {
    getProfileAbility,
    lookupBookLevelSurfaces,
    lookupBookWordEvidence,
} from '../services/Database';
import { lowestUnderlinedRank } from '../services/abilityModel';
import { buildLevelUnderlineTerms } from '../services/levelUnderlineTerms';
import { summarizeEvidenceRows } from '../services/wordEvidence';

/**
 * Load the graded-word underline snapshot for an indexed text (a book, or a
 * song via its `song:<id>` book_index URI). Same pipeline as Read.js: read
 * theta fresh, prune SQL-side to the ranks that can earn an underline, then
 * shade with buildLevelUnderlineTerms.
 *
 * The snapshot only refreshes when `bookUri`, `language`, `ownerId` or
 * `refreshKey` change — theta moves on every lookup, and re-shading mid-read
 * would make words silently change color under the reader.
 */
export const loadLevelUnderlineTerms = async ({ ownerId, bookUri, language }) => {
    if (!bookUri) {
        return [];
    }
    const ability = await getProfileAbility({ ownerId, language });
    let theta = Number(ability?.theta);
    if (!Number.isFinite(theta)) {
        theta = 0;
    }
    const floorRank = lowestUnderlinedRank(language, theta);
    if (floorRank == null) {
        return [];
    }
    const [rows, evidenceRows] = await Promise.all([
        lookupBookLevelSurfaces(ownerId, bookUri, floorRank, { language }),
        lookupBookWordEvidence(ownerId, bookUri, { language }).catch(() => []),
    ]);
    return buildLevelUnderlineTerms(rows, language, theta, { evidence: summarizeEvidenceRows(evidenceRows) });
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
