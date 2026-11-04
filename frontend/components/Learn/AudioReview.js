import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import {
    getAudioLessons,
    getAudioLessonWordInfo,
    getVocabContexts,
    getWordDifficulties,
    lookupCacheByStem,
    markAudioLessonPlayed,
    saveAudioLesson,
} from '../../services/Database';
import { chapterTranslations } from '../../services/chapterTranslations';
import { createListenPlayer, LISTEN_RATES, voiceLocaleFor, voiceSampleFor } from '../../services/listenPlayer';
import {
    AUDIO_REVIEW_REPEATS,
    buildAudioReviewSentencePart,
    buildAudioReviewWordPart,
    groupBySentence,
    spokenMeaning,
} from '../../services/audioReview';
import {
    AUDIO_LESSON_SIZES,
    episodeTitle,
    lessonIntroText,
    lessonOutroText,
    lessonSizeFor,
    lessonWordRecord,
    pickLessonSentence,
    planLesson,
    rankByUsage,
    rotationUsedKeys,
    themeForDomain,
    withLessonSize,
} from '../../services/audioLessons';
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
import { formatDate, formatNumber } from '../../services/interfaceLanguage';
import { withListenTimeout } from '../../services/listenDelay';
import { ensureNotificationPermission } from '../../services/notificationPermission';
import { fontFamilies, useTheme } from '../../theme';

const OWNER = 'audio-review';
// Listen mode's saved voice settings (screens/Read.js LISTEN_PREFS_KEY): the
// same voices read here.
const LISTEN_PREFS_KEY = 'listenPrefs';
// Audio review's own setting: how many times the word and meaning are read.
const AUDIO_REVIEW_PREFS_KEY = 'audioReviewPrefs';
// Words per lesson, per target language ({ sizeByLanguage: { ko: 5 } }).
const AUDIO_LESSON_PREFS_KEY = 'audioLessonPrefs';

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
// The pause after the intro, before the first word.
const INTRO_PAUSE_MS = 900;

// Screen-off safe: a JS timer would never fire with the phone locked.
const withTimeout = (promise, ms) => withListenTimeout(promise, ms, '');

/**
 * AudioReview — the Learn tab's audio lessons. The first screen picks how
 * many words a lesson has, starts today's lesson (the next most useful saved
 * words, grouped by theme where possible: services/audioLessons.js) and lists
 * past lessons ("episodes") to replay. The player reads, hands-free: a short
 * intro, then for each word the word, its short meaning, a short sentence it
 * was met in and that sentence's translation (services/audioReview.js), then
 * an outro. Words saved from the same sentence play together: each word and
 * meaning, then the shared sentence once. Finishing a lesson does not mark its
 * words as learned; the next lesson takes the next words.
 * Keeps playing with the screen off through the same foreground service and
 * lock-screen player as the reader's listen mode.
 */
// The most words read before one shared sentence.
const GROUP_MAX = 6;

const wordKey = (row) => `${row?.word ?? ''}\u0000${row?.hanja ?? ''}\u0000${row?.def ?? ''}`;

const AudioReview = ({ visible, words: candidates = [], targetLanguage, interfaceLanguage, ownerId, onClose }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(colors), [colors]);
    // 'home' (word count, today's lesson, episodes) or 'player'.
    const [view, setView] = useState('home');
    const [lesson, setLesson] = useState(null);
    const lessonRef = useRef(null);
    const [episodes, setEpisodes] = useState([]);
    const [homeData, setHomeData] = useState(null);
    const [homeLoading, setHomeLoading] = useState(false);
    const [lessonSize, setLessonSize] = useState(lessonSizeFor(null, targetLanguage));
    const lessonPrefsRef = useRef({});
    const [starting, setStarting] = useState(false);
    const [index, setIndex] = useState(0);
    // The play order: the lesson's words with words that share a sentence
    // together. wordsRef is what playback reads (it is set before the render).
    const [words, setWordsState] = useState([]);
    const wordsRef = useRef([]);
    const setWords = useCallback((list) => {
        wordsRef.current = list;
        setWordsState(list);
    }, []);
    const sentenceCacheRef = useRef(new Map());
    const orderingRef = useRef(Promise.resolve());
    const introDoneRef = useRef(false);
    const autoPlayRef = useRef(false);
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
    const scope = useMemo(() => ({ ownerId, language: targetLanguage }), [ownerId, targetLanguage]);

    // The sentence a word is read with: a short one it was met in (from the
    // local database), cut to the word's clause when long, or none.
    const sentenceFor = useCallback(async (row) => {
        const key = wordKey(row);
        if (sentenceCacheRef.current.has(key)) return sentenceCacheRef.current.get(key);
        let sentence = null;
        try {
            const language = row.language ?? targetLanguage;
            const contexts = await getVocabContexts(
                row.word, row.hanja, row.def, 12, language, { ownerId }
            );
            sentence = pickLessonSentence(contexts, row.word, language);
        } catch {
            sentence = null;
        }
        sentenceCacheRef.current.set(key, sentence);
        return sentence;
    }, [ownerId, targetLanguage]);

    // The sentence and its translation for a word, fetched once.
    const loadDetails = useCallback(async (position) => {
        if (detailsRef.current[position]) return detailsRef.current[position];
        const row = wordsRef.current[position];
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
        if (wordsRef.current[position] !== row) return loaded;
        detailsRef.current = { ...detailsRef.current, [position]: loaded };
        setDetails(detailsRef.current);
        return loaded;
    }, [interfaceLanguage, sentenceFor, targetLanguage]);

    const pause = useCallback(() => {
        runRef.current += 1;
        playingRef.current = false;
        setPlaying(false);
        playerRef.current?.stop();
    }, []);

    // ─── Home: lesson size, today's lesson, episodes ──────────────────────

    // Episodes, and the candidates ranked by usage with their themes.
    const loadHome = useCallback(async () => {
        setHomeLoading(true);
        const stems = candidates.map((row) => row.word).filter(Boolean);
        const [saved, difficulties, wordInfo] = await Promise.all([
            getAudioLessons(scope).catch(() => []),
            getWordDifficulties(targetLanguage, stems).catch(() => ({})),
            getAudioLessonWordInfo({ ...scope, words: stems }).catch(() => ({})),
        ]);
        const usage = {};
        Object.entries(difficulties || {}).forEach(([stem, value]) => {
            usage[stem] = { difficulty: value?.difficulty, isFallback: value?.isFallback, zipf: value?.details?.zipf };
        });
        setEpisodes(saved);
        setHomeData({ ranked: rankByUsage(candidates, usage), wordInfo: wordInfo || {} });
        setHomeLoading(false);
    }, [candidates, scope, targetLanguage]);

    // The lesson the start button plays: an unfinished one first, else the
    // next words.
    const unfinished = episodes[0] && !episodes[0].completedAt ? episodes[0] : null;
    const plan = useMemo(() => {
        if (!homeData) return null;
        const { ranked, wordInfo } = homeData;
        return planLesson({
            ranked,
            size: lessonSize,
            usedKeys: rotationUsedKeys(episodes, ranked),
            themeOf: (row) => themeForDomain(wordInfo[row.word]?.domain),
            bookOf: (row) => wordInfo[row.word]?.book,
        });
    }, [episodes, homeData, lessonSize]);

    const changeLessonSize = useCallback((size) => {
        setLessonSize(size);
        lessonPrefsRef.current = withLessonSize(lessonPrefsRef.current, targetLanguage, size);
        AsyncStorage.setItem(AUDIO_LESSON_PREFS_KEY, JSON.stringify(lessonPrefsRef.current)).catch(() => {});
    }, [targetLanguage]);

    // Open an episode in the player and start it.
    const openEpisode = useCallback((episode) => {
        if (!episode || episode.words.length === 0) return;
        pause();
        lessonRef.current = episode;
        introDoneRef.current = false;
        autoPlayRef.current = true;
        setLesson(episode);
        setView('player');
        markAudioLessonPlayed(episode.id).catch(() => {});
    }, [pause]);

    const startTodaysLesson = useCallback(async () => {
        if (unfinished) {
            openEpisode(unfinished);
            return;
        }
        if (!plan || plan.words.length === 0 || starting) return;
        setStarting(true);
        try {
            const episode = await saveAudioLesson({
                ...scope,
                theme: plan.theme,
                words: plan.words.map(lessonWordRecord),
            });
            setEpisodes((list) => [episode, ...list]);
            openEpisode(episode);
        } catch {
            // Not saved: play it anyway, it just won't be in the list.
            openEpisode({ id: null, theme: plan.theme, words: plan.words.map(lessonWordRecord), createdAt: new Date().toISOString() });
        } finally {
            setStarting(false);
        }
    }, [openEpisode, plan, scope, starting, unfinished]);

    const backToEpisodes = useCallback(() => {
        pause();
        setView('home');
    }, [pause]);

    // The lesson played to the end: it stays in the list (its words stay
    // where they were in the saved list), and the next lesson moves on.
    const finishLesson = useCallback(() => {
        const finished = lessonRef.current;
        pause();
        setView('home');
        if (finished?.id == null) return;
        const at = new Date().toISOString();
        setEpisodes((list) => list.map((item) => (
            item.id === finished.id ? { ...item, completedAt: item.completedAt ?? at, lastPlayedAt: at } : item
        )));
        markAudioLessonPlayed(finished.id, { completed: true }).catch(() => {});
    }, [pause]);

    // ─── Player ───────────────────────────────────────────────────────────

    // Play from `position`: the intro first on a lesson's first word, then the
    // word (and any next words that share its sentence) with their meanings,
    // the sentence once, then move on; the outro after the last word.
    const playFrom = useCallback(async (position) => {
        await orderingRef.current;
        const list = wordsRef.current;
        if (!list[position]) {
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
        const voice = { targetLocale, interfaceLocale, rate, pitch: voicePrefs.pitch, voices: voicePrefs.voices };
        const finish = (outcome) => {
            if (outcome === 'error') {
                setVoiceError(true);
                pause();
            }
            return outcome === 'done';
        };
        const say = (text, pauseMs) => playerRef.current.speakSequence([
            {
                text,
                locale: interfaceLocale,
                rate,
                pitch: voicePrefs.pitch,
                voice: voicePrefs.voices?.[interfaceLocale] || null,
            },
            { pauseMs },
        ]);

        const loading = loadDetails(position);
        if (position === 0 && !introDoneRef.current && lessonRef.current) {
            const outcome = await say(lessonIntroText(lessonRef.current, t), INTRO_PAUSE_MS);
            if (run !== runRef.current || !finish(outcome)) return;
            introDoneRef.current = true;
        }
        const loaded = await loading;
        if (run !== runRef.current) return;

        const group = [position];
        if (loaded?.sentence) {
            while (group.length < GROUP_MAX) {
                const next = position + group.length;
                if (!list[next] || (await sentenceFor(list[next])) !== loaded.sentence) break;
                group.push(next);
            }
            if (run !== runRef.current) return;
        }
        const after = position + group.length;
        // Fetch the next word while this one plays.
        loadDetails(after).catch(() => {});

        for (const at of group) {
            setIndex(at);
            const part = at === position ? loaded : await loadDetails(at);
            if (run !== runRef.current) return;
            const outcome = await playerRef.current.speakSequence(buildAudioReviewWordPart({
                ...voice,
                word: list[at].word,
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
        if (after < list.length) {
            playFrom(after);
            return;
        }
        if (lessonRef.current) {
            const outro = await say(lessonOutroText(t), 0);
            if (run !== runRef.current) return;
            if (outro === 'done') {
                finishLesson();
                return;
            }
        }
        pause();
    }, [finishLesson, interfaceLocale, loadDetails, pause, rate, repeat, sentenceFor, t, targetLocale, voicePrefs]);

    const togglePlay = useCallback(() => {
        if (playingRef.current) pause();
        else playFrom(index);
    }, [index, pause, playFrom]);

    const step = useCallback((direction) => {
        const next = Math.min(Math.max(index + direction, 0), Math.max(wordsRef.current.length - 1, 0));
        // Skipping counts as past the intro.
        introDoneRef.current = true;
        if (playingRef.current) {
            playFrom(next);
        } else {
            setIndex(next);
        }
    }, [index, playFrom]);

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
        AsyncStorage.getItem(AUDIO_LESSON_PREFS_KEY)
            .then((raw) => {
                const parsed = raw ? JSON.parse(raw) : {};
                if (cancelled) return;
                lessonPrefsRef.current = parsed && typeof parsed === 'object' ? parsed : {};
                setLessonSize(lessonSizeFor(lessonPrefsRef.current, targetLanguage));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [targetLanguage, visible]);

    // Each open starts on the home view with fresh episodes and ranking.
    useEffect(() => {
        if (!visible) return;
        setView('home');
        setLesson(null);
        lessonRef.current = null;
        setHomeData(null);
        loadHome();
        // loadHome changes with the candidates, which also reopen the view.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, candidates]);

    // A lesson opened: its words, with words that share a sentence moved
    // together (play waits for this).
    useEffect(() => {
        if (!lesson) return undefined;
        let cancelled = false;
        const rows = lesson.words.map((record) => ({ ...record, language: record.language ?? targetLanguage }));
        detailsRef.current = {};
        sentenceCacheRef.current = new Map();
        setDetails({});
        setIndex(0);
        setVoiceError(false);
        setWords(rows);
        orderingRef.current = (async () => {
            const sentences = await Promise.all(rows.map((row) => sentenceFor(row)));
            if (cancelled) return;
            const grouped = groupBySentence(rows, (row, at) => sentences[at]);
            if (grouped.every((row, at) => row === rows[at])) return;
            detailsRef.current = {};
            setDetails({});
            setWords(grouped);
        })();
        return () => {
            cancelled = true;
        };
        // sentenceFor changes with the owner/language, which also closes the lesson.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lesson]);

    // Start a lesson as soon as it opens.
    useEffect(() => {
        if (view !== 'player' || !autoPlayRef.current || words.length === 0) return;
        autoPlayRef.current = false;
        playFrom(0);
    }, [playFrom, view, words.length]);

    // Show the current word's sentence even before playing.
    useEffect(() => {
        if (visible && view === 'player' && word) loadDetails(index).catch(() => {});
    }, [index, loadDetails, view, visible, word]);

    // The lock-screen / notification player.
    const lessonTitle = lesson ? episodeTitle(lesson, t) : t('learn.audioLessons');
    useEffect(() => {
        if (!visible || !word || !ownsListenSession(OWNER)) return;
        updateListenSession({
            title: word.word,
            subtitle: `${lessonTitle} · ${formatNumber(index + 1)} / ${formatNumber(words.length)}`,
            playing,
            cover: '',
        });
    }, [index, lessonTitle, playing, visible, word, words.length]);

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
    const startLabel = unfinished ? t('learn.audioLessonContinue') : t('learn.audioLessonStart');
    const startEpisode = unfinished ?? (plan && plan.words.length > 0 ? plan : null);
    const canStart = Boolean(startEpisode) && !starting && !homeLoading;

    const renderHome = () => (
        <ScrollView style={styles.homeScroll} contentContainerStyle={styles.homeContent}>
            <Text style={styles.sectionLabel}>{t('learn.audioLessonWords')}</Text>
            <View style={styles.sizeRow} accessibilityRole="radiogroup">
                {AUDIO_LESSON_SIZES.map((size) => {
                    const active = size === lessonSize;
                    return (
                        <TouchableOpacity
                            key={size}
                            onPress={() => changeLessonSize(size)}
                            style={[styles.sizeChip, active && styles.sizeChipActive]}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={t('learn.audioLessonWordCount', { count: formatNumber(size) })}
                        >
                            <Text style={[styles.sizeText, active && styles.sizeTextActive]}>{formatNumber(size)}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            <TouchableOpacity
                onPress={startTodaysLesson}
                disabled={!canStart}
                style={[styles.startButton, !canStart && styles.startButtonDisabled]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canStart }}
            >
                {starting || homeLoading ? (
                    <ActivityIndicator color={colors.surface} />
                ) : (
                    <>
                        <Feather name="headphones" size={18} color={canStart ? colors.surface : colors.textTertiary} />
                        <Text style={[styles.startText, !canStart && styles.startTextDisabled]}>{startLabel}</Text>
                    </>
                )}
            </TouchableOpacity>
            {!homeLoading ? (
                <Text style={styles.startHint}>
                    {startEpisode
                        ? `${episodeTitle(startEpisode, t)} · ${t('learn.audioLessonWordCount', { count: formatNumber(startEpisode.words.length) })}`
                        : t('learn.audioEmpty')}
                </Text>
            ) : null}

            <Text style={[styles.sectionLabel, styles.episodesLabel]}>{t('learn.audioLessonEpisodes')}</Text>
            {episodes.length === 0 ? (
                <Text style={styles.muted}>{t('learn.audioLessonNoEpisodes')}</Text>
            ) : episodes.map((episode) => {
                const title = episodeTitle(episode, t);
                const meta = [
                    t('learn.audioLessonWordCount', { count: formatNumber(episode.words.length) }),
                    formatDate(episode.createdAt, { month: 'short', day: 'numeric' }),
                    episode.completedAt ? null : t('learn.audioLessonInProgress'),
                ].filter(Boolean).join(' · ');
                return (
                    <TouchableOpacity
                        key={episode.id}
                        onPress={() => openEpisode(episode)}
                        style={styles.episodeRow}
                        accessibilityRole="button"
                        accessibilityLabel={t('learn.audioLessonPlayEpisode', { title })}
                    >
                        <View style={styles.episodeText}>
                            <Text style={styles.episodeTitle} numberOfLines={1}>{title}</Text>
                            <Text style={styles.episodeMeta} numberOfLines={1}>{meta}</Text>
                            <Text style={styles.episodeWords} numberOfLines={1}>
                                {episode.words.map((item) => item.word).join(' · ')}
                            </Text>
                        </View>
                        <View style={styles.episodePlay}>
                            <Feather name="play" size={16} color={colors.surface} />
                        </View>
                    </TouchableOpacity>
                );
            })}
        </ScrollView>
    );

    const renderPlayer = () => (
        <>
            {word ? (
                <View style={styles.body}>
                    <Text style={styles.progress}>
                        {`${lessonTitle} · ${formatNumber(index + 1)} / ${formatNumber(wordCount)}`}
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
                    <ActivityIndicator color={colors.textTertiary} />
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
        </>
    );

    const inPlayer = view === 'player';

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={inPlayer ? backToEpisodes : close} statusBarTranslucent>
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={inPlayer ? backToEpisodes : close}
                        style={styles.headerButton}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={inPlayer ? t('learn.audioLessonBackToEpisodes') : t('common.close')}
                    >
                        <Feather name={inPlayer ? 'chevron-left' : 'chevron-down'} size={26} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle} numberOfLines={1}>{t('learn.audioLessons')}</Text>
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

                {inPlayer ? renderPlayer() : renderHome()}
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
    homeScroll: {
        flex: 1,
    },
    homeContent: {
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 40,
    },
    sectionLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        color: colors.textSecondary,
        marginBottom: 10,
    },
    episodesLabel: {
        marginTop: 32,
    },
    sizeRow: {
        flexDirection: 'row',
        gap: 8,
    },
    sizeChip: {
        minWidth: 52,
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sizeChipActive: {
        borderColor: colors.text,
        backgroundColor: colors.text,
    },
    sizeText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.textSecondary,
    },
    sizeTextActive: {
        fontFamily: fontFamilies.sansSemiBold,
        color: colors.surface,
    },
    startButton: {
        marginTop: 24,
        height: 52,
        borderRadius: 14,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        backgroundColor: colors.text,
    },
    startButtonDisabled: {
        backgroundColor: colors.surfaceMuted,
    },
    startText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        color: colors.surface,
    },
    startTextDisabled: {
        color: colors.textTertiary,
    },
    startHint: {
        marginTop: 8,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        color: colors.textTertiary,
        textAlign: 'center',
    },
    episodeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    episodeText: {
        flex: 1,
        gap: 3,
    },
    episodeTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
    episodeMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        color: colors.textTertiary,
    },
    episodeWords: {
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 13,
        color: colors.textSecondary,
    },
    episodePlay: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
});

export default memo(AudioReview);
