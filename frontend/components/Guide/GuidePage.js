import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { fontFamilies } from '../../theme';
import { GUIDE_BAR_SENTENCE, GUIDE_HOLD_SENTENCE, GUIDE_PARAGRAPHS } from '../../services/readerGuideContent';
import { PulseRing, TouchHold, TouchTap } from './GuideTouch';

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
    // Listening is full screen in the reader: only its own bar stays up.
    const chromeShown = useShown(!frame.listenOn, 260);

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
        // Words around the reader's level and harder are tinted by level, as
        // the reader does it (the text, not an underline).
        let color = level ? levelInk[level] : ink;
        let borderBottomColor = 'transparent';
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
        return (
            <Pressable
                key={id}
                {...target(id)}
                accessibilityLabel={isTarget(id) ? text : undefined}
                style={[
                    styles.word,
                    { paddingHorizontal: pad, backgroundColor, borderBottomColor, borderRadius },
                ]}
            >
                <Text style={[styles.wordText, { color, fontFamily: fonts.regular }]}>{text}</Text>
                {sentence === GUIDE_HOLD_SENTENCE && index === frame.holdTouch ? <TouchHold ink={ink} /> : null}
                {marks(id, 8)}
            </Pressable>
        );
    };

    const holdQuote = page.sentences[GUIDE_HOLD_SENTENCE].join(page.joiner);
    // Korean hanja sits beside the word, as in the reader; a level tag goes
    // in the line under it with the reading.
    const dictHanja = page.font === 'krSerif' ? page.dictExtra : null;
    const dictLine = [page.dictReading, dictHanja ? null : page.dictExtra].filter(Boolean).join(' · ');
    const activeTab = [styles.tab, styles.tabActive];

    return (
        <View style={styles.frame}>
            <Animated.View style={[styles.header, { opacity: chromeShown }]}>
                <View style={styles.iconButton}>
                    <Feather name="chevron-left" size={20} color={colors.inkSlate} />
                </View>
                {/* The book over the chapter being read, as in the reader. */}
                <View style={styles.titleCluster}>
                    <Text numberOfLines={1} style={styles.titleBook}>{page.bookTitle}</Text>
                    <View style={styles.titleChapterRow}>
                        <Text numberOfLines={1} style={styles.titleChapter}>{page.chapter}</Text>
                        <Feather name="chevron-down" size={15} color={colors.textTertiary} />
                    </View>
                </View>
                <View style={styles.iconButton}>
                    <Feather name="bookmark" size={19} color={colors.inkSlate} />
                </View>
                <View style={styles.iconButton}>
                    <Feather name="menu" size={19} color={colors.inkSlate} />
                </View>
            </Animated.View>

            <View style={styles.page}>
                <Text style={[styles.chapter, { fontFamily: fonts.regular }]}>{page.chapter}</Text>
                <Text style={[styles.bookTitle, { fontFamily: fonts.strong }]}>{page.bookTitle}</Text>
                {GUIDE_PARAGRAPHS.map((sentences) => (
                    <View key={sentences.join('-')} style={styles.paragraph}>
                        {sentences.map((sentence) => page.sentences[sentence].map((text, index) => renderWord(sentence, index, text)))}
                    </View>
                ))}
            </View>

            {/* The line along the bottom, as in the reader: track, percent,
                and the play button at its right end, where listening starts. */}
            <Animated.View style={[styles.scrubber, { opacity: chromeShown }]} pointerEvents={frame.listenOn ? 'none' : 'box-none'}>
                <View pointerEvents="none" style={styles.scrubberTrack}>
                    <View style={styles.scrubberFill} />
                    <View style={styles.scrubberThumb} />
                </View>
                <Text pointerEvents="none" style={styles.scrubberLabel}>12%</Text>
                <Pressable
                    {...target('play')}
                    accessibilityLabel={t('read.listen')}
                    style={styles.playButton}
                >
                    <Feather name="play" size={15} color={colors.white} style={styles.playIcon} />
                    {marks('play', 16)}
                </Pressable>
            </Animated.View>

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
                    { transform: [{ translateY: aiShown.interpolate({ inputRange: [0, 1], outputRange: [aiHeight + 20, 0] }) }] },
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
                            {dictHanja ? (
                                <Text style={[styles.dictHanja, { fontFamily: fonts.regular }]}>{dictHanja}</Text>
                            ) : null}
                        </View>
                        {dictLine ? (
                            <View style={styles.dictMetaRow}>
                                <Text style={styles.dictLine}>{dictLine}</Text>
                                <MaterialIcons name="volume-up" size={15} color={colors.textTertiary} />
                            </View>
                        ) : null}
                    </View>
                    <Pressable {...target('save')} accessibilityLabel={t('lookup.saveWord')} style={styles.saveButton}>
                        <MaterialIcons name={frame.saved ? 'bookmark' : 'bookmark-border'} size={21} color={colors.inkSlate} />
                        {marks('save', 12)}
                    </Pressable>
                </View>
                <View style={styles.senseRow}>
                    {page.gloss.pos ? (
                        <View style={styles.posChip}>
                            <Text style={styles.posChipText}>{page.gloss.pos}</Text>
                        </View>
                    ) : null}
                    <Text style={styles.sense}>{page.gloss.sense}</Text>
                </View>
                <View style={styles.rule} />
                <Text style={styles.dictNote}>{page.gloss.note}</Text>
            </Animated.View>

            <Animated.View pointerEvents="none" style={[styles.toastWrap, { bottom: dictHeight + 12, opacity: toastShown }]}>
                <Text style={styles.toast}>{t('guide.savedToast')}</Text>
            </Animated.View>

            <Animated.View
                pointerEvents="none"
                style={[
                    styles.listenBar,
                    { transform: [{ translateY: listenShown.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) }], opacity: listenShown },
                ]}
            >
                {/* The reader's listen bar (components/Read/ListenBar.js):
                    previous / pause / next, voice and speed, the two study
                    toggles, close. Only play/pause is filled. */}
                <View style={styles.listenButton}>
                    <Feather name="skip-back" size={18} color={colors.text} />
                </View>
                <View style={styles.listenPlay}>
                    <Feather name="pause" size={17} color={colors.white} />
                </View>
                <View style={styles.listenButton}>
                    <Feather name="skip-forward" size={18} color={colors.text} />
                </View>
                <View style={styles.listenDivider} />
                <View style={styles.listenChip}>
                    <MaterialCommunityIcons name="waveform" size={15} color={colors.text} />
                    <Text style={styles.listenChipText}>{t('read.listenRateValue', { rate: '1.0' })}</Text>
                </View>
                <View style={styles.listenToggle}>
                    <MaterialIcons name="school" size={17} color={colors.textSecondary} />
                </View>
                <View style={styles.listenToggle}>
                    <MaterialIcons name="translate" size={17} color={colors.textSecondary} />
                </View>
                <View style={styles.listenSpacer} />
                <View style={styles.listenButton}>
                    <Feather name="x" size={18} color={colors.textTertiary} />
                </View>
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
            paddingHorizontal: 6,
            backgroundColor: colors.readerPaper,
            borderBottomWidth: 1,
            borderBottomColor: colors.divider,
            zIndex: 3,
        },
        iconButton: {
            width: 34,
            height: 34,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
        },
        titleCluster: {
            flex: 1,
            minWidth: 0,
            justifyContent: 'center',
            paddingLeft: 2,
            paddingRight: 6,
        },
        titleBook: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: 10,
            lineHeight: 12,
            color: colors.textTertiary,
        },
        titleChapterRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
        },
        titleChapter: {
            flexShrink: 1,
            fontFamily: fontFamilies.sansSemiBold,
            fontSize: 14,
            lineHeight: 19,
            color: colors.text,
        },
        // The page scrubber along the bottom (components/Read/PageScrubber.js):
        // the place in the book, the percent, and the play button on the line.
        scrubber: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 48,
            zIndex: 2,
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: 18,
            paddingRight: 12,
            borderTopWidth: 1,
            borderTopColor: colors.divider,
            backgroundColor: colors.readerPaper,
        },
        scrubberTrack: {
            flex: 1,
            height: 2,
            borderRadius: 1,
            backgroundColor: colors.readerHairline,
        },
        scrubberFill: {
            width: '12%',
            height: '100%',
            borderRadius: 1,
            backgroundColor: colors.readerBodyInk,
        },
        scrubberThumb: {
            position: 'absolute',
            left: '12%',
            top: -4,
            width: 10,
            height: 10,
            marginLeft: -5,
            borderRadius: 5,
            backgroundColor: colors.readerBodyInk,
        },
        scrubberLabel: {
            width: 36,
            textAlign: 'right',
            fontFamily: fontFamilies.sansRegular,
            fontSize: 12,
            color: colors.textTertiary,
            fontVariant: ['tabular-nums'],
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
        // The sentence's translation: a pane across the top of the page,
        // hanging from the header (the word panel's twin).
        bar: {
            position: 'absolute',
            left: 8,
            right: 8,
            top: 50,
            zIndex: 4,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 20,
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
            bottom: 0,
            zIndex: 5,
            paddingTop: 14,
            paddingBottom: 18,
            paddingHorizontal: 20,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
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
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
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
            minWidth: 0,
            paddingTop: 2,
        },
        // Word and hanja on one baseline, left-aligned.
        dictHeadRow: {
            flexDirection: 'row',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            columnGap: 8,
        },
        dictHead: {
            fontSize: 25,
            lineHeight: 33,
            color: colors.text,
        },
        dictHanja: {
            fontSize: 17,
            lineHeight: 24,
            color: colors.textSecondary,
        },
        // The pronunciation: an italic meta line under the word.
        dictMetaRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
        },
        dictLine: {
            fontFamily: fontFamilies.sansRegular,
            fontStyle: 'italic',
            fontSize: 13,
            lineHeight: 18,
            color: colors.textTertiary,
        },
        saveButton: {
            width: 44,
            height: 44,
            marginRight: -11,
            alignItems: 'center',
            justifyContent: 'center',
        },
        // The part-of-speech chip beside the meaning, left-aligned.
        senseRow: {
            marginTop: 8,
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
        },
        posChip: {
            paddingVertical: 3,
            paddingHorizontal: 8,
            borderRadius: 8,
            backgroundColor: colors.surfaceMuted,
        },
        posChipText: {
            fontFamily: fontFamilies.sansSemiBold,
            fontSize: 12,
            color: colors.textSecondary,
        },
        sense: {
            flexShrink: 1,
            fontFamily: fontFamilies.sansRegular,
            fontSize: 16,
            lineHeight: 23,
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
        // Solid, centred on the line: the one filled control on the page.
        playButton: {
            marginLeft: 10,
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.inkSlate,
        },
        playIcon: {
            marginLeft: 2,
        },
        listenBar: {
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 14,
            zIndex: 5,
            height: 52,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 6,
            borderRadius: 26,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.readerBorder,
            backgroundColor: colors.readerSurface,
            ...panelShadow,
        },
        listenButton: {
            width: 32,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
        },
        listenPlay: {
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.inkSlate,
        },
        listenDivider: {
            width: 1,
            height: 20,
            marginHorizontal: 4,
            backgroundColor: colors.divider,
        },
        // Speed and the study toggles are plain icons: only play is filled.
        listenChip: {
            height: 32,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            paddingHorizontal: 5,
        },
        listenChipText: {
            fontFamily: fontFamilies.sansSemiBold,
            fontSize: 13,
            color: colors.text,
            fontVariant: ['tabular-nums'],
        },
        listenToggle: {
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
        },
        listenSpacer: {
            flex: 1,
        },
    });
};
