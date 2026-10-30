import { KRDICT_INTERFACE_LANGUAGE_OPTIONS } from '../../constants/languages';
import {
    GUIDE_CLIPS,
    GUIDE_STEP_COUNT,
    guideFrameAt,
    guideTargetId,
} from '../readerGuide';
import {
    GUIDE_HOLD_SENTENCE,
    GUIDE_PAGE_LANGUAGES,
    GUIDE_PARAGRAPHS,
    getGuidePage,
} from '../readerGuideContent';

// The reader guide: its timeline (what the sample page shows at each moment of
// each clip) and its sample pages, which must exist for every pairing of
// learning language and interface language so the guide never waits on a lookup.

const GLOSS_FIELDS = ['pos', 'sense', 'note', 'bar', 'meaning', 'idiom', 'grammarGloss', 'grammarNote'];
const INTERFACE_LANGUAGES = KRDICT_INTERFACE_LANGUAGE_OPTIONS.map((option) => option.code);

// A Chinese-interface reader isn't learning Chinese, so that page skips both scripts.
const pairs = GUIDE_PAGE_LANGUAGES.flatMap((target) => INTERFACE_LANGUAGES
    .filter((ui) => ui !== target && !(target === 'zh' && ui.startsWith('zh')))
    .map((ui) => [target, ui]));

describe('sample pages', () => {
    it.each(pairs)('%s page has its own glosses in %s', (target, ui) => {
        const page = getGuidePage(target, ui);
        const own = page.glosses[ui];
        expect(own).toBeDefined();
        GLOSS_FIELDS.forEach((field) => {
            expect(typeof own[field]).toBe('string');
            expect(own[field].trim()).not.toBe('');
        });
        expect(page.gloss).toBe(own);
    });

    it.each(GUIDE_PAGE_LANGUAGES)('%s page has the shape the timeline expects', (target) => {
        const page = getGuidePage(target, 'en');
        const sentenceCount = GUIDE_PARAGRAPHS.flat().length;
        expect(page.sentences).toHaveLength(sentenceCount);
        const [sentence, word] = page.word.split(':').map(Number);
        expect(page.sentences[sentence][word]).toBeDefined();
        expect(page.sentences[sentence][word]).toContain(page.wordLabel);
        expect(page.sentences[GUIDE_HOLD_SENTENCE][0]).toContain(page.holdLabel);
        Object.keys(page.levels).forEach((id) => {
            const [s, w] = id.split(':').map(Number);
            expect(page.sentences[s][w]).toBeDefined();
        });
    });

    it('follows the Chinese script setting', () => {
        expect(getGuidePage('zh', 'en', 'zh-Hans').bookTitle).toBe('海上来的信');
        const traditional = getGuidePage('zh', 'en', 'zh-Hant');
        expect(traditional.bookTitle).toBe('海上來的信');
        expect(traditional.sentences).toHaveLength(7);
        expect(traditional.sentences[2][5]).toBe(traditional.wordLabel);
    });

    it('falls back to English help, or Korean on the English page', () => {
        expect(getGuidePage('ko', 'ko').gloss).toBe(getGuidePage('ko', 'en').gloss);
        expect(getGuidePage('en', 'en').gloss).toBe(getGuidePage('en', 'ko').gloss);
    });
});

describe('timeline', () => {
    it('has six clips between the intro and the end card', () => {
        expect(GUIDE_STEP_COUNT).toBe(6);
        expect(GUIDE_CLIPS[0].key).toBe('intro');
        expect(GUIDE_CLIPS[GUIDE_CLIPS.length - 1].key).toBe('done');
        GUIDE_CLIPS.filter((clip) => clip.actionAt != null).forEach((clip) => {
            expect(clip.actionAt).toBeLessThan(clip.duration);
        });
    });

    it('opens the word panel only after the tap', () => {
        expect(guideFrameAt('tap', -1, '2:8', 6).dictionary).toBe(false);
        const touched = guideFrameAt('tap', 0, '2:8', 6);
        expect(touched.touch).toBe('2:8');
        expect(touched.dictionary).toBe(false);
        const open = guideFrameAt('tap', 300, '2:8', 6);
        expect(open.tapped).toBe('2:8');
        expect(open.dictionary).toBe(true);
    });

    it('drags across the whole held sentence before the AI answers, whatever its length', () => {
        [6, 10].forEach((length) => {
            expect(guideFrameAt('hold', 0, '2:8', length).selected).toBe(1);
            expect(guideFrameAt('hold', 1950, '2:8', length).selected).toBe(length);
            expect(guideFrameAt('hold', 1950, '2:8', length).ai).toBe(false);
            expect(guideFrameAt('hold', 2300, '2:8', length).ai).toBe(true);
        });
        expect(guideFrameAt('hold', 4000, '2:8', 6).grammar).toBe(true);
    });

    it('steps focus mode to the next sentence and reads four sentences aloud', () => {
        expect(guideFrameAt('focus', 500, '2:8', 6).focus).toBe(2);
        expect(guideFrameAt('focus', 2100, '2:8', 6).focus).toBe(3);
        expect(guideFrameAt('listen', 400, '2:8', 6).reading).toBe(0);
        expect(guideFrameAt('listen', 9000, '2:8', 6).reading).toBe(3);
    });

    it('resolves target roles to the page', () => {
        const page = getGuidePage('ko', 'en');
        expect(guideTargetId(GUIDE_CLIPS.find((clip) => clip.key === 'tap'), page)).toBe(page.word);
        expect(guideTargetId(GUIDE_CLIPS.find((clip) => clip.key === 'hold'), page)).toBe(`${GUIDE_HOLD_SENTENCE}:0`);
        expect(guideTargetId(GUIDE_CLIPS.find((clip) => clip.key === 'focus'), page)).toBe('eye');
    });
});
