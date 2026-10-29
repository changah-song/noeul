import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { getVocabContexts, lookupCacheByStem } from '../../services/Database';
import { chapterTranslations } from '../../services/chapterTranslations';
import { createListenPlayer, LISTEN_RATES, voiceLocaleFor, voiceSampleFor } from '../../services/listenPlayer';
import {
    AUDIO_REVIEW_REPEATS,
    buildAudioReviewSentencePart,
    buildAudioReviewWordPart,
    groupBySentence,
    pickSentence,
    spokenMeaning,
} from '../../services/audioReview';
import ListenVoiceSheet from '../Read/ListenVoiceSheet';
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
import { ensureNotificationPermission } from '../../services/notificationPermission';
import { fontFamilies, useTheme } from '../../theme';

const OWNER = 'audio-review';
// Listen mode's saved voice settings (screens/Read.js LISTEN_PREFS_KEY): the
// same voices read here.
const LISTEN_PREFS_KEY = 'listenPrefs';
// Audio review's own setting: how many times the word and meaning are read.
const AUDIO_REVIEW_PREFS_KEY = 'audioReviewPrefs';

// Merge `patch` into listen mode's saved prefs (shared with the reader).
const saveListenPrefs = async (patch) => {
    try {
        const raw = await AsyncStorage.getItem(LISTEN_PREFS_KEY);
        const current = raw ? JSON.parse(raw) : {};
        await AsyncStorage.setItem(LISTEN_PREFS_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {
        // The choice still applies for this session.
    }
};
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
 * Words saved from the same sentence play together: each word and meaning,
 * then the shared sentence once.
 * Keeps playing with the screen off through the same foreground service and
 * lock-screen player as the reader's listen mode.
 */
// Words whose sentences are looked up up front to group them (local only).
const GROUPING_LIMIT = 300;
// The most words read before one shared sentence.
const GROUP_MAX = 6;

const wordKey = (row) => `${row?.word ?? ''}\u0000${row?.hanja ?? ''}\u0000${row?.def ?? ''}`;

const AudioReview = ({ visible, words: inputWords = [], targetLanguage, interfaceLanguage, ownerId, onClose }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [index, setIndex] = useState(0);
    // The play order: inputWords with words that share a sentence together.
    const [words, setWords] = useState(inputWords);
    const sentenceCacheRef = useRef(new Map());
    const orderingRef = useRef(Promise.resolve());
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState(1);
    const [details, setDetails] = useState({});
    const [voiceError, setVoiceError] = useState(false);
    const [voicePrefs, setVoicePrefs] = useState({ voices: {}, pitch: 1 });
    const [repeat, setRepeat] = useState(1);
    const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
    const [previewingVoice, setPreviewingVoice] = useState(undefined);
    const playerRef = useRef(null);
    const detailsRef = useRef({});
    const playingRef = useRef(false);
    const runRef = useRef(0);
    const targetLocale = voiceLocaleFor(targetLanguage);
    const interfaceLocale = voiceLocaleFor(interfaceLanguage);
    const word = words[index] ?? null;
    const current = details[index] ?? null;

    // The sentence a saved word is read with (from the local database).
    const sentenceFor = useCallback(async (row) => {
        const key = wordKey(row);
        if (sentenceCacheRef.current.has(key)) return sentenceCacheRef.current.get(key);
        let sentence = null;
        try {
            const contexts = await getVocabContexts(
                row.word, row.hanja, row.def, 12, row.language ?? targetLanguage, { ownerId }
            );
            sentence = pickSentence(contexts, row.word);
        } catch {
            sentence = null;
        }
        sentenceCacheRef.current.set(key, sentence);
        return sentence;
    }, [ownerId, targetLanguage]);

    // The sentence and its translation for a word, fetched once.
    const loadDetails = useCallback(async (position) => {
        if (detailsRef.current[position]) return detailsRef.current[position];
        const row = words[position];
        if (!row) return null;
        // The dictionary's short gloss reads better than a long saved sense.
        let gloss = null;
        try {
            const cached = await lookupCacheByStem(row.word, {
                language: row.language ?? targetLanguage,
                interfaceLanguage,
            });
            gloss = cached?.gloss ?? null;
        } catch {
            gloss = null;
        }
        const meaning = spokenMeaning({ gloss, definition: row.def });
        const sentence = await sentenceFor(row);
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
    }, [interfaceLanguage, sentenceFor, targetLanguage, words]);

    const pause = useCallback(() => {
        runRef.current += 1;
        playingRef.current = false;
        setPlaying(false);
        playerRef.current?.stop();
    }, []);

    // Play from `position`: the word (and any next words that share its
    // sentence) with their meanings, the sentence once, then move on.
    const playFrom = useCallback(async (position) => {
        await orderingRef.current;
        if (!words[position]) {
            pause();
            return;
        }
        const run = ++runRef.current;
        // Asked (and answered) before the voice starts: the system dialog
        // pauses the app and cut the first word off.
        await ensureNotificationPermission();
        if (run !== runRef.current) return;
        claimListenSession(OWNER, () => pause());
        playingRef.current = true;
        setPlaying(true);
        setVoiceError(false);
        setIndex(position);
        if (!playerRef.current) playerRef.current = createListenPlayer();
        const loaded = await loadDetails(position);
        if (run !== runRef.current) return;

        const group = [position];
        if (loaded?.sentence) {
            while (group.length < GROUP_MAX) {
                const next = position + group.length;
                if (!words[next] || (await sentenceFor(words[next])) !== loaded.sentence) break;
                group.push(next);
            }
            if (run !== runRef.current) return;
        }
        const after = position + group.length;
        // Fetch the next word while this one plays.
        loadDetails(after).catch(() => {});

        const voice = { targetLocale, interfaceLocale, rate, pitch: voicePrefs.pitch, voices: voicePrefs.voices };
        const finish = (outcome) => {
            if (outcome === 'error') {
                setVoiceError(true);
                pause();
            }
            return outcome === 'done';
        };
        for (const at of group) {
            setIndex(at);
            const part = at === position ? loaded : await loadDetails(at);
            if (run !== runRef.current) return;
            const outcome = await playerRef.current.speakSequence(buildAudioReviewWordPart({
                ...voice,
                word: words[at].word,
                meaning: part?.meaning,
                repeat,
            }));
            if (run !== runRef.current || !finish(outcome)) return;
        }
        const outcome = await playerRef.current.speakSequence(buildAudioReviewSentencePart({
            ...voice,
            sentence: loaded?.sentence,
            translation: loaded?.translation,
        }));
        if (run !== runRef.current || !finish(outcome)) return;
        if (after < words.length) {
            playFrom(after);
        } else {
            pause();
        }
    }, [interfaceLocale, loadDetails, pause, rate, repeat, sentenceFor, targetLocale, voicePrefs, words]);

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
        setRate((value) => {
            const next = LISTEN_RATES[(LISTEN_RATES.indexOf(value) + 1) % LISTEN_RATES.length] ?? 1;
            saveListenPrefs({ rate: next });
            return next;
        });
    }, []);

    const cycleRepeat = useCallback(() => {
        setRepeat((value) => {
            const next = AUDIO_REVIEW_REPEATS[(AUDIO_REVIEW_REPEATS.indexOf(value) + 1) % AUDIO_REVIEW_REPEATS.length] ?? 1;
            AsyncStorage.setItem(AUDIO_REVIEW_PREFS_KEY, JSON.stringify({ repeat: next })).catch(() => {});
            return next;
        });
    }, []);

    // The voice sheet (the reader's listen-mode sheet): the book voice and the
    // translation voice, speed and pitch, shared with the reader.
    const openVoiceSheet = useCallback(() => {
        pause();
        setVoiceSheetOpen(true);
    }, [pause]);
    const previewVoice = useCallback(async (voiceId, which = 'book') => {
        const locale = which === 'translation' ? interfaceLocale : targetLocale;
        const key = `${which}:${voiceId}`;
        setPreviewingVoice(key);
        if (!playerRef.current) playerRef.current = createListenPlayer();
        await playerRef.current.speakSequence([{
            text: voiceSampleFor(locale),
            locale,
            rate,
            pitch: voicePrefs.pitch,
            voice: voiceId || null,
        }]);
        setPreviewingVoice((current) => (current === key ? undefined : current));
    }, [interfaceLocale, rate, targetLocale, voicePrefs.pitch]);
    const selectVoice = useCallback((voiceId, which = 'book') => {
        const locale = which === 'translation' ? interfaceLocale : targetLocale;
        setVoicePrefs((current) => {
            const voices = { ...current.voices, [locale]: voiceId || undefined };
            saveListenPrefs({ voices });
            return { ...current, voices };
        });
        previewVoice(voiceId, which);
    }, [interfaceLocale, previewVoice, targetLocale]);
    const changePitch = useCallback((pitch) => {
        setVoicePrefs((current) => ({ ...current, pitch }));
        saveListenPrefs({ pitch });
    }, []);
    const changeRate = useCallback((next) => {
        setRate(next);
        saveListenPrefs({ rate: next });
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
        AsyncStorage.getItem(AUDIO_REVIEW_PREFS_KEY)
            .then((raw) => {
                if (cancelled || !raw) return;
                const parsed = JSON.parse(raw);
                if (AUDIO_REVIEW_REPEATS.includes(parsed?.repeat)) setRepeat(parsed.repeat);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [visible]);

    // Fresh list each time it opens, with words that share a sentence moved
    // together (play waits for this).
    useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        detailsRef.current = {};
        sentenceCacheRef.current = new Map();
        setDetails({});
        setIndex(0);
        setVoiceError(false);
        setWords(inputWords);
        orderingRef.current = (async () => {
            const head = inputWords.slice(0, GROUPING_LIMIT);
            const sentences = await Promise.all(head.map((row) => sentenceFor(row)));
            if (cancelled) return;
            const grouped = groupBySentence(head, (row, at) => sentences[at]);
            if (grouped.every((row, at) => row === head[at])) return;
            detailsRef.current = {};
            setDetails({});
            setWords([...grouped, ...inputWords.slice(GROUPING_LIMIT)]);
        })();
        return () => {
            cancelled = true;
        };
        // sentenceFor changes with the owner/language, which also changes inputWords.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, inputWords]);

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
                    <TouchableOpacity
                        onPress={openVoiceSheet}
                        style={styles.headerButton}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('read.listenVoiceTitle')}
                    >
                        <Feather name="sliders" size={20} color={colors.text} />
                    </TouchableOpacity>
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
                    <TouchableOpacity
                        onPress={cycleRepeat}
                        style={styles.rateButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('learn.audioRepeat', { count: repeat })}
                    >
                        <Feather name="repeat" size={14} color={colors.textSecondary} />
                        <Text style={styles.rateText}>{`${repeat}`}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
            <ListenVoiceSheet
                visible={voiceSheetOpen}
                onClose={() => {
                    setVoiceSheetOpen(false);
                    playerRef.current?.stop();
                    setPreviewingVoice(undefined);
                }}
                colors={colors}
                insets={insets}
                locale={targetLocale}
                rate={rate}
                pitch={voicePrefs.pitch}
                voiceId={voicePrefs.voices?.[targetLocale] || null}
                previewingId={previewingVoice}
                onChangeRate={changeRate}
                onChangePitch={changePitch}
                onSelectVoice={(voiceId) => selectVoice(voiceId, 'book')}
                onPreviewVoice={(voiceId) => previewVoice(voiceId, 'book')}
                translationLocale={interfaceLocale}
                translationVoiceId={voicePrefs.voices?.[interfaceLocale] || null}
                onSelectTranslationVoice={(voiceId) => selectVoice(voiceId, 'translation')}
                onPreviewTranslationVoice={(voiceId) => previewVoice(voiceId, 'translation')}
            />
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
        flexDirection: 'row',
        gap: 3,
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
