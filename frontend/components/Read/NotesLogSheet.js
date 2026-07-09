import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';

const formatNoteDate = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * NotesLogSheet — the full log of notes-to-self a reader has left in a book,
 * newest first, reached from the reader's "Notes" menu. View + delete; new notes
 * are written from the "before you go" flow.
 */
const NotesLogSheet = ({
    visible,
    colors,
    insets,
    notes = [],
    onDelete,
    onClose,
}) => {
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors, insets), [colors, insets]);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);

    const confirmDelete = () => {
        if (pendingDeleteId != null) {
            onDelete?.(pendingDeleteId);
        }
        setPendingDeleteId(null);
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={styles.backdrop} onPress={onClose} />
                <View style={styles.sheet}>
                    <View style={styles.handleWrap}>
                        <View style={styles.handle} />
                    </View>

                    <View style={styles.header}>
                        <Text style={styles.title}>{t('read.notesLogTitle')}</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button">
                            <Feather name="x" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {notes.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Feather name="edit-3" size={24} color={colors.textSubtle} />
                            <Text style={styles.emptyText}>{t('read.notesLogEmpty')}</Text>
                        </View>
                    ) : (
                        <ScrollView
                            style={styles.scroll}
                            contentContainerStyle={styles.scrollContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {notes.map((item) => (
                                <View key={item.id} style={styles.noteRow}>
                                    <View style={styles.noteMetaRow}>
                                        <Text style={styles.noteMeta}>
                                            {[formatNoteDate(item.createdAt), item.chapterLabel]
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
                        </ScrollView>
                    )}
                </View>

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
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
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
