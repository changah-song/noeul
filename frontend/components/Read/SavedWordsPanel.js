import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';
import CandidateCard from '../vocab/CandidateCard';
import PaperSheet from '../ui/PaperSheet';
import PaperTabs from '../ui/PaperTabs';

/**
 * SavedWordsPanel — the reader's word tracker. Opened from the top-bar count
 * pill, it has two tabs:
 *   • Saved     — the words the reader has kept while in *this* book.
 *   • Suggested — unsaved words worth keeping (from the candidate model), each
 *                 saveable on the spot.
 * This is the on-demand home for candidates; the "before you go" exit sheet now
 * only handles the note-to-self.
 */
const SavedWordsPanel = ({
    visible,
    colors,
    insets,
    savedWords = [],
    candidates = [],
    candidatesLoading = false,
    savedStems,
    onSaveCandidate,
    onClose,
    initialTab = 'saved',
}) => {
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors, insets), [colors, insets]);
    const [tab, setTab] = useState(initialTab);

    useEffect(() => {
        if (visible) setTab(initialTab);
    }, [visible, initialTab]);

    const savedSet = savedStems instanceof Set ? savedStems : new Set();

    return (
        <PaperSheet visible={visible} onClose={onClose} maxHeightRatio={0.82} dragRegion="header" style={styles.sheet}>
                    <PaperTabs
                        style={styles.tabsRow}
                        value={tab}
                        onChange={setTab}
                        tabs={[
                            { key: 'saved', label: t('read.savedTab', { count: savedWords.length }) },
                            { key: 'suggested', label: t('read.suggestedTab') },
                        ]}
                    />

                    {tab === 'saved' ? (
                        savedWords.length === 0 ? (
                            <View style={styles.emptyWrap}>
                                <Feather name="bookmark" size={26} color={colors.textSubtle} />
                                <Text style={styles.emptyTitle}>{t('read.savedEmptyTitle')}</Text>
                                <Text style={styles.emptyBody}>{t('read.savedEmptyBody')}</Text>
                            </View>
                        ) : (
                            <ScrollView
                                style={styles.scroll}
                                contentContainerStyle={styles.scrollContent}
                                showsVerticalScrollIndicator={false}
                            >
                                {savedWords.map((entry) => (
                                    <View key={entry.id ?? entry.word} style={styles.savedRow}>
                                        <View style={styles.savedHeadwordRow}>
                                            <Text style={styles.savedWord}>{entry.word}</Text>
                                            {entry.hanja ? (
                                                <Text style={styles.savedHanja}>{entry.hanja}</Text>
                                            ) : null}
                                            {entry.source === 'ai' ? (
                                                <View style={styles.savedSourceTag}>
                                                    <Text style={styles.savedSourceTagText}>
                                                        {t('read.aiExplainedTag')}
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </View>
                                        {entry.def ? (
                                            <Text style={styles.savedDef} numberOfLines={2}>{entry.def}</Text>
                                        ) : null}
                                    </View>
                                ))}
                            </ScrollView>
                        )
                    ) : (
                        candidatesLoading ? (
                            <View style={styles.emptyWrap}>
                                <ActivityIndicator color={colors.textMuted} />
                            </View>
                        ) : candidates.length === 0 ? (
                            <View style={styles.emptyWrap}>
                                <Feather name="feather" size={26} color={colors.textSubtle} />
                                <Text style={styles.emptyTitle}>{t('read.suggestedEmptyTitle')}</Text>
                                <Text style={styles.emptyBody}>{t('read.suggestedEmptyBody')}</Text>
                            </View>
                        ) : (
                            <>
                                <Text style={styles.suggestedHint}>{t('read.suggestedHint')}</Text>
                                <ScrollView
                                    style={styles.scroll}
                                    contentContainerStyle={styles.scrollContent}
                                    showsVerticalScrollIndicator={false}
                                >
                                    {candidates.map((candidate) => (
                                        <CandidateCard
                                            key={candidate.stem}
                                            candidate={candidate}
                                            colors={colors}
                                            saved={savedSet.has(candidate.stem)}
                                            onSave={onSaveCandidate}
                                        />
                                    ))}
                                </ScrollView>
                            </>
                        )
                    )}
        </PaperSheet>
    );
};

const createStyles = (colors, insets = { bottom: 0 }) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    sheet: {
        paddingHorizontal: spacing.xl,
        paddingBottom: (insets?.bottom ?? 0) + spacing.lg,
        minHeight: '48%',
    },
    handleWrap: { alignItems: 'center', paddingVertical: spacing.xs },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.borderStrong,
    },
    tabsRow: {
        marginBottom: spacing.md,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderRadius: radii.pill,
    },
    tabActive: {
        backgroundColor: colors.surface,
    },
    tabText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: colors.textSubtle,
    },
    tabTextActive: {
        color: colors.text,
    },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingBottom: spacing.md, gap: spacing.sm },
    savedRow: {
        paddingVertical: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        gap: 2,
    },
    savedHeadwordRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: spacing.xs,
    },
    savedWord: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 19,
        color: colors.text,
    },
    savedHanja: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        color: colors.textSubtle,
    },
    savedSourceTag: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: radii.sm,
        backgroundColor: colors.surfaceMuted,
        alignSelf: 'center',
    },
    savedSourceTagText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 10,
        letterSpacing: 0.4,
        color: colors.textSubtle,
    },
    savedDef: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        color: colors.textMuted,
    },
    suggestedHint: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        color: colors.textSubtle,
        marginBottom: spacing.sm,
    },
    emptyWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.xxl,
        gap: spacing.sm,
    },
    emptyTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 18,
        color: colors.text,
        marginTop: spacing.xs,
    },
    emptyBody: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
});

export default SavedWordsPanel;
