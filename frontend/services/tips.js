import AsyncStorage from '@react-native-async-storage/async-storage';

// First-time tips: short explanations shown once, each at the moment its
// feature becomes relevant (see components/Tips/CoachTip.js). Seen tips and a
// few counters are kept in one AsyncStorage entry.
const TIPS_KEY = 'tips.v1';
// The reader's original tap tip, from before this module.
const LEGACY_LOOKUP_HINT_KEY = 'lookupHintDismissed';
// screens/Onboarding.js ONBOARDING_FLOW_SEEN_KEY: set for people who went
// through onboarding.
const ONBOARDING_FLOW_SEEN_KEY = 'onboarding.flowSeen.v1';

export const TIP_IDS = {
    readerTap: 'reader.tap',
    readerLongPress: 'reader.longPress',
    readerFocus: 'reader.focus',
    readerFocusNav: 'reader.focusNav',
    readerListen: 'reader.listen',
    readerSaved: 'reader.saved',
    homeOcr: 'home.ocr',
    learnAudio: 'learn.audio',
};

// A tip nobody asked for waits this long after the last one closed, so tips
// arrive one by one while reading instead of in a row.
export const UNPROMPTED_TIP_GAP_MS = 90 * 1000;
// Lookups before the long-press tip: by then tapping is familiar.
export const LONG_PRESS_TIP_AFTER_LOOKUPS = 5;

let state = null;
let loading = null;
let activeTipId = null;
let lastClosedAt = 0;

const emptyState = () => ({ seen: {}, counters: {}, enabled: false });

const persist = async () => {
    try {
        await AsyncStorage.setItem(TIPS_KEY, JSON.stringify(state));
    } catch {
        // Worst case a tip shows again.
    }
};

export const loadTips = async () => {
    if (state) return state;
    if (!loading) {
        loading = (async () => {
            let next = emptyState();
            try {
                const [raw, legacyTap] = await Promise.all([
                    AsyncStorage.getItem(TIPS_KEY),
                    AsyncStorage.getItem(LEGACY_LOOKUP_HINT_KEY),
                ]);
                const parsed = raw ? JSON.parse(raw) : null;
                if (parsed && typeof parsed === 'object') {
                    next = {
                        seen: { ...(parsed.seen || {}) },
                        counters: { ...(parsed.counters || {}) },
                        enabled: parsed.enabled === true,
                    };
                }
                if (legacyTap === 'true') next.seen[TIP_IDS.readerTap] = true;
            } catch {
                // Start fresh.
            }
            state = next;
            return state;
        })();
    }
    return loading;
};

export const isTipSeen = (id) => Boolean(state?.seen?.[id]);

// Tips beyond the reader's tap tip are for people who came through
// onboarding (or asked to see tips again), not for long-time readers.
export const areTipsEnabled = async () => {
    await loadTips();
    if (state.enabled) return true;
    try {
        return (await AsyncStorage.getItem(ONBOARDING_FLOW_SEEN_KEY)) === '1';
    } catch {
        return false;
    }
};

export const tipCounter = (name) => Number(state?.counters?.[name]) || 0;

export const markTipSeen = async (id) => {
    await loadTips();
    if (state.seen[id]) return;
    state.seen[id] = true;
    await persist();
};

export const bumpTipCounter = async (name) => {
    await loadTips();
    state.counters[name] = tipCounter(name) + 1;
    await persist();
    return state.counters[name];
};

// Whether `id` may appear now. Unprompted tips (shown at a quiet moment) also
// wait UNPROMPTED_TIP_GAP_MS after the last tip; a tip answering something the
// reader just did (their first save) only waits for the screen to be free.
export const canShowTip = (id, { unprompted = true, now = Date.now() } = {}) => {
    if (!state || isTipSeen(id)) return false;
    if (activeTipId && activeTipId !== id) return false;
    if (unprompted && lastClosedAt && now - lastClosedAt < UNPROMPTED_TIP_GAP_MS) return false;
    return true;
};

export const tipOpened = (id) => {
    activeTipId = id;
};

// How long until an unprompted tip may show (0: now).
export const msUntilUnpromptedTip = (now = Date.now()) => (
    lastClosedAt ? Math.max(0, lastClosedAt + UNPROMPTED_TIP_GAP_MS - now) : 0
);

// Only a tip that was up starts the wait before the next one.
export const tipClosed = (id, { now = Date.now() } = {}) => {
    if (activeTipId !== id) return;
    activeTipId = null;
    lastClosedAt = now;
};

// "Show tips again": every tip shows once more, for anyone.
export const resetTips = async () => {
    state = { ...emptyState(), enabled: true };
    activeTipId = null;
    lastClosedAt = 0;
    await persist();
    try {
        await AsyncStorage.removeItem(LEGACY_LOOKUP_HINT_KEY);
    } catch {
        // The tap tip may stay hidden.
    }
};

// For tests.
export const __resetTipsMemory = () => {
    state = null;
    loading = null;
    activeTipId = null;
    lastClosedAt = 0;
};
