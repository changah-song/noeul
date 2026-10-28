import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    PermissionsAndroid,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { getVocabContexts } from '../../services/Database';
import { chapterTranslations } from '../../services/chapterTranslations';
import { createListenPlayer, LISTEN_RATES, voiceLocaleFor } from '../../services/listenPlayer';
import { buildAudioReviewScript, pickSentence, shortMeaning } from '../../services/audioReview';
import {
    claimListenSession,
    mayUseListenSession,
    ownsListenSession,
    releaseListenSession,
} from '../../services/listenOwner';
import {
    addListenControlListener,
    stopListenSession,
    updateListenSession,
} from '../../modules/native-epub-reader/src/NativeEpubReaderView';
import { formatNumber } from '../../services/interfaceLanguage';
import { fontFamilies, useTheme } from '../../theme';

const OWNER = 'audio-review';
// Listen mode's saved voice settings (screens/Read.js LISTEN_PREFS_KEY): the
// same voices read here.
const LISTEN_PREFS_KEY = 'listenPrefs';
// A sentence's translation may need the network; past this the word plays
// without it rather than waiting.
const TRANSLATION_TIMEOUT_MS = 6000;

const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(''), ms)),
]);

/**
 * AudioReview — the Learn tab's audio mode: plays the saved words one after
 * another, hands-free. For each: the word, its short meaning, a sentence it
 * was met in, and that sentence's translation (services/audioReview.js).
 * Keeps playing with the screen off through the same foreground service and
 * lock-screen player as the reader's listen mode.
 */
const AudioReview = ({ visible, words = [], targetLanguage, interfaceLanguage, ownerId, onClose }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState(1);
    const [details, setDetails] = useState({});
    const [voiceError, setVoiceError] = useState(false);
    const [voicePrefs, setVoicePrefs] = useState({ voices: {}, pitch: 1 });
    const playerRef = useRef(null);
    const detailsRef = useRef({});
    const playingRef = useRef(false);
    const runRef = useRef(0);
    const targetLocale = voiceLocaleFor(targetLanguage);
    const interfaceLocale = voiceLocaleFor(interfaceLanguage);
    const word = words[index] ?? null;
    const current = details[index] ?? null;

    // The sentence and its translation for a word, fetched once.
    const loadDetails = useCallback(async (position) => {
        if (detailsRef.current[position]) return detailsRef.current[position];
        const row = words[position];
        if (!row) return null;
        const meaning = shortMeaning(row.def);
        let sentence = null;
        try {
            const contexts = await getVocabContexts(
                row.word, row.hanja, row.def, 12, row.language ?? targetLanguage, { ownerId }
            );
            sentence = pickSentence(contexts, row.word);
        } catch {
            sentence = null;
        }
        let translation = '';
        if (sentence) {
            translation = await withTimeout(
                chapterTranslations.translate(sentence, targetLanguage, interfaceLanguage).catch(() => ''),
                TRANSLATION_TIMEOUT_MS
            );
        }
        const loaded = { meaning, sentence, translation: String(translation || '').trim() };
        detailsRef.current = { ...detailsRef.current, [position]: loaded };
        setDetails(detailsRef.current);
        return loaded;
    }, [interfaceLanguage, ownerId, targetLanguage, words]);

    const pause = useCallback(() => {
        runRef.current += 1;
        playingRef.current = false;
        setPlaying(false);
        playerRef.current?.stop();
    }, []);

    // Play from `position`: read the word, then move on to the next one.
    const playFrom = useCallback(async (position) => {
        if (!words[position]) {
            pause();
            return;
        }
        // The notification player needs this on Android 13+.
        if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
            PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
        }
        claimListenSession(OWNER, () => pause());
        const run = ++runRef.current;
        playingRef.current = true;
        setPlaying(true);
        setVoiceError(false);
        setIndex(position);
        if (!playerRef.current) playerRef.current = createListenPlayer();
        const loaded = await loadDetails(position);
        if (run !== runRef.current) return;
        // Fetch the next word while this one plays.
        loadDetails(position + 1).catch(() => {});
        const row = words[position];
        const outcome = await playerRef.current.speakSequence(buildAudioReviewScript({
            word: row.word,
            meaning: loaded?.meaning,
            sentence: loaded?.sentence,
            translation: loaded?.translation,
            targetLocale,
            interfaceLocale,
            rate,
            pitch: voicePrefs.pitch,
            voices: voicePrefs.voices,
        }));
        if (run !== runRef.current) return;
        if (outcome === 'error') {
            setVoiceError(true);
            pause();
            return;
        }
        if (outcome === 'done') {
            if (position + 1 < words.length) {
                playFrom(position + 1);
            } else {
                pause();
            }
        }
    }, [interfaceLocale, loadDetails, pause, rate, targetLocale, voicePrefs, words]);

    const togglePlay = useCallback(() => {
        if (playingRef.current) pause();
        else playFrom(index);
    }, [index, pause, playFrom]);

    const step = useCallback((direction) => {
        const next = Math.min(Math.max(index + direction, 0), Math.max(words.length - 1, 0));
        if (playingRef.current) {
            playFrom(next);
        } else {
            setIndex(next);
        }
    }, [index, playFrom, words.length]);

    const cycleRate = useCallback(() => {
        setRate((value) => LISTEN_RATES[(LISTEN_RATES.indexOf(value) + 1) % LISTEN_RATES.length] ?? 1);
    }, []);

    const close = useCallback(() => {
        pause();
        if (mayUseListenSession(OWNER)) stopListenSession();
        releaseListenSession(OWNER);
        onClose?.();
    }, [onClose, pause]);

    // The voices, pitch and speed chosen in listen mode, read on each open.
    useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        AsyncStorage.getItem(LISTEN_PREFS_KEY)
            .then((raw) => {
                if (cancelled || !raw) return;
                const parsed = JSON.parse(raw);
                setVoicePrefs({
                    voices: parsed?.voices && typeof parsed.voices === 'object' ? parsed.voices : {},
                    pitch: Number.isFinite(parsed?.pitch) ? parsed.pitch : 1,
                });
                if (LISTEN_RATES.includes(parsed?.rate)) setRate(parsed.rate);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [visible]);

    // Fresh list each time it opens.
    useEffect(() => {
        if (!visible) return;
        detailsRef.current = {};
        setDetails({});
        setIndex(0);
        setVoiceError(false);
    }, [visible, words]);

    // Show the current word's sentence even before playing.
    useEffect(() => {
        if (visible && word) loadDetails(index).catch(() => {});
    }, [index, loadDetails, visible, word]);

    // The lock-screen / notification player.
    useEffect(() => {
        if (!visible || !word || !ownsListenSession(OWNER)) return;
        updateListenSession({
            title: word.word,
            subtitle: `${t('learn.audioReview')} · ${formatNumber(index + 1)} / ${formatNumber(words.length)}`,
            playing,
            cover: '',
        });
    }, [index, playing, t, visible, word, words.length]);

    const controlsRef = useRef({});
    controlsRef.current = { togglePlay, step, pause, playFrom, index, close };
    useEffect(() => {
        if (!visible) return undefined;
        const subscription = addListenControlListener(({ action } = {}) => {
            if (!ownsListenSession(OWNER)) return;
            const controls = controlsRef.current;
            switch (action) {
                case 'play':
                    controls.playFrom(controls.index);
                    break;
                case 'pause':
                    controls.pause();
                    break;
                case 'toggle':
                    controls.togglePlay();
                    break;
                case 'next':
                    controls.step(1);
                    break;
                case 'previous':
                    controls.step(-1);
                    break;
                case 'stop':
                    controls.close();
                    break;
                default:
                    break;
            }
        });
        return () => subscription?.remove?.();
    }, [visible]);

    useEffect(() => () => {
        runRef.current += 1;
        playerRef.current?.destroy();
        playerRef.current = null;
        if (mayUseListenSession(OWNER)) stopListenSession();
        releaseListenSession(OWNER);
    }, []);

    const wordCount = words.length;

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={close}
                        style={styles.headerButton}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                    >
                        <Feather name="chevron-down" size={26} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>{t('learn.audioReview')}</Text>
                    <View style={styles.headerButton} />
                </View>

                {word ? (
                    <View style={styles.body}>
                        <Text style={styles.progress}>
                            {`${formatNumber(index + 1)} / ${formatNumber(wordCount)}`}
                        </Text>
                        <Text style={styles.word} selectable>{word.word}</Text>
                        {current?.meaning ? <Text style={styles.meaning}>{current.meaning}</Text> : null}
                        <View style={styles.sentenceBlock}>
                            {!current ? (
                                <ActivityIndicator color={colors.textTertiary} />
                            ) : current.sentence ? (
                                <>
                                    <Text style={styles.sentence}>{current.sentence}</Text>
                                    {current.translation ? (
                                        <Text style={styles.translation}>{current.translation}</Text>
                                    ) : null}
                                </>
                            ) : (
                                <Text style={styles.muted}>{t('learn.audioNoSentence')}</Text>
                            )}
                        </View>
                        {voiceError ? <Text style={styles.error}>{t('learn.audioNoVoice')}</Text> : null}
                    </View>
                ) : (
                    <View style={styles.body}>
                        <Text style={styles.muted}>{t('learn.audioEmpty')}</Text>
                    </View>
                )}

                <View style={styles.controls}>
                    <TouchableOpacity
                        onPress={cycleRate}
                        style={styles.rateButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('learn.audioSpeed')}
                    >
                        <Text style={styles.rateText}>{`${rate}×`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => step(-1)}
                        disabled={index === 0}
                        style={[styles.stepButton, index === 0 && styles.disabled]}
                        accessibilityRole="button"
                        accessibilityLabel={t('learn.audioPrevious')}
                    >
                        <Feather name="skip-back" size={26} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={togglePlay}
                        disabled={!word}
                        style={styles.playButton}
                        accessibilityRole="button"
                        accessibilityLabel={playing ? t('learn.audioPause') : t('learn.audioPlay')}
                    >
                        <Feather name={playing ? 'pause' : 'play'} size={32} color={colors.surface} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => step(1)}
                        disabled={index >= wordCount - 1}
                        style={[styles.stepButton, index >= wordCount - 1 && styles.disabled]}
                        accessibilityRole="button"
                        accessibilityLabel={t('learn.audioNext')}
                    >
                        <Feather name="skip-forward" size={26} color={colors.text} />
                    </TouchableOpacity>
                    <View style={styles.rateButton} />
                </View>
            </SafeAreaView>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background ?? colors.surface,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    headerButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        color: colors.text,
    },
    body: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 28,
        gap: 14,
    },
    progress: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        color: colors.textTertiary,
        textAlign: 'center',
    },
    word: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 40,
        lineHeight: 52,
        color: colors.text,
        textAlign: 'center',
    },
    meaning: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 19,
        lineHeight: 26,
        color: colors.text,
        textAlign: 'center',
    },
    sentenceBlock: {
        marginTop: 18,
        minHeight: 90,
        gap: 10,
        justifyContent: 'center',
    },
    sentence: {
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 18,
        lineHeight: 28,
        color: colors.text,
        textAlign: 'center',
    },
    translation: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    muted: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textTertiary,
        textAlign: 'center',
    },
    error: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 28,
        paddingBottom: 28,
    },
    rateButton: {
        width: 52,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
    },
    rateText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: colors.textSecondary,
    },
    stepButton: {
        width: 52,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playButton: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
    disabled: {
        opacity: 0.35,
    },
});

export default memo(AudioReview);
