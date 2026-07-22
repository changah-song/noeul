import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    Animated,
    Easing,
    useWindowDimensions,
} from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * BeforeYouGoSheet — a note to the reader's future self, opened by long-pressing
 * the header bookmark icon. Word candidates used to live here too, but now have
 * a dedicated home in the saved-words panel (opened from the top-bar count
 * pill), so this sheet is note-only. Saving keeps the book open — the sheet just
 * closes, and the note appears in the checkpoints sheet.
 */
const BeforeYouGoSheet = ({
    visible,
    colors,
    insets,
    onSaveNote,
    onClose,
}) => {
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors, insets), [colors, insets]);
    const { height: windowHeight } = useWindowDimensions();

    const [note, setNote] = useState('');

    // Keep the modal mounted while it animates out, then unmount. The backdrop
    // fades in place while only the sheet slides up — otherwise the whole scrim
    // slides up with it (the old animationType="slide" behavior).
    const [mounted, setMounted] = useState(visible);
    const progress = useRef(new Animated.Value(0)).current;
    const sheetHeight = useRef(0);

    // Reset whenever it (re)opens, and drive the open/close animation.
    useEffect(() => {
        if (visible) {
            setNote('');
            setMounted(true);
            Animated.timing(progress, {
                toValue: 1,
                duration: 260,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else if (mounted) {
            Animated.timing(progress, {
                toValue: 0,
                duration: 200,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }
    }, [visible, mounted, progress]);

    const translateY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [sheetHeight.current || windowHeight, 0],
    });

    const saveNote = async () => {
        const trimmed = note.trim();
        if (trimmed) {
            await onSaveNote?.(trimmed);
        }
        onClose?.();
    };

    return (
        <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.overlay}>
                    <AnimatedPressable
                        style={[styles.backdrop, { opacity: progress }]}
                        onPress={onClose}
                    />
                    <Animated.View
                        style={[styles.sheet, { transform: [{ translateY }] }]}
                        onLayout={(e) => {
                            sheetHeight.current = e.nativeEvent.layout.height;
                        }}
                    >
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
                                onPress={onClose}
                                style={styles.secondaryButton}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.secondaryButtonText}>{t('common.close')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={saveNote}
                                disabled={!note.trim()}
                                style={[styles.primaryButton, !note.trim() && styles.primaryButtonDisabled]}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const createStyles = (colors, insets = { bottom: 0 }) => StyleSheet.create({
    flex: { flex: 1 },
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
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
