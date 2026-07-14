import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';

// Badge icon per candidate reason (see services/wordCandidates.deriveCandidateReason).
const REASON_ICON = {
    rare: 'filter-alt',
    closerLook: 'visibility',
    new: 'auto-awesome',
};

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
                <View style={styles.candidateHeaderRow}>
                    <View style={styles.candidateHeadwordRow}>
                        <Text style={styles.candidateHeadword}>{headword}</Text>
                        {candidate.romanization ? (
                            <Text style={styles.candidateRomanization}>{candidate.romanization}</Text>
                        ) : null}
                    </View>
                    {candidate.reason ? (
                        <View style={styles.candidateBadge}>
                            <MaterialIcons
                                name={REASON_ICON[candidate.reason] ?? 'visibility'}
                                size={12}
                                color={colors.textSecondary}
                            />
                            <Text style={styles.candidateBadgeText}>
                                {t(`read.candidateReason.${candidate.reason}`)}
                            </Text>
                        </View>
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
                accessibilityState={{ disabled: saved }}
                accessibilityLabel={saved ? t('vocab.candidateSaved') : t('vocab.candidateSave')}
                style={[styles.saveButton, saved && styles.saveButtonDone]}
            >
                <Feather
                    name={saved ? 'check' : 'plus'}
                    size={15}
                    color={saved ? colors.textSecondary : (colors.readerEdgeButtonText ?? '#ffffff')}
                />
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
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceCard ?? colors.surface,
    },
    candidateBody: { flex: 1, gap: 3 },
    candidateHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    candidateHeadwordRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: spacing.xs,
        flexShrink: 1,
    },
    candidateHeadword: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 20,
        color: colors.text,
    },
    candidateRomanization: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        color: colors.textSubtle,
    },
    candidateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 4,
        paddingHorizontal: spacing.xs,
        borderRadius: radii.pill,
        backgroundColor: colors.surfaceMuted,
    },
    candidateBadgeText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 11,
        color: colors.textSecondary,
    },
    candidateGloss: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        color: colors.text,
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
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs + 2,
        paddingHorizontal: spacing.md,
        borderRadius: radii.pill,
        backgroundColor: colors.inkSlate,
    },
    saveButtonDone: {
        backgroundColor: colors.surfaceMuted,
    },
    saveButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        color: colors.readerEdgeButtonText ?? '#ffffff',
    },
    saveButtonTextDone: {
        color: colors.textSecondary,
    },
});

export default CandidateCard;
