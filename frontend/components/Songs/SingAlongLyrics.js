import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { activeLineIndex } from '../../services/lrc';

// The lyrics while the song plays: the line being sung is lit and kept a
// third of the way down; the others are dimmed. Words are coloured as in the
// book reader (services/lyricTint.js). A tap on a word looks it up and a long
// press explains it in its line (the AI explanation), as in the reader. Moving
// between lines is the player's back / next buttons; a row tap does nothing.
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

const SingAlongLyrics = ({
    lines,
    times,
    translations,
    subscribeTime,
    offset = 0,
    fontSize,
    lineHeight,
    isWordSaved,
    activeWord,
    onWordPress,
    onWordLongPress,
    // (text) → [{ text, color? }]: the word in pieces, its level colour on
    // the part the level term covers.
    tintWord,
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

    const follow = useCallback((index, animated = true) => {
        const layout = lineLayoutsRef.current.get(index);
        if (!layout || !scrollRef.current) return;
        const y = Math.max(0, layout.y - viewHeightRef.current / 3 + layout.height / 2);
        scrollRef.current.scrollTo({ y, animated });
    }, []);

    useEffect(() => {
        if (active < 0) return;
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

    return (
        <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
            showsVerticalScrollIndicator={false}
            onLayout={(event) => { viewHeightRef.current = event.nativeEvent.layout.height; }}
            onScrollBeginDrag={() => { userScrolledAtRef.current = Date.now(); }}
            onMomentumScrollEnd={() => { userScrolledAtRef.current = Date.now(); }}
            scrollEventThrottle={32}
        >
            {lines.map((line, index) => {
                const isActive = index === active;
                const translation = line.isBlank ? '' : translations?.get(line.text.trim());
                return (
                    <View
                        key={line.id}
                        onLayout={(event) => lineLayoutsRef.current.set(index, event.nativeEvent.layout)}
                    >
                        <Text
                            suppressHighlighting
                            style={[
                                lyricStyles.lyricLine,
                                { fontSize, lineHeight },
                                line.isBlank && lyricStyles.lyricLineBlank,
                                !isActive && styles.dimmed,
                                isActive && { color: colors.readerBodyInk },
                            ]}
                        >
                            {line.isBlank ? ' ' : line.segments.map((segment) => {
                                if (!segment.isWord) {
                                    return <Text key={segment.id}>{segment.text}</Text>;
                                }
                                const saved = isWordSaved(segment.text);
                                const tapped = activeWord(segment.text);
                                const pieces = saved || tapped || !tintWord ? null : tintWord(segment.text);
                                const word = { text: segment.text, sentence: line.text };
                                return (
                                    <Text
                                        key={segment.id}
                                        suppressHighlighting
                                        onPress={() => onWordPress(word)}
                                        onLongPress={onWordLongPress ? () => onWordLongPress(word) : undefined}
                                        style={[
                                            saved && lyricStyles.savedLyricWord,
                                            tapped && lyricStyles.activeLyricWord,
                                        ]}
                                    >
                                        {pieces && pieces.some((piece) => piece.color)
                                            ? pieces.map((piece, pieceIndex) => (piece.color ? (
                                                // eslint-disable-next-line react/no-array-index-key
                                                <Text key={pieceIndex} style={{ color: piece.color }}>{piece.text}</Text>
                                            ) : piece.text))
                                            : segment.text}
                                    </Text>
                                );
                            })}
                        </Text>
                        {translation ? (
                            <Text
                                suppressHighlighting
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
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: {
        flex: 1,
    },
    content: {
        paddingTop: 24,
        paddingHorizontal: 24,
    },
    dimmed: {
        opacity: 0.38,
    },
});

export default memo(SingAlongLyrics);
