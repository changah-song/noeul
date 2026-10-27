import { memo, useEffect, useMemo, useState } from 'react';
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
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, useTheme } from '../../theme';

/**
 * HighlightNoteSheet — write or edit the note on a passage (long press →
 * toolbar → Note). The passage is quoted above the box; saving keeps the
 * passage highlighted with the note attached, listed in the book's notes.
 */
const HighlightNoteSheet = ({ visible, quote, initialNote = '', onSave, onClose }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [note, setNote] = useState(initialNote);

    useEffect(() => {
        if (visible) setNote(initialNote || '');
    }, [initialNote, visible]);

    return (
        <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView style={styles.flex} behavior="padding">
                <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
                    <Text style={styles.title}>{t('selection.noteTitle')}</Text>
                    <Text style={styles.quote} numberOfLines={4}>{quote}</Text>
                    <TextInput
                        style={styles.input}
                        value={note}
                        onChangeText={setNote}
                        placeholder={t('selection.notePlaceholder')}
                        placeholderTextColor={colors.textTertiary}
                        multiline
                        // A new note opens with the keyboard; an existing one
                        // opens to be read (tap the box to edit).
                        autoFocus={!initialNote}
                        textAlignVertical="top"
                    />
                    <View style={styles.buttons}>
                        <TouchableOpacity style={[styles.button, styles.cancel]} onPress={onClose} accessibilityRole="button">
                            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.button, styles.save]}
                            onPress={() => onSave?.(note)}
                            accessibilityRole="button"
                        >
                            <Text style={styles.saveText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
    flex: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    sheet: {
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        paddingHorizontal: 20,
        paddingTop: 18,
        backgroundColor: colors.surface,
        gap: 12,
    },
    title: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 17,
        color: colors.text,
    },
    quote: {
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textSecondary,
        paddingLeft: 10,
        borderLeftWidth: 3,
        borderLeftColor: colors.border,
    },
    input: {
        minHeight: 110,
        maxHeight: 220,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 22,
        color: colors.text,
    },
    buttons: {
        flexDirection: 'row',
        gap: 10,
    },
    button: {
        flex: 1,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancel: {
        borderWidth: 1,
        borderColor: colors.border,
    },
    save: {
        backgroundColor: colors.text,
    },
    cancelText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
    saveText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
});

export default memo(HighlightNoteSheet);
