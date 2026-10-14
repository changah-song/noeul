import {
    getCachedPKnown,
    insertData,
    logInteractionEvent,
    recordVocabContext,
    vocabEntryExists,
} from './Database';
import { requestUserDataSync } from './userDataSyncQueue';

/**
 * Persist a "Suggested" candidate from the saved-words panel into the user's
 * vocab (skipping the insert when the entry already exists), record its example
 * sentence as context, log the save, and queue a sync. Same steps as Read.js
 * handleSaveCandidate; the song reader uses this, Read.js can adopt it later.
 *
 * @returns {Promise<boolean>} true when the candidate was saved (or already was)
 */
export const saveWordCandidate = async ({
    candidate,
    ownerId,
    language,
    sourceBookUri = null,
    sourceBookTitle = null,
}) => {
    if (!candidate?.stem) {
        return false;
    }
    const word = candidate.stem;
    const hanja = candidate.hanja || '';
    const definition = candidate.gloss || '';
    const sentence = candidate.exampleSentence || null;
    const createdAt = new Date().toISOString();

    const alreadySaved = await vocabEntryExists(word, hanja, definition, language, { ownerId });
    if (!alreadySaved) {
        const pKnown = await getCachedPKnown({ ownerId, language, word });
        await insertData(word, hanja, definition, {
            ownerId,
            level: 'unorganized',
            sourceBookUri,
            sourceBookTitle,
            contextSentence: sentence,
            createdAt,
            updatedAt: createdAt,
            language,
            pKnown,
        });
    }
    if (sentence) {
        await recordVocabContext({
            ownerId,
            word,
            hanja,
            definition,
            sentence,
            sourceBookUri,
            sourceBookTitle,
            language,
        });
    }
    requestUserDataSync('candidate-save');
    logInteractionEvent({
        ownerId,
        language,
        word,
        hanja,
        def: definition,
        eventType: 'save',
        sourceBookUri,
        sentence,
    }).catch(() => {});
    return true;
};

export default saveWordCandidate;
