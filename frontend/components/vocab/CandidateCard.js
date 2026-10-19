import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, spacing } from '../../theme';
import { PressableScale } from '../ui';
import { tapCommit } from '../../services/haptics';

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
 * CandidateCard — one suggested (unsaved) word the reader can keep on demand,
 * set as a dictionary entry on the paper (hairline below, no box).
 * Shared by the reader's saved-words panel and the vocab screen's Suggested tab.
 * `onSave` fires once; the entry then shows a saved (checked) state and disables.
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
                </View>
                {candidate.gloss ? (
                    <Text style={styles.candidateGloss} numberOfLines={2}>{candidate.gloss}</Text>
                ) : null}
                <ExampleSentence
                    sentence={candidate.exampleSentence}
                    surface={candidate.exampleSurface ?? headword}
                    styles={styles}
                />
                {candidate.reason ? (
                    <View style={styles.candidateReason}>
                        <MaterialIcons
                            name={REASON_ICON[candidate.reason] ?? 'visibility'}
                            size={13}
                            color={colors.textMuted}
                        />
                        <Text style={styles.candidateReasonText}>
                            {t(`read.candidateReason.${candidate.reason}`)}
                        </Text>
                    </View>
                ) : null}
            </View>

            {saved ? (
                <View
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={t('vocab.candidateSaved')}
                    style={[styles.saveButton, styles.saveButtonDone]}
                >
                    <Feather name="check" size={15} color={colors.tint} />
                    <Text style={[styles.saveButtonText, styles.saveButtonTextDone]}>
                        {t('vocab.candidateSaved')}
                    </Text>
                </View>
            ) : (
                <PressableScale
                    onPress={() => {
                        tapCommit();
                        onSave?.(candidate);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('vocab.candidateSave')}
                    style={styles.saveButton}
                >
                    <Feather name="plus" size={15} color={colors.onInk} />
                    <Text style={styles.saveButtonText}>{t('vocab.candidateSave')}</Text>
                </PressableScale>
            )}
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    candidateCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    candidateBody: { flex: 1, minWidth: 0, gap: 3 },
    candidateHeadwordRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: 10,
    },
    candidateHeadword: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 21,
        lineHeight: 30,
        letterSpacing: -0.2,
        color: colors.text,
    },
    candidateRomanization: {
        fontFamily: fontFamilies.displayItalic,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textTertiary,
    },
    candidateGloss: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 21,
        color: colors.textSecondary,
    },
    candidateSentence: {
        fontFamily: fontFamilies.krSerifRegular ?? fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 22,
        color: colors.textMuted,
        marginTop: 2,
    },
    candidateSentenceMatch: {
        color: colors.text,
        textDecorationLine: 'underline',
        textDecorationColor: colors.tint,
    },
    candidateReason: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 4,
    },
    candidateReasonText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textMuted,
    },
    saveButton: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        borderRadius: 22,
        backgroundColor: colors.inkSlate,
        marginTop: 2,
    },
    saveButtonDone: {
        backgroundColor: 'transparent',
        paddingHorizontal: 8,
    },
    saveButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.onInk,
    },
    saveButtonTextDone: {
        color: colors.tint,
    },
});

export default CandidateCard;
