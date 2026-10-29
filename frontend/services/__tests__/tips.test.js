import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    __resetTipsMemory,
    areTipsEnabled,
    bumpTipCounter,
    canShowTip,
    isTipSeen,
    loadTips,
    markTipSeen,
    resetTips,
    TIP_IDS,
    tipClosed,
    tipCounter,
    tipOpened,
    UNPROMPTED_TIP_GAP_MS,
} from '../tips';

describe('first-time tips', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        __resetTipsMemory();
    });

    it('shows a tip once, and remembers it across launches', async () => {
        await loadTips();
        expect(canShowTip(TIP_IDS.readerFocus)).toBe(true);
        await markTipSeen(TIP_IDS.readerFocus);
        expect(canShowTip(TIP_IDS.readerFocus)).toBe(false);

        __resetTipsMemory();
        await loadTips();
        expect(isTipSeen(TIP_IDS.readerFocus)).toBe(true);
    });

    it('carries over the old dismissed tap tip', async () => {
        await AsyncStorage.setItem('lookupHintDismissed', 'true');
        await loadTips();
        expect(isTipSeen(TIP_IDS.readerTap)).toBe(true);
    });

    it('shows one tip at a time, and spaces out unprompted ones', async () => {
        await loadTips();
        tipOpened(TIP_IDS.readerFocus);
        expect(canShowTip(TIP_IDS.readerListen, { unprompted: false })).toBe(false);

        tipClosed(TIP_IDS.readerFocus, { now: 1000 });
        expect(canShowTip(TIP_IDS.readerListen, { now: 1000 + UNPROMPTED_TIP_GAP_MS - 1 })).toBe(false);
        expect(canShowTip(TIP_IDS.readerListen, { now: 1000 + UNPROMPTED_TIP_GAP_MS })).toBe(true);
        // A tip answering an action doesn't wait.
        expect(canShowTip(TIP_IDS.readerSaved, { unprompted: false, now: 1001 })).toBe(true);
    });

    it('waits only after a tip that was actually up', async () => {
        await loadTips();
        tipClosed(TIP_IDS.homeOcr, { now: 1000 });
        expect(canShowTip(TIP_IDS.readerFocus, { now: 1001 })).toBe(true);
    });

    it('counts lookups', async () => {
        await bumpTipCounter('lookups');
        await bumpTipCounter('lookups');
        expect(tipCounter('lookups')).toBe(2);
    });

    it('is on after onboarding, or after "show tips again"', async () => {
        expect(await areTipsEnabled()).toBe(false);
        await AsyncStorage.setItem('onboarding.flowSeen.v1', '1');
        expect(await areTipsEnabled()).toBe(true);

        await AsyncStorage.removeItem('onboarding.flowSeen.v1');
        await markTipSeen(TIP_IDS.readerFocus);
        await resetTips();
        expect(await areTipsEnabled()).toBe(true);
        expect(isTipSeen(TIP_IDS.readerFocus)).toBe(false);
    });
});
