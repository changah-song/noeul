import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { activeLineIndex } from '../../services/lrc';

// The lyrics while the song plays: the line being sung is lit and kept a
// third of the way down; the others are dimmed. Words behave as in the book
// reader: coloured by level (services/lyricTint.js); a tap looks the word up
// and marks just that word, a second tap saves it; a long press selects it and
// a drag carries the selection across words (and lines), and letting go opens
// the AI explanation. Moving between lines is the player's back / next
// buttons; a tap off the words closes the panel.
// After the reader scrolls by hand the view stops following for a few seconds.
// A line's translation, when there is one, sits under it in the muted ink.
//
// The time comes through `subscribeTime` instead of a prop so only this list
// renders four times a second, not the whole song reader.

const RESUME_FOLLOW_MS = 4000;
// A line's translation is drawn this much smaller than the lyrics.
export const TRANSLATION_SCALE = 0.68;

// A line's translation text style: smaller, and pulled up over the lyric
// line's extra leading so it sits right under the words, not a line below.
export const translationTextStyle = (fontSize, lineHeight) => {
    const size = Math.max(12, Math.round(fontSize * TRANSLATION_SCALE));
    const leading = Math.max(0, lineHeight - fontSize * 1.25);
    return {
        fontSize: size,
        lineHeight: Math.round(size * 1.3),
        marginTop: -Math.round(leading / 2),
    };
};

// The flat list of a song's segments (words, spaces, punctuation) in reading
// order, so a selection can run from one word to another across lines.
const flattenSegments = (lines) => {
    const flat = [];
    const indexByKey = new Map();
    lines.forEach((line, lineIndex) => {
        if (line.isBlank) return;
        line.segments.forEach((segment) => {
            const key = `${lineIndex}:${segment.id}`;
            indexByKey.set(key, flat.length);
            flat.push({ key, lineIndex, text: segment.text, isWord: segment.isWord });
        });
    });
    return { flat, indexByKey };
};

// What a selection from flat index `a` to `b` reads, and the lines it spans
// (the sentence the explanation is given).
export const selectionText = (lines, flat, a, b) => {
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    let text = '';
    let lastLine = null;
    const lineIndexes = [];
    for (let index = from; index <= to; index += 1) {
        const item = flat[index];
        if (!item) continue;
        if (lastLine !== null && item.lineIndex !== lastLine) text += ' ';
        if (item.lineIndex !== lastLine) lineIndexes.push(item.lineIndex);
        lastLine = item.lineIndex;
        text += item.text;
    }
    const sentence = lineIndexes.map((index) => lines[index]?.text?.trim()).filter(Boolean).join(' ');
    return { text: text.replace(/\s+/g, ' ').trim(), sentence };
};

const SingAlongLyrics = ({
    lines,
    times,
    translations,
    subscribeTime,
    offset = 0,
    fontSize,
    lineHeight,
    // (text) → the saved word's shade strength (1, fading toward 0 as it is
    // passed without a lookup), 0 when not saved.
    savedStrength,
    // True while the definition panel is open on a tapped word: that word
    // (only the one tapped, not its other copies) gets the ink box.
    lookupOpen = false,
    onWordPress,
    // ({ text, sentence }) when a long-press selection is let go: one word, or
    // several dragged across, as in the book reader.
    onSelectText,
    // True while the explanation of the selection is open: it stays marked.
    selectionOpen = false,
    // (text) → [{ text, color? }]: the word in pieces, its level colour on
    // the part the level term covers.
    tintWord,
    // A tap on the page that isn't on a word (closes the lookup panel).
    onBackgroundPress,
    // Bumped when the reader jumps to a line (the back / next buttons): the
    // view follows again at once, even right after a scroll by hand.
    followToken = 0,
    bottomPadding = 0,
    colors,
    styles: lyricStyles,
}) => {
    const translationStyle = translationTextStyle(fontSize, lineHeight);
    const [active, setActive] = useState(-1);
    const scrollRef = useRef(null);
    const viewHeightRef = useRef(0);
    const lineLayoutsRef = useRef(new Map());
    const userScrolledAtRef = useRef(0);

    useEffect(() => subscribeTime((time) => {
        const next = activeLineIndex(times, time + offset);
        setActive((current) => (current === next ? current : next));
    }), [offset, subscribeTime, times]);

    // ── Selection (long press, then drag) ───────────────────────────────────
    const { flat, indexByKey } = useMemo(() => flattenSegments(lines), [lines]);
    const [tappedKey, setTappedKey] = useState(null);
    const [selection, setSelection] = useState(null); // { anchor, focus } flat indexes
    const selectingRef = useRef(null); // { anchor, focus, claimed }
    const rowLayoutsRef = useRef(new Map()); // lineIndex → row layout in its line
    const wordLayoutsRef = useRef(new Map()); // flat index → layout in its row
    const linesBoxRef = useRef(null);
    const linesOriginRef = useRef({ x: 0, y: 0 });
    const onSelectTextRef = useRef(onSelectText);
    onSelectTextRef.current = onSelectText;

    // Once the explanation closes, the selection mark goes with it.
    useEffect(() => {
        if (!selectionOpen && !selectingRef.current) setSelection(null);
    }, [selectionOpen]);

    const setScrollEnabled = useCallback((enabled) => {
        scrollRef.current?.setNativeProps?.({ scrollEnabled: enabled });
    }, []);

    // The word nearest a point in the lines box (rows weigh more than columns,
    // so a drag along a line stays on it).
    const wordAt = useCallback((x, y) => {
        let best = -1;
        let bestScore = Infinity;
        wordLayoutsRef.current.forEach((layout, index) => {
            const item = flat[index];
            if (!item?.isWord) return;
            const line = lineLayoutsRef.current.get(item.lineIndex);
            const row = rowLayoutsRef.current.get(item.lineIndex);
            if (!line || !row) return;
            const left = line.x + row.x + layout.x;
            const top = line.y + row.y + layout.y;
            const dx = x < left ? left - x : (x > left + layout.width ? x - left - layout.width : 0);
            const dy = y < top ? top - y : (y > top + layout.height ? y - top - layout.height : 0);
            const score = dx + dy * 4;
            if (score < bestScore) {
                bestScore = score;
                best = index;
            }
        });
        return best;
    }, [flat]);

    const finishSelection = useCallback(() => {
        const current = selectingRef.current;
        selectingRef.current = null;
        setScrollEnabled(true);
        if (!current) return;
        const picked = selectionText(lines, flat, current.anchor, current.focus);
        if (picked.text) onSelectTextRef.current?.(picked);
        else setSelection(null);
    }, [flat, lines, setScrollEnabled]);

    const startSelection = useCallback((index) => {
        if (index == null || index < 0) return;
        selectingRef.current = { anchor: index, focus: index, claimed: false };
        userScrolledAtRef.current = Date.now();
        setScrollEnabled(false);
        setTappedKey(null);
        setSelection({ anchor: index, focus: index });
        linesBoxRef.current?.measure?.((_x, _y, _w, _h, pageX, pageY) => {
            linesOriginRef.current = { x: pageX, y: pageY };
        });
    }, [setScrollEnabled]);

    const moveSelection = useCallback((pageX, pageY) => {
        const current = selectingRef.current;
        if (!current) return;
        const origin = linesOriginRef.current;
        const index = wordAt(pageX - origin.x, pageY - origin.y);
        if (index < 0 || index === current.focus) return;
        current.focus = index;
        setSelection({ anchor: current.anchor, focus: index });
    }, [wordAt]);

    // Dragging after the long press: the lines box takes the touch from the
    // word (only while a selection is being made, so taps and scrolls are
    // left alone).
    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => !!selectingRef.current,
        onPanResponderGrant: () => {
            if (selectingRef.current) selectingRef.current.claimed = true;
        },
        onPanResponderMove: (event) => moveSelection(event.nativeEvent.pageX, event.nativeEvent.pageY),
        onPanResponderRelease: finishSelection,
        onPanResponderTerminate: finishSelection,
        onPanResponderTerminationRequest: () => false,
    }), [finishSelection, moveSelection]);

    // A long press let go without a drag ends on the word itself. (When the
    // drag took over, the word's press-out comes after that grant.)
    const handleWordPressOut = useCallback(() => {
        setTimeout(() => {
            if (selectingRef.current && !selectingRef.current.claimed) finishSelection();
        }, 0);
    }, [finishSelection]);

    const selFrom = selection ? Math.min(selection.anchor, selection.focus) : -1;
    const selTo = selection ? Math.max(selection.anchor, selection.focus) : -1;

    const follow = useCallback((index, animated = true) => {
        const layout = lineLayoutsRef.current.get(index);
        if (!layout || !scrollRef.current) return;
        const y = Math.max(0, layout.y - viewHeightRef.current / 3 + layout.height / 2);
        scrollRef.current.scrollTo({ y, animated });
    }, []);

    useEffect(() => {
        if (active < 0) return;
        if (selectingRef.current) return;
        if (Date.now() - userScrolledAtRef.current < RESUME_FOLLOW_MS) return;
        follow(active);
    }, [active, follow]);

    const activeRef = useRef(active);
    activeRef.current = active;
    useEffect(() => {
        if (!followToken) return;
        userScrolledAtRef.current = 0;
        if (activeRef.current >= 0) follow(activeRef.current);
    }, [follow, followToken]);

    const textStyle = [lyricStyles.lyricLine, lyricStyles.lyricLineInRow, { fontSize, lineHeight }];

    // Where a word's baseline sits in its Text (every word has the same type,
    // so one reading serves all); read again when the type changes.
    const [baseline, setBaseline] = useState(null);
    useEffect(() => { setBaseline(null); }, [fontSize, lineHeight]);
    const handleTextLayout = useCallback((event) => {
        const line = event?.nativeEvent?.lines?.[0];
        const next = Number.isFinite(line?.baseline) ? line.baseline : (
            Number.isFinite(line?.y) && Number.isFinite(line?.ascender) ? line.y + line.ascender : null
        );
        if (next != null) setBaseline((current) => (current === next ? current : next));
    }, []);

    return (
        <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.contentFill}
            showsVerticalScrollIndicator={false}
            onLayout={(event) => { viewHeightRef.current = event.nativeEvent.layout.height; }}
            onScrollBeginDrag={() => { userScrolledAtRef.current = Date.now(); }}
            onMomentumScrollEnd={() => { userScrolledAtRef.current = Date.now(); }}
            scrollEventThrottle={32}
        >
            {/* A tap that lands on no word closes the panel, as on a book
                page; word taps are caught by the words first. */}
            <Pressable
                onPress={onBackgroundPress}
                android_disableSound
                accessible={false}
                // The margins are inside, so a tap there closes the panel too.
                style={[styles.content, { paddingBottom: bottomPadding }]}
            >
            <View ref={linesBoxRef} collapsable={false} {...panResponder.panHandlers}>
            {lines.map((line, index) => {
                const isActive = index === active;
                const translation = line.isBlank ? '' : translations?.get(line.text.trim());
                return (
                    <View
                        key={line.id}
                        onLayout={(event) => lineLayoutsRef.current.set(index, event.nativeEvent.layout)}
                    >
                        {/* One Text a word, so each has a place on screen for
                            the drag to find; wrapped and centred like a line. */}
                        <View
                            style={[
                                styles.row,
                                line.isBlank && lyricStyles.lyricLineBlank,
                                !isActive && styles.dimmed,
                            ]}
                            onLayout={(event) => rowLayoutsRef.current.set(index, event.nativeEvent.layout)}
                        >
                            {line.isBlank ? <Text style={textStyle}> </Text> : line.segments.map((segment) => {
                                const key = `${index}:${segment.id}`;
                                const flatIndex = indexByKey.get(key);
                                const selected = flatIndex >= selFrom && flatIndex <= selTo;
                                if (!segment.isWord) {
                                    return (
                                        <Text
                                            key={segment.id}
                                            onPress={onBackgroundPress}
                                            style={[textStyle, lyricStyles.lyricWord]}
                                        >
                                            {segment.text}
                                        </Text>
                                    );
                                }
                                const strength = savedStrength ? savedStrength(segment.text) : 0;
                                const tapped = lookupOpen && tappedKey === key;
                                const pieces = tapped || !tintWord ? null : tintWord(segment.text);
                                const marks = wordMarks(fontSize, lineHeight, baseline);
                                return (
                                    <View
                                        key={segment.id}
                                        onLayout={(event) => wordLayoutsRef.current.set(flatIndex, event.nativeEvent.layout)}
                                    >
                                    {/* The book reader's marks, drawn behind the word:
                                        a saved word's light ink shade and underline,
                                        the tapped word's solid ink box (rounded, snug
                                        to the letters), the selection tint. */}
                                    {strength > 0.01 && !tapped ? (
                                        <>
                                            <View
                                                pointerEvents="none"
                                                style={[styles.mark, marks.box, {
                                                    backgroundColor: inkWithAlpha(colors.readerSavedWordSurfaceBg, SAVED_SHADE_ALPHA * strength),
                                                }]}
                                            />
                                            <View
                                                pointerEvents="none"
                                                style={[styles.mark, marks.underline, {
                                                    backgroundColor: inkWithAlpha(colors.readerSavedWordSurfaceBg, SAVED_UNDERLINE_ALPHA * strength),
                                                }]}
                                            />
                                        </>
                                    ) : null}
                                    {tapped ? (
                                        <View
                                            pointerEvents="none"
                                            style={[styles.mark, marks.box, { backgroundColor: colors.readerTappedWordBg }]}
                                        />
                                    ) : null}
                                    {selected ? (
                                        <View pointerEvents="none" style={[styles.mark, marks.box, selectedStyle(colors)]} />
                                    ) : null}
                                    <Text
                                        suppressHighlighting
                                        onTextLayout={baseline == null ? handleTextLayout : undefined}
                                        onPress={() => {
                                            const again = lookupOpen && tappedKey === key;
                                            if (!lookupOpen) setTappedKey(key);
                                            onWordPress({ text: segment.text, sentence: line.text, again });
                                        }}
                                        onLongPress={onSelectText ? () => startSelection(flatIndex) : undefined}
                                        onPressOut={handleWordPressOut}
                                        style={[
                                            textStyle,
                                            // Plain colours set explicitly: on Android a
                                            // Text keeps an old colour when its style
                                            // just drops the property.
                                            lyricStyles.lyricWord,
                                            tapped && { color: colors.readerTappedWordText },
                                        ]}
                                    >
                                        {pieces && pieces.some((piece) => piece.color)
                                            ? pieces.map((piece, pieceIndex) => (piece.color ? (
                                                // eslint-disable-next-line react/no-array-index-key
                                                <Text key={pieceIndex} style={{ color: piece.color }}>{piece.text}</Text>
                                            ) : piece.text))
                                            : segment.text}
                                    </Text>
                                    </View>
                                );
                            })}
                        </View>
                        {translation ? (
                            <Text
                                suppressHighlighting
                                onPress={onBackgroundPress}
                                style={[
                                    lyricStyles.lineTranslation,
                                    translationStyle,
                                    !isActive && styles.dimmed,
                                ]}
                            >
                                {translation}
                            </Text>
                        ) : null}
                    </View>
                );
            })}
            </View>
            </Pressable>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: {
        flex: 1,
    },
    contentFill: {
        flexGrow: 1,
    },
    content: {
        flexGrow: 1,
        paddingTop: 24,
        paddingHorizontal: 24,
    },
    mark: {
        position: 'absolute',
    },
    // A lyric line: its words wrapped and centred.
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 10,
    },
    dimmed: {
        opacity: 0.38,
    },
});

// The book reader's saved-word marks (EpubPageView.kt): a shade of the ink
// at this opacity, and an ink underline at this one, both times the word's
// fade strength.
const SAVED_SHADE_ALPHA = 0.16;
const SAVED_UNDERLINE_ALPHA = 0.85;

// '#rrggbb' (or '#rrggbbaa') with its alpha set to `alpha` (0–1).
export const inkWithAlpha = (color, alpha) => {
    const match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(color || ''));
    if (!match) return color;
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
    return `#${match[1]}${a}`;
};

// Where the marks sit in a word's line box: snug to the letters (the line's
// extra leading is split above and below the glyphs), rounded 3, with the
// underline 2 thick just under the baseline — as the book reader draws them.
// `baseline` is the word's baseline from the top of its Text, as the text
// layout reports it; the book reader centres its 2-thick underline 3 below
// the baseline (drawLevelUnderline).
const UNDERLINE_BELOW_BASELINE = 3;
const UNDERLINE_THICKNESS = 2;
const wordMarks = (fontSize, lineHeight, baseline) => {
    const glyphs = fontSize * 1.18;
    const top = Math.max(0, (lineHeight - glyphs) / 2) - 1;
    const base = Number.isFinite(baseline) ? baseline : top + 1 + glyphs * 0.86;
    return {
        box: { top, height: glyphs + 3, left: -1, right: -1, borderRadius: 3 },
        underline: {
            top: base + UNDERLINE_BELOW_BASELINE - UNDERLINE_THICKNESS / 2,
            height: UNDERLINE_THICKNESS,
            left: 0,
            right: 0,
        },
    };
};

// The book reader's text-selection tint.
const selectedStyle = (colors) => ({ backgroundColor: colors.readerTextSelectionHighlight });

export default memo(SingAlongLyrics);
