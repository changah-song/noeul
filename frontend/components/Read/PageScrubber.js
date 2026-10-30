import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';

export const PAGE_SCRUBBER_HEIGHT = 56;
const SIDE = 24;
const PERCENT_WIDTH = 52;
const THUMB = 12;
const THUMB_DRAGGING = 18;
const PREVIEW_WIDTH = 210;
const PREVIEW_HEIGHT = 250;
// Bookmarks nearer than this on the line share one mark with a count.
const BOOKMARK_MERGE_PX = 18;
// Chapter rings nearer than this to the last one shown are left out.
const MARK_MIN_GAP_PX = 7;

const clamp01 = (value) => Math.min(Math.max(Number(value) || 0, 0), 1);

/**
 * PageScrubber — where you are in the book, along the bottom of the reader.
 * A line with a dot (drag it, or tap the line, to move through the book),
 * rings where chapters start, bookmarks above the line (close ones share a
 * mark with a count that opens a list), and the percent, which opens the
 * contents. While dragging, a plain page preview shows the chapter there.
 *
 * Positions are 0..1 through the story (screens/Read.js maps them to and
 * from chapters, services/storyRange.js).
 */
const PageScrubber = ({
    progress = 0,
    chapters = [],
    bookmarks = [],
    describe,
    onSeek,
    onDragTarget,
    onSelectBookmark,
    onOpenContents,
    bottomInset = 0,
}) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [width, setWidth] = useState(0);
    const [dragFraction, setDragFraction] = useState(null);
    const [picker, setPicker] = useState(null);
    const startXRef = useRef(0);
    const widthRef = useRef(0);
    widthRef.current = width;
    const callbacks = useRef({});
    callbacks.current = { onSeek, onDragTarget };

    // After letting go the dot stays where it was dropped until the reader
    // reports arriving there (its first report can still be the chapter top).
    const [released, setReleased] = useState(null);
    const releasedTimerRef = useRef(null);
    useEffect(() => {
        if (released !== null && Math.abs(clamp01(progress) - released) < 0.03) setReleased(null);
    }, [progress, released]);
    useEffect(() => () => clearTimeout(releasedTimerRef.current), []);
    const holdReleased = (fraction) => {
        setReleased(fraction);
        clearTimeout(releasedTimerRef.current);
        releasedTimerRef.current = setTimeout(() => setReleased(null), 4000);
    };
    const holdRef = useRef(holdReleased);
    holdRef.current = holdReleased;

    const dragging = dragFraction !== null;
    const shown = dragging ? dragFraction : (released ?? clamp01(progress));
    const percent = Math.round(shown * 100);

    const fractionAt = (x) => clamp01(x / Math.max(1, widthRef.current));
    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
            startXRef.current = event.nativeEvent.locationX;
            const fraction = fractionAt(startXRef.current);
            setDragFraction(fraction);
            callbacks.current.onDragTarget?.(fraction);
        },
        onPanResponderMove: (_event, gesture) => {
            const fraction = fractionAt(startXRef.current + gesture.dx);
            setDragFraction(fraction);
            callbacks.current.onDragTarget?.(fraction);
        },
        onPanResponderRelease: (_event, gesture) => {
            const fraction = fractionAt(startXRef.current + gesture.dx);
            setDragFraction(null);
            holdRef.current(fraction);
            callbacks.current.onSeek?.(fraction);
        },
        onPanResponderTerminate: () => setDragFraction(null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);

    const marks = useMemo(() => {
        if (!width) return [];
        const shownMarks = [];
        chapters.forEach((chapter) => {
            const x = clamp01(chapter.at) * width;
            const last = shownMarks[shownMarks.length - 1];
            if (x < MARK_MIN_GAP_PX || x > width - 2) return;
            if (last && x - last.x < MARK_MIN_GAP_PX) return;
            shownMarks.push({ ...chapter, x });
        });
        return shownMarks;
    }, [chapters, width]);

    const bookmarkGroups = useMemo(() => {
        if (!width) return [];
        const groups = [];
        [...bookmarks]
            .sort((a, b) => a.at - b.at)
            .forEach((bookmark) => {
                const x = clamp01(bookmark.at) * width;
                const last = groups[groups.length - 1];
                if (last && x - last.lastX < BOOKMARK_MERGE_PX) {
                    last.items.push(bookmark);
                    last.lastX = x;
                } else {
                    groups.push({ x, lastX: x, items: [bookmark] });
                }
            });
        return groups;
    }, [bookmarks, width]);

    const preview = dragging ? describe?.(dragFraction) : null;
    const thumbSize = dragging ? THUMB_DRAGGING : THUMB;
    const thumbX = shown * width;
    const previewLeft = Math.max(-SIDE + 12, Math.min(width - PREVIEW_WIDTH + PERCENT_WIDTH - 12, thumbX - PREVIEW_WIDTH / 2));

    return (
        <View style={[styles.bar, { paddingBottom: bottomInset, height: PAGE_SCRUBBER_HEIGHT + bottomInset }]}>
            <View style={styles.row}>
                <View
                    style={styles.trackArea}
                    onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
                    {...panResponder.panHandlers}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={t('read.scrubberLabel')}
                    accessibilityValue={{ min: 0, max: 100, now: percent, text: t('common.percent', { value: percent }) }}
                    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                    onAccessibilityAction={(event) => {
                        const step = event.nativeEvent.actionName === 'increment' ? 0.05 : -0.05;
                        onSeek?.(clamp01(progress + step));
                    }}
                >
                    <View pointerEvents="none" style={styles.track} />
                    <View pointerEvents="none" style={[styles.trackFill, { width: thumbX }]} />
                    {marks.map((mark) => (
                        <View
                            key={mark.spineIndex}
                            pointerEvents="none"
                            style={[styles.mark, { left: mark.x - 4 }, mark.at <= shown && styles.markPassed]}
                        />
                    ))}
                    <View
                        pointerEvents="none"
                        style={[
                            styles.thumb,
                            {
                                width: thumbSize,
                                height: thumbSize,
                                borderRadius: thumbSize / 2,
                                left: thumbX - thumbSize / 2,
                                top: TRACK_Y - thumbSize / 2 + 1,
                            },
                            dragging && styles.thumbDragging,
                        ]}
                    />
                </View>
                <TouchableOpacity
                    onPress={onOpenContents}
                    style={styles.percentButton}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('read.contents')}, ${t('common.percent', { value: percent })}`}
                >
                    <Text style={styles.percent}>{t('common.percent', { value: percent })}</Text>
                </TouchableOpacity>
            </View>

            {bookmarkGroups.map((group) => (
                <TouchableOpacity
                    key={`${group.items[0].id}`}
                    style={[styles.bookmark, { left: SIDE + group.x - 12 }]}
                    hitSlop={{ top: 6, bottom: 2, left: 4, right: 4 }}
                    onPress={() => (group.items.length > 1
                        ? setPicker(group.items)
                        : onSelectBookmark?.(group.items[0]))}
                    accessibilityRole="button"
                    accessibilityLabel={group.items.length > 1
                        ? t('read.scrubberBookmarks', { count: group.items.length })
                        : `${t('read.checkpoints')}: ${group.items[0].where}`}
                >
                    <MaterialIcons name="bookmark" size={14} color={colors.readerBodyInk} style={styles.bookmarkIcon} />
                    {group.items.length > 1 ? (
                        <Text style={styles.bookmarkCount}>{group.items.length}</Text>
                    ) : null}
                </TouchableOpacity>
            ))}

            {preview ? (
                <View pointerEvents="none" style={[styles.preview, { left: SIDE + previewLeft, bottom: PAGE_SCRUBBER_HEIGHT + bottomInset + 10 }]}>
                    {preview.title ? <Text style={styles.previewTitle} numberOfLines={2}>{preview.title}</Text> : null}
                    <Text style={styles.previewText} numberOfLines={9}>{preview.text || ''}</Text>
                    <View style={styles.previewFooter}>
                        <Text style={styles.previewMeta} numberOfLines={1}>{preview.chapter || ''}</Text>
                        <Text style={styles.previewMeta}>{t('common.percent', { value: percent })}</Text>
                    </View>
                </View>
            ) : null}

            <Modal visible={Boolean(picker)} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
                <Pressable style={styles.pickerBackdrop} onPress={() => setPicker(null)} accessibilityLabel={t('common.close')}>
                    <View style={[styles.picker, { marginBottom: PAGE_SCRUBBER_HEIGHT + bottomInset + 8 }]}>
                        {(picker || []).map((bookmark) => (
                            <TouchableOpacity
                                key={bookmark.id}
                                style={styles.pickerRow}
                                onPress={() => {
                                    setPicker(null);
                                    onSelectBookmark?.(bookmark);
                                }}
                                accessibilityRole="button"
                            >
                                <Text style={styles.pickerWhere}>{bookmark.where}</Text>
                                {bookmark.snippet ? (
                                    <Text style={styles.pickerSnippet} numberOfLines={2}>{bookmark.snippet}</Text>
                                ) : null}
                            </TouchableOpacity>
                        ))}
                    </View>
                </Pressable>
            </Modal>
        </View>
    );
};

// The line's height inside the touch strip.
const TRACK_Y = 30;

const createStyles = (colors) => ({
    bar: {
        backgroundColor: colors.readerPaper,
        borderTopWidth: 1,
        borderTopColor: colors.readerHairline,
    },
    row: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'stretch',
        paddingLeft: SIDE,
    },
    trackArea: {
        flex: 1,
        position: 'relative',
    },
    track: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: TRACK_Y,
        height: 2,
        borderRadius: 1,
        backgroundColor: colors.readerHairline,
    },
    trackFill: {
        position: 'absolute',
        left: 0,
        top: TRACK_Y,
        height: 2,
        borderRadius: 1,
        backgroundColor: colors.readerBodyInk,
    },
    mark: {
        position: 'absolute',
        top: TRACK_Y - 3,
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: colors.readerPaper,
    },
    markPassed: {
        borderColor: colors.readerBodyInk,
    },
    thumb: {
        position: 'absolute',
        backgroundColor: colors.readerBodyInk,
    },
    thumbDragging: {
        borderWidth: 6,
        borderColor: colors.readerPaper,
        backgroundColor: colors.readerBodyInk,
        elevation: 2,
    },
    percentButton: {
        width: PERCENT_WIDTH,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: TRACK_Y - 9,
    },
    percent: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        color: colors.readerMutedInk,
        fontVariant: ['tabular-nums'],
    },
    bookmark: {
        position: 'absolute',
        top: 4,
        width: 24,
        height: 20,
        alignItems: 'center',
    },
    bookmarkIcon: {
        opacity: 0.75,
    },
    bookmarkCount: {
        position: 'absolute',
        left: 17,
        top: -3,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 10,
        color: colors.readerBodyInk,
    },
    preview: {
        position: 'absolute',
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.readerHairline,
        backgroundColor: colors.readerPaper,
        elevation: 8,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
    },
    previewTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: colors.readerBodyInk,
        marginBottom: 8,
    },
    previewText: {
        flex: 1,
        fontFamily: fontFamilies.serifRegular,
        fontSize: 11,
        lineHeight: 17,
        color: colors.readerBodyInk,
    },
    previewFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
        marginTop: 6,
    },
    previewMeta: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        color: colors.readerMutedInk,
    },
    pickerBackdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        paddingHorizontal: 16,
        backgroundColor: 'rgba(0,0,0,0.06)',
    },
    picker: {
        maxWidth: 300,
        padding: 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.readerHairline,
        backgroundColor: colors.readerPaper,
        elevation: 8,
    },
    pickerRow: {
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 10,
        gap: 3,
    },
    pickerWhere: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        color: colors.readerBodyInk,
    },
    pickerSnippet: {
        fontFamily: fontFamilies.serifRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.readerMutedInk,
    },
});

export default memo(PageScrubber);
