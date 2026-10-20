import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    Animated,
    Easing,
    useWindowDimensions,
} from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies } from '../../theme';
import CandidateCard from '../vocab/CandidateCard';
import {
    SHEET_PADDING,
    SegmentedTabs,
    SheetEmptyState,
    SheetHandle,
    SheetHeader,
    createReaderSettingsControlStyles,
    createSheetChromeStyles,
} from './ReaderSettingsControls';

// A short saved date for the row's status column ("Oct 20").
const formatSavedDate = (value, language) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
        return date.toLocaleDateString(language ?? undefined, { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * SavedWordsPanel — the reader's word tracker. Opened from the top-bar count
 * pill, it has two tabs:
 *   • Saved     — the words the reader has kept while in *this* book.
 *   • Suggested — unsaved words worth keeping (from the candidate model), each
 *                 saveable on the spot.
 * This is the on-demand home for candidates; the "before you go" exit sheet now
 * only handles the note-to-self. `title` overrides the sheet title (defaults to
 * "Saved in this book").
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
    title,
}) => {
    const { t, language } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const chrome = useMemo(() => createSheetChromeStyles(colors, insets), [colors, insets]);
    const controlStyles = useMemo(() => createReaderSettingsControlStyles(colors), [colors]);
    const [tab, setTab] = useState(initialTab);
    const { height: windowHeight } = useWindowDimensions();

    // Keep the modal mounted while it animates out, then unmount.
    const [mounted, setMounted] = useState(visible);
    const progress = useRef(new Animated.Value(0)).current;
    // Sheet height is cached across open/close so the slide distance is exact
    // after the first layout; falls back to the window height on first open.
    const sheetHeight = useRef(0);

    useEffect(() => {
        if (visible) {
            setTab(initialTab);
            setMounted(true);
            Animated.timing(progress, {
                toValue: 1,
                duration: 260,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else if (mounted) {
            Animated.timing(progress, {
                toValue: 0,
                duration: 200,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }
    }, [visible, initialTab, mounted, progress]);

    const translateY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [sheetHeight.current || windowHeight, 0],
    });

    const savedSet = savedStems instanceof Set ? savedStems : new Set();

    return (
        <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <AnimatedPressable
                    style={[styles.backdrop, { opacity: progress }]}
                    onPress={onClose}
                />
                <Animated.View
                    style={[chrome.sheet, styles.sheet, { transform: [{ translateY }] }]}
                    onLayout={(e) => {
                        sheetHeight.current = e.nativeEvent.layout.height;
                    }}
                >
                    <SheetHandle styles={chrome} />
                    <SheetHeader
                        styles={chrome}
                        colors={colors}
                        title={title ?? t('read.savedPanelTitle')}
                        onClose={onClose}
                        closeLabel={t('common.close')}
                    />

                    <SegmentedTabs
                        styles={controlStyles}
                        style={styles.tabs}
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: 'saved', label: t('read.savedTab', { count: savedWords.length }) },
                            { value: 'suggested', label: t('read.suggestedTab') },
                        ]}
                    />

                    {tab === 'saved' ? (
                        savedWords.length === 0 ? (
                            <SheetEmptyState
                                styles={chrome}
                                colors={colors}
                                icon="bookmark"
                                title={t('read.savedEmptyTitle')}
                                body={t('read.savedEmptyBody')}
                            />
                        ) : (
                            <ScrollView
                                style={styles.scroll}
                                contentContainerStyle={styles.scrollContent}
                                showsVerticalScrollIndicator={false}
                            >
                                {savedWords.map((entry) => {
                                    const status = entry.source === 'ai'
                                        ? t('read.aiExplainedTag')
                                        : formatSavedDate(entry.createdAt, language);
                                    return (
                                        <View key={entry.id ?? entry.word} style={styles.savedRow}>
                                            <View style={styles.savedBody}>
                                                <View style={styles.savedHeadwordRow}>
                                                    <Text style={styles.savedWord}>{entry.word}</Text>
                                                    {entry.hanja ? (
                                                        <Text style={styles.savedHanja}>{entry.hanja}</Text>
                                                    ) : null}
                                                </View>
                                                {entry.def ? (
                                                    <Text style={styles.savedDef} numberOfLines={2}>{entry.def}</Text>
                                                ) : null}
                                            </View>
                                            {status ? (
                                                <Text style={styles.savedStatus} numberOfLines={1}>{status}</Text>
                                            ) : null}
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        )
                    ) : (
                        candidatesLoading ? (
                            <View style={styles.loadingWrap}>
                                <ActivityIndicator color={colors.textTertiary} />
                            </View>
                        ) : candidates.length === 0 ? (
                            <SheetEmptyState
                                styles={chrome}
                                colors={colors}
                                icon="feather"
                                title={t('read.suggestedEmptyTitle')}
                                body={t('read.suggestedEmptyBody')}
                            />
                        ) : (
                            <>
                                <Text style={styles.suggestedHint}>{t('read.suggestedHint')}</Text>
                                <ScrollView
                                    style={styles.scroll}
                                    contentContainerStyle={[styles.scrollContent, styles.suggestedContent]}
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
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    sheet: {
        maxHeight: '86%',
        minHeight: '48%',
    },
    tabs: {
        marginTop: 12,
        marginHorizontal: SHEET_PADDING,
    },
    scroll: { flexGrow: 0 },
    scrollContent: {
        paddingHorizontal: SHEET_PADDING,
        paddingTop: 6,
        paddingBottom: 8,
    },
    suggestedContent: {
        gap: 10,
    },
    savedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    savedBody: {
        flex: 1,
        gap: 2,
    },
    savedHeadwordRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    savedWord: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 18,
        lineHeight: 26,
        color: colors.text,
    },
    savedHanja: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        color: colors.textTertiary,
    },
    savedDef: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
    },
    savedStatus: {
        maxWidth: '35%',
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textTertiary,
    },
    suggestedHint: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
        marginTop: 12,
        paddingHorizontal: SHEET_PADDING,
    },
    loadingWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
    },
});

export default SavedWordsPanel;
