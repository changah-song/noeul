import { useCallback, useRef, useState } from 'react';
import { tapSelect } from '../services/haptics';
import { resolveTextSelection, resolveWordSelection } from '../services/readerSelection';

/**
 * useReaderLookup — lookup-panel state and native selection handlers for a
 * NativeEpubReaderView surface. Same behavior as the book reader (Read.js):
 *   • a word tap opens the dictionary panel (with a light haptic tick)
 *   • a word tap while the panel is already open ONLY closes the panel
 *   • a long-press range selection opens the AI explanation
 *     (`textSelection`), as in the book reader
 *   • tapping empty space (onSelectionCleared) closes the panel
 *
 * Read.js still carries its own inline copy of these handlers (they are
 * interleaved with focus-mode/settings state there); it can adopt this hook
 * later.
 *
 * @param {object}   [options]
 * @param {function} [options.onWordLookup] called with { text, sentence } for
 *   every genuine new word selection (not for panel-dismiss taps)
 * @param {function} [options.cleanText] optional surface cleanup before use
 */
const useReaderLookup = ({ onWordLookup, cleanText } = {}) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [clearSelectionToken, setClearSelectionToken] = useState(0);
    // The long-pressed text and its sentence, for the AI explanation.
    const [textSelection, setTextSelection] = useState(null);

    // Refs let the native callbacks read the latest state without being
    // re-created (which would churn the native view's props).
    const lookupOpenRef = useRef(false);
    lookupOpenRef.current = !!highlightedWord || !!textSelection;
    const onWordLookupRef = useRef(onWordLookup);
    onWordLookupRef.current = onWordLookup;
    const cleanTextRef = useRef(cleanText);
    cleanTextRef.current = cleanText;

    const resetLookupState = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setTextSelection(null);
    }, []);

    // Ask native to drop its current selection highlight.
    const clearNativeSelection = useCallback(() => {
        setClearSelectionToken((value) => value + 1);
    }, []);

    const dismissLookup = useCallback(() => {
        resetLookupState();
        clearNativeSelection();
    }, [clearNativeSelection, resetLookupState]);

    const handleNativeWordSelected = useCallback((event = {}) => {
        const result = resolveWordSelection(event, {
            lookupOpen: lookupOpenRef.current,
            cleanText: cleanTextRef.current,
        });
        if (result.type === 'ignore') {
            return;
        }
        if (result.type === 'dismiss') {
            dismissLookup();
            return;
        }

        tapSelect();
        onWordLookupRef.current?.({ text: result.text, sentence: result.sentence });

        setTextSelection(null);
        setIsNativeSelection(false);
        setHighlightedWord(result.text);
        setHighlightedWordContext({ sentence: result.sentence });
        setLookupPlacement(result.placement);
    }, [dismissLookup]);

    const handleNativeTextSelected = useCallback((event = {}) => {
        const result = resolveTextSelection(event);
        if (result.type !== 'select') {
            return;
        }
        setIsNativeSelection(true);
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setTextSelection({
            text: result.text,
            sentence: typeof event.sentence === 'string' ? event.sentence.trim() : '',
        });
        // The explanation always opens at the bottom, like a sheet.
        setLookupPlacement('bottom');
    }, []);

    // A long press the JS lyric views handle themselves (a whole line).
    const openTextSelection = useCallback(({ text, sentence } = {}) => {
        const clean = typeof text === 'string' ? text.trim() : '';
        if (!clean) return;
        tapSelect();
        setIsNativeSelection(true);
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setTextSelection({ text: clean, sentence: typeof sentence === 'string' ? sentence.trim() : clean });
        setLookupPlacement('bottom');
    }, []);

    // Native already cleared its own selection; just close the panel.
    const handleNativeSelectionCleared = resetLookupState;

    return {
        highlightedWord,
        highlightedWordContext,
        isNativeSelection,
        textSelection,
        lookupPlacement,
        clearSelectionToken,
        dismissLookup,
        openTextSelection,
        clearNativeSelection,
        handleNativeWordSelected,
        handleNativeTextSelected,
        handleNativeSelectionCleared,
    };
};

export default useReaderLookup;
