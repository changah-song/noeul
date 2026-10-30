import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { streamExplainInContext } from '../../services/api/explainInContext';
import { getUserFacingErrorMessage } from '../../i18n/userFacing';
import { fontFamilies, spacing, useTheme } from '../../theme';
import GrammarView from './GrammarView';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * SelectionExplainPanel — the AI explanation of a long-pressed selection, in a
 * bottom sheet like the definition panel: idioms, phrases and archaic words the
 * dictionary doesn't cover, explained in the sentence they appear in. The short
 * meaning streams in first, then the longer explanation. The bookmark in the
 * corner keeps the expression with that short meaning as a vocab card. Tapping
 * the page (or swiping the sheet down) closes it.
 */
const SelectionExplainPanel = ({
    text,
    sentence,
    language,
    interfaceLanguage,
    bottomInset = 0,
    saved = false,
    onSave,
    // For the Grammar tab's record of patterns met.
    ownerId,
    bookUri,
    bookTitle,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const phrase = clean(text);
    // `expression`: what the explanation is about — the selection completed to
    // whole words (or a whole idiom), as the backend reports it.
    const [state, setState] = useState({ loading: true, gloss: '', text: '', expression: '', error: null });
    const generationRef = useRef(0);
    // Meaning (the explanation) or Grammar (the pattern); the Grammar view
    // stays mounted once opened so switching back doesn't ask again.
    const [tab, setTab] = useState('meaning');
    const [grammarOpened, setGrammarOpened] = useState(false);
    useEffect(() => {
        setTab('meaning');
        setGrammarOpened(false);
    }, [phrase, sentence]);

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
        <View style={[styles.sheet, { paddingBottom: 18 + bottomInset }]}>
            <View style={styles.header}>
                <MaterialIcons name="auto-awesome" size={15} color={colors.textTertiary} />
                <Text style={styles.headerLabel}>{t('selection.aiExplain')}</Text>
                <TouchableOpacity
                    style={[styles.saveIcon, !canSave && !saved && styles.saveIconDisabled]}
                    disabled={!canSave}
                    onPress={() => onSave?.({ text: heading, gloss: state.gloss, sentence })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={saved ? t('selection.saved') : t('lookup.save')}
                    accessibilityState={{ disabled: !canSave, selected: saved }}
                >
                    <MaterialIcons
                        name={saved ? 'bookmark' : 'bookmark-border'}
                        size={26}
                        color={saved ? colors.text : colors.textTertiary}
                    />
                </TouchableOpacity>
            </View>
            <Text style={styles.phrase} selectable numberOfLines={3}>{heading}</Text>
            <View style={styles.tabs} accessibilityRole="tablist">
                {[['meaning', t('grammar.tabMeaning')], ['grammar', t('grammar.tabGrammar')]].map(([key, label]) => {
                    const selected = tab === key;
                    return (
                        <TouchableOpacity
                            key={key}
                            onPress={() => {
                                setTab(key);
                                if (key === 'grammar') setGrammarOpened(true);
                            }}
                            style={[styles.tab, selected && styles.tabSelected]}
                            accessibilityRole="tab"
                            accessibilityState={{ selected }}
                        >
                            <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} nestedScrollEnabled>
                {tab === 'meaning' ? (
                    <>
                        {state.gloss ? <Text style={styles.gloss} selectable>{state.gloss}</Text> : null}
                        {state.text ? <Text style={styles.explanation} selectable>{state.text}</Text> : null}
                        {state.loading && !state.text ? (
                            <View style={styles.loadingRow}>
                                <ActivityIndicator size="small" color={colors.textTertiary} />
                                <Text style={styles.muted}>{t('lookup.explainLoading')}</Text>
                            </View>
                        ) : null}
                        {state.error ? <Text style={styles.muted}>{state.error}</Text> : null}
                    </>
                ) : null}
                {grammarOpened ? (
                    <View style={tab === 'grammar' ? null : styles.hidden}>
                        <GrammarView
                            text={phrase}
                            sentence={clean(sentence) || phrase}
                            language={language}
                            interfaceLanguage={interfaceLanguage}
                            ownerId={ownerId}
                            bookUri={bookUri}
                            bookTitle={bookTitle}
                        />
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    // Matches the definition panel's bottom sheet (TopSection).
    sheet: {
        paddingHorizontal: 24,
        paddingTop: 14,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: colors.surfaceElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: 0,
        borderColor: colors.border,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 10,
        maxHeight: 560,
    },
    saveIcon: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: -8,
    },
    saveIconDisabled: {
        opacity: 0.4,
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
    tabs: {
        flexDirection: 'row',
        gap: 4,
        padding: 4,
        marginTop: 10,
        borderRadius: 12,
        backgroundColor: colors.surfaceMuted,
    },
    tab: {
        flex: 1,
        height: 34,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabSelected: {
        backgroundColor: colors.surfaceElevated,
    },
    tabText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.textTertiary,
    },
    tabTextSelected: {
        color: colors.text,
    },
    hidden: {
        display: 'none',
    },
    body: {
        marginTop: 10,
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
});

export default memo(SelectionExplainPanel);
