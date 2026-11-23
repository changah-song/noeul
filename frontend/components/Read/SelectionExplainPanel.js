import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { streamExplainInContext } from '../../services/api/explainInContext';
import { getUserFacingErrorMessage } from '../../i18n/userFacing';
import { fontFamilies, panelLift, spacing, useTheme } from '../../theme';
import GrammarView from './GrammarView';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// A long selection's explanation walks through it one chunk a line:
// "chunk — what it does". Those lines are drawn as rows (the chunk in ink,
// its note muted under it) so the walkthrough can be scanned; other lines stay
// plain paragraphs. A line still streaming in without its dash is a paragraph
// until the dash arrives.
const CHUNK_LINE = /^(.*?\S)\s+[—–]\s+(.+)$/;
export const explanationParts = (text) => clean(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
        const match = line.match(CHUNK_LINE);
        return match ? { chunk: match[1], note: match[2] } : { paragraph: line };
    });

/**
 * SelectionExplainPanel — the AI explanation of a long-pressed selection, in a
 * bottom sheet like the definition panel: idioms, phrases and archaic words the
 * dictionary doesn't cover, explained in the sentence they appear in. The short
 * meaning streams in first, then the longer explanation. Saving is the word
 * panel's job, so there is no save button here. Tapping the page (or swiping
 * the sheet down) closes it.
 */
const ExplainSheet = ({
    text,
    sentence,
    language,
    interfaceLanguage,
    bottomInset = 0,
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

    // A cut-off selection ("Gabl") is shown as the word it belongs to.
    const heading = state.expression || phrase;

    const parts = explanationParts(state.text);
    const waiting = state.loading && !state.text;

    return (
        <View style={[styles.sheet, { paddingBottom: 18 + bottomInset }]}>
            <View style={styles.grabberWrap}>
                <View style={styles.grabber} />
            </View>
            <View style={styles.header}>
                <MaterialIcons name="auto-awesome" size={15} color={colors.textTertiary} />
                <Text style={styles.headerLabel}>{t('selection.aiExplain')}</Text>
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
            <ScrollView
                style={styles.body}
                contentContainerStyle={[styles.bodyContent, tab === 'meaning' && styles.bodyMeaning]}
                nestedScrollEnabled
            >
                {tab === 'meaning' ? (
                    <>
                        {state.gloss ? <Text style={styles.gloss} selectable>{state.gloss}</Text> : null}
                        {parts.map((part, index) => (part.chunk ? (
                            <View key={index} style={styles.chunkRow}>
                                <Text style={styles.chunk} selectable>{part.chunk}</Text>
                                <Text style={styles.chunkNote} selectable>{part.note}</Text>
                            </View>
                        ) : (
                            <Text key={index} style={styles.explanation} selectable>{part.paragraph}</Text>
                        )))}
                        {/* Placeholder lines where the answer will be, so the
                            sheet doesn't jump as it streams in. */}
                        {waiting ? (
                            <View
                                style={styles.placeholder}
                                accessible
                                accessibilityLabel={t('lookup.explainLoading')}
                            >
                                {state.gloss ? null : <View style={[styles.placeholderBar, styles.placeholderGloss]} />}
                                <View style={[styles.placeholderBar, { width: '92%' }]} />
                                <View style={[styles.placeholderBar, { width: '68%' }]} />
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

// The sheet slides up and fades in, and back out when closed, like the
// definition panel (TopSection). It keeps the last selection on screen while it
// slides away, since the reader clears `text` at once.
const SHOW_MS = 180;
const SelectionExplainPanel = (props) => {
    const phrase = clean(props.text);
    const sentence = props.sentence;
    const [shown, setShown] = useState(() => (phrase ? { text: phrase, sentence } : null));
    const translateY = useRef(new Animated.Value(24)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (phrase) {
            setShown({ text: phrase, sentence });
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: 0, duration: SHOW_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true,
                }),
            ]).start();
            return;
        }
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: 24, duration: SHOW_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 0, duration: SHOW_MS, easing: Easing.in(Easing.quad), useNativeDriver: true,
            }),
        ]).start(({ finished }) => {
            if (finished) setShown(null);
        });
    }, [opacity, phrase, sentence, translateY]);

    if (!shown) return null;
    return (
        <Animated.View
            style={{ opacity, transform: [{ translateY }] }}
            pointerEvents={phrase ? 'auto' : 'none'}
        >
            <ExplainSheet {...props} text={shown.text} sentence={shown.sentence} />
        </Animated.View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    // Matches the definition panel's bottom sheet (TopSection).
    sheet: {
        paddingHorizontal: 24,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: colors.surfaceElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: 0,
        borderColor: colors.border,
        ...panelLift(colors, 'up'),
        maxHeight: 560,
    },
    // The bottom sheet's grabber, as on the definition panel.
    grabberWrap: {
        height: 22,
        paddingTop: 9,
        alignItems: 'center',
    },
    grabber: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
    },
    header: {
        marginTop: 2,
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
    // Room for a short answer before it arrives, so the sheet keeps its size.
    bodyMeaning: {
        minHeight: 84,
    },
    chunkRow: {
        gap: 2,
    },
    chunk: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 21,
        color: colors.text,
    },
    chunkNote: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    placeholder: {
        gap: 10,
        paddingTop: 4,
    },
    placeholderBar: {
        height: 12,
        borderRadius: 6,
        backgroundColor: colors.surfaceMuted,
    },
    placeholderGloss: {
        width: '45%',
        height: 16,
        borderRadius: 8,
    },
    muted: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textTertiary,
    },
});

export default memo(SelectionExplainPanel);
