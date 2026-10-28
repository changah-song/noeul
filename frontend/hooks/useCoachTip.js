import { useCallback, useEffect, useRef, useState } from 'react';
import { canShowTip, loadTips, markTipSeen, tipClosed, tipOpened } from '../services/tips';

// One screen's first-time tip: `offer(id)` shows it if it hasn't been seen and
// no other tip is up (see services/tips.js for pacing); `close()` marks it seen.
export default function useCoachTip() {
    const [tipId, setTipId] = useState(null);
    const tipIdRef = useRef(null);

    const offer = useCallback(async (id, { unprompted = true } = {}) => {
        await loadTips();
        if (tipIdRef.current === id) return true;
        if (!canShowTip(id, { unprompted })) return false;
        tipOpened(id);
        tipIdRef.current = id;
        setTipId(id);
        return true;
    }, []);

    // `seen: false` hides the tip without using it up (it can come back later).
    const close = useCallback((id = tipIdRef.current, { seen = true } = {}) => {
        if (!id) return;
        if (seen) markTipSeen(id);
        if (tipIdRef.current !== id) return;
        tipClosed(id);
        tipIdRef.current = null;
        setTipId(null);
    }, []);

    // Leaving the screen with a tip up doesn't use it up.
    useEffect(() => () => {
        if (tipIdRef.current) tipClosed(tipIdRef.current);
    }, []);

    return { tipId, offer, close };
}
