import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    __resetTutorialMemory,
    advanceTutorial,
    finishTutorial,
    getTutorial,
    initialTutorialProgress,
    loadTutorial,
    requestTutorial,
    setTutorialBook,
    subscribeTutorial,
    TUTORIAL_STEPS as S,
    tutorialWaitsForAction,
} from '../firstBookTutorial';

const run = (events) => events.reduce(
    (progress, type) => advanceTutorial(progress, { type }),
    initialTutorialProgress()
);

describe('first-book tutorial steps', () => {
    it('walks the six steps, each action step waiting for the real action', () => {
        let progress = run(['next']);
        expect(progress.step).toBe(S.tapWord);
        expect(tutorialWaitsForAction(progress)).toBe(true);
        // Next does nothing until the word is tapped.
        expect(advanceTutorial(progress, { type: 'next' })).toBe(progress);

        progress = run(['next', 'wordTapped']);
        expect(progress.step).toBe(S.sentenceBar);
        expect(tutorialWaitsForAction(progress)).toBe(false);

        progress = run(['next', 'wordTapped', 'next', 'wordSaved']);
        expect(progress.step).toBe(S.holdSentence);
        expect(tutorialWaitsForAction(progress)).toBe(true);

        progress = advanceTutorial(progress, { type: 'selectionOpened' });
        expect(progress).toMatchObject({ step: S.holdSentence, held: true });
        expect(tutorialWaitsForAction(progress)).toBe(false);

        progress = run(['next', 'wordTapped', 'next', 'wordSaved', 'selectionOpened', 'next', 'focusOn', 'next', 'listenOn', 'next']);
        expect(progress).toMatchObject({ step: S.more, held: false, focused: false, listening: false });

        expect(advanceTutorial(progress, { type: 'next' })).toMatchObject({ step: null, finished: 'done' });
    });

    it('ignores actions that belong to another step', () => {
        const progress = run(['next']);
        expect(advanceTutorial(progress, { type: 'wordSaved' })).toBe(progress);
        expect(advanceTutorial(progress, { type: 'focusOn' })).toBe(progress);
        // Listening turns focus mode on; on the listen step that is not a focus step.
        const listening = run(['next', 'wordTapped', 'next', 'wordSaved', 'selectionOpened', 'next', 'focusOn', 'next', 'focusOn']);
        expect(listening).toMatchObject({ step: S.listen, focused: false });
    });

    it('skips from anywhere', () => {
        expect(advanceTutorial(run(['next', 'wordTapped']), { type: 'skip' })).toMatchObject({ step: null, finished: 'skipped' });
    });
});

describe('first-book tutorial record', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        __resetTutorialMemory();
    });

    it('is asked for, given a book, and finished, across launches', async () => {
        expect((await loadTutorial()).status).toBe('none');
        const seen = [];
        subscribeTutorial((value) => seen.push(value.status));

        await requestTutorial();
        await setTutorialBook('public-domain:the-fox');
        expect(getTutorial()).toEqual({ status: 'pending', bookUri: 'public-domain:the-fox' });

        __resetTutorialMemory();
        expect(await loadTutorial()).toEqual({ status: 'pending', bookUri: 'public-domain:the-fox' });

        await finishTutorial('skipped');
        expect(getTutorial()).toEqual({ status: 'skipped', bookUri: null });
        expect(seen).toEqual(['pending', 'pending']);
    });
});
