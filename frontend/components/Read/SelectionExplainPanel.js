import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { streamExplainInContext } from '../../services/api/explainInContext';
import { getUserFacingErrorMessage } from '../../i18n/userFacing';
import { fontFamilies, spacing, useTheme } from '../../theme';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * SelectionExplainPanel — the AI explanation of a selected phrase (long press →
 * toolbar → AI explain): idioms, phrases and archaic words the dictionary
 * doesn't cover, explained in the sentence they appear in. The short meaning
 * streams in first, then the longer explanation. "Save" keeps the phrase with
 * that short meaning as a vocab card.
 */
const SelectionExplainPanel = ({
    text,
    sentence,
    language,
    interfaceLanguage,
    placement = 'bottom',
    saved = false,
    onSave,
    onClose,
}) => {
    const { t } = useTranslation();
    const { colors, isDarkMode } = useTheme();
    const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);
    const phrase = clean(text);
    // `expression`: what the explanation is about — the selection completed to
    // whole words (or a whole idiom), as the backend reports it.
    const [state, setState] = useState({ loading: true, gloss: '', text: '', expression: '', error: null });
    const generationRef = useRef(0);

    useEffect(() => {
        if (!phrase) return undefined;
        generationRef.current += 1;
        const generation = generationRef.current;
        const stale = () => generationRef.current !== generation;
        setState({ loading: true, gloss: '', text: '', expression: '', error: null });
        streamExplainInContext({
            word: phrase,
            sentence: clean(sentence) || phrase,
            language,
            interfaceLanguage,
            mode: 'selection',
            onGloss: (gloss) => {
                if (!stale()) setState((prev) => ({ ...prev, gloss: clean(gloss) }));
            },
            onText: (streamed) => {
                if (!stale()) setState((prev) => ({ ...prev, text: streamed }));
            },
        })
            .then((response) => {
                if (stale()) return;
                const explanation = clean(response?.explanation);
                setState(explanation
                    ? {
                        loading: false,
                        gloss: clean(response?.gloss),
                        text: explanation,
                        expression: clean(response?.lemma),
                        error: null,
                    }
                    : { loading: false, gloss: '', text: '', expression: '', error: t('lookup.explainFailed') });
            })
            .catch((error) => {
                if (stale()) return;
                setState({
                    loading: false,
                    gloss: '',
                    text: '',
                    expression: '',
                    error: getUserFacingErrorMessage(error, t, 'lookup.explainFailed', interfaceLanguage),
                });
            });
        return () => {
            generationRef.current += 1;
        };
    }, [interfaceLanguage, language, phrase, sentence, t]);

    const canSave = !state.loading && Boolean(state.gloss) && !saved;
    // A cut-off selection ("Gabl") is shown and saved as the word it belongs to.
    const heading = state.expression || phrase;

    return (
        <View style={[styles.panel, placement === 'top' ? styles.panelTop : styles.panelBottom]}>
            <View style={styles.header}>
                <MaterialIcons name="auto-awesome" size={16} color={colors.textTertiary} />
                <Text style={styles.headerLabel}>{t('selection.aiExplain')}</Text>
                <TouchableOpacity
                    onPress={onClose}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                >
                    <Feather name="x" size={20} color={colors.textTertiary} />
                </TouchableOpacity>
            </View>
            <Text style={styles.phrase} selectable numberOfLines={3}>{heading}</Text>
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} nestedScrollEnabled>
                {state.gloss ? <Text style={styles.gloss} selectable>{state.gloss}</Text> : null}
                {state.text ? <Text style={styles.explanation} selectable>{state.text}</Text> : null}
                {state.loading && !state.text ? (
                    <View style={styles.loadingRow}>
                        <ActivityIndicator size="small" color={colors.textTertiary} />
                        <Text style={styles.muted}>{t('lookup.explainLoading')}</Text>
                    </View>
                ) : null}
                {state.error ? <Text style={styles.muted}>{state.error}</Text> : null}
            </ScrollView>
            <TouchableOpacity
                style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
                disabled={!canSave}
                onPress={() => onSave?.({ text: heading, gloss: state.gloss, sentence })}
                accessibilityRole="button"
            >
                <Feather name={saved ? 'check' : 'bookmark'} size={16} color={colors.text} />
                <Text style={styles.saveText}>{saved ? t('selection.saved') : t('lookup.save')}</Text>
            </TouchableOpacity>
        </View>
    );
};

const createStyles = (colors, isDarkMode) => StyleSheet.create({
    panel: {
        marginHorizontal: 12,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingTop: 12,
        paddingBottom: 14,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOpacity: isDarkMode ? 0.4 : 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 10,
        maxHeight: 420,
    },
    panelTop: {
        marginTop: 8,
    },
    panelBottom: {
        marginBottom: 12,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    headerLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        color: colors.textTertiary,
    },
    phrase: {
        marginTop: 8,
        fontFamily: fontFamilies.displayMedium,
        fontSize: 22,
        lineHeight: 28,
        color: colors.text,
    },
    body: {
        marginTop: 8,
        flexGrow: 0,
    },
    bodyContent: {
        gap: 8,
        paddingBottom: 4,
    },
    gloss: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 17,
        lineHeight: 24,
        color: colors.text,
    },
    explanation: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textSecondary,
    },
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    muted: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textTertiary,
    },
    saveButton: {
        marginTop: 12,
        height: 44,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
    },
    saveButtonDisabled: {
        opacity: 0.45,
    },
    saveText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
});

export default memo(SelectionExplainPanel);
