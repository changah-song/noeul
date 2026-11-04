// Audio lessons (Learn tab): audio review played as short "episodes". Each
// lesson takes the next few saved words, most useful first, grouped by theme
// where the dictionary knows one, opens with a spoken intro ("Welcome to audio
// learn. Let's learn 5 words today.") and closes with an outro. A finished
// lesson stays in the episode list to replay; it does not mark its words as
// learned.
//
// Pure helpers; the player (components/Learn/AudioReview.js) loads the data
// (services/Database.js) and drives the voice.

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// ─── Lesson size ──────────────────────────────────────────────────────────────

export const AUDIO_LESSON_SIZES = [3, 5, 10, 15];
export const DEFAULT_AUDIO_LESSON_SIZE = 5;

export const normalizeLessonSize = (value) => (
    AUDIO_LESSON_SIZES.includes(Number(value)) ? Number(value) : DEFAULT_AUDIO_LESSON_SIZE
);

// The saved per-language choice ({ sizeByLanguage: { ko: 5 } }).
export const lessonSizeFor = (prefs, language) => normalizeLessonSize(prefs?.sizeByLanguage?.[language]);

export const withLessonSize = (prefs, language, size) => ({
    ...(prefs && typeof prefs === 'object' ? prefs : {}),
    sizeByLanguage: {
        ...(prefs?.sizeByLanguage && typeof prefs.sizeByLanguage === 'object' ? prefs.sizeByLanguage : {}),
        [language]: normalizeLessonSize(size),
    },
});

// ─── Word identity ────────────────────────────────────────────────────────────

export const lessonWordKey = (row) => `${clean(row?.word)}\u0000${clean(row?.hanja)}`;

// What an episode keeps of each word: enough to replay it after the word is
// edited, learned or removed from the saved list.
export const lessonWordRecord = (row) => ({
    word: clean(row?.word),
    hanja: row?.hanja ? clean(row.hanja) : null,
    def: row?.def ?? null,
    language: row?.language ?? null,
});

// ─── Ranking by usage ─────────────────────────────────────────────────────────

/**
 * Most useful first: the words' objective difficulty (services/levelEngine.js
 * wordDifficulty via Database.getWordDifficulties: frequency (zipf) and the
 * graded level band), easiest = most common = first. Words the dictionary
 * knows nothing about go last; ties keep the saved order.
 *
 * @param rows        saved words
 * @param infoByWord  { [word]: { difficulty, isFallback, zipf } }
 */
export const rankByUsage = (rows = [], infoByWord = {}) => (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
        const info = infoByWord?.[clean(row?.word)] ?? null;
        const known = Boolean(info) && !info.isFallback && Number.isFinite(Number(info.difficulty));
        return {
            row,
            index,
            known,
            difficulty: known ? Number(info.difficulty) : Infinity,
            zipf: Number.isFinite(Number(info?.zipf)) && info?.zipf != null ? Number(info.zipf) : -Infinity,
        };
    })
    .sort((a, b) => (
        (Number(b.known) - Number(a.known))
        || (a.difficulty - b.difficulty)
        || (b.zipf - a.zipf)
        || (a.index - b.index)
    ))
    .map(({ row }) => row);

// ─── Themes ───────────────────────────────────────────────────────────────────

// Coarse themes for the Korean learner's dictionary's topic categories
// (KRDICT 주제 및 상황 범주, stored as dictionary_cache.domain). Chinese and
// English entries carry no category, so their lessons group by book instead.
export const AUDIO_LESSON_THEMES = [
    'food', 'feelings', 'people', 'body', 'travel', 'nature', 'time',
    'home', 'work', 'school', 'society', 'leisure', 'science',
];

const THEME_DOMAINS = {
    food: ['요리 설명하기', '음식 주문하기', '식문화', '음식 설명하기'],
    feelings: ['심리', '감정, 기분 표현하기', '성격 표현하기'],
    people: [
        '인간관계', '소개하기(자기소개)', '소개하기(가족 소개)', '가족 행사', '가족 행사-명절',
        '연애와 결혼', '인사하기', '감사하기', '사과하기', '초대와 방문', '약속하기',
        '개인 정보 교환하기',
    ],
    body: ['보건과 의료', '건강', '외모 표현하기', '외양', '약국 이용하기', '병원 이용하기'],
    travel: ['교통 이용하기', '여행', '길찾기', '위치 표현하기', '지리 정보', '주말 및 휴가'],
    nature: ['날씨와 계절', '기후', '환경 문제'],
    time: ['시간 표현하기', '날짜 표현하기', '요일 표현하기', '하루 생활'],
    home: ['집 구하기', '집안일', '주거 생활', '복장 표현하기', '물건 사기', '건축'],
    work: ['경제·경영', '직장 생활', '직업과 진로'],
    school: ['학교생활', '교육', '언어'],
    society: [
        '사회 문제', '정치', '사회 제도', '법', '언론', '대중 매체', '역사', '철학·윤리', '종교',
        '사건, 사고, 재해 기술하기', '공공기관 이용하기', '공공 기관 이용하기(도서관)',
        '공공 기관 이용하기(우체국)', '공공 기관 이용하기(출입국 관리 사무소)',
        '문화 차이', '문화 비교하기', '한국 생활',
    ],
    leisure: ['취미', '스포츠', '대중 문화', '예술', '공연과 감상', '여가 생활', '영화 보기', '한국의 문학'],
    science: ['과학과 기술', '컴퓨터와 인터넷'],
};

const DOMAIN_THEME = new Map(Object.entries(THEME_DOMAINS)
    .flatMap(([theme, domains]) => domains.map((domain) => [domain.replace(/\s+/g, ''), theme])));

/** The coarse theme for a dictionary category, or null. */
export const themeForDomain = (domain) => DOMAIN_THEME.get(clean(domain).replace(/\s+/g, '')) ?? null;

// ─── Rotation ─────────────────────────────────────────────────────────────────

/**
 * The words the current rotation has already played: those in episodes
 * (newest first) back to, but not including, the episode that would complete
 * a pass over every candidate. Once every saved word has been in a lesson the
 * next pass starts, without keeping any extra state.
 */
export const rotationUsedKeys = (episodes = [], candidates = []) => {
    const candidateKeys = new Set((Array.isArray(candidates) ? candidates : []).map(lessonWordKey));
    const used = new Set();
    for (const episode of Array.isArray(episodes) ? episodes : []) {
        const keys = (Array.isArray(episode?.words) ? episode.words : []).map(lessonWordKey);
        const next = new Set([...used, ...keys]);
        const covered = candidateKeys.size > 0 && [...candidateKeys].every((key) => next.has(key));
        if (covered) break;
        keys.forEach((key) => used.add(key));
    }
    return used;
};

// ─── Planning a lesson ────────────────────────────────────────────────────────

// A themed lesson needs this share of its words from one theme (the rest are
// the next most useful words), drawn from the next WINDOW × size candidates,
// so a theme never buries the most useful words for long.
export const THEME_MIN_SHARE = 0.6;
const THEME_WINDOW = 3;

const groupWinner = (window, keyOf, need) => {
    const groups = new Map();
    window.forEach((row) => {
        const key = keyOf(row);
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    let best = null;
    groups.forEach((rows, key) => {
        if (rows.length >= need && (!best || rows.length > best.rows.length)) best = { key, rows };
    });
    return best;
};

/**
 * The next lesson: `size` words from `ranked` (most useful first), skipping
 * words already in an episode (`usedKeys`); once every word has been in one,
 * the rotation starts over from the top.
 *
 * Themes, in order: a dictionary topic (`themeOf(row)` → theme key), then the
 * book the words were met in (`bookOf(row)` → title); either needs
 * THEME_MIN_SHARE of the lesson. Otherwise plain usage order.
 *
 * @returns {{ words, theme: { kind: 'topic'|'book', key: string } | null, restarted: boolean }}
 */
export const planLesson = ({
    ranked = [],
    size = DEFAULT_AUDIO_LESSON_SIZE,
    usedKeys = new Set(),
    themeOf = () => null,
    bookOf = () => null,
} = {}) => {
    const count = Math.max(1, Number(size) || DEFAULT_AUDIO_LESSON_SIZE);
    const seen = new Set();
    const unique = (Array.isArray(ranked) ? ranked : []).filter((row) => {
        const key = lessonWordKey(row);
        if (!clean(row?.word) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    let fresh = unique.filter((row) => !usedKeys.has(lessonWordKey(row)));
    let restarted = false;
    if (fresh.length === 0 && unique.length > 0) {
        fresh = unique;
        restarted = true;
    }
    if (fresh.length === 0) return { words: [], theme: null, restarted };

    const lessonSize = Math.min(count, fresh.length);
    const need = Math.max(2, Math.ceil(lessonSize * THEME_MIN_SHARE));
    const window = fresh.slice(0, Math.max(lessonSize * THEME_WINDOW, lessonSize));
    const pick = (group, theme) => {
        const chosen = group.rows.slice(0, lessonSize);
        const chosenKeys = new Set(chosen.map(lessonWordKey));
        const filler = fresh.filter((row) => !chosenKeys.has(lessonWordKey(row))).slice(0, lessonSize - chosen.length);
        // Keep usage order inside the lesson.
        const keys = new Set([...chosen, ...filler].map(lessonWordKey));
        return { words: fresh.filter((row) => keys.has(lessonWordKey(row))), theme, restarted };
    };

    if (lessonSize >= 2) {
        const topic = groupWinner(window, themeOf, need);
        if (topic) return pick(topic, { kind: 'topic', key: topic.key });
        const book = groupWinner(window, (row) => clean(bookOf(row)) || null, need);
        if (book) return pick(book, { kind: 'book', key: book.key });
    }
    return { words: fresh.slice(0, lessonSize), theme: null, restarted };
};

// ─── Short example sentences ──────────────────────────────────────────────────

// Past these a sentence is too long to follow by ear: words for spaced
// scripts, characters for Chinese and Japanese, Hangul syllables for Korean
// (whose spaces separate phrases, not words).
export const SENTENCE_MAX_WORDS = 14;
export const SENTENCE_MAX_CJK_CHARS = 40;

const isCjkLanguage = (language) => /^(zh|ja|ko)/i.test(String(language || ''));

export const sentenceTooLong = (sentence, language) => {
    const text = clean(sentence);
    if (!text) return false;
    if (isCjkLanguage(language)) return text.replace(/[\s\p{P}]/gu, '').length > SENTENCE_MAX_CJK_CHARS;
    return text.split(' ').filter(Boolean).length > SENTENCE_MAX_WORDS;
};

// Clause breaks: punctuation everywhere, plus simple connective endings.
const PUNCT_BREAK = /\s*[,;:—–，；：、]\s*|\s+-\s+/;
// Korean connective endings that close a clause, when a space follows
// (…했는데 / …했지만 / …하고 / …해서 / …하면서 / …하니까 / …먹으면).
const KO_CLAUSE_END = /(는데|은데|지만|으면서|면서|니까|어서|아서|해서|으면|고)\s+/g;
const EN_CLAUSE_START = /\s+(?=(?:and|but|because|so|which|while|when|although|though|whereas|until|unless)\s)/i;

const splitClauses = (sentence, language) => {
    let parts = clean(sentence).split(PUNCT_BREAK).map(clean).filter(Boolean);
    if (String(language || '').startsWith('ko')) {
        parts = parts.flatMap((part) => part.replace(KO_CLAUSE_END, (match, ending) => `${ending}\u0001`)
            .split('\u0001').map(clean).filter(Boolean));
    } else if (!isCjkLanguage(language)) {
        parts = parts.flatMap((part) => part.split(EN_CLAUSE_START).map(clean).filter(Boolean));
    }
    return parts;
};

// How the word shows up in running text: Korean verbs and adjectives lose
// their dictionary ending (엄하다 → 엄하셨다); English matches whole words.
const wordMatcher = (word, language) => {
    const target = clean(word).toLowerCase();
    if (!target) return () => false;
    if (String(language || '').startsWith('ko')) {
        const stem = target.length > 1 && target.endsWith('다') ? target.slice(0, -1) : target;
        return (text) => text.toLowerCase().includes(stem);
    }
    if (isCjkLanguage(language)) return (text) => text.includes(target);
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}])${escaped}`, 'iu');
    return (text) => pattern.test(text);
};

const stripEdgePunct = (text) => clean(text).replace(/^[\s,;:—–，；：、"'“”‘’]+|[\s,;:—–，；：、"'“”‘’]+$/g, '');

/**
 * A sentence short enough to hear: the sentence itself when it is short,
 * else the clause that has the word, else null (read only the word and its
 * meaning).
 */
export const shortenSentence = (sentence, word, language) => {
    const text = clean(sentence);
    if (!text) return null;
    if (!sentenceTooLong(text, language)) return text;
    const has = wordMatcher(word, language);
    const clause = splitClauses(text, language).find((part) => has(part));
    if (!clause) return null;
    const cut = stripEdgePunct(clause);
    if (!cut || sentenceTooLong(cut, language)) return null;
    return cut;
};

const lengthOf = (text, language) => (isCjkLanguage(language)
    ? clean(text).replace(/\s/g, '').length
    : clean(text).split(' ').length);

/**
 * The sentence a lesson reads for a word: of the saved ones that have the
 * word, the shortest after shortening (a short whole sentence beats a clause
 * cut from a long one). Null when none fits.
 */
export const pickLessonSentence = (contexts = [], word = '', language = '') => {
    const has = wordMatcher(word, language);
    const sentences = [...new Set((Array.isArray(contexts) ? contexts : [])
        .map((context) => clean(typeof context === 'string' ? context : context?.sentence))
        .filter(Boolean))];
    const withWord = sentences.filter((sentence) => has(sentence));
    const candidates = (withWord.length > 0 ? withWord : sentences)
        .map((sentence) => ({ sentence, short: shortenSentence(sentence, word, language) }))
        .filter(({ short }) => short)
        .sort((a, b) => (
            (Number(a.short !== a.sentence) - Number(b.short !== b.sentence))
            || (lengthOf(a.short, language) - lengthOf(b.short, language))
        ));
    return candidates[0]?.short ?? null;
};

// ─── Intro, outro, title ──────────────────────────────────────────────────────

/** The i18n key and params for an episode's title. */
export const episodeTitle = (episode, t) => {
    const theme = episode?.theme;
    if (theme?.kind === 'topic' && AUDIO_LESSON_THEMES.includes(theme.key)) {
        return t(`learn.audioLessonTheme.${theme.key}`);
    }
    if (theme?.kind === 'book' && clean(theme.key)) {
        return t('learn.audioLessonFromBook', { title: clean(theme.key) });
    }
    return t('learn.audioLessonMixed');
};

/** What the voice says before the first word (interface language). */
export const lessonIntroText = (episode, t) => {
    const count = Array.isArray(episode?.words) ? episode.words.length : 0;
    const theme = episode?.theme;
    if (theme?.kind === 'topic' && AUDIO_LESSON_THEMES.includes(theme.key)) {
        return t('learn.audioLessonIntroTheme', { count, theme: t(`learn.audioLessonTheme.${theme.key}`) });
    }
    if (theme?.kind === 'book' && clean(theme.key)) {
        return t('learn.audioLessonIntroBook', { count, title: clean(theme.key) });
    }
    return t('learn.audioLessonIntro', { count });
};

export const lessonOutroText = (t) => t('learn.audioLessonOutro');
