import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { explainGrammar } from '../../services/api/explainGrammar';
import { recordGrammarEncounter, setGrammarPatternKept } from '../../services/Database';
import { getUserFacingErrorMessage } from '../../i18n/userFacing';
import { fontFamilies, useTheme } from '../../theme';

/**
 * GrammarView — the AI panel's Grammar tab: which tracked pattern the
 * selected sentence uses (with its level), how it works in plain words, the
 * sentence in chunks with what each does (the pattern's chunks marked), how
 * many sentences the reader has met it in, and Keep, which puts it in
 * Learn › Grammar for review. Fetched once per selection; the result stays
 * while the reader switches tabs.
 */
const GrammarView = ({
    text,
    sentence,
    language,
    interfaceLanguage,
    ownerId,
    bookUri,
    bookTitle,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [state, setState] = useState({ loading: true, result: null, error: null });
    const [record, setRecord] = useState(null);
    const generationRef = useRef(0);

    useEffect(() => {
        generationRef.current += 1;
        const generation = generationRef.current;
        const stale = () => generationRef.current !== generation;
        setState({ loading: true, result: null, error: null });
        setRecord(null);
        explainGrammar({ text, sentence, language, interfaceLanguage })
            .then((result) => {
                if (stale()) return;
                setState({ loading: false, result, error: null });
                return recordGrammarEncounter({
                    ownerId, language, result, sentence: sentence || text, bookUri, bookTitle,
                }).then((row) => {
                    if (!stale()) setRecord(row);
                });
            })
            .catch((error) => {
                if (stale()) return;
                setState({
                    loading: false,
                    result: null,
                    error: getUserFacingErrorMessage(error, t, 'lookup.explainFailed', interfaceLanguage),
                });
            });
        return () => {
            generationRef.current += 1;
        };
        // Once per selection.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text, sentence, language, interfaceLanguage]);

    if (state.loading) {
        return (
            <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.textTertiary} />
                <Text style={styles.muted}>{t('grammar.loading')}</Text>
            </View>
        );
    }
    if (state.error || !state.result) {
        return <Text style={styles.muted}>{state.error || t('lookup.explainFailed')}</Text>;
    }

    const { result } = state;
    const tracked = result.pattern_id && result.pattern_id !== 'none';
    const kept = Boolean(record?.kept);
    const toggleKeep = () => {
        const next = !kept;
        setRecord((previous) => ({ ...(previous || {}), kept: next }));
        setGrammarPatternKept({ ownerId, language, patternId: result.pattern_id, kept: next })
            .catch(() => setRecord((previous) => ({ ...(previous || {}), kept: !next })));
    };

    return (
        <View style={styles.wrap}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>{result.title || t('grammar.untitled')}</Text>
                {result.level ? <Text style={styles.level}>{result.level}</Text> : null}
            </View>
            <Text style={styles.rule} selectable>{result.rule}</Text>
            {Array.isArray(result.chunks) && result.chunks.length > 0 ? (
                <View style={styles.chunks} accessibilityLabel={result.chunks.map((chunk) => `${chunk.text}: ${chunk.label}`).join(', ')}>
                    {result.chunks.map((chunk, index) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <View key={`${chunk.text}-${index}`} style={styles.chunk}>
                            <Text style={[styles.chunkText, chunk.pattern && styles.chunkTextPattern]}>{chunk.text}</Text>
                            <View style={[styles.chunkLine, chunk.pattern && styles.chunkLinePattern]} />
                            <Text style={[styles.chunkLabel, chunk.pattern && styles.chunkLabelPattern]}>{chunk.label}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
            {tracked ? (
                <>
                    {record?.encounters > 1 ? (
                        <Text style={styles.muted}>{t('grammar.metTimes', { count: record.encounters })}</Text>
                    ) : null}
                    <TouchableOpacity
                        onPress={toggleKeep}
                        style={[styles.keep, kept && styles.keepKept]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: kept }}
                    >
                        <Text style={[styles.keepText, kept && styles.keepTextKept]}>
                            {kept ? t('grammar.kept') : t('grammar.keep')}
                        </Text>
                    </TouchableOpacity>
                </>
            ) : null}
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    wrap: {
        gap: 12,
        paddingBottom: 4,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    title: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 17,
        lineHeight: 24,
        color: colors.text,
    },
    level: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        color: colors.textSecondary,
        backgroundColor: colors.surfaceMuted,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        overflow: 'hidden',
    },
    rule: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textSecondary,
    },
    chunks: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 8,
        rowGap: 12,
        padding: 12,
        borderRadius: 14,
        backgroundColor: colors.readerPaper,
    },
    chunk: {
        alignItems: 'center',
        maxWidth: '100%',
    },
    chunkText: {
        fontFamily: fontFamilies.serifRegular,
        fontSize: 16,
        lineHeight: 22,
        color: colors.text,
    },
    chunkTextPattern: {
        fontFamily: fontFamilies.sansSemiBold,
    },
    chunkLine: {
        alignSelf: 'stretch',
        height: 2,
        borderRadius: 1,
        marginTop: 2,
        backgroundColor: colors.borderStrong,
    },
    chunkLinePattern: {
        backgroundColor: colors.text,
    },
    chunkLabel: {
        marginTop: 3,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 11,
        color: colors.textTertiary,
    },
    chunkLabelPattern: {
        color: colors.text,
    },
    keep: {
        height: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
    keepKept: {
        backgroundColor: colors.surfaceMuted,
    },
    keepText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
    keepTextKept: {
        color: colors.text,
    },
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    muted: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        lineHeight: 20,
        color: colors.textTertiary,
    },
});

export default memo(GrammarView);
