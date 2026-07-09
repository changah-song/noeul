import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TouchableOpacity,
    TextInput,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';

// Badge icon per candidate reason (see wordCandidates.deriveCandidateReason).
const REASON_ICON = {
    rare: 'filter-alt',
    closerLook: 'visibility',
    new: 'auto-awesome',
};

/**
 * Renders an in-book example sentence with the candidate's surface underlined,
 * so the reader sees the word where they met it (mockup 1).
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
 * BeforeYouGoSheet — the opt-in "thoughtful close" the reader can open on the way
 * out of a book. Two steps: (1) a couple of unsaved words worth keeping, and
 * (2) a note to their future self. The plain back button stays a quick exit;
 * this is only shown when the reader chooses it.
 */
const BeforeYouGoSheet = ({
    visible,
    colors,
    insets,
    candidates = [],
    loading = false,
    onSaveWord,
    onSaveNote,
    onExit,
    onCancel,
}) => {
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors, insets), [colors, insets]);

    const [step, setStep] = useState('words');
    const [selected, setSelected] = useState(() => new Set());
    const [note, setNote] = useState('');
    const [savedStems, setSavedStems] = useState(() => new Set());

    // Reset the flow whenever it (re)opens, defaulting every candidate to selected.
    useEffect(() => {
        if (visible) {
            setStep('words');
            setSavedStems(new Set());
            setNote('');
        }
    }, [visible]);

    // Preselect candidates as they arrive; skip straight to the note step once
    // loading finishes with nothing to recommend.
    useEffect(() => {
        if (!visible) return;
        setSelected(new Set(candidates.map((c) => c.stem)));
        if (!loading && candidates.length === 0) {
            setStep('note');
        }
    }, [visible, loading, candidates]);

    const toggle = (stem) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(stem)) next.delete(stem);
            else next.add(stem);
            return next;
        });
    };

    const selectedCount = selected.size;

    const handleSaveWords = async () => {
        const toSave = candidates.filter((c) => selected.has(c.stem) && !savedStems.has(c.stem));
        for (const candidate of toSave) {
            // eslint-disable-next-line no-await-in-loop
            await onSaveWord?.(candidate);
        }
        setSavedStems((prev) => {
            const next = new Set(prev);
            toSave.forEach((c) => next.add(c.stem));
            return next;
        });
        setStep('note');
    };

    const finish = async () => {
        const trimmed = note.trim();
        if (trimmed) {
            await onSaveNote?.(trimmed);
        }
        onExit?.();
    };

    const renderCandidate = (candidate) => {
        const isSelected = selected.has(candidate.stem);
        return (
            <TouchableOpacity
                key={candidate.stem}
                activeOpacity={0.85}
                onPress={() => toggle(candidate.stem)}
                style={[styles.candidateCard, isSelected && styles.candidateCardSelected]}
            >
                <View style={[styles.candidateCheck, isSelected && styles.candidateCheckOn]}>
                    <Feather
                        name={isSelected ? 'check' : 'plus'}
                        size={16}
                        color={isSelected ? colors.readerEdgeButtonText ?? '#ffffff' : colors.textSecondary}
                    />
                </View>
                <View style={styles.candidateBody}>
                    <View style={styles.candidateHeaderRow}>
                        <View style={styles.candidateHeadwordRow}>
                            <Text style={styles.candidateHeadword}>{candidate.headword}</Text>
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
                        surface={candidate.exampleSurface ?? candidate.headword}
                        styles={styles}
                    />
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.overlay}>
                    <Pressable style={styles.backdrop} onPress={onCancel} />
                    <View style={styles.sheet}>
                        <View style={styles.handleWrap}>
                            <View style={styles.handle} />
                        </View>

                        {step === 'words' ? (
                            <>
                                <Text style={styles.eyebrow}>{t('read.beforeYouGoEyebrow')}</Text>
                                <Text style={styles.title}>{t('read.beforeYouGoTitle')}</Text>
                                <Text style={styles.subtitle}>{t('read.beforeYouGoSubtitle')}</Text>

                                {loading ? (
                                    <View style={styles.loadingWrap}>
                                        <ActivityIndicator color={colors.textMuted} />
                                    </View>
                                ) : (
                                    <ScrollView
                                        style={styles.candidateScroll}
                                        contentContainerStyle={styles.candidateScrollContent}
                                        showsVerticalScrollIndicator={false}
                                    >
                                        {candidates.map(renderCandidate)}
                                    </ScrollView>
                                )}

                                <View style={styles.refreshHintRow}>
                                    <Feather name="refresh-cw" size={12} color={colors.textSubtle} />
                                    <Text style={styles.refreshHintText}>{t('read.candidatesRefreshHint')}</Text>
                                </View>

                                <View style={styles.footer}>
                                    <TouchableOpacity
                                        onPress={() => setStep('note')}
                                        style={styles.secondaryButton}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.secondaryButtonText}>{t('read.notNow')}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={handleSaveWords}
                                        disabled={selectedCount === 0}
                                        style={[styles.primaryButton, selectedCount === 0 && styles.primaryButtonDisabled]}
                                        activeOpacity={0.85}
                                    >
                                        <Feather name="bookmark" size={16} color={colors.readerEdgeButtonText ?? '#ffffff'} />
                                        <Text style={styles.primaryButtonText}>
                                            {selectedCount === 0
                                                ? t('read.continue')
                                                : selectedCount === 1
                                                    ? t('read.saveWordOne')
                                                    : t('read.saveWordsCount', { count: selectedCount })}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        ) : (
                            <>
                                <Text style={styles.title}>{t('read.notePromptTitle')}</Text>
                                <Text style={styles.subtitle}>{t('read.notePromptSubtitle')}</Text>

                                <TextInput
                                    style={styles.noteInput}
                                    value={note}
                                    onChangeText={setNote}
                                    placeholder={t('read.notePlaceholder')}
                                    placeholderTextColor={colors.textSubtle}
                                    multiline
                                    textAlignVertical="top"
                                    autoFocus
                                />

                                <View style={styles.footer}>
                                    <TouchableOpacity
                                        onPress={finish}
                                        style={styles.secondaryButton}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.secondaryButtonText}>{t('read.skip')}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={finish}
                                        disabled={!note.trim()}
                                        style={[styles.primaryButton, !note.trim() && styles.primaryButtonDisabled]}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.primaryButtonText}>{t('read.saveAndClose')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        )}
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const createStyles = (colors, insets = { bottom: 0 }) => StyleSheet.create({
    flex: { flex: 1 },
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.sm,
        paddingBottom: (insets?.bottom ?? 0) + spacing.lg,
        maxHeight: '86%',
    },
    handleWrap: { alignItems: 'center', paddingVertical: spacing.xs },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.borderStrong,
    },
    eyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 11,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: colors.textSubtle,
        marginTop: spacing.xs,
    },
    title: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 26,
        color: colors.text,
        marginTop: spacing.xs,
    },
    subtitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textMuted,
        marginTop: spacing.xs,
        marginBottom: spacing.md,
    },
    loadingWrap: { paddingVertical: spacing.xxl, alignItems: 'center' },
    candidateScroll: { flexGrow: 0 },
    candidateScrollContent: { paddingVertical: spacing.xs, gap: spacing.sm },
    candidateCard: {
        flexDirection: 'row',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: 14,
        backgroundColor: colors.transparent ?? 'transparent',
        borderWidth: 1,
        borderColor: colors.transparent ?? 'transparent',
    },
    candidateCardSelected: {
        backgroundColor: colors.surfaceMuted,
    },
    candidateCheck: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    candidateCheckOn: {
        backgroundColor: colors.inkSlate,
        borderColor: colors.inkSlate,
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
    refreshHintRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginTop: spacing.sm,
    },
    refreshHintText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        color: colors.textSubtle,
    },
    noteInput: {
        minHeight: 120,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.md,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 24,
        color: colors.text,
        backgroundColor: colors.surfaceCard,
        marginBottom: spacing.md,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        marginTop: spacing.sm,
    },
    secondaryButton: {
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
    },
    secondaryButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.textMuted,
    },
    primaryButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: 12,
        backgroundColor: colors.inkSlate,
    },
    primaryButtonDisabled: { opacity: 0.45 },
    primaryButtonText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 15,
        letterSpacing: 0.4,
        color: colors.readerEdgeButtonText ?? '#ffffff',
    },
});

export default BeforeYouGoSheet;
