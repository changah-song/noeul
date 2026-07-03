import React, { useMemo, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamilies, radii } from '../../theme';

// ── Session-close "final thought" prompt ───────────────────────────────────
// Slides up when the reader leaves a book, inviting a short note that future-you
// will read first on return. Ported 1:1 from the Noeul design prototype.
const ClosePrompt = ({ themeColors, visible, onSave, onSkip }) => {
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
    const [text, setText] = useState('');

    const handleSave = () => {
        onSave?.(text.trim());
        setText('');
    };

    const handleSkip = () => {
        onSkip?.();
        setText('');
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleSkip}>
            <KeyboardAvoidingView
                style={styles.overlay}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <Pressable style={styles.backdrop} onPress={handleSkip} />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 26 }]}>
                    <View style={styles.grabber} />
                    <Text style={styles.title}>Where did this leave you?</Text>
                    <Text style={styles.subtitle}>
                        A line for next time — a thought, a word, a question. Anything. Future you will read it first.
                    </Text>
                    <TextInput
                        value={text}
                        onChangeText={setText}
                        multiline
                        numberOfLines={3}
                        placeholder="He finally has fares, but the weather feels like a warning…"
                        placeholderTextColor={themeColors.readerPlaceholder}
                        style={styles.input}
                        textAlignVertical="top"
                    />
                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={styles.saveButton}
                            onPress={handleSave}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                        >
                            <Text style={styles.saveLabel}>Save &amp; close</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.skipButton}
                            onPress={handleSkip}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                        >
                            <Text style={styles.skipLabel}>Skip</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const createStyles = (themeColors) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: themeColors.overlay,
    },
    sheet: {
        backgroundColor: themeColors.surface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        borderTopWidth: 1,
        borderColor: themeColors.border,
        paddingTop: 14,
        paddingHorizontal: 24,
        shadowColor: 'rgba(43,20,26,0.16)',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 12,
    },
    grabber: {
        width: 40,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 16,
        backgroundColor: themeColors.surfaceStrong,
    },
    title: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 22,
        lineHeight: 28,
        color: themeColors.text,
    },
    subtitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 20,
        color: themeColors.textTertiary,
        marginTop: 6,
        marginBottom: 14,
    },
    input: {
        minHeight: 84,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: themeColors.borderStrong,
        backgroundColor: themeColors.surfaceCard,
        paddingVertical: 12,
        paddingHorizontal: 14,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 21,
        color: themeColors.text,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 16,
    },
    saveButton: {
        flex: 1,
        height: 48,
        borderRadius: radii.sm,
        backgroundColor: themeColors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: themeColors.glyphCream,
    },
    skipButton: {
        height: 48,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    skipLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: themeColors.textTertiary,
    },
});

export default ClosePrompt;
