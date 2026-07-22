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
import { fontFamilies, radii, spacing } from '../../theme';

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
    const styles = useMemo(() => createStyles(colors, insets), [colors, insets]);
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
                    style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}
                    onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
                >
                    <View style={styles.handleWrap}>
                        <View style={styles.handle} />
                    </View>

                    <View style={styles.header}>
                        <Text style={styles.title}>{t('read.checkpoints')}</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button">
                            <Feather name="x" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {bookmarks.length === 0 && notes.length === 0 ? (
                        <View style={styles.emptyState}>
                            <MaterialIcons name="bookmark-border" size={24} color={colors.textSubtle} />
                            <Text style={styles.emptyText}>{t('read.checkpointsEmpty')}</Text>
                        </View>
                    ) : (
                        <ScrollView
                            style={styles.scroll}
                            contentContainerStyle={styles.scrollContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {bookmarks.length > 0 ? (
                                <View>
                                    <Text style={styles.sectionLabel}>{t('read.bookmarksSection')}</Text>
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
                                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                accessibilityRole="button"
                                                accessibilityLabel={t('read.removeBookmark')}
                                            >
                                                <MaterialIcons name="bookmark" size={20} color={colors.inkSlate ?? colors.text} />
                                            </TouchableOpacity>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            ) : null}

                            {notes.length > 0 ? (
                                <View style={bookmarks.length > 0 ? styles.notesSection : null}>
                                    <Text style={styles.sectionLabel}>{t('read.notesSection')}</Text>
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
                                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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

const createStyles = (colors, insets = { bottom: 0 }) => StyleSheet.create({
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
        paddingHorizontal: spacing.xl,
    },
    confirmBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    confirmCard: {
        width: '100%',
        maxWidth: 320,
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.xl,
    },
    confirmTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 18,
        color: colors.text,
    },
    confirmBody: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
        marginTop: spacing.xs,
    },
    confirmActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
        marginTop: spacing.lg,
    },
    confirmButton: {
        minHeight: 40,
        paddingHorizontal: spacing.lg,
        borderRadius: radii.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    confirmCancelButton: {
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: colors.surface,
    },
    confirmCancelText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.text,
    },
    confirmDeleteButton: {
        backgroundColor: colors.danger ?? '#c0392b',
    },
    confirmDeleteText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: '#ffffff',
    },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.sm,
        paddingBottom: (insets?.bottom ?? 0) + spacing.lg,
        maxHeight: '80%',
    },
    handleWrap: { alignItems: 'center', paddingVertical: spacing.xs },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.borderStrong,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.xs,
        marginBottom: spacing.md,
    },
    title: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 22,
        color: colors.text,
    },
    closeButton: { padding: spacing.xs },
    emptyState: {
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xxl,
    },
    emptyText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        color: colors.textSubtle,
        textAlign: 'center',
    },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingBottom: spacing.sm },
    sectionLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: colors.textSubtle,
        marginBottom: spacing.xs,
    },
    bookmarkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: spacing.md,
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
        color: colors.text,
    },
    bookmarkMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        color: colors.textSubtle,
    },
    notesSection: {
        marginTop: spacing.lg,
    },
    noteRow: {
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        gap: spacing.xs,
    },
    noteMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    noteMeta: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: colors.textSubtle,
    },
    noteText: {
        fontFamily: fontFamilies.krSerifRegular ?? fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
    },
});

export default NotesLogSheet;
