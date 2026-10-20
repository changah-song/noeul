import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Animated,
    Easing,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies } from '../../theme';
import {
    SHEET_PADDING,
    SheetEmptyState,
    SheetHandle,
    SheetHeader,
    createSheetChromeStyles,
} from './ReaderSettingsControls';

const formatNoteDate = (iso, language = null) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(language ?? undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// Bookmarks store a 0-based page index within the chapter; readers count from 1.
// The chapter's page count is only known when the bookmark was taken from a page
// event, so fall back to the bare page number when it's missing.
const pageLabel = (t, bookmark) => {
    if (!Number.isInteger(bookmark?.pageIndex)) return null;
    const page = bookmark.pageIndex + 1;
    return Number.isInteger(bookmark.pagesInChapter) && bookmark.pagesInChapter > 0
        ? t('read.bookmarkPageOf', { page, total: bookmark.pagesInChapter })
        : t('read.bookmarkPage', { page });
};

/**
 * NotesLogSheet — the reader's checkpoints: bookmarked positions plus the log of
 * notes-to-self left in a book, newest first, reached from the reader menu's
 * "Checkpoints" row. Tapping a bookmark jumps the reader back to that spot;
 * pressing its bookmark icon removes it. Notes are view + delete; new notes are
 * written by long-pressing the header bookmark icon.
 */
const NotesLogSheet = ({
    visible,
    colors,
    insets,
    bookmarks = [],
    notes = [],
    onSelectBookmark,
    onDeleteBookmark,
    onDelete,
    onClose,
}) => {
    const { t, language } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const chrome = useMemo(() => createSheetChromeStyles(colors, insets), [colors, insets]);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);

    // Keep the sheet mounted through its exit animation, then unmount.
    const [mounted, setMounted] = useState(visible);
    // Slide travel is measured from the sheet's own height so it tucks fully
    // out of view without leaving a gap; the fixed fallback covers first paint.
    const [sheetHeight, setSheetHeight] = useState(0);
    const anim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.timing(anim, {
                toValue: 1,
                duration: 280,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(anim, {
                toValue: 0,
                duration: 200,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) {
                    setMounted(false);
                }
            });
        }
    }, [visible, anim]);

    const confirmDelete = () => {
        if (pendingDeleteId != null) {
            onDelete?.(pendingDeleteId);
        }
        setPendingDeleteId(null);
    };

    if (!mounted) {
        return null;
    }

    const sheetTranslateY = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [sheetHeight || 640, 0],
    });

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose}>
            <View style={styles.overlay}>
                {/* Gray scrim fades in smoothly to cover the background rather
                    than sliding up as a rectangle behind the sheet. */}
                <Animated.View
                    pointerEvents="none"
                    style={[styles.scrim, { opacity: anim }]}
                />
                <Pressable style={styles.backdrop} onPress={onClose} />
                <Animated.View
                    style={[chrome.sheet, styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}
                    onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
                >
                    <SheetHandle styles={chrome} />
                    <SheetHeader
                        styles={chrome}
                        colors={colors}
                        title={t('read.checkpoints')}
                        onClose={onClose}
                        closeLabel={t('common.close')}
                    />

                    {bookmarks.length === 0 && notes.length === 0 ? (
                        <SheetEmptyState
                            styles={chrome}
                            colors={colors}
                            icon="bookmark"
                            title={t('read.checkpointsEmptyTitle')}
                            body={t('read.checkpointsEmptyBody')}
                        />
                    ) : (
                        <ScrollView
                            style={styles.scroll}
                            contentContainerStyle={styles.scrollContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {bookmarks.length > 0 ? (
                                <View>
                                    <Text style={[chrome.sectionLabel, styles.sectionLabel]}>{t('read.bookmarksSection')}</Text>
                                    {bookmarks.map((bookmark) => (
                                        <TouchableOpacity
                                            key={bookmark.id}
                                            style={styles.bookmarkRow}
                                            onPress={() => onSelectBookmark?.(bookmark)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                        >
                                            <View style={styles.bookmarkBody}>
                                                <Text style={styles.bookmarkLabel} numberOfLines={1}>
                                                    {[
                                                        bookmark.chapterLabel,
                                                        pageLabel(t, bookmark),
                                                    ].filter(Boolean).join('  ·  ')}
                                                </Text>
                                                <Text style={styles.bookmarkMeta}>
                                                    {[
                                                        formatNoteDate(bookmark.createdAt, language),
                                                        typeof bookmark.progress === 'number'
                                                            ? `${Math.round(bookmark.progress * 100)}%`
                                                            : null,
                                                    ].filter(Boolean).join('  ·  ')}
                                                </Text>
                                            </View>
                                            <TouchableOpacity
                                                onPress={() => onDeleteBookmark?.(bookmark.id)}
                                                style={styles.rowAction}
                                                accessibilityRole="button"
                                                accessibilityLabel={t('read.removeBookmark')}
                                            >
                                                <MaterialIcons name="bookmark" size={20} color={colors.inkSlate} />
                                            </TouchableOpacity>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            ) : null}

                            {notes.length > 0 ? (
                                <View style={bookmarks.length > 0 ? styles.notesSection : null}>
                                    <Text style={[chrome.sectionLabel, styles.sectionLabel]}>{t('read.notesSection')}</Text>
                                    {notes.map((item) => (
                                        <View key={item.id} style={styles.noteRow}>
                                            <View style={styles.noteMetaRow}>
                                                <Text style={styles.noteMeta}>
                                                    {[formatNoteDate(item.createdAt, language), item.chapterLabel]
                                                        .filter(Boolean)
                                                        .join('  ·  ')}
                                                </Text>
                                                {onDelete ? (
                                                    <TouchableOpacity
                                                        onPress={() => setPendingDeleteId(item.id)}
                                                        style={styles.rowAction}
                                                        accessibilityRole="button"
                                                        accessibilityLabel={t('read.deleteNote')}
                                                    >
                                                        <Feather name="trash-2" size={16} color={colors.textSubtle} />
                                                    </TouchableOpacity>
                                                ) : null}
                                            </View>
                                            <Text style={styles.noteText}>{item.note}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                        </ScrollView>
                    )}
                </Animated.View>

                {pendingDeleteId != null ? (
                    <View style={styles.confirmOverlay}>
                        <Pressable style={styles.confirmBackdrop} onPress={() => setPendingDeleteId(null)} />
                        <View style={styles.confirmCard}>
                            <Text style={styles.confirmTitle}>{t('read.deleteNoteConfirmTitle')}</Text>
                            <Text style={styles.confirmBody}>{t('read.deleteNoteConfirmBody')}</Text>
                            <View style={styles.confirmActions}>
                                <TouchableOpacity
                                    style={[styles.confirmButton, styles.confirmCancelButton]}
                                    onPress={() => setPendingDeleteId(null)}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.confirmButton, styles.confirmDeleteButton]}
                                    onPress={confirmDelete}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.confirmDeleteText}>{t('common.delete')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                ) : null}
            </View>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    confirmOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    confirmBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    confirmCard: {
        width: '100%',
        maxWidth: 340,
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: SHEET_PADDING,
    },
    confirmTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 21,
        lineHeight: 28,
        color: colors.text,
    },
    confirmBody: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
        marginTop: 6,
    },
    confirmActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 20,
    },
    confirmButton: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    confirmCancelButton: {
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    confirmCancelText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
    confirmDeleteButton: {
        backgroundColor: colors.danger,
    },
    confirmDeleteText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
    sheet: {
        maxHeight: '80%',
    },
    scroll: { flexGrow: 0 },
    scrollContent: {
        paddingHorizontal: SHEET_PADDING,
        paddingTop: 8,
    },
    sectionLabel: {
        marginTop: 8,
        marginBottom: 2,
    },
    bookmarkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    bookmarkBody: {
        flex: 1,
        gap: 2,
    },
    bookmarkLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    bookmarkMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    rowAction: {
        width: 44,
        height: 44,
        marginRight: -10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    notesSection: {
        marginTop: 16,
    },
    noteRow: {
        paddingTop: 4,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    noteMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    noteMeta: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    noteText: {
        fontFamily: fontFamilies.krSerifRegular ?? fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
    },
});

export default NotesLogSheet;
