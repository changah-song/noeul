import {
    GUIDE_BAR_SENTENCE,
    GUIDE_FOCUS_SENTENCE,
    GUIDE_HOLD_SENTENCE,
    GUIDE_LISTEN_SENTENCES,
} from './readerGuideContent';

// The reader guide's timeline (components/Guide/ReaderGuide.js). The guide is
// played like a video: each clip runs for `duration` ms, and everything the
// sample page shows is a pure function of (clip, ms) — so a clip can pause,
// replay, or wait for the viewer at its moment of action.
//
// `actionAt`: when the clip's gesture happens. In "try" mode the clip stops
// there until the viewer taps the lit spot (or asks to be shown).
// `target`: what gets tapped — a role, resolved to the page's word ids by the
// player ('word' = the page's word to look up, 'hold' = the held sentence's
// first word).
export const GUIDE_CLIPS = [
    { key: 'intro' },
    { key: 'tap', duration: 4200, actionAt: 900, target: 'word' },
    { key: 'bar', duration: 3800 },
    { key: 'save', duration: 3800, actionAt: 900, target: 'save' },
    { key: 'hold', duration: 6200, actionAt: 700, target: 'hold' },
    { key: 'focus', duration: 4800, actionAt: 700, target: 'eye' },
    { key: 'listen', duration: 5600, actionAt: 700, target: 'listen' },
    { key: 'done' },
];

export const GUIDE_STEP_COUNT = GUIDE_CLIPS.filter((clip) => clip.duration).length;
export const GUIDE_LAST_CLIP = GUIDE_CLIPS.length - 1;

// How long a touch ring stays on screen.
const TOUCH_MS = 450;

const touchingAt = (elapsed, from = 0) => elapsed >= from && elapsed < from + TOUCH_MS;

/**
 * What the sample page shows `elapsed` ms after the clip's action (or after
 * the clip's start, for a clip with no action); -1 = the action hasn't
 * happened yet. `word` is the page's word id, `holdLength` the number of
 * words in the held sentence.
 */
export const guideFrameAt = (key, elapsed, word, holdLength) => {
    const frame = {
        tapped: null,
        saved: false,
        savedMark: false,
        dictionary: false,
        bar: false,
        barSentence: GUIDE_BAR_SENTENCE,
        ai: false,
        grammar: false,
        selected: 0,
        holdTouch: -1,
        focus: null,
        reading: -1,
        touch: null,
        toast: false,
        swipe: false,
        focusOn: false,
        listenOn: false,
    };
    if (key === 'tap') {
        if (touchingAt(elapsed)) frame.touch = word;
        if (elapsed >= 150) frame.tapped = word;
        if (elapsed >= 220) frame.dictionary = true;
    } else if (key === 'bar') {
        frame.tapped = word;
        frame.dictionary = true;
        frame.bar = elapsed >= 300 && elapsed < 3300;
    } else if (key === 'save') {
        frame.tapped = word;
        frame.dictionary = true;
        if (touchingAt(elapsed)) frame.touch = 'save';
        frame.saved = elapsed >= 120;
        frame.toast = elapsed >= 300 && elapsed < 2600;
    } else if (key === 'hold') {
        frame.savedMark = true;
        if (elapsed >= 0) {
            // The drag takes the same time however many words the sentence has.
            const step = 1400 / Math.max(1, holdLength - 1);
            frame.selected = elapsed < 500 ? 1 : Math.min(holdLength, 1 + Math.floor((elapsed - 500) / step));
            if (elapsed < 2050) frame.holdTouch = frame.selected - 1;
        }
        frame.ai = elapsed >= 2250;
        if (touchingAt(elapsed, 3700)) frame.touch = 'grammar';
        frame.grammar = elapsed >= 3900;
    } else if (key === 'focus') {
        frame.savedMark = true;
        if (touchingAt(elapsed)) frame.touch = 'eye';
        if (elapsed >= 150) {
            frame.focusOn = true;
            frame.focus = elapsed >= 2050 ? GUIDE_FOCUS_SENTENCE + 1 : GUIDE_FOCUS_SENTENCE;
        }
        frame.swipe = elapsed >= 1550 && elapsed < 2050;
    } else if (key === 'listen') {
        frame.savedMark = true;
        if (touchingAt(elapsed)) frame.touch = 'listen';
        if (elapsed >= 150) {
            frame.listenOn = true;
            frame.reading = Math.max(0, Math.min(GUIDE_LISTEN_SENTENCES - 1, Math.floor((elapsed - 300) / 1250)));
        }
    } else if (key === 'done') {
        frame.savedMark = true;
    }
    return frame;
};

/** The word id a clip's target role points at on this page. */
export const guideTargetId = (clip, page) => {
    if (clip?.target === 'word') return page.word;
    if (clip?.target === 'hold') return `${GUIDE_HOLD_SENTENCE}:0`;
    return clip?.target ?? null;
};
