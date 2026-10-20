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
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies } from '../../theme';
import {
    SHEET_PADDING,
    SheetHandle,
    SheetHeader,
    createSheetChromeStyles,
} from './ReaderSettingsControls';

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
    const styles = useMemo(() => createStyles(colors), [colors]);
    const chrome = useMemo(() => createSheetChromeStyles(colors, insets), [colors, insets]);
    const { height: windowHeight } = useWindowDimensions();

    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const savingRef = useRef(false);

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
            setSaveFailed(false);
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

    // Close only once the note is stored: the save handler resolves null (or
    // throws) on failure, and closing then would throw away what was typed.
    const saveNote = async () => {
        if (savingRef.current) return;
        const trimmed = note.trim();
        if (!trimmed) {
            onClose?.();
            return;
        }
        savingRef.current = true;
        setSaving(true);
        setSaveFailed(false);
        let saved = false;
        try {
            const result = await onSaveNote?.(trimmed);
            saved = result != null;
        } catch {
            saved = false;
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
        if (saved) {
            onClose?.();
        } else {
            setSaveFailed(true);
        }
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
                        style={[chrome.sheet, styles.sheet, { transform: [{ translateY }] }]}
                        onLayout={(e) => {
                            sheetHeight.current = e.nativeEvent.layout.height;
                        }}
                    >
                        <SheetHandle styles={chrome} />
                        <SheetHeader
                            styles={chrome}
                            colors={colors}
                            title={t('read.notePromptTitle')}
                            onClose={onClose}
                            closeLabel={t('common.close')}
                        />

                        <View style={styles.body}>
                            <Text style={styles.subtitle}>{t('read.notePromptSubtitle')}</Text>

                            <TextInput
                                style={styles.noteInput}
                                value={note}
                                onChangeText={(text) => {
                                    setNote(text);
                                    if (saveFailed) setSaveFailed(false);
                                }}
                                placeholder={t('read.notePlaceholder')}
                                placeholderTextColor={colors.textSubtle}
                                multiline
                                textAlignVertical="top"
                                autoFocus
                            />

                            {saveFailed ? (
                                <Text style={styles.errorText} accessibilityRole="alert">
                                    {t('lookup.saveFailed')}
                                </Text>
                            ) : null}

                            <View style={styles.footer}>
                                <TouchableOpacity
                                    onPress={onClose}
                                    style={styles.secondaryButton}
                                    activeOpacity={0.7}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.secondaryButtonText}>{t('common.close')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={saveNote}
                                    disabled={!note.trim() || saving}
                                    style={[styles.primaryButton, (!note.trim() || saving) && styles.primaryButtonDisabled]}
                                    activeOpacity={0.85}
                                    accessibilityRole="button"
                                    accessibilityState={{ disabled: !note.trim() || saving }}
                                >
                                    <Feather name="check" size={17} color={colors.surface} />
                                    <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Animated.View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
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
        maxHeight: '86%',
    },
    body: {
        paddingHorizontal: SHEET_PADDING,
    },
    subtitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
        marginTop: 4,
        marginBottom: 14,
    },
    noteInput: {
        minHeight: 120,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: 14,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
        backgroundColor: colors.surface,
        marginBottom: 12,
    },
    errorText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.danger,
        marginTop: -4,
        marginBottom: 6,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 6,
    },
    secondaryButton: {
        height: 48,
        paddingHorizontal: 20,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
    primaryButton: {
        flex: 1,
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: colors.inkSlate,
    },
    primaryButtonDisabled: { opacity: 0.4 },
    primaryButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
});

export default BeforeYouGoSheet;
