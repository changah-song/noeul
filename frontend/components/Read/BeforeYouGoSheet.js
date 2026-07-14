import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TouchableOpacity,
    TextInput,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';

/**
 * BeforeYouGoSheet — the opt-in "thoughtful close" the reader can open on the way
 * out of a book: a note to their future self. Word candidates used to live here
 * too, but now have a dedicated home in the saved-words panel (opened from the
 * top-bar count pill), so this sheet is note-only. The plain back button stays a
 * quick exit; this is only shown when the reader chooses it.
 */
const BeforeYouGoSheet = ({
    visible,
    colors,
    insets,
    onSaveNote,
    onExit,
    onCancel,
}) => {
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors, insets), [colors, insets]);

    const [note, setNote] = useState('');

    // Reset whenever it (re)opens.
    useEffect(() => {
        if (visible) setNote('');
    }, [visible]);

    const finish = async () => {
        const trimmed = note.trim();
        if (trimmed) {
            await onSaveNote?.(trimmed);
        }
        onExit?.();
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.overlay}>
                    <Pressable style={styles.backdrop} onPress={onCancel} />
                    <View style={styles.sheet}>
                        <View style={styles.handleWrap}>
                            <View style={styles.handle} />
                        </View>

                        <Text style={styles.title}>{t('read.notePromptTitle')}</Text>
                        <Text style={styles.subtitle}>{t('read.notePromptSubtitle')}</Text>

                        <TextInput
                            style={styles.noteInput}
                            value={note}
                            onChangeText={setNote}
                            placeholder={t('read.notePlaceholder')}
                            placeholderTextColor={colors.textSubtle}
                            multiline
                            textAlignVertical="top"
                            autoFocus
                        />

                        <View style={styles.footer}>
                            <TouchableOpacity
                                onPress={finish}
                                style={styles.secondaryButton}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.secondaryButtonText}>{t('read.skip')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={finish}
                                disabled={!note.trim()}
                                style={[styles.primaryButton, !note.trim() && styles.primaryButtonDisabled]}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.primaryButtonText}>{t('read.saveAndClose')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const createStyles = (colors, insets = { bottom: 0 }) => StyleSheet.create({
    flex: { flex: 1 },
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.sm,
        paddingBottom: (insets?.bottom ?? 0) + spacing.lg,
        maxHeight: '86%',
    },
    handleWrap: { alignItems: 'center', paddingVertical: spacing.xs },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.borderStrong,
    },
    title: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 26,
        color: colors.text,
        marginTop: spacing.xs,
    },
    subtitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textMuted,
        marginTop: spacing.xs,
        marginBottom: spacing.md,
    },
    noteInput: {
        minHeight: 120,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.md,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
        backgroundColor: colors.surfaceCard,
        marginBottom: spacing.md,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        marginTop: spacing.sm,
    },
    secondaryButton: {
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
    },
    secondaryButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.textMuted,
    },
    primaryButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: 12,
        backgroundColor: colors.inkSlate,
    },
    primaryButtonDisabled: { opacity: 0.45 },
    primaryButtonText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 15,
        letterSpacing: 0.4,
        color: colors.readerEdgeButtonText ?? '#ffffff',
    },
});

export default BeforeYouGoSheet;
