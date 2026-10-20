import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies } from '../../theme';

/**
 * Renders an in-book example sentence with the candidate's surface underlined,
 * so the reader sees the word where they actually met it.
 */
const ExampleSentence = ({ sentence, surface, styles }) => {
    const parts = useMemo(() => {
        if (!sentence || !surface) return null;
        const index = sentence.indexOf(surface);
        if (index === -1) return null;
        return {
            before: sentence.slice(0, index),
            match: sentence.slice(index, index + surface.length),
            after: sentence.slice(index + surface.length),
        };
    }, [sentence, surface]);

    if (!sentence) return null;
    return (
        <Text style={styles.candidateSentence} numberOfLines={2}>
            {parts ? (
                <>
                    {parts.before}
                    <Text style={styles.candidateSentenceMatch}>{parts.match}</Text>
                    {parts.after}
                </>
            ) : sentence}
        </Text>
    );
};

/**
 * CandidateCard — one suggested (unsaved) word the reader can keep on demand.
 * Shared by the reader's saved-words panel and the vocab screen's Suggested tab.
 * `onSave` fires once; the card then shows a saved (checked) state and disables.
 */
const CandidateCard = ({ candidate, colors, saved = false, onSave }) => {
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    if (!candidate) return null;

    const headword = candidate.headword ?? candidate.stem ?? '';
    return (
        <View style={styles.candidateCard}>
            <View style={styles.candidateBody}>
                <View style={styles.candidateHeadwordRow}>
                    <Text style={styles.candidateHeadword}>{headword}</Text>
                    {candidate.romanization ? (
                        <Text style={styles.candidateRomanization}>{candidate.romanization}</Text>
                    ) : null}
                    {candidate.reason ? (
                        <Text style={styles.candidateReason} numberOfLines={1}>
                            {t(`read.candidateReason.${candidate.reason}`)}
                        </Text>
                    ) : null}
                </View>
                {candidate.gloss ? (
                    <Text style={styles.candidateGloss} numberOfLines={2}>{candidate.gloss}</Text>
                ) : null}
                <ExampleSentence
                    sentence={candidate.exampleSentence}
                    surface={candidate.exampleSurface ?? headword}
                    styles={styles}
                />
            </View>

            <TouchableOpacity
                onPress={saved ? undefined : () => onSave?.(candidate)}
                disabled={saved}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ disabled: saved, selected: saved }}
                accessibilityLabel={saved ? t('vocab.candidateSaved') : t('vocab.candidateSave')}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                style={[styles.saveButton, saved && styles.saveButtonDone]}
            >
                {saved ? <Feather name="check" size={14} color={colors.textSecondary} /> : null}
                <Text style={[styles.saveButtonText, saved && styles.saveButtonTextDone]}>
                    {saved ? t('vocab.candidateSaved') : t('vocab.candidateSave')}
                </Text>
            </TouchableOpacity>
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    candidateCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        paddingLeft: 16,
        paddingRight: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.divider ?? colors.border,
        backgroundColor: colors.surface,
    },
    candidateBody: { flex: 1, minWidth: 0, gap: 2 },
    candidateHeadwordRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: 8,
    },
    candidateHeadword: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 19,
        lineHeight: 26,
        color: colors.text,
    },
    candidateRomanization: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        color: colors.textSubtle,
    },
    candidateReason: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        color: colors.textTertiary,
    },
    candidateGloss: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    candidateSentence: {
        fontFamily: fontFamilies.krSerifRegular ?? fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 21,
        color: colors.textSubtle,
        marginTop: 2,
    },
    candidateSentenceMatch: {
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
    saveButton: {
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.inkSlate,
        backgroundColor: colors.inkSlate,
    },
    saveButtonDone: {
        borderColor: colors.border,
        backgroundColor: colors.surfaceMuted,
    },
    saveButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        color: colors.white,
    },
    saveButtonTextDone: {
        color: colors.textSecondary,
    },
});

export default CandidateCard;
