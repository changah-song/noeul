import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    Animated,
    Easing,
    useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';
import CandidateCard from '../vocab/CandidateCard';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
                    style={[styles.sheet, { transform: [{ translateY }] }]}
                    onLayout={(e) => {
                        sheetHeight.current = e.nativeEvent.layout.height;
                    }}
                >
                    <View style={styles.handleWrap}>
                        <View style={styles.handle} />
                    </View>

                    <View style={styles.tabsRow}>
                        <TouchableOpacity
                            onPress={() => setTab('saved')}
                            style={[styles.tab, tab === 'saved' && styles.tabActive]}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: tab === 'saved' }}
                        >
                            <Text style={[styles.tabText, tab === 'saved' && styles.tabTextActive]}>
                                {t('read.savedTab', { count: savedWords.length })}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => setTab('suggested')}
                            style={[styles.tab, tab === 'suggested' && styles.tabActive]}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: tab === 'suggested' }}
                        >
                            <Text style={[styles.tabText, tab === 'suggested' && styles.tabTextActive]}>
                                {t('read.suggestedTab')}
                            </Text>
                        </TouchableOpacity>
                    </View>

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
                </Animated.View>
            </View>
        </Modal>
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
        backgroundColor: colors.surface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.sm,
        paddingBottom: (insets?.bottom ?? 0) + spacing.lg,
        maxHeight: '86%',
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
        flexDirection: 'row',
        gap: spacing.xs,
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.pill,
        padding: 4,
        marginTop: spacing.sm,
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
