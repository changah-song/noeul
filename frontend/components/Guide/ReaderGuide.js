import { useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import {
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useAppContext } from '../../contexts/AppContext';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, useTheme } from '../../theme';
import { GUIDE_HOLD_SENTENCE, getGuidePage } from '../../services/readerGuideContent';
import {
    GUIDE_CLIPS,
    GUIDE_LAST_CLIP,
    GUIDE_STEP_COUNT,
    guideFrameAt,
    guideTargetId,
} from '../../services/readerGuide';
import GuidePage from './GuidePage';

const TICK_MS = 50;
const TOP_BAR = 48;
const CAPTION = 262;
const MAX_FRAME = 540;
const MIN_FRAME = 360;
// Under this the sample page sets its text a size smaller.
const COMPACT_FRAME = 470;

// The player around the sample page is dark in both themes, like a video.
const PLAYER = {
    bg: '#11151c',
    text: '#f0eded',
    sub: '#c5c6cb',
    muted: '#9a9c9f',
    track: 'rgba(240,237,237,0.18)',
    fill: '#f0eded',
    ghost: 'rgba(240,237,237,0.09)',
    primaryBg: '#f0eded',
    primaryFg: '#11151c',
    frameEdge: 'rgba(240,237,237,0.08)',
    cueDot: '#e3cfb4',
};

// Each clip's caption: title, body and the "your turn" cue.
const CLIP_COPY = {
    tap: { title: 'guide.tapTitle', body: 'guide.tapBody', hint: 'guide.tapHint' },
    bar: { title: 'guide.barTitle', body: 'guide.barBody' },
    save: { title: 'guide.saveTitle', body: 'guide.saveBody', hint: 'guide.saveHint' },
    hold: { title: 'guide.holdTitle', body: 'guide.holdBody', hint: 'guide.holdHint' },
    focus: { title: 'guide.focusTitle', body: 'guide.focusBody', hint: 'guide.focusHint' },
    listen: { title: 'guide.listenTitle', body: 'guide.listenBody', hint: 'guide.listenHint' },
};

const MORE = [
    { key: 'Bookmark', Icon: MaterialIcons, icon: 'bookmark-border' },
    { key: 'Jump', Icon: MaterialCommunityIcons, icon: 'gesture-swipe-horizontal' },
    { key: 'Settings', Icon: Feather, icon: 'menu' },
    { key: 'Learn', Icon: MaterialCommunityIcons, icon: 'cards-outline' },
    { key: 'Goal', Icon: MaterialCommunityIcons, icon: 'circle-half-full' },
];

const startClip = (clip) => ({ clip, t: 0, playing: true, acted: false });

const reducer = (state, action) => {
    switch (action.type) {
        case 'go':
            return startClip(Math.max(0, Math.min(GUIDE_LAST_CLIP, action.clip)));
        case 'act':
            return { ...state, acted: true, playing: true };
        case 'toggle':
            return { ...state, playing: !state.playing };
        case 'tick': {
            const clip = GUIDE_CLIPS[state.clip];
            if (!clip.duration || !state.playing) return state;
            const t = state.t + TICK_MS;
            // Watch + try: the clip stops at its moment of action and waits.
            if (action.mode === 'try' && clip.actionAt != null && !state.acted && t >= clip.actionAt) {
                return state.t === clip.actionAt ? state : { ...state, t: clip.actionAt };
            }
            if (t >= clip.duration) {
                return state.clip < GUIDE_LAST_CLIP ? startClip(state.clip + 1) : { ...state, playing: false };
            }
            return { ...state, t };
        }
        default:
            return state;
    }
};

/**
 * ReaderGuide — the one-minute reading guide, played like a video over a
 * sample page (services/readerGuideContent.js) in the learning language, with
 * every caption and gloss in the interface language. Each clip runs up to its
 * moment of action and waits for the viewer to tap the lit spot ("try" mode),
 * or plays straight through ("watch").
 *
 * `onClose(reason)`: 'done' from the end card, 'skipped' from the X, the
 * intro's skip or Android back. `finishLabel`: the end card's button.
 */
export default function ReaderGuide({ onClose, finishLabel, mode = 'try' }) {
    const { targetLanguage, interfaceLanguage, chineseScript } = useAppContext();
    const { t } = useTranslation();
    const { colors, isDarkMode } = useTheme();
    const safeInsets = useContext(SafeAreaInsetsContext);
    const { height: windowHeight } = useWindowDimensions();
    const styles = useMemo(() => createStyles(), []);
    const [state, dispatch] = useReducer(reducer, startClip(0));

    const page = useMemo(
        () => getGuidePage(targetLanguage, interfaceLanguage, chineseScript),
        [chineseScript, interfaceLanguage, targetLanguage],
    );

    useEffect(() => {
        const timer = setInterval(() => dispatch({ type: 'tick', mode }), TICK_MS);
        return () => clearInterval(timer);
    }, [mode]);

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            onClose?.('skipped');
            return true;
        });
        return () => subscription?.remove?.();
    }, [onClose]);

    const clip = GUIDE_CLIPS[state.clip];
    const { t: ms } = state;
    const hasAction = clip.actionAt != null;
    const acted = !hasAction || (mode === 'watch' ? ms >= clip.actionAt : state.acted);
    const waiting = hasAction && !acted && ms >= clip.actionAt;
    const elapsed = !hasAction ? ms : (acted ? ms - clip.actionAt : -1);
    const ended = Boolean(clip.duration) && ms >= clip.duration;
    const playing = state.playing && !ended;
    const targetId = guideTargetId(clip, page);

    // A new object every tick; the page re-renders only when what it shows changes.
    const rawFrame = guideFrameAt(clip.key, elapsed, page.word, page.sentences[GUIDE_HOLD_SENTENCE].length);
    const frameKey = JSON.stringify(rawFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const frame = useMemo(() => rawFrame, [frameKey]);

    const go = useCallback((index) => dispatch({ type: 'go', clip: index }), []);
    const act = useCallback(() => dispatch({ type: 'act' }), []);
    const onTarget = useCallback((id) => {
        if (waiting && id === targetId) act();
    }, [act, targetId, waiting]);

    const insetTop = safeInsets?.top ?? 0;
    const insetBottom = safeInsets?.bottom ?? 0;
    const frameHeight = Math.round(Math.max(
        MIN_FRAME,
        Math.min(MAX_FRAME, windowHeight - insetTop - insetBottom - TOP_BAR - CAPTION),
    ));
    const compact = frameHeight < COMPACT_FRAME;
    const accent = isDarkMode ? '#d9b48a' : '#9a6431';

    const copy = CLIP_COPY[clip.key];
    const hintWord = clip.target === 'hold' ? page.holdLabel : page.wordLabel;
    const segments = GUIDE_CLIPS.map((item, index) => ({ item, index })).filter(({ item }) => item.duration);

    const renderTopBar = () => (
        <View style={styles.topBar}>
            <View style={styles.segments}>
                {segments.map(({ index }, position) => {
                    let fill = 0;
                    if (state.clip > index) fill = 1;
                    else if (state.clip === index && clip.duration) fill = Math.min(1, ms / clip.duration);
                    return (
                        <Pressable
                            key={index}
                            onPress={() => go(index)}
                            style={styles.segment}
                            accessibilityRole="button"
                            accessibilityLabel={t('guide.clipLabel', { n: position + 1, total: GUIDE_STEP_COUNT })}
                        >
                            <View style={styles.segmentTrack}>
                                <View style={[styles.segmentFill, { width: `${fill * 100}%` }]} />
                            </View>
                        </Pressable>
                    );
                })}
            </View>
            <TouchableOpacity
                onPress={() => onClose?.('skipped')}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel={t('guide.skip')}
                testID="guide-close"
            >
                <Feather name="x" size={20} color={PLAYER.sub} />
            </TouchableOpacity>
        </View>
    );

    const renderCaption = () => {
        if (clip.key === 'intro') {
            return (
                <View style={styles.caption}>
                    <ScrollView style={styles.captionText} showsVerticalScrollIndicator={false}>
                        <Text style={styles.eyebrow}>{t('guide.introEyebrow')}</Text>
                        <Text style={styles.title} accessibilityRole="header">{t('guide.introTitle')}</Text>
                        <Text style={styles.body}>{t('guide.introBody')}</Text>
                    </ScrollView>
                    <TouchableOpacity
                        onPress={() => go(1)}
                        style={styles.primary}
                        accessibilityRole="button"
                        testID="guide-play"
                    >
                        <Feather name="play" size={16} color={PLAYER.primaryFg} />
                        <Text style={styles.primaryText}>{t('guide.play')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onClose?.('skipped')} style={styles.secondary} accessibilityRole="button">
                        <Text style={styles.secondaryText}>{t('guide.skipExplore')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        return (
            <View style={styles.caption}>
                <ScrollView style={styles.captionText} showsVerticalScrollIndicator={false}>
                    <Text style={styles.eyebrow}>{t('guide.stepOf', { n: state.clip, total: GUIDE_STEP_COUNT })}</Text>
                    <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">{t(copy.title)}</Text>
                    <Text style={styles.body}>{t(copy.body)}</Text>
                </ScrollView>
                <View style={styles.controls}>
                    <TouchableOpacity
                        onPress={() => go(state.clip)}
                        style={styles.round}
                        accessibilityRole="button"
                        accessibilityLabel={t('guide.replayClip')}
                    >
                        <Feather name="rotate-ccw" size={18} color={PLAYER.text} />
                    </TouchableOpacity>
                    {waiting ? (
                        <TouchableOpacity onPress={act} style={styles.showMe} accessibilityRole="button" testID="guide-show-me">
                            <Feather name="play" size={15} color={PLAYER.primaryFg} />
                            <Text style={styles.primaryText}>{t('guide.showMe')}</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            onPress={() => (ended ? go(state.clip + 1) : dispatch({ type: 'toggle' }))}
                            style={styles.play}
                            accessibilityRole="button"
                            accessibilityLabel={playing ? t('read.listenPause') : t('read.listenPlay')}
                        >
                            <Feather
                                name={playing ? 'pause' : 'play'}
                                size={22}
                                color={PLAYER.primaryFg}
                                style={playing ? null : styles.playIcon}
                            />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => go(state.clip + 1)} style={styles.next} accessibilityRole="button" testID="guide-next">
                        <Text style={styles.nextText}>{t('guide.next')}</Text>
                        <Feather name="chevron-right" size={18} color={PLAYER.text} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderDone = () => (
        <View style={styles.done}>
            <ScrollView style={styles.captionText} showsVerticalScrollIndicator={false}>
                <Text style={styles.eyebrow}>{t('guide.doneEyebrow')}</Text>
                <Text style={[styles.title, styles.doneTitle]} accessibilityRole="header">{t('guide.doneTitle')}</Text>
                <Text style={styles.body}>{t('guide.doneBody')}</Text>
                <View style={styles.moreList}>
                    {MORE.map(({ key, Icon, icon }) => (
                        <View key={key} style={styles.moreRow}>
                            <View style={styles.moreIcon}>
                                <Icon name={icon} size={19} color={PLAYER.text} />
                            </View>
                            <View style={styles.moreCopy}>
                                <Text style={styles.moreTitle}>{t(`guide.more${key}Title`)}</Text>
                                <Text style={styles.moreBody}>{t(`guide.more${key}Body`)}</Text>
                            </View>
                        </View>
                    ))}
                </View>
            </ScrollView>
            <TouchableOpacity
                onPress={() => onClose?.('done')}
                style={styles.primary}
                accessibilityRole="button"
                testID="guide-finish"
            >
                <Text style={styles.primaryText}>{finishLabel || t('onboarding.startReading')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => go(1)} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>{t('guide.watchAgain')}</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={[styles.screen, { paddingTop: insetTop, paddingBottom: insetBottom }]} testID="reader-guide">
            <StatusBar style="light" backgroundColor={PLAYER.bg} />
            {renderTopBar()}
            {clip.key === 'done' ? renderDone() : (
                <>
                    <View style={[styles.frame, { height: frameHeight }]}>
                        <GuidePage
                            page={page}
                            frame={frame}
                            targetId={targetId}
                            waiting={waiting}
                            onTarget={onTarget}
                            t={t}
                            colors={colors}
                            accent={accent}
                            compact={compact}
                        />
                        {waiting && copy?.hint ? (
                            <View style={styles.cue} pointerEvents="none" accessibilityLiveRegion="polite">
                                <View style={styles.cueDot} />
                                <Text style={styles.cueText}>{t(copy.hint, { word: hintWord })}</Text>
                            </View>
                        ) : null}
                        {clip.key === 'intro' ? (
                            <View style={styles.poster}>
                                <TouchableOpacity
                                    onPress={() => go(1)}
                                    style={styles.posterPlay}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('guide.play')}
                                >
                                    <Feather name="play" size={30} color="#202631" style={styles.playIcon} />
                                </TouchableOpacity>
                            </View>
                        ) : null}
                    </View>
                    {renderCaption()}
                </>
            )}
        </View>
    );
}

const createStyles = () => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: PLAYER.bg,
    },
    topBar: {
        height: TOP_BAR,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 18,
        paddingRight: 6,
    },
    segments: {
        flex: 1,
        flexDirection: 'row',
        gap: 5,
    },
    segment: {
        flex: 1,
        height: 44,
        justifyContent: 'center',
    },
    segmentTrack: {
        height: 3,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: PLAYER.track,
    },
    segmentFill: {
        height: '100%',
        backgroundColor: PLAYER.fill,
    },
    close: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    frame: {
        marginHorizontal: 20,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: PLAYER.frameEdge,
    },
    cue: {
        position: 'absolute',
        top: 52,
        alignSelf: 'center',
        maxWidth: '88%',
        zIndex: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 14,
        borderRadius: 999,
        backgroundColor: '#202631',
        elevation: 8,
        shadowColor: '#11151c',
        shadowOpacity: 0.22,
        shadowRadius: 12,
    },
    cueDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: PLAYER.cueDot,
    },
    cueText: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        lineHeight: 18,
        color: '#ffffff',
    },
    poster: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(17,21,28,0.42)',
    },
    posterPlay: {
        width: 76,
        height: 76,
        borderRadius: 38,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(251,249,248,0.96)',
    },
    playIcon: {
        marginLeft: 3,
    },
    caption: {
        flex: 1,
        paddingTop: 18,
        paddingHorizontal: 24,
        paddingBottom: 16,
    },
    captionText: {
        flex: 1,
    },
    eyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.9,
        color: PLAYER.muted,
    },
    title: {
        marginTop: 8,
        fontFamily: fontFamilies.displayMedium,
        fontSize: 25,
        lineHeight: 31,
        color: PLAYER.text,
    },
    doneTitle: {
        fontSize: 30,
        lineHeight: 36,
    },
    body: {
        marginTop: 8,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: PLAYER.sub,
    },
    controls: {
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    round: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PLAYER.ghost,
    },
    play: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PLAYER.primaryBg,
    },
    showMe: {
        minHeight: 48,
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 22,
        borderRadius: 24,
        backgroundColor: PLAYER.primaryBg,
    },
    next: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingLeft: 12,
        paddingRight: 4,
    },
    nextText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: PLAYER.text,
    },
    primary: {
        marginTop: 10,
        minHeight: 52,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: PLAYER.primaryBg,
    },
    primaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: PLAYER.primaryFg,
    },
    secondary: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: PLAYER.sub,
    },
    done: {
        flex: 1,
        paddingTop: 8,
        paddingHorizontal: 24,
        paddingBottom: 16,
    },
    moreList: {
        marginTop: 16,
        gap: 4,
    },
    moreRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        paddingVertical: 7,
    },
    moreIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PLAYER.ghost,
    },
    moreCopy: {
        flex: 1,
        minWidth: 0,
    },
    moreTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 20,
        color: PLAYER.text,
    },
    moreBody: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: PLAYER.muted,
    },
});
