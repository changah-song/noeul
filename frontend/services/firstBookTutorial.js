import AsyncStorage from '@react-native-async-storage/async-storage';

// The first-book tutorial: six steps tried on a real page of the starter
// book, under a dark overlay that leaves only the explained control lit
// (components/Read/FirstBookTutorial.js). Onboarding asks for it, and Profile ›
// Tips can ask again; Home then opens the starter book and the reader runs it.
const TUTORIAL_KEY = 'tutorial.firstBook.v1';

export const TUTORIAL_STEP_COUNT = 6;

// The steps. INTRO and MORE are the cards before and after the counted six.
export const TUTORIAL_STEPS = {
    intro: 0,
    tapWord: 1,
    sentenceBar: 2,
    saveWord: 3,
    holdSentence: 4,
    focus: 5,
    listen: 6,
    more: 7,
};

const emptyState = () => ({ status: 'none', bookUri: null });

let state = null;
let loading = null;
const listeners = new Set();

const notify = () => {
    listeners.forEach((listener) => {
        try {
            listener(state);
        } catch {
            // A listener's failure is its own.
        }
    });
};

const persist = async () => {
    try {
        await AsyncStorage.setItem(TUTORIAL_KEY, JSON.stringify(state));
    } catch {
        // Worst case the tutorial runs again, or not at all.
    }
};

export const loadTutorial = async () => {
    if (state) return state;
    if (!loading) {
        loading = (async () => {
            let next = emptyState();
            try {
                const parsed = JSON.parse((await AsyncStorage.getItem(TUTORIAL_KEY)) || 'null');
                if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
                    next = { status: parsed.status, bookUri: parsed.bookUri ?? null };
                }
            } catch {
                // Start fresh.
            }
            state = next;
            return state;
        })();
    }
    return loading;
};

export const getTutorial = () => state ?? emptyState();

export const subscribeTutorial = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const update = async (patch) => {
    await loadTutorial();
    state = { ...state, ...patch };
    notify();
    await persist();
    return state;
};

// Onboarding's end, or "Replay the reading guide": Home opens the starter
// book next and the reader runs the tutorial on it.
export const requestTutorial = () => update({ status: 'pending', bookUri: null });

// Home picked and opened the book.
export const setTutorialBook = (bookUri) => update({ bookUri: bookUri ?? null });

// outcome: 'done' | 'skipped'
export const finishTutorial = (outcome = 'done') => update({ status: outcome, bookUri: null });

export const isTutorialPending = (value = getTutorial()) => value?.status === 'pending';

// ── The steps ───────────────────────────────────────────────────────────────
//
// { step, held, focused, listening, savedBaseline }. An action step waits for
// the reader to do the thing (the reader screen reports it as an event); its
// "done" flag then turns the card into an explanation with Next. Pure, so it is
// unit-tested.

export const initialTutorialProgress = () => ({
    step: TUTORIAL_STEPS.intro,
    held: false,
    focused: false,
    listening: false,
});

// event: { type: 'next' | 'wordTapped' | 'wordSaved' | 'selectionOpened'
//          | 'focusOn' | 'listenOn' | 'skip' }
export const advanceTutorial = (progress, event) => {
    const { step } = progress;
    const S = TUTORIAL_STEPS;
    switch (event?.type) {
        case 'skip':
            return { ...progress, step: null, finished: 'skipped' };
        case 'wordTapped':
            return step === S.tapWord ? { ...progress, step: S.sentenceBar } : progress;
        case 'wordSaved':
            return step === S.saveWord ? { ...progress, step: S.holdSentence } : progress;
        case 'selectionOpened':
            return step === S.holdSentence ? { ...progress, held: true } : progress;
        case 'focusOn':
            return step === S.focus ? { ...progress, focused: true } : progress;
        case 'listenOn':
            return step === S.listen ? { ...progress, listening: true } : progress;
        case 'next':
            if (step === S.intro) return { ...progress, step: S.tapWord };
            if (step === S.sentenceBar) return { ...progress, step: S.saveWord };
            if (step === S.holdSentence && progress.held) return { ...progress, step: S.focus, held: false };
            if (step === S.focus && progress.focused) return { ...progress, step: S.listen, focused: false };
            if (step === S.listen && progress.listening) return { ...progress, step: S.more, listening: false };
            if (step === S.more) return { ...progress, step: null, finished: 'done' };
            return progress;
        default:
            return progress;
    }
};

// Whether the step's card shows Next (an explanation) or waits for an action.
export const tutorialWaitsForAction = (progress) => {
    const S = TUTORIAL_STEPS;
    switch (progress?.step) {
        case S.tapWord:
        case S.saveWord:
            return true;
        case S.holdSentence:
            return !progress.held;
        case S.focus:
            return !progress.focused;
        case S.listen:
            return !progress.listening;
        default:
            return false;
    }
};

// For tests.
export const __resetTutorialMemory = () => {
    state = null;
    loading = null;
    listeners.clear();
};
