import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { fontFamilies } from '../../theme';
import { GUIDE_BAR_SENTENCE, GUIDE_HOLD_SENTENCE, GUIDE_PARAGRAPHS } from '../../services/readerGuideContent';
import { PulseRing, TouchHold, TouchSwipe, TouchTap } from './GuideTouch';

// Fonts for the sample page, as the reader sets them for each language.
const PAGE_FONTS = {
    krSerif: { regular: fontFamilies.krSerifRegular, strong: fontFamilies.krSerifSemiBold },
    latinSerif: { regular: fontFamilies.serifRegular, strong: fontFamilies.serifMedium },
    hanSerif: Platform.select({
        android: { regular: 'serif', strong: 'serif' },
        default: { regular: undefined, strong: undefined },
    }),
};

// A word's horizontal padding: the space between words (none in Chinese).
const WORD_PAD = { ' ': 2.5, '': 0.5 };

const useShown = (on, duration = 300) => {
    const value = useRef(new Animated.Value(on ? 1 : 0)).current;
    useEffect(() => {
        Animated.timing(value, {
            toValue: on ? 1 : 0,
            duration,
            easing: Easing.bezier(0.2, 0.8, 0.2, 1),
            useNativeDriver: true,
        }).start();
    }, [duration, on, value]);
    return value;
};

/**
 * GuidePage — the reader guide's sample page: the reader's top bar, the page,
 * and the panels the guide opens on it (word, sentence bar, AI, listen bar),
 * all drawn from `frame` (services/readerGuide.js guideFrameAt). Only the
 * lit target takes a tap (`onTarget`).
 */
function GuidePage({ page, frame, targetId, waiting, onTarget, t, colors, accent, compact }) {
    const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);
    const fonts = PAGE_FONTS[page.font] ?? PAGE_FONTS.krSerif;
    const pad = WORD_PAD[page.joiner] ?? 2.5;
    const ink = colors.readerBodyInk;
    const levelInk = {
        easy: colors.readerLevelUnderlineEasy,
        mid: colors.readerLevelUnderlineMid,
        hard: colors.readerLevelUnderlineHard,
    };
    const [dictHeight, setDictHeight] = useState(200);
    const [aiHeight, setAiHeight] = useState(240);

    const dictShown = useShown(frame.dictionary, 340);
    const aiShown = useShown(frame.ai, 340);
    const barShown = useShown(frame.bar);
    const listenShown = useShown(frame.listenOn, 340);
    const toastShown = useShown(frame.toast, 250);

    const isTarget = (id) => waiting && targetId === id;
    const target = (id) => ({
        disabled: !isTarget(id),
        onPress: () => onTarget(id),
        onLongPress: () => onTarget(id),
        accessibilityRole: isTarget(id) ? 'button' : undefined,
    });
    const marks = (id, radius) => (
        <>
            {frame.touch === id ? <TouchTap ink={ink} /> : null}
            {isTarget(id) ? <PulseRing color={accent} radius={radius} /> : null}
        </>
    );

    const renderWord = (sentence, index, text) => {
        const id = `${sentence}:${index}`;
        const level = page.levels[id];
        let backgroundColor = 'transparent';
        let color = ink;
        let borderBottomColor = level ? levelInk[level] : 'transparent';
        let borderRadius = 0;
        if (frame.savedMark && id === page.word) borderBottomColor = ink;
        if (frame.reading === sentence) backgroundColor = `${colors.readerTappedWordSurfaceBg}99`;
        if (frame.bar && sentence === GUIDE_BAR_SENTENCE) backgroundColor = colors.accentSoft;
        if (sentence === GUIDE_HOLD_SENTENCE && index < frame.selected) backgroundColor = colors.accentMuted;
        if (frame.tapped === id) {
            backgroundColor = frame.saved ? colors.readerSavedWordSurfaceBg : colors.readerTappedWordSurfaceBg;
            color = frame.saved ? colors.readerSavedWordSurfaceText : colors.readerTappedWordSurfaceText;
            borderBottomColor = 'transparent';
            borderRadius = 4;
        }
        const faded = frame.focus != null && sentence !== frame.focus;
        return (
            <Pressable
                key={id}
                {...target(id)}
                accessibilityLabel={isTarget(id) ? text : undefined}
                style={[
                    styles.word,
                    { paddingHorizontal: pad, backgroundColor, borderBottomColor, borderRadius, opacity: faded ? 0.14 : 1 },
                ]}
            >
                <Text style={[styles.wordText, { color, fontFamily: fonts.regular }]}>{text}</Text>
                {sentence === GUIDE_HOLD_SENTENCE && index === frame.holdTouch ? <TouchHold ink={ink} /> : null}
                {marks(id, 8)}
            </Pressable>
        );
    };

    const holdQuote = page.sentences[GUIDE_HOLD_SENTENCE].join(page.joiner);
    const dictLine = [page.dictReading, page.gloss.pos, page.dictExtra].filter(Boolean).join(' · ');
    const activeTab = [styles.tab, styles.tabActive];

    return (
        <View style={styles.frame}>
            <View style={styles.header}>
                <View style={styles.iconButton}>
                    <Feather name="chevron-left" size={22} color={colors.inkSlate} />
                </View>
                <Pressable
                    {...target('eye')}
                    accessibilityLabel={t('read.focusMode')}
                    style={[styles.iconButton, frame.focusOn && styles.iconButtonOn]}
                >
                    <Feather name="eye" size={19} color={colors.inkSlate} />
                    {marks('eye', 12)}
                </Pressable>
                <Pressable
                    {...target('listen')}
                    accessibilityLabel={t('read.listen')}
                    style={[styles.iconButton, frame.listenOn && styles.iconButtonOn]}
                >
                    <Feather name="headphones" size={18} color={colors.inkSlate} />
                    {marks('listen', 12)}
                </Pressable>
                <View style={styles.progress}>
                    <View style={styles.progressTrack}>
                        <View style={styles.progressFill} />
                    </View>
                    <Text style={styles.progressLabel}>12%</Text>
                </View>
                <View style={styles.iconButton}>
                    <MaterialIcons name="bookmark-border" size={21} color={colors.inkSlate} />
                </View>
                <View style={styles.iconButton}>
                    <Feather name="menu" size={20} color={colors.inkSlate} />
                </View>
            </View>

            <View style={styles.page}>
                <Text style={[styles.chapter, { fontFamily: fonts.regular }]}>{page.chapter}</Text>
                <Text style={[styles.bookTitle, { fontFamily: fonts.strong }]}>{page.bookTitle}</Text>
                {GUIDE_PARAGRAPHS.map((sentences) => (
                    <View key={sentences.join('-')} style={styles.paragraph}>
                        {sentences.map((sentence) => page.sentences[sentence].map((text, index) => renderWord(sentence, index, text)))}
                    </View>
                ))}
            </View>

            {frame.swipe ? <TouchSwipe ink={ink} top={compact ? 220 : 260} /> : null}

            <Animated.View
                pointerEvents="none"
                style={[
                    styles.bar,
                    { opacity: barShown, transform: [{ translateY: barShown.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] },
                ]}
            >
                <Text style={styles.barText}>{page.gloss.bar}</Text>
            </Animated.View>

            <Animated.View
                onLayout={(event) => setAiHeight(event.nativeEvent.layout.height)}
                style={[
                    styles.aiPanel,
                    { transform: [{ translateY: aiShown.interpolate({ inputRange: [0, 1], outputRange: [-(aiHeight + 60), 0] }) }] },
                ]}
            >
                <View style={styles.aiHeader}>
                    <View style={styles.aiBadge}>
                        <MaterialIcons name="auto-awesome" size={15} color={colors.inkSlate} />
                        <Text style={styles.aiBadgeText}>AI</Text>
                    </View>
                    <View style={styles.tabs}>
                        <View style={frame.grammar ? styles.tab : activeTab}>
                            <Text style={[styles.tabText, !frame.grammar && styles.tabTextActive]}>{t('grammar.tabMeaning')}</Text>
                        </View>
                        <View style={frame.grammar ? activeTab : styles.tab}>
                            <Text style={[styles.tabText, frame.grammar && styles.tabTextActive]}>{t('grammar.tabGrammar')}</Text>
                            {frame.touch === 'grammar' ? <TouchTap ink={ink} /> : null}
                        </View>
                    </View>
                </View>
                <Text style={[styles.aiQuote, { fontFamily: fonts.regular }]}>{holdQuote}</Text>
                <View style={styles.rule} />
                {frame.grammar ? (
                    <>
                        <View style={styles.patternRow}>
                            <Text style={[styles.pattern, { fontFamily: fonts.strong }]}>{page.grammarHead}</Text>
                            <Text style={styles.patternGloss}>{page.gloss.grammarGloss}</Text>
                            <Text style={styles.levelTag}>{page.grammarLevel}</Text>
                        </View>
                        <Text style={styles.aiNote}>
                            <Text style={[styles.aiNoteHead, { fontFamily: fonts.regular }]}>{page.grammarNoteHead}</Text>
                            {` ${page.gloss.grammarNote}`}
                        </Text>
                    </>
                ) : (
                    <>
                        <Text style={styles.aiMeaning}>{page.gloss.meaning}</Text>
                        <Text style={styles.aiNote}>
                            <Text style={[styles.aiNoteHead, { fontFamily: fonts.regular }]}>{page.idiomHead}</Text>
                            {` ${page.gloss.idiom}`}
                        </Text>
                    </>
                )}
            </Animated.View>

            <Animated.View
                onLayout={(event) => setDictHeight(event.nativeEvent.layout.height)}
                style={[
                    styles.dictionary,
                    { transform: [{ translateY: dictShown.interpolate({ inputRange: [0, 1], outputRange: [dictHeight + 20, 0] }) }] },
                ]}
            >
                <View style={styles.handle} />
                <View style={styles.dictTop}>
                    <View style={styles.dictHeadBlock}>
                        <View style={styles.dictHeadRow}>
                            <Text style={[styles.dictHead, { fontFamily: fonts.strong }]}>{page.dictHead}</Text>
                            <MaterialIcons name="volume-up" size={16} color={colors.readerMutedInk} />
                        </View>
                        <Text style={styles.dictLine}>{dictLine}</Text>
                    </View>
                    <Pressable {...target('save')} accessibilityLabel={t('lookup.saveWord')} style={styles.saveButton}>
                        <MaterialIcons name={frame.saved ? 'bookmark' : 'bookmark-border'} size={24} color={colors.inkSlate} />
                        {marks('save', 12)}
                    </Pressable>
                </View>
                <View style={styles.rule} />
                <View style={styles.senseRow}>
                    <Text style={styles.senseNumber}>1</Text>
                    <Text style={styles.sense}>{page.gloss.sense}</Text>
                </View>
                <Text style={styles.dictNote}>{page.gloss.note}</Text>
            </Animated.View>

            <Animated.View pointerEvents="none" style={[styles.toastWrap, { bottom: dictHeight + 12, opacity: toastShown }]}>
                <Text style={styles.toast}>{t('guide.savedToast')}</Text>
            </Animated.View>

            {frame.focus != null ? (
                <View style={styles.focusStepper} pointerEvents="none">
                    <Feather name="chevron-left" size={18} color={colors.inkSlate} />
                    <Text style={styles.focusLabel}>{`${frame.focus + 1} / ${page.sentences.length}`}</Text>
                    <Feather name="chevron-right" size={18} color={colors.inkSlate} />
                </View>
            ) : null}

            <Animated.View
                pointerEvents="none"
                style={[
                    styles.listenBar,
                    { transform: [{ translateY: listenShown.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) }] },
                ]}
            >
                <View style={styles.listenPlay}>
                    <Feather name="pause" size={15} color={colors.inkSlate} />
                </View>
                <View style={styles.listenCopy}>
                    <Text style={styles.listenTitle} numberOfLines={1}>{t('guide.readingAloud')}</Text>
                    <Text style={styles.listenDetail} numberOfLines={1}>
                        {t('guide.sentenceOf', { n: Math.max(0, frame.reading) + 1, total: page.sentences.length })}
                    </Text>
                </View>
                <Text style={styles.listenChip}>{t('read.listenRateValue', { rate: '1.0' })}</Text>
            </Animated.View>
        </View>
    );
}

export default memo(GuidePage);

const createStyles = (colors, compact) => {
    const fontSize = compact ? 15 : 16;
    const lineHeight = compact ? 25 : 27;
    const panelShadow = {
        shadowColor: '#11151c',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 10,
    };
    return StyleSheet.create({
        frame: {
            flex: 1,
            backgroundColor: colors.readerPaper,
        },
        header: {
            height: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            paddingHorizontal: 8,
            backgroundColor: colors.readerPaper,
            zIndex: 3,
        },
        iconButton: {
            width: 34,
            height: 34,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
        },
        iconButtonOn: {
            backgroundColor: colors.accentSoft,
        },
        progress: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            paddingHorizontal: 6,
        },
        progressTrack: {
            width: 48,
            height: 3,
            borderRadius: 2,
            overflow: 'hidden',
            backgroundColor: colors.readerProgressTrack,
        },
        progressFill: {
            width: '12%',
            height: '100%',
            backgroundColor: colors.readerProgressFill,
        },
        progressLabel: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: 11,
            color: colors.readerMutedInk,
        },
        page: {
            paddingTop: 8,
            paddingHorizontal: 17,
        },
        chapter: {
            marginLeft: 3,
            fontSize: 12,
            lineHeight: 18,
            color: colors.readerMutedInk,
        },
        bookTitle: {
            marginLeft: 3,
            marginBottom: compact ? 8 : 12,
            fontSize: compact ? 18 : 20,
            lineHeight: compact ? 25 : 28,
            color: colors.readerBodyInk,
        },
        paragraph: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            marginBottom: compact ? 6 : 9,
        },
        // Words overlap by a pixel so a highlighted sentence reads as one band.
        word: {
            borderBottomWidth: 2,
            marginBottom: 1,
            marginHorizontal: -0.5,
        },
        wordText: {
            fontSize,
            lineHeight,
        },
        bar: {
            position: 'absolute',
            left: 12,
            right: 12,
            top: 50,
            zIndex: 4,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: colors.surfaceElevated,
            ...panelShadow,
        },
        barText: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: 14,
            lineHeight: 20,
            color: colors.text,
        },
        aiPanel: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 44,
            zIndex: 5,
            paddingTop: 12,
            paddingBottom: 16,
            paddingHorizontal: 18,
            borderBottomLeftRadius: 18,
            borderBottomRightRadius: 18,
            backgroundColor: colors.surfaceElevated,
            ...panelShadow,
        },
        aiHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
        },
        aiBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
        },
        aiBadgeText: {
            fontFamily: fontFamilies.sansSemiBold,
            fontSize: 13,
            color: colors.inkSlate,
        },
        tabs: {
            flexDirection: 'row',
            gap: 2,
            padding: 3,
            borderRadius: 10,
            backgroundColor: colors.surfaceMuted,
        },
        tab: {
            paddingVertical: 5,
            paddingHorizontal: 10,
            borderRadius: 7,
        },
        tabActive: {
            backgroundColor: colors.surfaceElevated,
        },
        tabText: {
            fontFamily: fontFamilies.sansMedium,
            fontSize: 12,
            color: colors.textMuted,
        },
        tabTextActive: {
            color: colors.text,
        },
        aiQuote: {
            marginTop: 10,
            fontSize: 15,
            lineHeight: 24,
            color: colors.text,
        },
        rule: {
            height: StyleSheet.hairlineWidth,
            marginVertical: 10,
            backgroundColor: colors.divider,
        },
        aiMeaning: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: 15,
            lineHeight: 22,
            color: colors.text,
        },
        aiNote: {
            marginTop: 6,
            fontFamily: fontFamilies.sansRegular,
            fontSize: 13,
            lineHeight: 19,
            color: colors.textMuted,
        },
        aiNoteHead: {
            color: colors.text,
        },
        patternRow: {
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 10,
        },
        pattern: {
            fontSize: 18,
            color: colors.text,
        },
        patternGloss: {
            flexShrink: 1,
            fontFamily: fontFamilies.sansRegular,
            fontSize: 14,
            color: colors.textSecondary,
        },
        levelTag: {
            marginLeft: 'auto',
            paddingVertical: 3,
            paddingHorizontal: 7,
            borderRadius: 6,
            overflow: 'hidden',
            fontFamily: fontFamilies.sansSemiBold,
            fontSize: 11,
            color: colors.textSecondary,
            backgroundColor: colors.surfaceMuted,
        },
        dictionary: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 5,
            paddingTop: 8,
            paddingBottom: 18,
            paddingHorizontal: 20,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            backgroundColor: colors.surfaceElevated,
            ...panelShadow,
        },
        handle: {
            alignSelf: 'center',
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.border,
        },
        dictTop: {
            marginTop: 8,
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
        },
        dictHeadBlock: {
            flex: 1,
        },
        dictHeadRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        dictHead: {
            fontSize: 25,
            lineHeight: 34,
            color: colors.text,
        },
        dictLine: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: 13,
            lineHeight: 18,
            color: colors.textMuted,
        },
        saveButton: {
            width: 44,
            height: 44,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        senseRow: {
            flexDirection: 'row',
            gap: 10,
        },
        senseNumber: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: 13,
            lineHeight: 21,
            color: colors.textTertiary,
        },
        sense: {
            flex: 1,
            fontFamily: fontFamilies.sansRegular,
            fontSize: 15,
            lineHeight: 21,
            color: colors.text,
        },
        dictNote: {
            marginTop: 8,
            fontFamily: fontFamilies.sansRegular,
            fontSize: 13,
            lineHeight: 18,
            color: colors.textMuted,
        },
        toastWrap: {
            position: 'absolute',
            left: 0,
            right: 0,
            zIndex: 6,
            alignItems: 'center',
        },
        toast: {
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            overflow: 'hidden',
            fontFamily: fontFamilies.sansMedium,
            fontSize: 13,
            color: colors.surface,
            backgroundColor: colors.inkSlate,
        },
        focusStepper: {
            position: 'absolute',
            bottom: 14,
            alignSelf: 'center',
            zIndex: 4,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 7,
            paddingHorizontal: 12,
            borderRadius: 999,
            backgroundColor: colors.surfaceElevated,
            ...panelShadow,
        },
        focusLabel: {
            minWidth: 36,
            textAlign: 'center',
            fontFamily: fontFamilies.sansRegular,
            fontSize: 12,
            color: colors.textSecondary,
        },
        listenBar: {
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            zIndex: 5,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 8,
            paddingLeft: 8,
            paddingRight: 12,
            borderRadius: 16,
            backgroundColor: colors.inkSlate,
        },
        listenPlay: {
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
        },
        listenCopy: {
            flex: 1,
            minWidth: 0,
        },
        listenTitle: {
            fontFamily: fontFamilies.sansMedium,
            fontSize: 13,
            color: colors.surface,
        },
        listenDetail: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: 12,
            color: colors.surface,
            opacity: 0.72,
        },
        listenChip: {
            paddingVertical: 5,
            paddingHorizontal: 8,
            borderRadius: 8,
            overflow: 'hidden',
            fontFamily: fontFamilies.sansSemiBold,
            fontSize: 12,
            color: colors.surface,
            backgroundColor: 'rgba(255,255,255,0.14)',
        },
    });
};
