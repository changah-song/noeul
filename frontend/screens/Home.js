import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    BackHandler,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    useWindowDimensions,
    View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { Feather, Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { createTabBarBaseStyle } from '../components/shared/TabBar';
import Book3D from '../components/Home/Book3D';
import ProfileAvatar from '../components/shared/ProfileAvatar';
import SongReader from '../components/Songs/SongReader';
import { IconButton, Screen } from '../components/ui';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import useCoachTip from '../hooks/useCoachTip';
import ScreenCoachTip from '../components/Tips/ScreenCoachTip';
import TodayGoalCard from '../components/Goal/TodayGoalCard';
import { areTipsEnabled, isTipSeen, loadTips, msUntilUnpromptedTip, TIP_IDS, tipCounter } from '../services/tips';
import { useFocusEffect } from '@react-navigation/native';
import { searchSongs } from '../services/api/songSearch';
import {
    colors,
    elevation,
    fontFamilies,
    insets,
    layout,
    radii,
    spacing,
    textStyles,
    IconDefaults,
    Layout,
    Motion,
    Radii,
    Shadows,
    Spacing,
    TextStyles,
    useTheme,
} from '../theme';
import useBooks from '../hooks/useBooks';
import { deleteBookIndexEntries, estimateBookReadingEase, getLatestBookNote, getProfileAbility } from '../services/Database';
import {
    bookEaseFromDistribution,
    formatEasePercent,
    getEaseBandKey,
    normalizeLegacyKoreanStats,
} from '../services/bookEase';
import {
    darkenHex,
    extractBookCoverColors,
    getGeneratedBookCoverPalette,
    getPublicDomainBookCoverColors,
    getStoredBookCoverColors,
    lightenHex,
    normalizeHexColor,
} from '../services/bookCoverColors';
import {
    downloadUserBook,
    softDeleteUserBook,
    updateUserBookMetadata,
} from '../services/bookCloudSync';
import {
    fetchUserPreferences,
    getTimestampMs,
    updateUserPreferenceFields,
} from '../services/preferencesCloudSync';
import { readEpubMetadata } from '../services/epubMetadata';
import { readPdfMetadata } from '../services/pdfMetadata';
import { getPublicDomainBooks } from '../services/publicDomainBooks';
import { pickStarterBook, starterThetaFromAbility } from '../services/starterBook';
import {
    downloadFeaturedBooks,
    downloadPublicBook,
    fetchPublicLibrary,
    getLocalPath as getPublicLibraryLocalPath,
    isBookDownloaded as isPublicLibraryBookDownloaded,
} from '../services/publicLibraryService';
import {
    cloudSongToLocalSong,
    fetchUserSongs,
    softDeleteUserSong,
    upsertUserSong,
} from '../services/songCloudSync';
import {
    getSongStorageLimitMessage,
    isSongStorageLimitError,
    serializeSongsForStorage,
} from '../services/songStorageLimits';
import { GUEST_OWNER_ID, makeScopedStorageKey } from '../services/localDataScope';
import { getDefaultProfileIdForLanguage } from '../services/profileScope';
import {
    assertCanUploadForOwner,
    isCurrentSyncGeneration,
} from '../services/localOwnerCoordinator';
import {
    addOverlayErrorListener,
    addOverlayStatusListener,
    isOverlayPermissionGranted,
    isScreenCaptureActive,
    requestOverlayPermission,
    requestScreenCapture,
    startFloatingWidget,
    stopFloatingWidget,
} from '../modules/screen-ocr-overlay/src';
import { normalizeBookLanguage } from '../constants/languages';
import { formatDate, formatNumber, tRuntime } from '../services/interfaceLanguage';
import {
    getLocalizedLanguageName,
    getUserFacingErrorMessage,
    localizeBookLevelLabel,
    localizeStoredPlaceholder,
    stripStoredPlaceholder,
} from '../i18n/userFacing';
import { localizePublicDomainBook } from '../assets/data/public-domain/catalogI18n';
import { localizedLevelLabel } from '../i18n/contentStrings';
import { getProficiencyLevelOptions } from '../constants/proficiencyLevels';

const BOOK_GRID_COLUMNS = 4;
const BOOK_GRID_GAP = Spacing.lg;
const HOME_CONTENT_HORIZONTAL_PADDING = Spacing.screenHorizontalDense;
const FEATURED_BOOK_COUNT = 3;
const HERO_COVER_WIDTH_RATIO = 0.5;
const HERO_COVER_ASPECT_RATIO = 1.5;
const HERO_SIDE_BOOK_SCALE = 0.78;
const HERO_ITEM_GAP = Spacing.xl4;
const FAB_EDGE_OFFSET = Spacing.xl5;
const FAB_MENU_GAP = Spacing.xl;
const FAB_WINDOW_BOTTOM_OFFSET = Layout.tabBarHeight + FAB_EDGE_OFFSET;
const WORDS_PER_PAGE = 250;
const APP_LOGO_SOURCE = require('../assets/noeul.png');
const DEFAULT_PREVIEW_SPINE_WIDTH = 24;
const PREVIEW_SPINE_TITLE_MIN_WIDTH = 30;
const PREVIEW_SPINE_TITLE_VERTICAL_INSET_EXTRA = 8;
const PREVIEW_SPINE_PAGE_BUCKETS = [
    { maxPages: 24, width: 12 },
    { maxPages: 48, width: 17 },
    { maxPages: 80, width: 23 },
    { maxPages: 160, width: 29 },
    { maxPages: 280, width: 35 },
    { maxPages: 420, width: 41 },
    { maxPages: 640, width: 47 },
];
const LEGACY_SONGS_STORAGE_KEY = 'manualSongs';
const getSongsStorageKey = (ownerId, language = 'ko') => {
    const normalizedLanguage = normalizeBookLanguage(language);
    return makeScopedStorageKey(
        ownerId,
        normalizedLanguage === 'ko' ? 'manual-songs' : `manual-songs-${normalizedLanguage}`
    );
};
const OCR_SETTINGS_KEY = '@ff/ocr-settings';
const EMPTY_SONG_DRAFT = { title: '', artist: '', lyrics: '' };
const DEFAULT_SONG_FONT_SIZE = 28;
const EMPTY_OCR_STATUS = {
    overlayPermissionGranted: false,
    screenCaptureActive: false,
    analysisActive: false,
    floatingVisible: false,
    resultOverlayVisible: false,
};

const BOOK_FILTERS = [
    { id: 'favorites', labelKey: 'home.favoriteBooks', iconOnly: true },
    { id: 'all', labelKey: 'home.myBooks' },
    { id: 'public-domain', labelKey: 'home.publicDomain' },
];

const PUBLIC_DOMAIN_SORTS = [
    // Default: grouped by each book's level on the language's standard scale
    // (CEFR, HSK, Korean reading levels), easiest first.
    { id: 'ease', labelKey: 'home.level' },
    { id: 'title', labelKey: 'home.alphabetical' },
    { id: 'author', labelKey: 'common.author' },
    { id: 'length', labelKey: 'home.length' },
    { id: 'genre', labelKey: 'home.genre' },
];

const makePublicLibraryDiagnostics = (patch = {}) => ({
    stage: 'idle',
    detail: '',
    targetLanguage: null,
    rowCount: null,
    checkedCount: null,
    downloadedCount: null,
    errorMessage: null,
    ...patch,
});

// Developer diagnostics (internal stage names, raw service errors): dev builds
// only, never shown to readers.
const getPublicLibraryDiagnosticLines = (diagnostics = {}, t = tRuntime) => (__DEV__ ? [
    diagnostics.detail,
    diagnostics.stage ? t('home.diagnosticStage', { value: diagnostics.stage }) : null,
    diagnostics.targetLanguage ? t('home.diagnosticTargetLanguage', { value: diagnostics.targetLanguage }) : null,
    diagnostics.rowCount != null ? t('home.diagnosticRows', { count: diagnostics.rowCount }) : null,
    diagnostics.checkedCount != null ? t('home.diagnosticLocalChecks', { count: diagnostics.checkedCount }) : null,
    diagnostics.downloadedCount != null ? t('home.diagnosticDownloadedLocally', { count: diagnostics.downloadedCount }) : null,
    diagnostics.errorMessage ? t('home.diagnosticError', { message: diagnostics.errorMessage }) : null,
].filter(Boolean) : []);

const createHomeColors = (themeColors) => ({
    bg: themeColors.bgPage,
    surface: themeColors.surface,
    surface2: themeColors.surfaceMuted,
    paper: themeColors.surface,
    card: themeColors.surfaceCard,
    assist: themeColors.surfaceAssist,
    text: themeColors.text,
    sub: themeColors.textMuted,
    secondary: themeColors.textSecondary,
    tertiary: themeColors.textTertiary,
    faint: themeColors.textSubtle,
    border: themeColors.border,
    divider: themeColors.divider,
    strongBorder: themeColors.borderStrong,
    frame: themeColors.frame,
    accent: themeColors.accent,
    accentBg: themeColors.surfaceMuted,
    accentDeep: themeColors.accentDeep,
    onAccent: themeColors.readerTappedWordText,
    success: themeColors.accent,
    track: themeColors.readerProgressTrack,
    continueBorder: themeColors.border,
    coverSlate: themeColors.coverSlate,
    coverMid: themeColors.coverMid,
});

const HOME_COLORS = createHomeColors(colors);

const HOME_SHADOWS = {
    card: elevation.card,
    cta: Shadows.fab,
};

const HomeThemeContext = createContext(null);
const useHomeTheme = () => (
    useContext(HomeThemeContext) ?? { homeColors: HOME_COLORS, styles: defaultHomeStyles }
);

const DEFAULT_COVER_REF_WIDTH = Layout.bookPreviewCoverWidth;
const DEFAULT_COVER_REF_HEIGHT = Layout.bookPreviewCoverHeight;

const KOREAN_TEXT_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const showSongStorageLimitAlert = (error, t = tRuntime) => {
    Alert.alert(
        t('home.songStorageLimitTitle'),
        t('home.songStorageLimitBody', { message: getSongStorageLimitMessage(error, t) })
    );
};
const countSongLines = (lyrics) => String(lyrics || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;
const normalizeStoredSong = (song, fallbackLanguage = 'ko') => {
    if (!song || typeof song !== 'object') {
        return null;
    }

    const title = String(song.title || '').trim();
    const lyrics = String(song.lyrics || '').trim();

    if (!title || !lyrics) {
        return null;
    }

    return {
        id: song.id || `song-${Date.now()}`,
        cloudId: song.cloudId ?? song.cloud_id ?? null,
        cloudOwnerId: song.cloudOwnerId ?? song.user_id ?? null,
        provider: String(song.provider || '').trim() || null,
        providerId: String(song.providerId || '').trim() || null,
        source: String(song.source || song.provider || '').trim() || null,
        externalId: String(song.externalId || song.external_id || song.providerId || '').trim() || null,
        title,
        artist: String(song.artist || '').trim(),
        album: String(song.album || '').trim(),
        duration: typeof song.duration === 'number' ? song.duration : null,
        instrumental: !!song.instrumental,
        lyrics,
        syncedLyrics: String(song.syncedLyrics || '').trim(),
        lines: countSongLines(lyrics),
        fontSize: typeof song.fontSize === 'number'
            ? clamp(song.fontSize, 20, 40)
            : DEFAULT_SONG_FONT_SIZE,
        savedTerms: Array.isArray(song.savedTerms)
            ? [...new Set(song.savedTerms.map((term) => String(term || '').trim()).filter(Boolean))]
            : [],
        createdAt: song.createdAt || new Date().toISOString(),
        updatedAt: song.updatedAt || song.createdAt || new Date().toISOString(),
        deletedAt: song.deletedAt ?? null,
        language: normalizeBookLanguage(song.language ?? song.targetLanguage ?? song.target_language ?? fallbackLanguage),
    };
};
// Service errors are English developer messages (HTTP codes, storage paths);
// show the user a translated message and keep the raw one in the log.
const getDownloadErrorMessageKey = (error) => {
    const message = String(error?.message ?? '').toLowerCase();
    if (error?.code === 'TIMEOUT' || message.includes('timed out') || message.includes('timeout')) {
        return 'home.downloadTimedOutBody';
    }
    if (message.includes('network') || message.includes('internet') || message.includes('offline')) {
        return 'home.downloadNetworkBody';
    }
    return 'home.downloadFailedBody';
};
const getBookTitle = (book, t = tRuntime) => localizeStoredPlaceholder(book?.title, t) || t('common.untitled');
const getBookAuthor = (book, t = tRuntime) => localizeStoredPlaceholder(book?.author, t) || t('common.unknownAuthor');
const hasKoreanText = (value) => KOREAN_TEXT_PATTERN.test(String(value || ''));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isPdfBook = (book) => (
    String(book?.format || '').toLowerCase() === 'pdf'
    || String(book?.uri || '').toLowerCase().split('?')[0].endsWith('.pdf')
);

const parseStoredJson = (value, fallback = {}) => {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const getSongTimestamp = (song, keys = ['updatedAt', 'updated_at', 'createdAt', 'created_at']) => {
    for (const key of keys) {
        const value = song?.[key];
        if (!value) {
            continue;
        }

        const timestamp = new Date(value).getTime();
        if (Number.isFinite(timestamp)) {
            return timestamp;
        }
    }

    return 0;
};

const mergeLocalAndCloudSongs = (localSongs, cloudRows, targetLanguage = 'ko') => {
    const localById = new Map((localSongs || []).map((song) => [song.id, song]));
    const cloudById = new Map((cloudRows || []).map((row) => [row.client_id, row]));
    const ids = new Set([...localById.keys(), ...cloudById.keys()].filter(Boolean));
    const merged = [];
    const localOnly = [];
    const keptLocalIds = new Set();

    ids.forEach((id) => {
        const localSong = localById.get(id);
        const cloudRow = cloudById.get(id);

        if (!cloudRow && localSong) {
            if (!localSong.deletedAt) {
                merged.push(localSong);
                localOnly.push(localSong);
                keptLocalIds.add(id);
            }
            return;
        }

        if (cloudRow && !localSong) {
            if (!cloudRow.deleted_at) {
                merged.push(normalizeStoredSong(cloudSongToLocalSong(cloudRow), targetLanguage));
            }
            return;
        }

        if (!cloudRow || !localSong) {
            return;
        }

        const cloudDeletedAt = getSongTimestamp(cloudRow, ['deleted_at']);
        const localUpdatedAt = getSongTimestamp(localSong);

        if (cloudDeletedAt && cloudDeletedAt >= localUpdatedAt) {
            return;
        }

        const cloudUpdatedAt = getSongTimestamp(cloudRow, ['updated_at', 'created_at']);
        if (cloudUpdatedAt > localUpdatedAt) {
            merged.push(normalizeStoredSong({
                ...cloudSongToLocalSong(cloudRow),
                savedTerms: localSong.savedTerms ?? [],
            }, targetLanguage));
            return;
        }

        merged.push(localSong);
        localOnly.push(localSong);
        keptLocalIds.add(id);
    });

    return {
        songs: merged
            .filter(Boolean)
            .filter((song) => normalizeBookLanguage(song.language ?? targetLanguage) === targetLanguage)
            .sort((a, b) => getSongTimestamp(b) - getSongTimestamp(a)),
        localOnly: localOnly.filter((song) => keptLocalIds.has(song.id)),
    };
};

const getSerifFontForText = (value, weight = 'bold') => {
    if (hasKoreanText(value)) {
        return {
            fontFamily: weight === 'medium'
                ? fontFamilies.krSerifMedium
                : fontFamilies.krSerifBold,
        };
    }

    return {
        fontFamily: weight === 'medium'
            ? fontFamilies.serifMedium
            : fontFamilies.serifBold,
    };
};

const getBookProgress = (book) => clamp(
    typeof book?.progress === 'number' ? book.progress : 0,
    0,
    1
);
const isBookDownloaded = (book) => book?.downloaded !== false && !!book?.uri;
const getBookKey = (book, fallback = '') => (
    book?.cloudId
    || book?.uri
    || book?.id
    || book?.publicLibraryId
    || book?.publicDomainId
    || book?.storagePath
    || book?.publicLibraryStoragePath
    || fallback
);
const isPublicLibraryBook = (book) => !!(book?.publicLibraryId || book?.publicLibraryStoragePath || book?.storagePath);
const isSamePublicDomainBook = (candidate, book) => {
    if (!candidate || !book) {
        return false;
    }

    const candidateLibraryId = candidate.publicLibraryId ?? candidate.public_library_id;
    const bookLibraryId = book.publicLibraryId ?? book.public_library_id;
    if (candidateLibraryId && bookLibraryId && String(candidateLibraryId) === String(bookLibraryId)) {
        return true;
    }

    const candidateStoragePath = candidate.publicLibraryStoragePath ?? candidate.storagePath ?? candidate.storage_path;
    const bookStoragePath = book.publicLibraryStoragePath ?? book.storagePath ?? book.storage_path;
    if (candidateStoragePath && bookStoragePath && candidateStoragePath === bookStoragePath) {
        return true;
    }

    return Boolean(candidate.uri && book.uri && candidate.uri === book.uri);
};
const isBookFavorite = (book) => book?.isFavorite === true || book?.favorite === true;
const isBookCompleted = (book) => (
    book?.completed === false
        ? false
        : book?.completed === true || getBookProgress(book) >= 1
);
const getBookRecentTimestamp = (book) => {
    const timestampFields = [
        book?.lastOpenedAt,
        book?.updatedAt,
        book?.cloudSyncedAt,
        book?.createdAt,
    ];

    for (const value of timestampFields) {
        const timestamp = new Date(value).getTime();
        if (Number.isFinite(timestamp)) {
            return timestamp;
        }
    }

    return 0;
};

const FILE_SIZE_UNIT_KEYS = ['common.sizeBytes', 'common.sizeKilobytes', 'common.sizeMegabytes', 'common.sizeGigabytes'];

const formatFileSize = (bytes, t = tRuntime) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
        return t('common.unknown');
    }

    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < FILE_SIZE_UNIT_KEYS.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = unitIndex === 0 || size >= 10 ? 0 : 1;
    const formatted = formatNumber(size, { minimumFractionDigits: precision, maximumFractionDigits: precision });
    return t(FILE_SIZE_UNIT_KEYS[unitIndex], { value: formatted });
};

const getBookWordCount = (book) => {
    const rawCount = book?.wordCount ?? book?.word_count;

    if (typeof rawCount === 'number') {
        return Number.isFinite(rawCount) && rawCount > 0 ? Math.round(rawCount) : null;
    }

    if (typeof rawCount === 'string') {
        const parsed = Number(rawCount.replace(/[^\d.]/g, ''));
        return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
    }

    return null;
};

const formatWordCount = (wordCount, t = tRuntime, language = undefined) => (
    wordCount
        ? t('home.words', { count: formatNumber(wordCount, {}, language) })
        : t('common.unknown')
);

const estimateBookPages = (book) => {
    const wordCount = getBookWordCount(book);
    return wordCount ? Math.max(1, Math.ceil(wordCount / WORDS_PER_PAGE)) : null;
};

const getPreviewSpineWidth = (book) => {
    const pages = estimateBookPages(book);
    if (!pages) {
        return DEFAULT_PREVIEW_SPINE_WIDTH;
    }

    const bucket = PREVIEW_SPINE_PAGE_BUCKETS.find(({ maxPages }) => pages <= maxPages)
        || PREVIEW_SPINE_PAGE_BUCKETS[PREVIEW_SPINE_PAGE_BUCKETS.length - 1];
    return bucket.width;
};

const getPreviewSpineColors = (book) => {
    const generatedPalette = getGeneratedBookCoverPalette(book);
    const useGeneratedDefaultCover = !!book?.publicDomain && !book?.cover;
    const storedColors = useGeneratedDefaultCover ? {} : getStoredBookCoverColors(book);
    const accent = storedColors.coverAccentColor || generatedPalette.accent;
    const fieldSource = storedColors.coverBackgroundColor || generatedPalette.bg;
    const panel = darkenHex(accent, 0.46) || darkenHex(generatedPalette.accent, 0.46);

    return {
        field: panel,
        panel,
        rule: useGeneratedDefaultCover
            ? generatedPalette.soft
            : lightenHex(fieldSource, 0.78) || generatedPalette.soft,
        title: useGeneratedDefaultCover
            ? generatedPalette.soft
            : lightenHex(fieldSource, 0.82) || generatedPalette.soft,
    };
};

const getPreviewSpineTitleGlyphs = ({ title, height, lineHeight, titleInsetY }) => {
    const glyphs = String(title || '').replace(/\s/g, '').split('');
    const bandHeight = Math.max(0, height - (titleInsetY * 2));
    const maxGlyphs = Math.max(1, Math.floor(Math.max(0, bandHeight - 4) / Math.max(1, lineHeight)));
    return glyphs.slice(0, maxGlyphs);
};

const normalizeSortText = (value) => String(value || '').trim();

const compareSortText = (a, b) => (
    normalizeSortText(a).localeCompare(normalizeSortText(b), undefined, {
        sensitivity: 'base',
        numeric: true,
    })
);

const formatPreviewDateTime = (value, t = tRuntime, language = undefined) => {
    if (!value) {
        return t('home.notOpened');
    }

    return formatDate(value, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }, language) || t('home.notOpened');
};


const getSongWordCount = (song) => String(song?.lyrics || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

const formatSongWordCount = (song, t = tRuntime) => {
    const count = getSongWordCount(song);
    return t('home.songWords', { count: formatNumber(count) });
};

// Full-sentence count labels: `${base}One` / `${base}Other` keys, never a
// noun glued onto a number.
const formatBookCount = (t, base, count) => (
    t(count === 1 ? `${base}One` : `${base}Other`, { count: formatNumber(count) })
);

const formatBookLanguage = (language, t = tRuntime) => {
    return getLocalizedLanguageName(language, t);
};

const getCoverColorLuminance = (value) => {
    const color = normalizeHexColor(value);
    if (!color) {
        return 0;
    }

    const channelLuminance = (hexChannel) => {
        const channel = Number.parseInt(hexChannel, 16) / 255;
        return channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
    };

    return (
        (0.2126 * channelLuminance(color.slice(1, 3)))
        + (0.7152 * channelLuminance(color.slice(3, 5)))
        + (0.0722 * channelLuminance(color.slice(5, 7)))
    );
};

const getCoverContrastRatio = (firstColor, secondColor) => {
    const firstLuminance = getCoverColorLuminance(firstColor);
    const secondLuminance = getCoverColorLuminance(secondColor);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
};

const getReadableCoverColor = ({
    background,
    preferred,
    light = HOME_COLORS.surface,
    dark = HOME_COLORS.text,
    minContrast = 4.5,
}) => {
    const preferredColor = normalizeHexColor(preferred);
    if (preferredColor && getCoverContrastRatio(background, preferredColor) >= minContrast) {
        return preferredColor;
    }

    const lightColor = normalizeHexColor(light) || HOME_COLORS.surface;
    const darkColor = normalizeHexColor(dark) || HOME_COLORS.text;
    return getCoverContrastRatio(background, darkColor) >= getCoverContrastRatio(background, lightColor)
        ? darkColor
        : lightColor;
};

const getDefaultCoverTitleSize = (title, baseSize) => {
    const glyphCount = String(title || '').replace(/\s/g, '').length;
    if (glyphCount <= 3) {
        return baseSize;
    }
    if (glyphCount <= 5) {
        return Math.round(baseSize * 0.8);
    }
    if (glyphCount <= 7) {
        return Math.round(baseSize * 0.66);
    }
    return Math.round(baseSize * 0.54);
};

const getDefaultCoverPalette = (book, homeColors = HOME_COLORS) => {
    const generatedPalette = getGeneratedBookCoverPalette(book);
    const baseBackground = generatedPalette.bg;
    const background = (
        getCoverColorLuminance(baseBackground) < 0.5
        && getCoverContrastRatio(baseBackground, homeColors.surface) < 5
    )
        ? darkenHex(baseBackground, 0.12) || baseBackground
        : baseBackground;
    const accent = generatedPalette.accent;
    const isLightBackground = getCoverColorLuminance(background) >= 0.38;
    const title = getReadableCoverColor({
        background,
        preferred: generatedPalette.ink,
        light: homeColors.surface,
        dark: homeColors.text,
        minContrast: 5.8,
    });
    const author = getReadableCoverColor({
        background,
        preferred: generatedPalette.soft,
        light: homeColors.surface,
        dark: homeColors.text,
        minContrast: 4.5,
    });
    const rule = getReadableCoverColor({
        background,
        preferred: generatedPalette.soft,
        light: homeColors.surface,
        dark: homeColors.text,
        minContrast: 3.4,
    });

    return {
        background,
        spine: isLightBackground
            ? accent
            : darkenHex(accent, 0.32) || homeColors.accentDeep,
        title,
        author,
        rule,
    };
};

const BookCover = ({ book, width, height, style, titleStyle }) => {
    const { t } = useTranslation();
    const { homeColors, styles } = useHomeTheme();
    const coverUri = typeof book?.cover === 'string' ? book.cover.trim() : '';
    const [failedCoverUri, setFailedCoverUri] = useState(null);

    if (coverUri && coverUri !== failedCoverUri) {
        return (
            <Image
                source={{ uri: coverUri }}
                accessibilityLabel={getBookTitle(book, t)}
                // No Android fade-in: a cover that mounts mid-swipe shows at once.
                fadeDuration={0}
                onError={() => setFailedCoverUri(coverUri)}
                style={[styles.coverImage, style, { width, height }]}
            />
        );
    }

    const palette = getDefaultCoverPalette(book, homeColors);
    const scaleX = width / DEFAULT_COVER_REF_WIDTH;
    const scaleY = height / DEFAULT_COVER_REF_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    const title = getBookTitle(book, t);
    const author = getBookAuthor(book, t);
    const titleFontSize = Math.max(10, getDefaultCoverTitleSize(title, 24 * scale));
    const authorFontSize = Math.max(7, Math.round(12 * scale));
    const ruleWidth = Math.max(18, Math.round(30 * scaleX));
    const ruleGap = Math.max(5, Math.round(12 * scaleY));

    return (
        <View style={[
            styles.defaultCover,
            style,
            {
                width,
                height,
                backgroundColor: palette.background,
                gap: ruleGap,
                paddingHorizontal: Math.max(8, Math.round(20 * scaleX)),
                paddingVertical: Math.max(10, Math.round(20 * scaleY)),
            },
        ]}>
            <View
                style={[
                    styles.defaultCoverRule,
                    {
                        width: ruleWidth,
                        backgroundColor: palette.rule,
                    },
                ]}
            />
            <Text
                numberOfLines={3}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={[
                    styles.defaultCoverTitle,
                    hasKoreanText(title) ? styles.defaultCoverTitleKorean : styles.defaultCoverTitleDisplay,
                    titleStyle,
                    {
                        color: palette.title,
                        fontSize: titleFontSize,
                        lineHeight: Math.round(titleFontSize * 1.45),
                    },
                ]}
            >
                {title}
            </Text>
            <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                style={[
                    styles.defaultCoverAuthor,
                    hasKoreanText(author) && styles.koreanInlineText,
                    {
                        color: palette.author,
                        fontSize: authorFontSize,
                        lineHeight: Math.max(10, Math.round(authorFontSize * 1.42)),
                        letterSpacing: Math.max(1.2, 3 * scale),
                    },
                ]}
            >
                {author}
            </Text>
            <View
                style={[
                    styles.defaultCoverRule,
                    {
                        width: ruleWidth,
                        backgroundColor: palette.rule,
                    },
                ]}
            />
        </View>
    );
};

const PreviewBookSpine = ({ book, height }) => {
    const { t } = useTranslation();
    const { styles } = useHomeTheme();
    const width = getPreviewSpineWidth(book);
    const spineColors = getPreviewSpineColors(book);
    const panelInsetX = Math.max(2, Math.round(width * (7 / 48)));
    const panelInsetY = Math.max(5, Math.round(height * 0.07));
    const ruleInsetX = Math.max(2, Math.round(width * 0.1));
    const ruleInsetY = Math.max(4, Math.round(height * 0.055));
    const fontSize = Math.min(14, Math.max(10, width * 0.34));
    const lineHeight = Math.max(12, Math.round(fontSize * 1.18));
    const titleInsetY = panelInsetY + PREVIEW_SPINE_TITLE_VERTICAL_INSET_EXTRA;
    const showTitle = width >= PREVIEW_SPINE_TITLE_MIN_WIDTH;
    const titleGlyphs = showTitle
        ? getPreviewSpineTitleGlyphs({
            title: getBookTitle(book, t),
            height,
            lineHeight,
            titleInsetY,
        })
        : [];

    return (
        <View
            pointerEvents="none"
            style={[
                styles.previewBookSpine,
                {
                    width,
                    height,
                    backgroundColor: spineColors.field,
                },
            ]}
        >
            <View
                style={[
                    styles.previewSpinePanel,
                    {
                        top: panelInsetY,
                        bottom: panelInsetY,
                        left: panelInsetX,
                        right: panelInsetX,
                        backgroundColor: spineColors.panel,
                    },
                ]}
            />
            <View
                style={[
                    styles.previewSpinePanelRule,
                    {
                        top: ruleInsetY,
                        bottom: ruleInsetY,
                        left: ruleInsetX,
                        right: ruleInsetX,
                        borderColor: spineColors.rule,
                    },
                ]}
            />
            <View style={styles.previewSpineSeam} />
            {titleGlyphs.length > 0 ? (
                <View
                    style={[
                        styles.previewSpineTitleBand,
                        {
                            top: titleInsetY,
                            bottom: titleInsetY,
                        },
                    ]}
                >
                    {titleGlyphs.map((glyph, glyphIndex) => (
                        <Text
                            key={`${getBookKey(book, 'preview')}-spine-glyph-${glyphIndex}`}
                            numberOfLines={1}
                            style={[
                                styles.previewSpineTitleGlyph,
                                {
                                    color: spineColors.title,
                                    fontSize,
                                    lineHeight,
                                },
                            ]}
                        >
                            {glyph}
                        </Text>
                    ))}
                </View>
            ) : null}
        </View>
    );
};

const EditCoverPreview = ({ book, cover }) => {
    const { styles } = useHomeTheme();

    return (
        <BookCover
            book={{ ...book, cover }}
            width={72}
            height={108}
            style={styles.coverPreview}
        />
    );
};

const buildPublicDomainLocalBook = (book, patch = {}) => {
    const publicLibrary = isPublicLibraryBook(book);
    const uri = patch.uri ?? book?.uri ?? null;
    const format = patch.format ?? book?.format ?? (publicLibrary ? 'epub' : 'txt');

    return {
        ...book,
        ...getPublicDomainBookCoverColors(book),
        ...patch,
        id: book?.id || `public-domain-${book?.publicDomainId}`,
        publicDomain: true,
        publicLibrary,
        publicLibraryId: book?.publicLibraryId ?? book?.public_library_id ?? null,
        publicLibraryStoragePath: book?.publicLibraryStoragePath ?? book?.storagePath ?? book?.storage_path ?? null,
        storagePath: book?.storagePath ?? book?.publicLibraryStoragePath ?? book?.storage_path ?? null,
        uri,
        format,
        downloaded: patch.downloaded ?? book?.downloaded ?? Boolean(uri),
        originalTitle: book?.originalTitle || book?.title,
        originalAuthor: book?.originalAuthor || book?.author,
        originalCover: book?.originalCover ?? book?.cover ?? null,
        originalFilename: book?.originalFilename || book?.original_filename || book?.storagePath?.split('/').pop() || book?.title,
        progress: patch.progress ?? book?.progress ?? 0,
        location: patch.location ?? book?.location ?? null,
        nativePosition: patch.nativePosition ?? book?.nativePosition ?? null,
        preprocessed: patch.preprocessed ?? book?.preprocessed ?? false,
        preprocessing: false,
    };
};

const readPublicLibraryBookMetadataPatch = async (book, uri) => {
    if (!uri) {
        return {};
    }

    const format = String(book?.format || 'epub').toLowerCase();
    const fallbackName = book?.originalFilename
        || book?.original_filename
        || book?.storagePath?.split('/').pop()
        || book?.publicLibraryStoragePath?.split('/').pop()
        || book?.title
        || '';
    const metadata = format === 'pdf'
        ? await readPdfMetadata(uri, fallbackName)
        : await readEpubMetadata(uri, fallbackName);
    const cover = metadata?.cover ?? book?.cover ?? null;
    const coverColors = cover
        ? await extractBookCoverColors({
            coverUri: cover,
            fallbackColor: book?.coverAccentColor || book?.coverColor,
            cacheKey: `public-library:${book?.publicLibraryId || book?.storagePath || uri}`,
        })
        : {};

    return {
        cover,
        ...coverColors,
        originalCover: cover ?? book?.originalCover ?? null,
        // Missing values are stored empty; getBookTitle/getBookAuthor show the translated label.
        title: book?.title || metadata?.title || '',
        author: book?.author || metadata?.author || '',
        wordCount: book?.wordCount ?? metadata?.wordCount ?? null,
        language: normalizeBookLanguage(metadata?.language ?? book?.language ?? book?.targetLanguage ?? 'en'),
    };
};

const getBookStatusLabel = (book, t = tRuntime) => {
    if (book?.publicDomain) {
        return isBookDownloaded(book)
            ? t('home.readyToRead')
            : t('home.availableToDownload');
    }

    return t('home.progress');
};

const getBookFormatLabel = (book, t = tRuntime) => {
    if (book?.publicDomain && !isPublicLibraryBook(book)) {
        return t('home.publicDomainText');
    }

    return String(book?.format || 'epub').toUpperCase();
};

const PREVIEW_COVER_WIDTH = 112;
const PREVIEW_COVER_HEIGHT = 164;

const PreviewBookCover = ({ book }) => {
    const { styles } = useHomeTheme();

    return (
        <Book3D
            width={PREVIEW_COVER_WIDTH}
            height={PREVIEW_COVER_HEIGHT}
            radius={5}
        >
            <BookCover
                book={book}
                width={PREVIEW_COVER_WIDTH}
                height={PREVIEW_COVER_HEIGHT}
                style={styles.previewCover}
            />
        </Book3D>
    );
};

const PreviewMetadataItem = ({ label, value }) => {
    const { styles } = useHomeTheme();

    return (
        <View style={styles.previewMetaItem}>
            <Text style={styles.previewMetaLabel}>{label}</Text>
            <Text numberOfLines={2} style={styles.previewMetaValue}>{value}</Text>
        </View>
    );
};

const PreviewNoSnippet = () => {
    const { homeColors: HOME_COLORS, styles } = useHomeTheme();
    const { t } = useTranslation();

    return (
        <View style={styles.previewNoSnippet}>
            <MaterialIcons name="format-quote" size={24} color={HOME_COLORS.frame} />
            <Text style={styles.previewNoSnippetText}>
                {t('home.previewNoSnippet')}
            </Text>
        </View>
    );
};

const PreviewNoteCard = ({ note }) => {
    const { styles } = useHomeTheme();
    const { t } = useTranslation();
    const text = typeof note?.note === 'string' ? note.note.trim() : '';
    if (!text) return null;

    return (
        <View style={styles.previewNoteBlock}>
            <Text style={styles.previewSectionLabel}>{t('home.noteToSelfLabel')}</Text>
            <View style={styles.previewNoteCard}>
                <Text style={[
                    styles.previewNoteText,
                    hasKoreanText(text) && styles.previewNoteTextKorean,
                ]}>
                    {`“${text}”`}
                </Text>
            </View>
        </View>
    );
};

// Below this many behavioral events (reviews/lookups) theta is still mostly the
// self-report seed, so the ease number is a guess — mark it as an early estimate.
const EASE_CONFIDENT_EVENT_COUNT = 10;

const EASE_BAND_TONES = {
    comfortable: 'easy',
    approachable: 'easy',
    challenging: 'mid',
    difficult: 'mid',
};

const PreviewReadingEase = ({ readingEase }) => {
    const { homeColors: HOME_COLORS, styles } = useHomeTheme();
    const { t } = useTranslation();
    const percent = formatEasePercent(readingEase?.ease);
    const hasEstimate = percent != null;
    const bandKey = hasEstimate ? getEaseBandKey(readingEase.ease) : null;
    const bandTone = bandKey ? EASE_BAND_TONES[bandKey] : null;
    // Low confidence when the reader is still cold OR the estimate fell back to
    // the coarse single-band formula (no distribution — 3 possible values in ko).
    const isEarlyEstimate = hasEstimate && (
        (readingEase?.eventCount ?? 0) < EASE_CONFIDENT_EVENT_COUNT
        || readingEase?.easeSource === 'level'
    );

    return (
        <View style={styles.previewEaseBlock}>
            <Text style={styles.previewSectionLabel}>{t('home.readingEase')}</Text>
            {hasEstimate ? (
                <>
                    <View style={styles.previewEaseHeader}>
                        <Text style={styles.previewEasePercent}>{`${isEarlyEstimate ? '~' : ''}${percent}%`}</Text>
                        {bandKey ? (
                            <Text
                                style={[
                                    styles.previewEaseBand,
                                    bandTone === 'easy' && styles.previewEaseBandEasy,
                                    bandTone === 'mid' && styles.previewEaseBandMid,
                                ]}
                            >
                                {t(`home.readingEaseBand.${bandKey}`)}
                            </Text>
                        ) : null}
                    </View>
                    <View style={styles.previewEaseRail}>
                        <View style={[styles.previewEaseFill, { width: `${percent}%` }]} />
                    </View>
                    <Text style={styles.previewEaseNote}>
                        {`${t('home.readingEaseNote', { percent })} ${isEarlyEstimate ? t('home.readingEaseEarlyHint') : t('home.readingEaseDisclaimer')}`}
                    </Text>
                </>
            ) : (
                <View style={styles.previewEaseEmpty}>
                    <MaterialIcons name="insights" size={22} color={HOME_COLORS.frame} />
                    <Text style={styles.previewEaseEmptyText}>{t('home.readingEaseUnavailable')}</Text>
                </View>
            )}
        </View>
    );
};

const BookPreview = ({
    book,
    actionBusy = false,
    downloadProgress = null,
    isInLibrary = false,
    readingEase = null,
    latestNote = null,
    onBack,
    onRead,
    onAddToLibrary,
    onToggleFavorite,
    onDelete,
    onEdit,
}) => {
    const { t, language } = useTranslation();
    const { homeColors: HOME_COLORS, styles } = useHomeTheme();
    const safeAreaInsets = useSafeAreaInsets();
    const isPublicDomain = !!book?.publicDomain;
    const wordCount = getBookWordCount(book);
    const attributionNote = [
        book?.previewSource,
        book?.attributionCategory,
    ].filter(Boolean).join(' · ');
    const canReadBook = isBookDownloaded(book);
    const isDownloadingBook = !canReadBook && actionBusy;
    const bookState = isDownloadingBook
        ? 'downloading'
        : isPublicDomain
            ? 'public'
            : !canReadBook
                ? 'notdl'
                : 'default';
    const favorite = isBookFavorite(book);
    const showTag = bookState !== 'default';
    const tagText = bookState === 'public'
        ? t('home.publicDomainTag')
        : bookState === 'downloading'
            ? t('home.downloadingTag')
            : t('home.notOnDeviceTag');
    const showDownloadCta = bookState === 'notdl' && !isPublicDomain;
    const showDownloadingCta = bookState === 'downloading';
    // Bundled books: title/genre/blurb in the interface language (catalogI18n).
    const localizedCopy = localizePublicDomainBook(book, language);
    const genreValue = localizedCopy?.genre || (isPublicDomain ? t('common.unknown') : t('home.autoDetectionSoon'));
    // Six-level names via contentStrings; the 3-grade Korean names the reader
    // stores (초급/중급/고급) via localizeBookLevelLabel.
    const levelValue = localizeBookLevelLabel(localizedLevelLabel(
        book?.language,
        book?.difficulty || book?.bookLevel?.level || book?.bookLevel?.proficiency_level,
        language
    ), t) || t('common.unknown');
    const hasKnownDownloadSize = Number(book?.size) > 0;
    const downloadNote = hasKnownDownloadSize
        ? t('home.availableOfflineWithSize', { size: formatFileSize(book?.size, t) })
        : t('home.availableOffline');
    const normalizedDownloadProgress = clamp(
        typeof downloadProgress === 'number' ? downloadProgress : 0.4,
        0.08,
        1
    );
    const downloadFillWidth = `${Math.round(normalizedDownloadProgress * 100)}%`;
    const descriptionText = String(book?.description || book?.summary || '').trim();
    const snippetText = canReadBook || isPublicDomain ? String(localizedCopy?.snippet || '').trim() : '';
    const aboutText = descriptionText || snippetText;
    const showAbout = !!aboutText;
    const canStartReading = (canReadBook || isPublicDomain) && !actionBusy;
    const primaryLabel = showDownloadingCta
        ? t('home.downloadingTag')
        : showDownloadCta
            ? t('home.downloadToDevice')
            : t('home.startReading');
    const handlePrimaryPress = () => {
        if (showDownloadingCta || actionBusy) {
            return;
        }
        onRead?.();
    };
    const primaryDisabled = showDownloadingCta || (!showDownloadCta && !canStartReading);

    return (
        <Screen backgroundColor={HOME_COLORS.bg} contentContainerStyle={styles.previewScreenContent}>
            <View style={styles.previewTopBar}>
                <TouchableOpacity
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.backToLibrary')}
                    onPress={onBack}
                    style={styles.previewIconButton}
                >
                    <Feather name="chevron-left" size={24} color={HOME_COLORS.accent} />
                </TouchableOpacity>
                <View style={styles.previewTopSpacer} />
                {!isPublicDomain && canReadBook ? (
                    <TouchableOpacity
                        activeOpacity={0.82}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.edit')}
                        onPress={onEdit}
                        style={styles.previewIconButton}
                    >
                        <Feather name="edit-2" size={19} color={HOME_COLORS.accent} />
                    </TouchableOpacity>
                ) : null}
                {!isPublicDomain ? (
                    <TouchableOpacity
                        activeOpacity={0.82}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.delete')}
                        onPress={onDelete}
                        style={styles.previewIconButton}
                    >
                        <Feather name="trash-2" size={19} color={HOME_COLORS.accent} />
                    </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={favorite ? t('home.favorited') : t('home.favoriteBook')}
                    accessibilityState={{ selected: favorite }}
                    onPress={onToggleFavorite}
                    style={styles.previewIconButton}
                >
                    <MaterialIcons
                        name={favorite ? 'star' : 'star-border'}
                        size={24}
                        color={HOME_COLORS.accent}
                    />
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.previewScroll}
                contentContainerStyle={[
                    styles.previewScrollContent,
                    { paddingBottom: 104 + safeAreaInsets.bottom },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.previewHero}>
                    <PreviewBookCover book={book} />
                    <View style={styles.previewHeroCopy}>
                        <Text
                            numberOfLines={3}
                            style={[
                                styles.previewTitle,
                                hasKoreanText(getBookTitle(book, t)) && styles.previewTitleKorean,
                            ]}
                        >
                            {getBookTitle(book, t)}
                        </Text>
                        <Text
                            numberOfLines={2}
                            style={[
                                styles.previewAuthor,
                                hasKoreanText(getBookAuthor(book, t)) && styles.koreanInlineText,
                            ]}
                        >
                            {getBookAuthor(book, t)}
                        </Text>
                        {showTag ? (
                            <View style={styles.previewTagWrap}>
                                <Text style={styles.previewTagText}>{tagText}</Text>
                            </View>
                        ) : null}
                    </View>
                </View>

                {canReadBook ? <PreviewNoteCard note={latestNote} /> : null}

                {showDownloadCta ? (
                    <Text style={styles.previewDownloadNote}>{downloadNote}</Text>
                ) : null}

                {showDownloadingCta ? (
                    <View style={styles.previewDownloadBlock}>
                        <View style={styles.previewDownloadProgressRail}>
                            <View style={[
                                styles.previewDownloadProgressFill,
                                { width: downloadFillWidth },
                            ]} />
                        </View>
                    </View>
                ) : null}

                <PreviewReadingEase readingEase={readingEase} />

                <View style={styles.previewMetaGrid}>
                    <PreviewMetadataItem label={t('home.length')} value={formatWordCount(wordCount, t)} />
                    <PreviewMetadataItem label={t('home.level')} value={levelValue} />
                    <PreviewMetadataItem label={t('home.genre')} value={genreValue} />
                    <PreviewMetadataItem label={t('home.lastOpened')} value={formatPreviewDateTime(book?.lastOpenedAt, t, language)} />
                </View>

                <View style={styles.previewAboutSection}>
                    <Text style={styles.previewSectionLabel}>{t('home.aboutTheStory')}</Text>
                    {showAbout ? (
                        <>
                            <Text style={styles.previewSnippetText}>{aboutText}</Text>
                            {attributionNote ? (
                                <Text style={styles.previewAttributionText}>
                                    {attributionNote}
                                </Text>
                            ) : null}
                        </>
                    ) : (
                        <PreviewNoSnippet />
                    )}
                </View>
            </ScrollView>

            <View style={[styles.previewBottomBar, { paddingBottom: Spacing.xl3 + safeAreaInsets.bottom }]}>
                {isPublicDomain ? (
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityState={{ selected: isInLibrary, disabled: actionBusy && !isInLibrary }}
                        activeOpacity={Motion.pressedOpacity}
                        disabled={actionBusy && !isInLibrary}
                        onPress={isInLibrary ? onDelete : onAddToLibrary}
                        style={[
                            styles.previewSecondaryButton,
                            isInLibrary && styles.previewSecondaryButtonActive,
                        ]}
                    >
                        {isInLibrary ? (
                            <Feather name="check" size={16} color={HOME_COLORS.text} />
                        ) : null}
                        <Text style={styles.previewSecondaryButtonText} numberOfLines={1}>
                            {isInLibrary
                                ? t('home.onYourShelf')
                                : actionBusy ? t('home.addingToLibrary') : t('home.addToShelf')}
                        </Text>
                    </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ disabled: primaryDisabled, busy: showDownloadingCta }}
                    activeOpacity={Motion.pressedOpacity}
                    disabled={primaryDisabled}
                    onPress={handlePrimaryPress}
                    style={[
                        styles.previewPrimaryButton,
                        primaryDisabled && styles.previewPrimaryButtonDisabled,
                    ]}
                >
                    {showDownloadingCta ? (
                        <ActivityIndicator size="small" color={HOME_COLORS.onAccent} />
                    ) : showDownloadCta ? (
                        <Feather name="download" size={18} color={HOME_COLORS.onAccent} />
                    ) : null}
                    <Text style={styles.previewPrimaryButtonText} numberOfLines={1}>{primaryLabel}</Text>
                </TouchableOpacity>
            </View>
        </Screen>
    );
};

// Copies of the featured books laid end to end. The carousel starts in the
// middle copy and quietly jumps back to it whenever a swipe settles, so a fast
// fling in either direction never runs out of books.
const HERO_LOOP_COPIES = 9;

// One cover in the featured carousel. Memoized so the active-book state
// changing mid-swipe doesn't re-render every cover.
const FeaturedCarouselItem = memo(({
    book,
    index,
    isLast,
    scrollX,
    snapInterval,
    coverWidth,
    coverHeight,
    onPressRef,
}) => {
    const { t } = useTranslation();
    const { styles } = useHomeTheme();
    const inputRange = [
        (index - 1) * snapInterval,
        index * snapInterval,
        (index + 1) * snapInterval,
    ];
    const scale = scrollX.interpolate({
        inputRange,
        outputRange: [HERO_SIDE_BOOK_SCALE, 1, HERO_SIDE_BOOK_SCALE],
        extrapolate: 'clamp',
    });
    const emphasis = scrollX.interpolate({
        inputRange,
        outputRange: [0, 1, 0],
        extrapolate: 'clamp',
    });
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={getBookTitle(book, t)}
            onPress={() => onPressRef.current?.(book, index)}
            style={[
                styles.heroItem,
                { width: coverWidth, marginRight: isLast ? 0 : HERO_ITEM_GAP },
            ]}
        >
            <Animated.View style={{ transform: [{ scale }] }}>
                <Book3D
                    width={coverWidth}
                    height={coverHeight}
                    radius={6}
                    shadowOpacity={emphasis}
                >
                    <BookCover
                        book={book}
                        width={coverWidth}
                        height={coverHeight}
                        style={styles.heroCover}
                    />
                </Book3D>
            </Animated.View>
        </Pressable>
    );
});

const FeaturedBookCarousel = ({ books, screenWidth, onResumeBook, onPressBook, opening = false }) => {
    const { t } = useTranslation();
    const { homeColors: HOME_COLORS, styles } = useHomeTheme();
    const scrollRef = useRef(null);
    const [activeIndex, setActiveIndex] = useState(0);

    const coverWidth = Math.round(screenWidth * HERO_COVER_WIDTH_RATIO);
    const coverHeight = Math.round(coverWidth * HERO_COVER_ASPECT_RATIO);
    const snapInterval = coverWidth + HERO_ITEM_GAP;
    const sidePadding = Math.max(0, Math.round((screenWidth - coverWidth) / 2));

    const count = books.length;
    const isLooping = count > 1;
    const copies = isLooping ? HERO_LOOP_COPIES : 1;
    const middleStart = Math.floor(copies / 2) * count;
    const loopedBooks = useMemo(
        () => Array.from({ length: copies * count }, (_, i) => books[i % count]),
        [books, copies, count],
    );
    const realIndexOf = (loopedIndex) => ((loopedIndex % count) + count) % count;

    const scrollX = useRef(new Animated.Value(middleStart * snapInterval)).current;

    useEffect(() => {
        if (isLooping) {
            scrollRef.current?.scrollTo({ x: middleStart * snapInterval, animated: false });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const clampedIndex = clamp(activeIndex, 0, count - 1);
    const activeBook = books[clampedIndex];
    const progressPercent = Math.round(getBookProgress(activeBook) * 100);
    const wordCount = getBookWordCount(activeBook);

    const handleScroll = (event) => {
        const offset = event.nativeEvent.contentOffset.x;
        const realIndex = realIndexOf(Math.round(offset / snapInterval));
        setActiveIndex((current) => (current === realIndex ? current : realIndex));
    };

    const handleMomentumScrollEnd = (event) => {
        if (!isLooping) return;
        const index = Math.round(event.nativeEvent.contentOffset.x / snapInterval);
        // Back to the same book in the middle copy; it looks identical.
        if (index < middleStart || index >= middleStart + count) {
            scrollRef.current?.scrollTo({
                x: (middleStart + realIndexOf(index)) * snapInterval,
                animated: false,
            });
        }
    };

    // Read through a ref so the memoized covers keep a stable prop.
    const onPressRef = useRef(null);
    onPressRef.current = (book, loopedIndex) => {
        if (realIndexOf(loopedIndex) === clampedIndex) {
            onPressBook(book, clampedIndex);
            return;
        }
        scrollRef.current?.scrollTo({ x: loopedIndex * snapInterval, animated: true });
    };

    return (
        <View style={styles.heroSection}>
            <Text style={styles.heroEyebrow}>{t('home.continueReading')}</Text>
            <Animated.ScrollView
                ref={scrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={snapInterval}
                snapToAlignment="start"
                contentContainerStyle={[
                    styles.heroScrollContent,
                    { paddingHorizontal: sidePadding },
                ]}
                onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                    { useNativeDriver: true, listener: handleScroll }
                )}
                onMomentumScrollEnd={handleMomentumScrollEnd}
                scrollEventThrottle={16}
            >
                {loopedBooks.map((book, index) => (
                    <FeaturedCarouselItem
                        key={`looped-${index}`}
                        book={book}
                        index={index}
                        isLast={index === loopedBooks.length - 1}
                        scrollX={scrollX}
                        snapInterval={snapInterval}
                        coverWidth={coverWidth}
                        coverHeight={coverHeight}
                        onPressRef={onPressRef}
                    />
                ))}
            </Animated.ScrollView>

            <View style={styles.heroMeta}>
                <Text
                    numberOfLines={1}
                    style={[
                        styles.heroTitle,
                        getSerifFontForText(getBookTitle(activeBook, t)),
                    ]}
                >
                    {getBookTitle(activeBook, t)}
                </Text>
                <Text
                    numberOfLines={1}
                    style={[
                        styles.heroAuthor,
                        hasKoreanText(getBookAuthor(activeBook, t)) && styles.koreanInlineText,
                    ]}
                >
                    {getBookAuthor(activeBook, t)}
                </Text>
                <View style={styles.heroProgressGroup}>
                    <View style={styles.heroProgressLabels}>
                        <Text style={styles.heroPercent}>{`${progressPercent}%`}</Text>
                        {wordCount ? (
                            <Text style={styles.heroWords}>{formatWordCount(wordCount, t)}</Text>
                        ) : null}
                    </View>
                    <View style={styles.heroProgressRail}>
                        <View style={[styles.heroProgressFill, { width: `${progressPercent}%` }]} />
                    </View>
                    {/* Greys out with a spinner the moment it's pressed: opening a
                        free book copies it in first, which takes a moment. */}
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={t('home.resume')}
                        accessibilityState={{ busy: opening, disabled: opening }}
                        activeOpacity={0.88}
                        disabled={opening}
                        onPress={() => onResumeBook(activeBook)}
                        style={[styles.heroResumeButton, opening && styles.heroResumeButtonOpening]}
                    >
                        <Text style={[styles.heroResumeText, opening && styles.heroResumeTextOpening]}>
                            {t('home.resume')}
                        </Text>
                        {opening ? (
                            <ActivityIndicator size="small" color={HOME_COLORS.tertiary} />
                        ) : (
                            <Feather name="arrow-right" size={17} color={HOME_COLORS.onAccent} />
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
};

// Shelf tabs (My books / Public domain / Songs) with an underline that slides
// to the selected tab. Tab positions come from onLayout, so the indicator only
// appears once every tab has been measured.
const ShelfTabs = ({ tabs, activeId }) => {
    const { styles } = useHomeTheme();
    const [layouts, setLayouts] = useState({});
    const indicatorX = useRef(new Animated.Value(0)).current;
    const indicatorWidth = useRef(new Animated.Value(0)).current;
    const hasPositioned = useRef(false);
    const activeLayout = layouts[activeId];

    useEffect(() => {
        if (!activeLayout) return;
        if (!hasPositioned.current) {
            hasPositioned.current = true;
            indicatorX.setValue(activeLayout.x);
            indicatorWidth.setValue(activeLayout.width);
            return;
        }
        Animated.parallel([
            Animated.timing(indicatorX, {
                toValue: activeLayout.x,
                duration: Motion.tabTransitionDuration,
                useNativeDriver: false,
            }),
            Animated.timing(indicatorWidth, {
                toValue: activeLayout.width,
                duration: Motion.tabTransitionDuration,
                useNativeDriver: false,
            }),
        ]).start();
    }, [activeLayout, indicatorWidth, indicatorX]);

    return (
        <View style={styles.libraryTabs} accessibilityRole="tablist">
            {tabs.map((tab) => {
                const selected = tab.id === activeId;
                return (
                    <TouchableOpacity
                        key={tab.id}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        activeOpacity={0.82}
                        onPress={tab.onPress}
                        onLayout={(event) => {
                            const { x, width } = event.nativeEvent.layout;
                            setLayouts((current) => (
                                current[tab.id]?.x === x && current[tab.id]?.width === width
                                    ? current
                                    : { ...current, [tab.id]: { x, width } }
                            ));
                        }}
                        style={styles.libraryTab}
                    >
                        <Text style={[styles.libraryTabText, selected && styles.libraryTabTextActive]}>
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
            {activeLayout ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.libraryTabUnderline,
                        { left: indicatorX, width: indicatorWidth },
                    ]}
                />
            ) : null}
        </View>
    );
};

const Home = ({ books, setBooks, currentBook, setCurrentBook, setPreprocessOnOpen, navigation, user }) => {
    const { t, language } = useTranslation();
    const interfaceLanguage = language;
    const { languageSettingsReady, targetLanguage, setTargetLanguage, switchProfile, activeProfileId } = useAppContext();
    const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
    const { colors: themeColors } = useTheme();
    const colors = themeColors;
    const safeAreaInsets = useSafeAreaInsets();
    const HOME_COLORS = useMemo(() => createHomeColors(colors), [colors]);
    const styles = useMemo(() => createStyles(HOME_COLORS, colors), [HOME_COLORS, colors]);
    const themedTabBarStyle = useMemo(() => createTabBarBaseStyle(colors), [colors]);
    const homeThemeValue = useMemo(() => ({
        homeColors: HOME_COLORS,
        styles,
    }), [HOME_COLORS, styles]);
    const [editBook, setEditBook] = useState(null);
    const [editDraft, setEditDraft] = useState({ title: '', author: '', cover: '' });
    const [activeLibraryTab, setActiveLibraryTab] = useState('Books');
    const [activeBookFilter, setActiveBookFilter] = useState('all');
    const [collectionViewMode, setCollectionViewMode] = useState('grid');
    const [activePublicDomainSort, setActivePublicDomainSort] = useState('ease');
    const [publicDomainSortDirection, setPublicDomainSortDirection] = useState('asc');
    const [publicLibraryBooks, setPublicLibraryBooks] = useState([]);
    const [publicLibraryLoading, setPublicLibraryLoading] = useState(false);
    const [publicLibraryError, setPublicLibraryError] = useState(null);
    const [publicLibraryDiagnostics, setPublicLibraryDiagnostics] = useState(makePublicLibraryDiagnostics());
    const [publicLibraryDownloadStates, setPublicLibraryDownloadStates] = useState({});
    const [activeBookMenuKey, setActiveBookMenuKey] = useState(null);
    const [songs, setSongs] = useState([]);
    const [songsLoaded, setSongsLoaded] = useState(false);
    const [downloadingBookId, setDownloadingBookId] = useState(null);
    // Synchronous record of in-flight downloads (keyed by bookKey). The
    // downloadingBookId state lags a render behind, so two quick taps could
    // both pass a state check and download the same book twice.
    const downloadsInFlightRef = useRef(new Set());
    const [selectedSongId, setSelectedSongId] = useState(null);
    const [selectedBookPreview, setSelectedBookPreview] = useState(null);
    const [previewReadingEase, setPreviewReadingEase] = useState(null);
    const [previewNote, setPreviewNote] = useState(null);

    // Android hardware back closes the full-screen book preview instead of
    // exiting the app (Home is the tab-navigator root, so back would otherwise
    // fall through and quit). Only registers while a preview is open.
    useEffect(() => {
        if (!selectedBookPreview) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            setSelectedBookPreview(null);
            return true;
        });
        return () => subscription.remove();
    }, [selectedBookPreview]);

    // Android hardware back closes the full-screen song reader and returns to
    // Home instead of exiting the app. Only registers while a song is open.
    useEffect(() => {
        if (!selectedSongId) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            setSelectedSongId(null);
            return true;
        });
        return () => subscription.remove();
    }, [selectedSongId]);
    const [showAddSongModal, setShowAddSongModal] = useState(false);
    const [songDraft, setSongDraft] = useState(EMPTY_SONG_DRAFT);
    // Song suggestions while the reader types a title, artist or line of
    // lyrics in the editor; a tap fills the draft, which stays editable.
    const [songSearch, setSongSearch] = useState({ query: '', results: [], status: 'idle' });
    const songSearchTimerRef = useRef(null);
    const songSearchRequestRef = useRef(0);
    const [ocrStatus, setOcrStatus] = useState(EMPTY_OCR_STATUS);
    const [ocrBusy, setOcrBusy] = useState(false);
    // Status / permission / start-failure feedback for the floating OCR toggle,
    // shown as a transient line under the top bar.
    const [ocrMessage, setOcrMessage] = useState('');
    const [ocrSettingsLoaded, setOcrSettingsLoaded] = useState(false);
    const songCloudSyncOwnerRef = useRef(null);
    const songStorageLimitAlertedRef = useRef(false);
    // Tracks which storage key (owner + target language) the current `songs`
    // state was loaded for. The persist effect writes only when this matches the
    // active key, so a target-language switch never flushes the previous
    // language's songs into the new language's key (which erased them).
    const loadedSongsStorageKeyRef = useRef(null);
    const activeOwnerIdRef = useRef(activeOwnerId);
    activeOwnerIdRef.current = activeOwnerId;
    const targetLanguageRef = useRef(targetLanguage);
    targetLanguageRef.current = targetLanguage;
    const ocrActionInFlightRef = useRef(false);
    const ocrSettingsRef = useRef({ floatingPreferred: false, updatedAt: null });
    const ocrSettingsCloudUserRef = useRef(null);
    const publicDomainBookPressRef = useRef(null);
    const { width } = useWindowDimensions();
    const {
        isImporting,
        openingBookUri,
        pdfCoverPrompt,
        pdfCoverPageInput,
        setPdfCoverPageInput,
        choosePdfCoverDefault,
        choosePdfCoverNone,
        choosePdfCoverCustom,
        confirmAddBook,
        handlePress,
    } = useBooks({
        books,
        setBooks,
        setCurrentBook,
        onBookImported: () => {},
        user,
        ownerId: activeOwnerId,
        syncGeneration,
        targetLanguage,
        setTargetLanguage,
    });

    const languageFilteredBooks = useMemo(() => (
        books.filter((book) => normalizeBookLanguage(book?.language ?? 'ko') === targetLanguage)
    ), [books, targetLanguage]);

    useEffect(() => {
        const currentBookMatchesTarget = currentBook
            ? languageFilteredBooks.some((book) => book.uri === currentBook)
            : false;
        if (currentBookMatchesTarget) {
            return;
        }

        const nextBookUri = (
            languageFilteredBooks.find(isBookDownloaded)?.uri
            ?? languageFilteredBooks[0]?.uri
            ?? null
        );

        if (nextBookUri !== currentBook) {
            setCurrentBook(nextBookUri);
        }
    }, [currentBook, languageFilteredBooks, setCurrentBook]);

    useEffect(() => {
        setSelectedSongId(null);
        setSelectedBookPreview(null);
        setShowAddSongModal(false);
    }, [targetLanguage]);

    const homeGridContentWidth = Math.max(width - (HOME_CONTENT_HORIZONTAL_PADDING * 2), 0);
    const bookTileWidth = Math.max(
        Math.floor((homeGridContentWidth - (BOOK_GRID_GAP * (BOOK_GRID_COLUMNS - 1))) / BOOK_GRID_COLUMNS),
        0
    );
    const bookCoverHeight = Math.round(bookTileWidth * 1.5);
    const useRemotePublicLibrary = targetLanguage === 'en';
    const bundledPublicDomainBooks = useMemo(() => getPublicDomainBooks(targetLanguage), [targetLanguage]);
    const publicDomainBooks = useMemo(() => (
        useRemotePublicLibrary ? publicLibraryBooks : bundledPublicDomainBooks
    ), [bundledPublicDomainBooks, publicLibraryBooks, useRemotePublicLibrary]);

    useEffect(() => {
        let isActive = true;

        if (!languageSettingsReady || !useRemotePublicLibrary) {
            setPublicLibraryBooks([]);
            setPublicLibraryDownloadStates({});
            setPublicLibraryError(null);
            setPublicLibraryLoading(false);
            setPublicLibraryDiagnostics(makePublicLibraryDiagnostics({
                stage: languageSettingsReady ? 'inactive' : 'waiting-language-settings',
                detail: languageSettingsReady
                    ? t('home.libraryOnlyEnglishDetail')
                    : t('home.libraryWaitingLanguageDetail'),
                targetLanguage,
            }));
            return () => {
                isActive = false;
            };
        }

        const loadPublicLibrary = async () => {
            setPublicLibraryLoading(true);
            setPublicLibraryError(null);
            setPublicLibraryDiagnostics(makePublicLibraryDiagnostics({
                stage: 'fetching-rows',
                detail: t('home.libraryQueryingDetail'),
                targetLanguage,
            }));

            try {
                const libraryBooks = await fetchPublicLibrary(targetLanguage);
                const downloadStates = {};
                let checkedCount = 0;

                if (isActive) {
                    setPublicLibraryDiagnostics(makePublicLibraryDiagnostics({
                        stage: 'checking-local-files',
                        detail: t('home.libraryRowsCheckingDetail', { count: libraryBooks.length }),
                        targetLanguage,
                        rowCount: libraryBooks.length,
                        checkedCount,
                    }));
                }

                for (const book of libraryBooks) {
                    const storagePath = book.storagePath ?? book.publicLibraryStoragePath;
                    if (storagePath) {
                        downloadStates[book.publicLibraryId] = await isPublicLibraryBookDownloaded(storagePath, book.format);
                    }
                    checkedCount += 1;

                    if (isActive) {
                        setPublicLibraryDiagnostics(makePublicLibraryDiagnostics({
                            stage: 'checking-local-files',
                            detail: t('home.libraryCheckedDetail', { checked: checkedCount, total: libraryBooks.length }),
                            targetLanguage,
                            rowCount: libraryBooks.length,
                            checkedCount,
                            downloadedCount: Object.values(downloadStates).filter(Boolean).length,
                        }));
                    }
                }

                if (!isActive) {
                    return;
                }

                setPublicLibraryBooks(libraryBooks);
                setPublicLibraryDownloadStates((current) => ({
                    ...downloadStates,
                    ...current,
                }));
                setPublicLibraryDiagnostics(makePublicLibraryDiagnostics({
                    stage: 'ready',
                    detail: t('home.libraryLoadedDetail', {
                        total: libraryBooks.length,
                        local: Object.values(downloadStates).filter(Boolean).length,
                    }),
                    targetLanguage,
                    rowCount: libraryBooks.length,
                    checkedCount,
                    downloadedCount: Object.values(downloadStates).filter(Boolean).length,
                }));
            } catch (error) {
                if (!isActive) {
                    return;
                }

                console.warn('[Home] Failed to load public library:', error?.message ?? error);
                setPublicLibraryBooks([]);
                setPublicLibraryDownloadStates({});
                setPublicLibraryError(error);
                setPublicLibraryDiagnostics(makePublicLibraryDiagnostics({
                    stage: 'error',
                    detail: t('home.libraryLoadFailedDetail'),
                    targetLanguage,
                    errorMessage: error?.message || String(error),
                }));
            } finally {
                if (isActive) {
                    setPublicLibraryLoading(false);
                }
            }
        };

        loadPublicLibrary();

        return () => {
            isActive = false;
        };
    }, [languageSettingsReady, targetLanguage, useRemotePublicLibrary]);

    useEffect(() => {
        if (!languageSettingsReady || !useRemotePublicLibrary) {
            return undefined;
        }

        let isActive = true;
        downloadFeaturedBooks(targetLanguage, (book) => {
            if (!isActive) {
                return;
            }

            setPublicLibraryDownloadStates((current) => ({
                ...current,
                [book.publicLibraryId]: true,
            }));
            readPublicLibraryBookMetadataPatch(book, book.uri, t)
                .then((metadataPatch) => {
                    if (!isActive) {
                        return;
                    }

                    setPublicLibraryBooks((currentBooks) => currentBooks.map((candidate) => (
                        isSamePublicDomainBook(candidate, book)
                            ? {
                                ...candidate,
                                ...metadataPatch,
                                uri: book.uri,
                                downloaded: true,
                            }
                            : candidate
                    )));
                })
                .catch((error) => {
                    if (isActive) {
                        console.warn(
                            `[Home] Failed to read embedded cover for public book "${book.title}":`,
                            error?.message ?? error
                        );
                    }
                });
        }).catch((error) => {
            if (isActive) {
                console.warn('[Home] Failed to pre-download featured public books:', error?.message ?? error);
            }
        });

        return () => {
            isActive = false;
        };
    }, [languageSettingsReady, targetLanguage, useRemotePublicLibrary]);

    const publicDomainBookRows = useMemo(() => (
        publicDomainBooks.map((book) => {
            const localBook = languageFilteredBooks.find((candidate) => isSamePublicDomainBook(candidate, book));
            const catalogCoverColors = getPublicDomainBookCoverColors(book);
            const hasCustomCover = !!localBook?.cover;
            const publicLibrary = isPublicLibraryBook(book);
            const downloadState = publicLibraryDownloadStates[book.publicLibraryId];
            const downloaded = publicLibrary
                ? downloadState === true
                : localBook
                    ? isBookDownloaded(localBook)
                    : book.downloaded !== false;
            const localUri = downloaded
                ? localBook?.uri
                    ?? book.uri
                    ?? (publicLibrary ? getPublicLibraryLocalPath(book.storagePath ?? book.publicLibraryStoragePath) : null)
                : null;
            return localBook
                ? {
                    ...book,
                    ...localBook,
                    publicDomain: true,
                    publicLibrary,
                    publicLibraryId: localBook.publicLibraryId ?? book.publicLibraryId ?? null,
                    publicLibraryStoragePath: localBook.publicLibraryStoragePath ?? book.publicLibraryStoragePath ?? null,
                    storagePath: localBook.storagePath ?? book.storagePath ?? null,
                    uri: localBook.uri ?? localUri,
                    downloaded,
                    format: localBook.format ?? book.format ?? (publicLibrary ? 'epub' : 'txt'),
                    previewSource: localBook.previewSource ?? book.previewSource,
                    attributionCategory: localBook.attributionCategory ?? book.attributionCategory,
                    titleTranslation: localBook.titleTranslation ?? book.titleTranslation,
                    authorTranslation: localBook.authorTranslation ?? book.authorTranslation,
                    attribution: localBook.attribution ?? book.attribution,
                    snippet: localBook.snippet ?? book.snippet,
                    genre: localBook.genre ?? book.genre,
                    difficulty: localBook.difficulty ?? book.difficulty,
                    bookLevel: localBook.bookLevel ?? book.bookLevel,
                    coverColor: book.coverColor,
                    coverAccentColor: hasCustomCover
                        ? localBook.coverAccentColor ?? catalogCoverColors.coverAccentColor
                        : catalogCoverColors.coverAccentColor,
                    coverBackgroundColor: hasCustomCover
                        ? localBook.coverBackgroundColor ?? catalogCoverColors.coverBackgroundColor
                        : catalogCoverColors.coverBackgroundColor,
                }
                : {
                    ...book,
                    ...catalogCoverColors,
                    uri: localUri,
                    downloaded,
                };
        })
    ), [languageFilteredBooks, publicDomainBooks, publicLibraryDownloadStates]);
    // Each book's level on the standard scale (rank, 1 = easiest) and, to
    // order books within a level, the share of its vocabulary a reader of
    // neutral ability knows. Neither depends on this reader.
    const publicDomainLevels = useMemo(() => {
        const levelsByKey = new Map();
        publicDomainBookRows.forEach((book, index) => {
            const stats = normalizeLegacyKoreanStats(book?.bookLevel, targetLanguage);
            const rank = Number(stats?.level_rank ?? stats?.proficiency_rank);
            const ease = bookEaseFromDistribution({
                theta: 0,
                language: targetLanguage,
                distribution: stats?.distribution,
            });
            levelsByKey.set(getBookKey(book, `${index}`), {
                rank: Number.isFinite(rank) && rank > 0 ? rank : null,
                ease: Number.isFinite(ease) ? ease : null,
            });
        });
        return levelsByKey;
    }, [publicDomainBookRows, targetLanguage]);
    const sortedPublicDomainBookRows = useMemo(() => (
        publicDomainBookRows
            .map((book, index) => ({ book, index }))
            .sort((a, b) => {
                const direction = publicDomainSortDirection === 'desc' ? -1 : 1;
                let sortResult = 0;

                if (activePublicDomainSort === 'ease') {
                    const levelA = publicDomainLevels.get(getBookKey(a.book, `${a.index}`)) ?? {};
                    const levelB = publicDomainLevels.get(getBookKey(b.book, `${b.index}`)) ?? {};
                    sortResult = ((levelA.rank ?? 99) - (levelB.rank ?? 99))
                        || ((levelB.ease ?? -1) - (levelA.ease ?? -1))
                        || compareSortText(getBookTitle(a.book), getBookTitle(b.book));
                    return sortResult ? sortResult * direction : a.index - b.index;
                }

                if (activePublicDomainSort === 'author') {
                    sortResult = (
                        compareSortText(getBookAuthor(a.book), getBookAuthor(b.book))
                        || compareSortText(getBookTitle(a.book), getBookTitle(b.book))
                    );
                    return sortResult ? sortResult * direction : a.index - b.index;
                }

                if (activePublicDomainSort === 'length') {
                    sortResult = (
                        (getBookWordCount(a.book) ?? Number.MAX_SAFE_INTEGER)
                        - (getBookWordCount(b.book) ?? Number.MAX_SAFE_INTEGER)
                        || compareSortText(getBookTitle(a.book), getBookTitle(b.book))
                    );
                    return sortResult ? sortResult * direction : a.index - b.index;
                }

                if (activePublicDomainSort === 'genre') {
                    sortResult = (
                        compareSortText(a.book?.genre, b.book?.genre)
                        || compareSortText(getBookTitle(a.book), getBookTitle(b.book))
                    );
                    return sortResult ? sortResult * direction : a.index - b.index;
                }

                sortResult = (
                    compareSortText(getBookTitle(a.book), getBookTitle(b.book))
                    || compareSortText(getBookAuthor(a.book), getBookAuthor(b.book))
                );

                return sortResult ? sortResult * direction : a.index - b.index;
            })
            .map(({ book }) => book)
    ), [activePublicDomainSort, publicDomainBookRows, publicDomainLevels, publicDomainSortDirection]);
    // The level sort shows the books in sections, one per level (A1, A2, ...;
    // HSK 1, 2, ...), then any book with no level yet.
    const publicDomainEaseSections = useMemo(() => {
        if (activePublicDomainSort !== 'ease') {
            return null;
        }
        const levelOptions = getProficiencyLevelOptions(targetLanguage);
        const sections = new Map();
        sortedPublicDomainBookRows.forEach((book) => {
            const index = publicDomainBookRows.indexOf(book);
            const rank = publicDomainLevels.get(getBookKey(book, `${index}`))?.rank ?? null;
            const key = rank == null ? 'unknown' : String(rank);
            if (!sections.has(key)) {
                const option = levelOptions.find((level) => level.rank === rank);
                sections.set(key, {
                    key,
                    title: rank == null
                        ? t('home.easeNotEstimated')
                        : localizedLevelLabel(targetLanguage, option?.label ?? rank, interfaceLanguage, option?.label ?? String(rank)),
                    books: [],
                });
            }
            sections.get(key).books.push(book);
        });
        // Books arrive sorted by level (either direction), so the sections are
        // already in order; the unleveled ones always go last.
        const ordered = [...sections.values()];
        return ordered.filter((section) => section.key !== 'unknown')
            .concat(ordered.filter((section) => section.key === 'unknown'));
    }, [
        activePublicDomainSort,
        interfaceLanguage,
        publicDomainBookRows,
        publicDomainLevels,
        sortedPublicDomainBookRows,
        t,
        targetLanguage,
    ]);
    const favoriteBooks = useMemo(() => languageFilteredBooks.filter(isBookFavorite), [languageFilteredBooks]);
    const recentBooks = useMemo(() => (
        languageFilteredBooks
            .map((book, index) => ({ book, index }))
            .sort((a, b) => {
                const timestampDiff = getBookRecentTimestamp(b.book) - getBookRecentTimestamp(a.book);
                return timestampDiff || a.index - b.index;
            })
            .map(({ book }) => book)
    ), [languageFilteredBooks]);
    const featuredBooks = useMemo(
        () => recentBooks.slice(0, FEATURED_BOOK_COUNT),
        [recentBooks]
    );
    const bookFilterCounts = useMemo(() => ({
        favorites: favoriteBooks.length,
        all: languageFilteredBooks.length,
        'public-domain': sortedPublicDomainBookRows.length,
    }), [favoriteBooks.length, languageFilteredBooks.length, sortedPublicDomainBookRows.length]);
    const filteredLibraryBooks = useMemo(() => {
        if (activeBookFilter === 'favorites') {
            return favoriteBooks;
        }

        return recentBooks;
    }, [activeBookFilter, favoriteBooks, recentBooks]);
    const showingPublicDomainBooks = activeLibraryTab === 'Books' && activeBookFilter === 'public-domain';
    const showingEmptyMyBooks = activeLibraryTab === 'Books'
        && !showingPublicDomainBooks
        && filteredLibraryBooks.length === 0;

    // Empty-shelf starter suggestion: instead of a dead end, offer one short
    // bundled book matched to the reader (services/starterBook.js). The reader's
    // ability is read once per (owner, profile, language) while the shelf is
    // empty; the result is keyed so a language/profile switch never pairs the new
    // catalog with the previous profile's theta for a frame.
    const shelfIsEmpty = languageFilteredBooks.length === 0;
    const starterAbilityKey = `${activeOwnerId ?? ''}|${activeProfileId ?? ''}|${targetLanguage}`;
    const starterLookupEnabled = shelfIsEmpty
        && languageSettingsReady
        && bundledPublicDomainBooks.length > 0;
    const [starterAbility, setStarterAbility] = useState({ key: null, theta: null });
    useEffect(() => {
        if (!starterLookupEnabled) {
            return undefined;
        }

        let active = true;
        getProfileAbility({ ownerId: activeOwnerId, profileId: activeProfileId, language: targetLanguage })
            .then((ability) => {
                if (active) {
                    setStarterAbility({ key: starterAbilityKey, theta: starterThetaFromAbility(ability) });
                }
            })
            .catch((error) => {
                console.warn('[Home] Failed to read ability for the starter book:', error?.message ?? error);
                if (active) {
                    setStarterAbility({ key: starterAbilityKey, theta: null });
                }
            });

        return () => {
            active = false;
        };
    }, [activeOwnerId, activeProfileId, starterAbilityKey, starterLookupEnabled, targetLanguage]);
    const starterAbilityReady = starterAbility.key === starterAbilityKey;
    // Still waiting on the ability read: hold the empty-state space rather than
    // flashing the plain empty state (or the wrong book) for a frame.
    const starterBookPending = starterLookupEnabled && !starterAbilityReady;
    const starterBook = useMemo(() => {
        if (!starterLookupEnabled || !starterAbilityReady) {
            return null;
        }

        const picked = pickStarterBook(bundledPublicDomainBooks, {
            language: targetLanguage,
            theta: starterAbility.theta,
        });
        if (!picked) {
            return null;
        }

        // Prefer the shelf row: it carries the catalog cover colors the Public
        // Domain tab shows, so the suggestion looks like the same book.
        return publicDomainBookRows.find((row) => isSamePublicDomainBook(row, picked)) ?? picked;
    }, [
        bundledPublicDomainBooks,
        publicDomainBookRows,
        starterAbility.theta,
        starterAbilityReady,
        starterLookupEnabled,
        targetLanguage,
    ]);
    const showingEmptyPublicDomain = showingPublicDomainBooks
        && !publicLibraryLoading
        && !publicLibraryError
        && sortedPublicDomainBookRows.length === 0;
    const showingEmptySongs = activeLibraryTab === 'Songs' && songsLoaded && songs.length === 0;
    const effectiveCollectionViewMode = activeLibraryTab === 'Songs' ? 'grid' : collectionViewMode;
    const bookSectionLabel = showingPublicDomainBooks
        ? formatBookCount(t, 'home.publicDomainCount', sortedPublicDomainBookRows.length)
        : activeBookFilter === 'favorites'
            ? formatBookCount(t, 'home.favoriteCount', favoriteBooks.length)
            : formatBookCount(t, 'home.bookCount', languageFilteredBooks.length);
    const bookSectionHint = showingPublicDomainBooks
        ? t('home.publicDomainHint')
        : null;
    const selectedSong = useMemo(() => (
        songs.find((song) => song.id === selectedSongId) ?? null
    ), [selectedSongId, songs]);
    const selectedPreviewBook = useMemo(() => {
        const previewBook = selectedBookPreview?.book;
        if (!previewBook) {
            return null;
        }

        if (previewBook.publicDomain || previewBook.uri?.startsWith('public-domain:')) {
            return publicDomainBookRows.find((book) => isSamePublicDomainBook(book, previewBook)) ?? previewBook;
        }

        return languageFilteredBooks.find((book) => (
            (previewBook.cloudId && book.cloudId === previewBook.cloudId)
            || (previewBook.uri && book.uri === previewBook.uri)
            || (previewBook.id && book.id === previewBook.id)
        )) ?? previewBook;
    }, [languageFilteredBooks, publicDomainBookRows, selectedBookPreview]);
    const previewInLibrary = useMemo(() => {
        if (!selectedPreviewBook) {
            return false;
        }

        if (selectedPreviewBook.publicDomain) {
            return books.some((book) => isSamePublicDomainBook(book, selectedPreviewBook));
        }

        // A non-public book only reaches the preview from the reader's own shelf.
        return true;
    }, [books, selectedPreviewBook]);
    const previewBookUri = selectedPreviewBook?.uri ?? null;
    const previewBookLevelRank = selectedPreviewBook?.bookLevel?.level_rank
        ?? selectedPreviewBook?.bookLevel?.proficiency_rank
        ?? null;
    const previewBookLanguage = selectedPreviewBook
        ? (normalizeBookLanguage(selectedPreviewBook.language ?? targetLanguage) || targetLanguage)
        : targetLanguage;

    // Estimate how easy this book is for the current reader (see estimateBookReadingEase).
    // Re-runs when the previewed book, the active profile, or the reader's ability
    // could have changed, so the percentage reflects the latest theta.
    useEffect(() => {
        if (!selectedPreviewBook) {
            setPreviewReadingEase(null);
            return undefined;
        }

        let active = true;
        estimateBookReadingEase({
            ownerId: activeOwnerId,
            profileId: activeProfileId,
            language: previewBookLanguage,
            levelRank: previewBookLevelRank,
            // Unlocks the distribution-refined estimate when the book has one
            // (accumulated by preprocessing, or bundled with the catalog).
            bookLevelStats: selectedPreviewBook?.bookLevel ?? null,
            bookUri: previewBookUri,
        })
            .then((result) => {
                if (active) {
                    setPreviewReadingEase(result);
                }
            })
            .catch((error) => {
                console.warn('[Home] Failed to estimate reading ease:', error?.message ?? error);
                if (active) {
                    setPreviewReadingEase(null);
                }
            });

        return () => {
            active = false;
        };
    }, [
        selectedPreviewBook,
        activeOwnerId,
        activeProfileId,
        previewBookLanguage,
        previewBookLevelRank,
        previewBookUri,
    ]);

    // Surface the reader's most recent "note to self" as a welcome-back card on
    // the book preview (thoughtful open). Only the latest note is shown.
    useEffect(() => {
        if (!selectedPreviewBook || !previewBookUri) {
            setPreviewNote(null);
            return undefined;
        }

        let active = true;
        getLatestBookNote(previewBookUri, {
            ownerId: activeOwnerId,
            profileId: activeProfileId,
            language: previewBookLanguage,
        })
            .then((note) => {
                if (active) setPreviewNote(note);
            })
            .catch((error) => {
                console.warn('[Home] Failed to load latest note:', error?.message ?? error);
                if (active) setPreviewNote(null);
            });

        return () => {
            active = false;
        };
    }, [selectedPreviewBook, activeOwnerId, activeProfileId, previewBookLanguage, previewBookUri]);
    const isFloatingOcrVisible = Platform.OS === 'android' && ocrStatus.floatingVisible;
    const isFloatingOcrActive = Platform.OS === 'android' && (
        ocrStatus.floatingVisible || ocrStatus.resultOverlayVisible || ocrStatus.analysisActive
    );

    const syncSongToCloud = useCallback((song) => {
        if (
            !user?.id
            || !song?.id
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            return;
        }

        try {
            assertCanUploadForOwner({ ownerId: activeOwnerId, user });
        } catch (error) {
            console.warn('[Home] Refusing song upload:', error?.message ?? error);
            return;
        }

        upsertUserSong({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
            song: {
                ...song,
                language: normalizeBookLanguage(song.language ?? targetLanguage),
            },
        }).catch((error) => {
            console.warn('[Home] Failed to sync song:', error?.message ?? error);
        });
    }, [activeOwnerId, syncGeneration, syncPaused, targetLanguage, user]);

    const syncSongsFromCloud = useCallback(async () => {
        const ownerId = activeOwnerId;
        const generation = syncGeneration;

        if (
            !user?.id
            || syncPaused
            || ownerId !== user.id
            || !isCurrentSyncGeneration(generation)
        ) {
            return;
        }

        try {
            assertCanUploadForOwner({ ownerId, user });
        } catch (error) {
            console.warn('[Home] Refusing song cloud sync:', error?.message ?? error);
            return;
        }

        const language = targetLanguage;
        const isStale = () => (
            !isCurrentSyncGeneration(generation)
            || ownerId !== activeOwnerIdRef.current
            // The user switched target language while the fetch was in flight:
            // these rows belong to the old language's library.
            || language !== targetLanguageRef.current
        );

        const cloudRows = await fetchUserSongs(user.id, {
            includeDeleted: true,
            targetLanguage: language,
        });
        if (isStale()) {
            return;
        }

        const normalizeLocal = (list) => (list || [])
            .map((song) => normalizeStoredSong(song, language))
            .filter(Boolean);
        // Upload candidates come from the snapshot this sync started with.
        const { localOnly } = mergeLocalAndCloudSongs(normalizeLocal(songs), cloudRows, language);

        // Merge against the *current* state, not the snapshot, so a song the
        // user added while the fetch was running isn't dropped.
        setSongs((currentSongs) => (
            isStale()
                ? currentSongs
                : mergeLocalAndCloudSongs(normalizeLocal(currentSongs), cloudRows, language).songs
        ));

        if (isStale()) {
            return;
        }

        for (const song of localOnly) {
            if (isStale()) {
                return;
            }

            try {
                assertCanUploadForOwner({ ownerId, user });
                await upsertUserSong({
                    user,
                    ownerId,
                    generation,
                    song: {
                        ...song,
                        language: normalizeBookLanguage(song.language ?? targetLanguage),
                    },
                });
            } catch (error) {
                console.warn('[Home] Failed to upload local song:', error?.message ?? error);
            }
        }
    }, [activeOwnerId, songs, syncGeneration, syncPaused, targetLanguage, user]);

    const persistOcrSettings = useCallback((patch, options = {}) => {
        const { syncCloud = true, updatedAt = new Date().toISOString() } = options;
        const nextSettings = {
            ...ocrSettingsRef.current,
            ...patch,
            updatedAt,
        };

        ocrSettingsRef.current = nextSettings;

        AsyncStorage.setItem(OCR_SETTINGS_KEY, JSON.stringify(nextSettings)).catch((error) => {
            console.warn('[Home] Failed to save OCR preference:', error?.message ?? error);
        });

        if (
            syncCloud
            && user?.id
            && activeOwnerId === user.id
            && !syncPaused
            && isCurrentSyncGeneration(syncGeneration)
        ) {
            updateUserPreferenceFields({
                user,
                ownerId: activeOwnerId,
                generation: syncGeneration,
                patch: {
                    ocr_settings: nextSettings,
                    updated_at: updatedAt,
                },
            }).catch((error) => {
                console.warn('[Home] Failed to sync OCR preference:', error?.message ?? error);
            });
        }
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

    const mergeOcrStatus = useCallback((nextStatus = {}) => {
        setOcrStatus((previous) => ({
            overlayPermissionGranted: typeof nextStatus.overlayPermissionGranted === 'boolean'
                ? nextStatus.overlayPermissionGranted
                : previous.overlayPermissionGranted,
            screenCaptureActive: typeof nextStatus.screenCaptureActive === 'boolean'
                ? nextStatus.screenCaptureActive
                : previous.screenCaptureActive,
            analysisActive: typeof nextStatus.analysisActive === 'boolean'
                ? nextStatus.analysisActive
                : previous.analysisActive,
            floatingVisible: typeof nextStatus.floatingVisible === 'boolean'
                ? nextStatus.floatingVisible
                : previous.floatingVisible,
            resultOverlayVisible: typeof nextStatus.resultOverlayVisible === 'boolean'
                ? nextStatus.resultOverlayVisible
                : previous.resultOverlayVisible,
        }));
    }, []);

    const waitForScreenCapture = useCallback(async () => {
        for (let attempt = 0; attempt < 25; attempt += 1) {
            if (isScreenCaptureActive()) {
                mergeOcrStatus({ screenCaptureActive: true });
                return true;
            }
            await wait(120);
        }

        return isScreenCaptureActive();
    }, [mergeOcrStatus]);

    useEffect(() => {
        if (!activeOwnerId) {
            return undefined;
        }

        let isActive = true;
        const ownerId = activeOwnerId;

        const loadSongs = async () => {
            setSongsLoaded(false);
            setSongs([]);
            setSelectedSongId(null);
            setShowAddSongModal(false);
            setSongDraft(EMPTY_SONG_DRAFT);
            songCloudSyncOwnerRef.current = null;
            // Invalidate the persist guard until this load resolves — the in-state
            // songs no longer belong to any storage key, so nothing should flush.
            loadedSongsStorageKeyRef.current = null;

            const storageKey = getSongsStorageKey(ownerId, targetLanguage);

            try {
                let storedSongs = await AsyncStorage.getItem(storageKey);

                if (!storedSongs && ownerId === GUEST_OWNER_ID && targetLanguage === 'ko') {
                    const legacySongs = await AsyncStorage.getItem(LEGACY_SONGS_STORAGE_KEY);
                    if (legacySongs) {
                        const parsedLegacySongs = JSON.parse(legacySongs);
                        if (Array.isArray(parsedLegacySongs)) {
                            const normalizedLegacySongs = parsedLegacySongs
                                .map((song) => normalizeStoredSong(song, targetLanguage))
                                .filter(Boolean);
                            try {
                                storedSongs = serializeSongsForStorage(normalizedLegacySongs);
                                await AsyncStorage.setItem(storageKey, storedSongs);
                            } catch (error) {
                                if (!isSongStorageLimitError(error)) {
                                    throw error;
                                }

                                console.warn('[Home] Legacy songs exceed local storage cap:', error.message);
                                storedSongs = JSON.stringify(normalizedLegacySongs);
                                if (!songStorageLimitAlertedRef.current) {
                                    songStorageLimitAlertedRef.current = true;
                                    showSongStorageLimitAlert(error, t);
                                }
                            }
                        }
                    }
                }

                if (!isActive) {
                    return;
                }

                if (!storedSongs) {
                    return;
                }

                const parsedSongs = JSON.parse(storedSongs);
                if (!Array.isArray(parsedSongs)) {
                    return;
                }

                setSongs(parsedSongs
                    .map((song) => normalizeStoredSong(song, targetLanguage))
                    .filter((song) => song && normalizeBookLanguage(song.language ?? targetLanguage) === targetLanguage));
            } catch (error) {
                console.error('[Home] Failed to load songs:', error);
            } finally {
                if (isActive) {
                    // The in-state songs now correspond to this storage key, so the
                    // persist effect is cleared to flush future edits back to it.
                    loadedSongsStorageKeyRef.current = storageKey;
                    setSongsLoaded(true);
                }
            }
        };

        loadSongs();

        return () => {
            isActive = false;
        };
    }, [activeOwnerId, targetLanguage, t]);

    useEffect(() => {
        if (Platform.OS !== 'android') {
            return undefined;
        }

        mergeOcrStatus({
            overlayPermissionGranted: isOverlayPermissionGranted(),
            screenCaptureActive: isScreenCaptureActive(),
        });

        const statusSubscription = addOverlayStatusListener((status = {}) => {
            mergeOcrStatus(status);
            if (status.status === 'floating_widget_visible') {
                setOcrMessage(t('home.ocrReady'));
            } else if (status.status === 'floating_widget_hidden') {
                setOcrMessage(t('home.ocrOff'));
            } else if (status.status === 'screen_capture_stopped') {
                setOcrMessage(t('home.ocrCaptureStopped'));
            }
        });

        const errorSubscription = addOverlayErrorListener((error = {}) => {
            setOcrMessage(getUserFacingErrorMessage(error, t, 'home.ocrFailed', language));
        });

        return () => {
            statusSubscription.remove();
            errorSubscription.remove();
        };
    }, [language, mergeOcrStatus, t]);

    useEffect(() => {
        let isMounted = true;

        AsyncStorage.getItem(OCR_SETTINGS_KEY)
            .then((stored) => {
                if (!isMounted) {
                    return;
                }

                const parsed = parseStoredJson(stored, {});
                ocrSettingsRef.current = {
                    floatingPreferred: parsed.floatingPreferred === true,
                    updatedAt: parsed.updatedAt ?? null,
                };
            })
            .catch((error) => {
                console.warn('[Home] Failed to load OCR preference:', error?.message ?? error);
            })
            .finally(() => {
                if (isMounted) {
                    setOcrSettingsLoaded(true);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!ocrSettingsLoaded) {
            return;
        }

        if (!user?.id) {
            ocrSettingsCloudUserRef.current = null;
            return;
        }

        if (
            syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            ocrSettingsCloudUserRef.current = null;
            return;
        }

        if (ocrSettingsCloudUserRef.current === user.id) {
            return;
        }

        let isMounted = true;
        ocrSettingsCloudUserRef.current = user.id;
        const ownerId = activeOwnerId;
        const generation = syncGeneration;

        const mergeCloudOcrSettings = async () => {
            try {
                const cloudPreferences = await fetchUserPreferences(user.id);
                if (!isMounted || !isCurrentSyncGeneration(generation) || ownerId !== activeOwnerIdRef.current) {
                    return;
                }
                const cloudSettings = cloudPreferences?.ocr_settings;
                const hasCloudSettings = cloudSettings
                    && typeof cloudSettings === 'object'
                    && !Array.isArray(cloudSettings)
                    && Object.keys(cloudSettings).length > 0;
                const cloudUpdatedAt = cloudSettings?.updatedAt
                    ?? cloudSettings?.updated_at
                    ?? cloudPreferences?.updated_at
                    ?? null;
                const localUpdatedAt = ocrSettingsRef.current.updatedAt;

                if (hasCloudSettings && getTimestampMs(cloudUpdatedAt) > getTimestampMs(localUpdatedAt)) {
                    const nextSettings = {
                        floatingPreferred: cloudSettings.floatingPreferred === true,
                        updatedAt: cloudUpdatedAt,
                    };
                    if (!isMounted) {
                        return;
                    }
                    ocrSettingsRef.current = nextSettings;
                    await AsyncStorage.setItem(OCR_SETTINGS_KEY, JSON.stringify(nextSettings));
                    return;
                }

                const updatedAt = localUpdatedAt ?? new Date().toISOString();
                await updateUserPreferenceFields({
                    user,
                    ownerId,
                    generation,
                    patch: {
                        ocr_settings: {
                            ...ocrSettingsRef.current,
                            updatedAt,
                        },
                        updated_at: updatedAt,
                    },
                });
            } catch (error) {
                ocrSettingsCloudUserRef.current = null;
                console.warn('[Home] Failed to merge cloud OCR preference:', error?.message ?? error);
            }
        };

        mergeCloudOcrSettings();

        return () => {
            isMounted = false;
        };
    }, [activeOwnerId, ocrSettingsLoaded, syncGeneration, syncPaused, user]);

    useEffect(() => {
        if (!songsLoaded || !activeOwnerId) {
            return;
        }

        const storageKey = getSongsStorageKey(activeOwnerId, targetLanguage);
        // On a target-language (or owner) switch this effect re-runs while `songs`
        // still holds the previous language's list — before loadSongs has swapped
        // it out. Writing here would clobber the new key with stale songs and
        // erase whatever was saved under it. Only persist once loadSongs has
        // confirmed the in-state songs belong to this exact key.
        if (loadedSongsStorageKeyRef.current !== storageKey) {
            return;
        }

        let serializedSongs;
        try {
            serializedSongs = serializeSongsForStorage(songs);
        } catch (error) {
            console.error('[Home] Failed to save songs:', error);
            if (isSongStorageLimitError(error) && !songStorageLimitAlertedRef.current) {
                songStorageLimitAlertedRef.current = true;
                showSongStorageLimitAlert(error, t);
            }
            return;
        }

        AsyncStorage.setItem(storageKey, serializedSongs)
            .then(() => {
                songStorageLimitAlertedRef.current = false;
            })
            .catch((error) => {
                console.error('[Home] Failed to save songs:', error);
            });
    }, [activeOwnerId, songs, songsLoaded, targetLanguage, t]);

    useEffect(() => {
        if (
            !user?.id
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            songCloudSyncOwnerRef.current = null;
            return;
        }

        if (!songsLoaded) {
            return;
        }

        const syncKey = `${activeOwnerId}:${user.id}:${targetLanguage}`;
        if (songCloudSyncOwnerRef.current === syncKey) {
            return;
        }

        songCloudSyncOwnerRef.current = syncKey;
        syncSongsFromCloud().catch((error) => {
            songCloudSyncOwnerRef.current = null;
            console.warn('[Home] Failed to sync cloud songs:', error?.message ?? error);
        });
    }, [activeOwnerId, songsLoaded, syncGeneration, syncPaused, syncSongsFromCloud, targetLanguage, user?.id]);

    useEffect(() => {
        if (selectedSongId && !selectedSong) {
            setSelectedSongId(null);
        }
    }, [selectedSong, selectedSongId]);

    useEffect(() => {
        const shouldHideTabBar = !!selectedSong || !!selectedPreviewBook;

        navigation?.setOptions({
            tabBarStyle: shouldHideTabBar ? { display: 'none' } : themedTabBarStyle,
        });

        return () => {
            navigation?.setOptions({
                tabBarStyle: themedTabBarStyle,
            });
        };
    }, [navigation, selectedPreviewBook, selectedSong, themedTabBarStyle]);

    useEffect(() => {
        if (!ocrMessage || ocrBusy) {
            return undefined;
        }
        const timer = setTimeout(() => setOcrMessage(''), 5000);
        return () => clearTimeout(timer);
    }, [ocrBusy, ocrMessage]);

    // First-time tip: after a first reading session (a word looked up), the
    // screen scanner takes lookups outside Noeul.
    const { tipId, offer: offerTip, close: closeTip } = useCoachTip();
    const ocrButtonRef = useRef(null);
    useFocusEffect(useCallback(() => {
        let cancelled = false;
        const timer = setTimeout(async () => {
            await loadTips();
            if (cancelled || isTipSeen(TIP_IDS.homeOcr) || tipCounter('lookups') < 1) return;
            if (!cancelled && (await areTipsEnabled())) offerTip(TIP_IDS.homeOcr);
        }, Math.max(1200, msUntilUnpromptedTip()));
        return () => {
            cancelled = true;
            clearTimeout(timer);
            closeTip(TIP_IDS.homeOcr, { seen: false });
        };
    }, [closeTip, offerTip]));

    const handleFloatingOcrToggle = useCallback(async () => {
        if (ocrBusy || ocrActionInFlightRef.current) {
            return;
        }

        if (Platform.OS !== 'android') {
            Alert.alert(t('home.ocrScanner'), t('home.ocrAndroidOnly'));
            return;
        }

        ocrActionInFlightRef.current = true;
        setOcrBusy(true);
        setOcrMessage(isFloatingOcrActive ? t('home.ocrTurningOff') : t('home.ocrStarting'));

        try {
            if (isFloatingOcrActive) {
                await stopFloatingWidget();
                mergeOcrStatus({
                    screenCaptureActive: false,
                    analysisActive: false,
                    floatingVisible: false,
                    resultOverlayVisible: false,
                });
                persistOcrSettings({ floatingPreferred: false });
                setOcrMessage(t('home.ocrOff'));
                return;
            }

            let overlayGranted = isOverlayPermissionGranted();
            if (!overlayGranted) {
                setOcrMessage(t('home.ocrAllowOverlay'));
                const overlayResult = await requestOverlayPermission();
                overlayGranted = !!overlayResult?.granted || isOverlayPermissionGranted();
            }

            if (!overlayGranted) {
                mergeOcrStatus({ overlayPermissionGranted: false });
                setOcrMessage(t('home.ocrOverlayDenied'));
                return;
            }
            mergeOcrStatus({ overlayPermissionGranted: true });

            let captureActive = isScreenCaptureActive();
            if (!captureActive) {
                setOcrMessage(t('home.ocrAllowCapture'));
                const captureResult = await requestScreenCapture();
                captureActive = !!captureResult?.active || !!captureResult?.granted;
                if (captureActive) {
                    captureActive = await waitForScreenCapture() || !!captureResult?.granted;
                }
            }

            if (!captureActive) {
                mergeOcrStatus({ screenCaptureActive: false, analysisActive: false, floatingVisible: false });
                setOcrMessage(t('home.ocrCaptureDenied'));
                return;
            }
            mergeOcrStatus({ screenCaptureActive: true });

            const startResult = await startFloatingWidget();
            const visible = !!startResult?.visible;
            mergeOcrStatus({ floatingVisible: visible });
            persistOcrSettings({ floatingPreferred: visible });
            setOcrMessage(visible ? t('home.ocrTapBubble') : t('home.ocrBubbleFailed'));
        } catch (error) {
            const message = getUserFacingErrorMessage(error, t, 'home.ocrFailed', language);
            setOcrMessage(message);
            Alert.alert(t('home.ocrScanner'), message);
        } finally {
            ocrActionInFlightRef.current = false;
            setOcrBusy(false);
        }
    }, [isFloatingOcrActive, language, mergeOcrStatus, ocrBusy, persistOcrSettings, t, waitForScreenCapture]);

    const updateBookRecord = useCallback((bookToUpdate, patch) => {
        setBooks((prevBooks) => prevBooks.map((book) => (
            (bookToUpdate?.cloudId && book.cloudId === bookToUpdate.cloudId)
            || (bookToUpdate?.uri && book.uri === bookToUpdate.uri)
            || (bookToUpdate?.id && book.id === bookToUpdate.id)
                ? { ...book, ...patch }
                : book
        )));
    }, [setBooks]);

    const handleDownloadBook = useCallback(async (book) => {
        if (
            !user?.id
            || !book?.cloudId
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            Alert.alert(t('home.downloadUnavailableTitle'), t('home.downloadUnavailableBody'));
            return;
        }

        const bookKey = getBookKey(book);
        if (downloadingBookId || downloadsInFlightRef.current.size > 0) {
            return;
        }

        downloadsInFlightRef.current.add(bookKey);
        setDownloadingBookId(bookKey);
        const ownerId = activeOwnerId;
        const generation = syncGeneration;

        try {
            const localBook = await downloadUserBook({
                user,
                ownerId,
                generation,
                cloudBook: book,
            });
            const downloadedCoverColors = localBook.cover
                ? await extractBookCoverColors({
                    coverUri: localBook.cover,
                    fallbackColor: book.coverAccentColor || book.coverColor,
                    cacheKey: `download:${book.cloudId || book.id || localBook.uri}`,
                })
                : {};
            if (!isCurrentSyncGeneration(generation) || activeOwnerIdRef.current !== ownerId) {
                return;
            }

            const openedAt = new Date().toISOString();
            setBooks((prevBooks) => {
                let replaced = false;
                const nextBooks = prevBooks.map((candidate) => {
                    if (candidate.cloudId === book.cloudId || candidate.id === book.id) {
                        replaced = true;
                        return {
                            ...candidate,
                            ...localBook,
                            ...downloadedCoverColors,
                            downloaded: true,
                            lastOpenedAt: openedAt,
                        };
                    }

                    return candidate;
                });

                return replaced
                    ? nextBooks
                    : [...nextBooks, { ...localBook, ...downloadedCoverColors, lastOpenedAt: openedAt }];
            });
            setCurrentBook(localBook.uri);
            navigation.navigate('Read', { returnTo: 'Home' });
        } catch (error) {
            console.warn('[Home] Failed to download cloud book:', error?.message ?? error);
            Alert.alert(t('home.downloadFailedTitle'), t(getDownloadErrorMessageKey(error)));
        } finally {
            downloadsInFlightRef.current.delete(bookKey);
            setDownloadingBookId(null);
        }
    }, [activeOwnerId, downloadingBookId, navigation, setBooks, setCurrentBook, syncGeneration, syncPaused, t, user]);

    const handleBookPress = useCallback((book) => {
        if (!book) {
            return;
        }

        if (activeBookMenuKey) {
            setActiveBookMenuKey(null);
            return;
        }

        if (isPublicLibraryBook(book)) {
            publicDomainBookPressRef.current?.(book);
            return;
        }

        if (!isBookDownloaded(book)) {
            handleDownloadBook(book);
            return;
        }

        const openedAt = new Date().toISOString();
        updateBookRecord(book, { lastOpenedAt: openedAt });
        handlePress(book.uri);
    }, [activeBookMenuKey, handleDownloadBook, handlePress, updateBookRecord]);

    const upsertPublicDomainBookInLibrary = useCallback((localBook) => {
        if (!localBook?.uri) {
            return;
        }

        setBooks((prevBooks) => {
            const exists = prevBooks.some((candidate) => isSamePublicDomainBook(candidate, localBook));
            if (exists) {
                return prevBooks.map((candidate) => (
                    isSamePublicDomainBook(candidate, localBook)
                        ? {
                            ...localBook,
                            ...candidate,
                            uri: localBook.uri,
                            publicDomain: true,
                            downloaded: true,
                            format: localBook.format ?? candidate.format ?? 'epub',
                            publicLibrary: localBook.publicLibrary ?? candidate.publicLibrary ?? false,
                            publicLibraryId: localBook.publicLibraryId ?? candidate.publicLibraryId ?? null,
                            publicLibraryStoragePath: localBook.publicLibraryStoragePath ?? candidate.publicLibraryStoragePath ?? null,
                            storagePath: localBook.storagePath ?? candidate.storagePath ?? null,
                            previewSource: candidate.previewSource ?? localBook.previewSource,
                            attributionCategory: candidate.attributionCategory ?? localBook.attributionCategory,
                            titleTranslation: candidate.titleTranslation ?? localBook.titleTranslation,
                            authorTranslation: candidate.authorTranslation ?? localBook.authorTranslation,
                            attribution: candidate.attribution ?? localBook.attribution,
                            snippet: candidate.snippet ?? localBook.snippet,
                            genre: candidate.genre ?? localBook.genre,
                            coverColor: localBook.coverColor,
                            coverAccentColor: localBook.coverAccentColor,
                            coverBackgroundColor: localBook.coverBackgroundColor,
                            lastOpenedAt: localBook.lastOpenedAt,
                        }
                        : candidate
                ));
            }

            return [...prevBooks, localBook];
        });
    }, [setBooks]);

    const downloadPublicLibraryBookToLocal = useCallback(async (book, patch = {}) => {
        const storagePath = book?.storagePath ?? book?.publicLibraryStoragePath;
        if (!storagePath) {
            Alert.alert(t('home.downloadFailedTitle'), t('home.downloadFailedBody'));
            return null;
        }

        const bookKey = getBookKey(book);
        // One download at a time, and never the same book twice.
        if (downloadsInFlightRef.current.size > 0) {
            return null;
        }

        downloadsInFlightRef.current.add(bookKey);
        setDownloadingBookId(bookKey);
        setPublicLibraryDownloadStates((current) => ({
            ...current,
            [book.publicLibraryId]: 'downloading',
        }));

        try {
            const uri = await downloadPublicBook(book, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
                const expected = Number(totalBytesExpectedToWrite);
                const progress = expected > 0
                    ? totalBytesWritten / expected
                    : 'downloading';
                setPublicLibraryDownloadStates((current) => ({
                    ...current,
                    [book.publicLibraryId]: progress,
                    }));
                });
            const metadataPatch = await readPublicLibraryBookMetadataPatch(book, uri, t).catch((error) => {
                console.warn(
                    `[Home] Failed to read embedded cover for public book "${book.title}":`,
                    error?.message ?? error
                );
                return {};
            });
            const localBook = buildPublicDomainLocalBook(book, {
                ...patch,
                ...metadataPatch,
                uri,
                downloaded: true,
                format: book.format || 'epub',
            });

            setPublicLibraryDownloadStates((current) => ({
                ...current,
                [book.publicLibraryId]: true,
            }));
            setPublicLibraryBooks((currentBooks) => currentBooks.map((candidate) => (
                isSamePublicDomainBook(candidate, localBook)
                    ? {
                        ...candidate,
                        uri,
                        downloaded: true,
                    }
                    : candidate
            )));

            return localBook;
        } catch (error) {
            console.warn('[Home] Failed to download public library book:', error?.message ?? error);
            setPublicLibraryDownloadStates((current) => ({
                ...current,
                [book.publicLibraryId]: false,
            }));
            Alert.alert(t('home.downloadFailedTitle'), t(getDownloadErrorMessageKey(error)));
            return null;
        } finally {
            downloadsInFlightRef.current.delete(bookKey);
            setDownloadingBookId((current) => (current === bookKey ? null : current));
        }
    }, [t]);

    const handlePublicDomainBookPress = useCallback(async (book) => {
        if (!book) {
            return;
        }

        const openedAt = new Date().toISOString();
        const localBook = isPublicLibraryBook(book)
            ? await downloadPublicLibraryBookToLocal(book, { lastOpenedAt: openedAt })
            : buildPublicDomainLocalBook(book, {
                lastOpenedAt: openedAt,
                downloaded: true,
            });

        if (!localBook?.uri) {
            return;
        }

        upsertPublicDomainBookInLibrary(localBook);
        setCurrentBook(localBook.uri);
        setPreprocessOnOpen(isPublicLibraryBook(localBook));
        navigation.navigate('Read', { returnTo: 'Home' });
    }, [
        downloadPublicLibraryBookToLocal,
        navigation,
        setCurrentBook,
        setPreprocessOnOpen,
        upsertPublicDomainBookInLibrary,
    ]);

    publicDomainBookPressRef.current = handlePublicDomainBookPress;

    const addPublicDomainBookToLibrary = useCallback(async (book) => {
        if (!book) {
            return null;
        }

        const localBook = isPublicLibraryBook(book)
            ? await downloadPublicLibraryBookToLocal(book)
            : buildPublicDomainLocalBook(book);

        if (!localBook?.uri) {
            return null;
        }

        // Add in place: the reader stays on the preview (the action flips to
        // "Remove") rather than being yanked over to the My Books tab, so they can
        // keep browsing the public-domain shelf.
        upsertPublicDomainBookInLibrary(localBook);
        return localBook;
    }, [downloadPublicLibraryBookToLocal, upsertPublicDomainBookInLibrary]);

    const handleBookPreviewPress = useCallback((book, index = 0) => {
        if (!book) {
            return;
        }

        if (activeBookMenuKey) {
            setActiveBookMenuKey(null);
            return;
        }

        setSelectedBookPreview({ book, index });
    }, [activeBookMenuKey]);

    // The daily goal card re-reads today's minutes each time Home is shown.
    const [homeFocusKey, setHomeFocusKey] = useState(0);
    useFocusEffect(useCallback(() => {
        setHomeFocusKey((value) => value + 1);
    }, []));

    // Set from the press until the reader takes over (or the open fails).
    const [openingBook, setOpeningBook] = useState(false);
    useFocusEffect(useCallback(() => () => setOpeningBook(false), []));
    const handleResumeFeaturedBook = useCallback(async (book) => {
        if (!book) {
            return;
        }

        setOpeningBook(true);
        try {
            if (book.publicDomain) {
                await handlePublicDomainBookPress(book);
            } else {
                handleBookPress(book);
            }
        } finally {
            // Still here (the open failed or was a download): let go.
            setTimeout(() => setOpeningBook(false), 800);
        }
    }, [handleBookPress, handlePublicDomainBookPress]);

    const handleReadPreviewBook = useCallback(() => {
        if (!selectedPreviewBook) {
            return;
        }

        setSelectedBookPreview(null);

        if (selectedPreviewBook.publicDomain) {
            handlePublicDomainBookPress(selectedPreviewBook);
            return;
        }

        handleBookPress(selectedPreviewBook);
    }, [handleBookPress, handlePublicDomainBookPress, selectedPreviewBook]);

    const handleAddPreviewBookToLibrary = useCallback(() => {
        if (!selectedPreviewBook?.publicDomain) {
            return;
        }

        addPublicDomainBookToLibrary(selectedPreviewBook);
    }, [addPublicDomainBookToLibrary, selectedPreviewBook]);

    const upsertPreviewBookPatch = useCallback((book, patch) => {
        if (!book) {
            return null;
        }

        const nextPatch = {
            ...patch,
            updatedAt: new Date().toISOString(),
        };

        if (book.publicDomain) {
            const localBook = buildPublicDomainLocalBook(book, nextPatch);
            setBooks((prevBooks) => {
                const exists = prevBooks.some((candidate) => isSamePublicDomainBook(candidate, localBook));
                if (exists) {
                    return prevBooks.map((candidate) => (
                        isSamePublicDomainBook(candidate, localBook)
                            ? {
                                ...localBook,
                                ...candidate,
                                ...nextPatch,
                                publicDomain: true,
                                downloaded: true,
                                format: localBook.format ?? candidate.format ?? 'epub',
                                publicLibrary: localBook.publicLibrary ?? candidate.publicLibrary ?? false,
                                publicLibraryId: localBook.publicLibraryId ?? candidate.publicLibraryId ?? null,
                                publicLibraryStoragePath: localBook.publicLibraryStoragePath ?? candidate.publicLibraryStoragePath ?? null,
                                storagePath: localBook.storagePath ?? candidate.storagePath ?? null,
                                coverColor: localBook.coverColor,
                                coverAccentColor: localBook.coverAccentColor,
                                coverBackgroundColor: localBook.coverBackgroundColor,
                            }
                            : candidate
                    ));
                }

                return [...prevBooks, localBook];
            });
            return localBook;
        }

        updateBookRecord(book, nextPatch);
        return { ...book, ...nextPatch };
    }, [setBooks, updateBookRecord]);

    const handleTogglePreviewFavorite = useCallback(() => {
        if (!selectedPreviewBook) {
            return;
        }

        const nextFavorite = !isBookFavorite(selectedPreviewBook);
        upsertPreviewBookPatch(selectedPreviewBook, {
            isFavorite: nextFavorite,
            favorite: nextFavorite,
        });
    }, [selectedPreviewBook, upsertPreviewBookPatch]);

    const handleDeleteBook = useCallback((bookToDelete) => {
        setActiveBookMenuKey(null);
        Alert.alert(
            t('home.removeBookTitle'),
            t('home.removeBookBody', { title: getBookTitle(bookToDelete, t) }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.remove'),
                    style: 'destructive',
                    onPress: async () => {
                        if (bookToDelete.cloudId && user?.id) {
                            try {
                                await softDeleteUserBook({
                                    user,
                                    ownerId: activeOwnerId,
                                    generation: syncGeneration,
                                    cloudBookId: bookToDelete.cloudId,
                                });
                            } catch (error) {
                                console.warn('[Home] Failed to soft-delete cloud book:', error);
                            }
                        }

                        if (bookToDelete.uri) {
                            try {
                                await deleteBookIndexEntries(bookToDelete.uri, { ownerId: activeOwnerId });
                            } catch (error) {
                                // Leave the book in the library so the user can retry.
                                console.warn('[Home] Failed to delete book index entries:', error?.message ?? error);
                                Alert.alert(t('home.removeBookFailedTitle'), t('home.removeBookFailedBody'));
                                return;
                            }
                        }

                        setBooks((prevBooks) => {
                            const remainingBooks = prevBooks.filter((book) => (
                                bookToDelete.cloudId
                                    ? book.cloudId !== bookToDelete.cloudId
                                    : book.uri !== bookToDelete.uri
                            ));

                            if (currentBook === bookToDelete.uri) {
                                setCurrentBook(remainingBooks[0]?.uri ?? null);
                                setPreprocessOnOpen(false);
                            }

                            return remainingBooks;
                        });
                        setSelectedBookPreview((current) => {
                            const previewBook = current?.book;
                            if (!previewBook) {
                                return current;
                            }

                            const matchesDeletedBook = bookToDelete.cloudId
                                ? previewBook.cloudId === bookToDelete.cloudId
                                : bookToDelete.publicDomain
                                    ? isSamePublicDomainBook(previewBook, bookToDelete)
                                    : previewBook.uri === bookToDelete.uri;

                            return matchesDeletedBook ? null : current;
                        });
                    },
                },
            ]
        );
    }, [activeOwnerId, currentBook, setBooks, setCurrentBook, setPreprocessOnOpen, syncGeneration, t, user]);

    const handleEditBook = useCallback((book) => {
        if (!book) {
            return;
        }

        setActiveBookMenuKey(null);
        setEditBook(book);
        setEditDraft({
            title: stripStoredPlaceholder(book.title),
            author: stripStoredPlaceholder(book.author),
            cover: book.cover || '',
        });
    }, []);

    const handleDeletePreviewBook = useCallback(() => {
        if (!selectedPreviewBook) {
            return;
        }

        const existsInLibrary = books.some((book) => (
            selectedPreviewBook.publicDomain
                ? isSamePublicDomainBook(book, selectedPreviewBook)
                : selectedPreviewBook.cloudId
                ? book.cloudId === selectedPreviewBook.cloudId
                : book.uri === selectedPreviewBook.uri
        ));

        if (selectedPreviewBook.publicDomain && !existsInLibrary) {
            Alert.alert(t('home.notInLibraryTitle'), t('home.notInLibraryBody'));
            return;
        }

        handleDeleteBook(selectedPreviewBook);
    }, [books, handleDeleteBook, selectedPreviewBook, t]);

    const handleEditPreviewBook = useCallback(async () => {
        if (!selectedPreviewBook) {
            return;
        }

        if (selectedPreviewBook.publicDomain) {
            const localBook = isPublicLibraryBook(selectedPreviewBook)
                ? await downloadPublicLibraryBookToLocal(selectedPreviewBook)
                : buildPublicDomainLocalBook(selectedPreviewBook);

            if (!localBook?.uri) {
                return;
            }

            upsertPublicDomainBookInLibrary(localBook);
            setSelectedBookPreview(null);
            handleEditBook(localBook);
            return;
        }

        setSelectedBookPreview(null);
        handleEditBook(selectedPreviewBook);
    }, [downloadPublicLibraryBookToLocal, handleEditBook, selectedPreviewBook, upsertPublicDomainBookInLibrary]);

    const handleResetBookToOriginal = useCallback(async (book) => {
        if (!book) {
            return;
        }

        setActiveBookMenuKey(null);

        const publicDomainOriginal = book.publicDomain
            ? publicDomainBooks.find((candidate) => isSamePublicDomainBook(candidate, book))
            : null;

        if (publicDomainOriginal) {
            updateBookRecord(book, {
                title: publicDomainOriginal.title,
                author: publicDomainOriginal.author,
                cover: publicDomainOriginal.cover ?? null,
                ...getPublicDomainBookCoverColors(publicDomainOriginal),
                originalTitle: publicDomainOriginal.title,
                originalAuthor: publicDomainOriginal.author,
                originalCover: publicDomainOriginal.cover ?? null,
            });
            return;
        }

        const hasStoredOriginal = !!book.originalTitle
            || !!book.originalAuthor
            || Object.prototype.hasOwnProperty.call(book, 'originalCover');

        if (hasStoredOriginal) {
            const cover = book.originalCover ?? null;
            const coverColors = cover
                ? await extractBookCoverColors({
                    coverUri: cover,
                    fallbackColor: book.coverAccentColor || book.coverColor,
                    cacheKey: `reset:${book.uri || book.id || book.cloudId || book.title}`,
                })
                : {
                    coverAccentColor: null,
                    coverBackgroundColor: null,
                };

            updateBookRecord(book, {
                title: stripStoredPlaceholder(book.originalTitle || book.title),
                author: stripStoredPlaceholder(book.originalAuthor || book.author),
                cover,
                ...coverColors,
            });
            return;
        }

        if (!isBookDownloaded(book) || !book.uri) {
            Alert.alert(t('home.resetUnavailableTitle'), t('home.resetUnavailableBody'));
            return;
        }

        try {
            const fallbackName = book.originalFilename || book.title || '';
            const metadata = isPdfBook(book)
                ? await readPdfMetadata(book.uri, fallbackName)
                : await readEpubMetadata(book.uri, fallbackName);
            // Missing values are stored empty; getBookTitle/getBookAuthor show the translated label.
            const title = String(metadata?.title || book.title || '').trim() || '';
            const author = String(metadata?.author || book.author || '').trim() || '';
            const cover = metadata?.cover ?? null;
            const coverColors = cover
                ? await extractBookCoverColors({
                    coverUri: cover,
                    fallbackColor: book.coverAccentColor || book.coverColor,
                    cacheKey: `metadata-reset:${book.uri || book.id || title}:${author}`,
                })
                : {
                    coverAccentColor: null,
                    coverBackgroundColor: null,
                };

            updateBookRecord(book, {
                title,
                author,
                cover,
                ...coverColors,
                originalTitle: title,
                originalAuthor: author,
                originalCover: cover,
                format: metadata?.format || book.format || 'epub',
            });
        } catch (error) {
            console.warn('[Home] Failed to reset book metadata:', error);
            Alert.alert(t('home.resetFailedTitle'), getUserFacingErrorMessage(error, t, 'home.resetFailedBody', language));
        }
    }, [language, publicDomainBooks, t, updateBookRecord]);

    const handlePickCover = useCallback(async () => {
        try {
            const { assets } = await DocumentPicker.getDocumentAsync({
                type: ['image/*'],
                copyToCacheDirectory: true,
            });

            if (!assets?.[0]?.uri) {
                return;
            }

            setEditDraft((prev) => ({ ...prev, cover: assets[0].uri }));
        } catch (error) {
            console.error('[Home] Failed to pick cover:', error);
        }
    }, []);

    const handleSaveBookEdit = useCallback(async () => {
        if (!editBook) {
            return;
        }

        const cover = editDraft.cover.trim() || null;
        const coverColors = cover
            ? await extractBookCoverColors({
                coverUri: cover,
                fallbackColor: editBook.coverAccentColor || editBook.coverColor,
                cacheKey: `edit:${editBook.uri || editBook.id || editBook.cloudId || editDraft.title}:${cover}`,
            })
            : {
                coverAccentColor: null,
                coverBackgroundColor: null,
            };

        const updatedAt = new Date().toISOString();
        const patch = {
            title: editDraft.title.trim(),
            author: editDraft.author.trim(),
            cover,
            ...coverColors,
            updatedAt,
        };

        updateBookRecord(editBook, patch);
        setEditBook(null);

        if (
            user?.id
            && activeOwnerId === user.id
            && editBook.cloudId
            && !syncPaused
            && isCurrentSyncGeneration(syncGeneration)
        ) {
            updateUserBookMetadata({
                user,
                ownerId: activeOwnerId,
                generation: syncGeneration,
                book: {
                    ...editBook,
                    ...patch,
                },
            }).catch((error) => {
                console.warn('[Home] Failed to sync edited book metadata:', error?.message ?? error);
            });
        }
    }, [
        activeOwnerId,
        editBook,
        editDraft.author,
        editDraft.cover,
        editDraft.title,
        syncGeneration,
        syncPaused,
        updateBookRecord,
        user,
        t,
    ]);

    const resetSongSearch = useCallback(() => {
        if (songSearchTimerRef.current) {
            clearTimeout(songSearchTimerRef.current);
            songSearchTimerRef.current = null;
        }
        songSearchRequestRef.current += 1;
        setSongSearch({ query: '', results: [], status: 'idle' });
    }, []);

    const handleSongSearchChange = useCallback((query) => {
        if (songSearchTimerRef.current) {
            clearTimeout(songSearchTimerRef.current);
            songSearchTimerRef.current = null;
        }
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            songSearchRequestRef.current += 1;
            setSongSearch({ query, results: [], status: 'idle' });
            return;
        }
        setSongSearch((prev) => ({ ...prev, query, status: 'loading' }));
        // Debounced: the lyrics provider rate-limits, and a keystroke is not a query.
        songSearchTimerRef.current = setTimeout(async () => {
            const requestId = ++songSearchRequestRef.current;
            try {
                const results = await searchSongs({ query: trimmed, language: targetLanguage });
                if (requestId !== songSearchRequestRef.current) return;
                setSongSearch((prev) => ({ ...prev, results, status: 'done' }));
            } catch (error) {
                if (requestId !== songSearchRequestRef.current) return;
                console.warn('[Home] song search failed:', error?.message ?? error);
                setSongSearch((prev) => ({ ...prev, results: [], status: 'error' }));
            }
        }, 600);
    }, [targetLanguage]);

    const handlePickSongSuggestion = useCallback((song) => {
        setSongDraft({
            title: String(song?.title || ''),
            artist: String(song?.artist || ''),
            lyrics: String(song?.lyrics || ''),
        });
        resetSongSearch();
    }, [resetSongSearch]);

    useEffect(() => () => {
        if (songSearchTimerRef.current) clearTimeout(songSearchTimerRef.current);
    }, []);

    const handleAddSong = useCallback(() => {
        setSongDraft(EMPTY_SONG_DRAFT);
        resetSongSearch();
        setShowAddSongModal(true);
    }, [resetSongSearch]);

    const songEditorCanSave = songDraft.title.trim().length > 0 && songDraft.lyrics.trim().length > 0;

    const handleCancelSongAdd = useCallback(() => {
        setShowAddSongModal(false);
        setSongDraft(EMPTY_SONG_DRAFT);
        resetSongSearch();
    }, [resetSongSearch]);

    const handleSubmitSong = useCallback(() => {
        const title = songDraft.title.trim();
        const artist = songDraft.artist.trim();
        const lyrics = songDraft.lyrics.trim();

        if (!title || !lyrics) {
            Alert.alert(t('home.missingSongTitle'), t('home.missingSongBody'));
            return;
        }

        const nextSong = {
            id: `song-${Date.now()}`,
            source: 'manual',
            title,
            artist,
            lyrics,
            lines: countSongLines(lyrics),
            fontSize: DEFAULT_SONG_FONT_SIZE,
            savedTerms: [],
            language: targetLanguage,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const nextSongs = [nextSong, ...songs];
        try {
            serializeSongsForStorage(nextSongs);
        } catch (error) {
            if (isSongStorageLimitError(error)) {
                showSongStorageLimitAlert(error, t);
                return;
            }
            throw error;
        }

        setSongs(nextSongs);
        syncSongToCloud(nextSong);
        setShowAddSongModal(false);
        setSongDraft(EMPTY_SONG_DRAFT);
        setActiveLibraryTab('Songs');
    }, [songDraft.artist, songDraft.lyrics, songDraft.title, songs, syncSongToCloud, targetLanguage, t]);

    const handleUpdateSong = useCallback((songId, patch) => {
        const currentSong = songs.find((song) => song.id === songId);
        if (!currentSong) {
            return;
        }

        const nextSong = {
            ...currentSong,
            ...patch,
            language: normalizeBookLanguage(patch.language ?? currentSong.language ?? targetLanguage),
            lines: patch.lyrics !== undefined ? countSongLines(patch.lyrics) : currentSong.lines,
            updatedAt: new Date().toISOString(),
        };
        const updatedSong = normalizeStoredSong(nextSong, targetLanguage) ?? currentSong;
        const nextSongs = songs.map((song) => (
            song.id === songId ? updatedSong : song
        ));

        try {
            serializeSongsForStorage(nextSongs);
        } catch (error) {
            if (isSongStorageLimitError(error)) {
                showSongStorageLimitAlert(error, t);
                return;
            }
            throw error;
        }

        setSongs(nextSongs);
        syncSongToCloud(updatedSong);
    }, [songs, syncSongToCloud, targetLanguage, t]);

    const handleDeleteSong = useCallback((songId) => {
        setSongs((previous) => previous.filter((song) => song.id !== songId));
        setSelectedSongId(null);

        if (
            !user?.id
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            return;
        }

        try {
            assertCanUploadForOwner({ ownerId: activeOwnerId, user });
        } catch (error) {
            console.warn('[Home] Refusing song delete sync:', error?.message ?? error);
            return;
        }

        softDeleteUserSong({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
            songId,
            targetLanguage,
        }).catch((error) => {
            console.warn('[Home] Failed to delete cloud song:', error?.message ?? error);
        });
    }, [activeOwnerId, syncGeneration, syncPaused, targetLanguage, user]);

    const handleSelectedSongSavedTermsChange = useCallback((savedTerms) => {
        if (!selectedSong) {
            return;
        }

        const nextSongs = songs.map((song) => (
            song.id === selectedSong.id
                ? { ...song, savedTerms }
                : song
        ));

        try {
            serializeSongsForStorage(nextSongs);
        } catch (error) {
            if (isSongStorageLimitError(error)) {
                showSongStorageLimitAlert(error, t);
                return;
            }
            throw error;
        }

        setSongs(nextSongs);
    }, [selectedSong, songs, t]);

    const getCollectionBookMeta = useCallback((book, sourceLabel) => {
        const parts = [
            formatBookLanguage(book?.language || targetLanguage, t),
            localizedLevelLabel(book?.language || targetLanguage, book?.difficulty, interfaceLanguage),
            formatWordCount(getBookWordCount(book), t),
            sourceLabel,
        ];

        return parts.filter(Boolean).join(' · ');
    }, [interfaceLanguage, targetLanguage, t]);

    const renderCollectionEmptyState = ({
        icon,
        title,
        body,
        primaryLabel,
        primaryIcon,
        onPrimaryPress,
        secondaryLabel,
        onSecondaryPress,
    }) => (
        <View style={styles.collectionEmptyState}>
            <View style={styles.collectionEmptyIcon}>
                <Feather name={icon} size={22} color={HOME_COLORS.sub} />
            </View>
            <Text style={styles.collectionEmptyTitle}>{title}</Text>
            <Text style={styles.collectionEmptyCopy}>{body}</Text>
            <View style={styles.collectionEmptyActions}>
                {primaryLabel ? (
                    <TouchableOpacity
                        activeOpacity={Motion.pressedOpacity}
                        onPress={onPrimaryPress}
                        style={styles.collectionEmptyPrimary}
                    >
                        {primaryIcon ? <Feather name={primaryIcon} size={18} color={HOME_COLORS.onAccent} /> : null}
                        <Text style={styles.collectionEmptyPrimaryText}>{primaryLabel}</Text>
                    </TouchableOpacity>
                ) : null}
                {secondaryLabel ? (
                    <TouchableOpacity
                        activeOpacity={Motion.pressedOpacity}
                        onPress={onSecondaryPress}
                        style={styles.collectionEmptySecondary}
                    >
                        <Text style={styles.collectionEmptySecondaryText}>{secondaryLabel}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        </View>
    );

    // Empty "My Books" with a bundled book to suggest: a one-tap "Start reading"
    // card (adds the book to the shelf and opens it, exactly like Read on the
    // public-domain preview), with Import / Browse kept as secondary actions.
    const renderStarterBookCard = (book) => {
        const title = getBookTitle(book, t);
        const author = getBookAuthor(book, t);
        const localizedTitle = localizePublicDomainBook(book, interfaceLanguage)?.titleTranslation;
        const translatedTitle = typeof localizedTitle === 'string' ? localizedTitle.trim() : '';
        const wordCount = getBookWordCount(book);
        const meta = [
            wordCount ? formatWordCount(wordCount, t) : null,
            t('home.publicDomain'),
        ].filter(Boolean).join(' · ');
        const openStarterBook = () => handlePublicDomainBookPress(book);

        return (
            <View style={styles.starterWrap}>
                <View style={styles.starterCard}>
                    <Text style={styles.collectionEyebrow}>{t('home.starterEyebrow')}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('home.starterPreviewA11y', { title, author })}
                        onPress={() => handleBookPreviewPress(book, 0)}
                        style={({ pressed }) => [styles.starterBookRow, pressed && styles.pressed]}
                    >
                        <Book3D
                            width={66}
                            height={96}
                            radius={2}
                        >
                            <BookCover
                                book={book}
                                width={66}
                                height={96}
                                style={styles.bookRowCover}
                                titleStyle={styles.bookRowCoverText}
                            />
                        </Book3D>
                        <View style={styles.bookRowCopy}>
                            <Text
                                style={[styles.starterTitle, getSerifFontForText(title)]}
                                numberOfLines={2}
                            >
                                {title}
                            </Text>
                            {translatedTitle && translatedTitle !== title ? (
                                <Text style={styles.starterTranslatedTitle} numberOfLines={1}>
                                    {translatedTitle}
                                </Text>
                            ) : null}
                            <Text
                                style={[styles.bookRowAuthor, hasKoreanText(author) && styles.koreanInlineText]}
                                numberOfLines={1}
                            >
                                {author}
                            </Text>
                            {meta ? (
                                <Text style={styles.bookRowMeta} numberOfLines={1}>
                                    {meta}
                                </Text>
                            ) : null}
                        </View>
                    </Pressable>
                    <Text style={styles.starterCopy}>{t('home.starterBody')}</Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={t('home.starterStartA11y', { title })}
                        activeOpacity={Motion.pressedOpacity}
                        onPress={openStarterBook}
                        style={styles.starterPrimary}
                    >
                        <Feather name="book-open" size={18} color={HOME_COLORS.onAccent} />
                        <Text style={styles.collectionEmptyPrimaryText}>{t('home.startReading')}</Text>
                    </TouchableOpacity>
                    <View style={styles.starterSecondaryActions}>
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={Motion.pressedOpacity}
                            onPress={confirmAddBook}
                            style={styles.starterSecondary}
                        >
                            <Text
                                style={styles.starterSecondaryText}
                                numberOfLines={1}
                                // Two half-width buttons: longer languages shrink to fit.
                                adjustsFontSizeToFit
                                minimumFontScale={0.75}
                            >
                                {t('home.importEpub')}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={Motion.pressedOpacity}
                            onPress={() => {
                                setActiveLibraryTab('Books');
                                setActiveBookFilter('public-domain');
                            }}
                            style={styles.starterSecondary}
                        >
                            <Text style={styles.starterSecondaryText} numberOfLines={1}>{t('home.browse')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        );
    };

    const renderBookGrid = (items, style = null) => (
        <View style={[styles.bookGrid, style]}>
            {items.map((book, index) => {
                const bookKey = getBookKey(book, `${index}`);
                const isDownloadingBook = downloadingBookId === bookKey;

                return (
                    <Pressable
                        key={book.uri || book.id || book.publicLibraryId || `${book.title}-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${getBookTitle(book, t)}, ${getBookAuthor(book, t)}`}
                        onPress={() => handleBookPreviewPress(book, index)}
                        style={({ pressed }) => [
                            styles.bookTile,
                            { width: bookTileWidth },
                            pressed && styles.pressed,
                        ]}
                    >
                        <View style={styles.bookCoverContainer}>
                            <Book3D
                                width={bookTileWidth}
                                height={bookCoverHeight}
                                radius={2}
                            >
                                <BookCover
                                    book={book}
                                    width={bookTileWidth}
                                    height={bookCoverHeight}
                                    style={styles.bookCover}
                                    titleStyle={styles.bookCoverText}
                                />
                            </Book3D>
                            {!isBookDownloaded(book) || isDownloadingBook ? (
                                <View style={styles.bookGridDownloadBadge}>
                                    {isDownloadingBook ? (
                                        <ActivityIndicator size="small" color={HOME_COLORS.accent} />
                                    ) : (
                                        <Feather name="download" size={11} color={HOME_COLORS.accent} />
                                    )}
                                </View>
                            ) : null}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );

    const renderBookRows = (items, sourceLabel) => (
        <View style={styles.bookRows}>
            {items.map((book, index) => {
                const bookKey = getBookKey(book, `${index}`);
                const isDownloadingBook = downloadingBookId === bookKey;

                return (
                    <Pressable
                        key={book.uri || book.id || book.publicLibraryId || `${book.title}-${index}`}
                        accessibilityRole="button"
                        onPress={() => handleBookPreviewPress(book, index)}
                        style={({ pressed }) => [
                            styles.bookRow,
                            index === items.length - 1 && styles.bookRowLast,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Book3D
                            width={52}
                            height={76}
                            radius={2}
                        >
                            <BookCover
                                book={book}
                                width={52}
                                height={76}
                                style={styles.bookRowCover}
                                titleStyle={styles.bookRowCoverText}
                            />
                        </Book3D>
                        <View style={styles.bookRowCopy}>
                            <View style={styles.bookRowTitleLine}>
                                <Text
                                    style={[
                                        styles.bookRowTitle,
                                        getSerifFontForText(getBookTitle(book, t)),
                                    ]}
                                    numberOfLines={1}
                                >
                                    {getBookTitle(book, t)}
                                </Text>
                                {isPdfBook(book) ? (
                                    <View style={styles.inlineBadge}>
                                        <Text style={styles.inlineBadgeText}>PDF</Text>
                                    </View>
                                ) : null}
                            </View>
                            <Text
                                style={[
                                    styles.bookRowAuthor,
                                    hasKoreanText(getBookAuthor(book, t)) && styles.koreanInlineText,
                                ]}
                                numberOfLines={1}
                            >
                                {getBookAuthor(book, t)}
                            </Text>
                            <Text style={styles.bookRowMeta} numberOfLines={1}>
                                {isDownloadingBook ? t('home.downloading') : getCollectionBookMeta(book, sourceLabel)}
                            </Text>
                        </View>
                        <Feather name="chevron-right" size={16} color={HOME_COLORS.faint} />
                    </Pressable>
                );
            })}
        </View>
    );

    if (selectedSong) {
        return (
            <HomeThemeContext.Provider value={homeThemeValue}>
                <SongReader
                    song={selectedSong}
                    onClose={() => setSelectedSongId(null)}
                    onSongUpdate={(patch) => handleUpdateSong(selectedSong.id, patch)}
                    onSongDelete={() => handleDeleteSong(selectedSong.id)}
                    onSavedTermsChange={handleSelectedSongSavedTermsChange}
                />
            </HomeThemeContext.Provider>
        );
    }

    if (selectedPreviewBook) {
        const previewKey = getBookKey(selectedPreviewBook, `${selectedBookPreview?.index ?? 0}`);
        const previewUri = selectedPreviewBook.uri;
        const previewPublicDownloadState = selectedPreviewBook.publicLibraryId
            ? publicLibraryDownloadStates[selectedPreviewBook.publicLibraryId]
            : null;
        const previewDownloadInProgress = previewPublicDownloadState === 'downloading'
            || typeof previewPublicDownloadState === 'number';
        const previewActionBusy = (
            (!isBookDownloaded(selectedPreviewBook) && downloadingBookId === previewKey)
            || previewDownloadInProgress
            || (!!previewUri && openingBookUri === previewUri)
        );

        return (
            <HomeThemeContext.Provider value={homeThemeValue}>
                <BookPreview
                    book={selectedPreviewBook}
                    actionBusy={previewActionBusy}
                    downloadProgress={typeof previewPublicDownloadState === 'number' ? previewPublicDownloadState : null}
                    isInLibrary={previewInLibrary}
                    readingEase={previewReadingEase}
                    latestNote={previewNote}
                    onBack={() => setSelectedBookPreview(null)}
                    onRead={handleReadPreviewBook}
                    onAddToLibrary={handleAddPreviewBookToLibrary}
                    onToggleFavorite={handleTogglePreviewFavorite}
                    onDelete={handleDeletePreviewBook}
                    onEdit={handleEditPreviewBook}
                />
            </HomeThemeContext.Provider>
        );
    }

    return (
        <HomeThemeContext.Provider value={homeThemeValue}>
        <Screen backgroundColor={HOME_COLORS.bg} contentContainerStyle={styles.screenFrame}>
            <ScrollView
                contentContainerStyle={styles.screenContent}
                showsVerticalScrollIndicator={false}
            >
            <Pressable
                accessible={false}
                disabled={!activeBookMenuKey}
                onPress={() => setActiveBookMenuKey(null)}
                style={styles.stack}
            >
                <View style={styles.appTopBar}>
                    <TouchableOpacity
                        ref={ocrButtonRef}
                        activeOpacity={0.84}
                        accessibilityRole="switch"
                        accessibilityLabel={isFloatingOcrActive ? t('home.turnOcrOff') : t('home.turnOcrOn')}
                        accessibilityState={{ checked: isFloatingOcrActive, busy: ocrBusy }}
                        disabled={ocrBusy}
                        onPress={() => {
                            if (tipId === TIP_IDS.homeOcr) closeTip(TIP_IDS.homeOcr);
                            handleFloatingOcrToggle();
                        }}
                        style={styles.appTopIconButton}
                    >
                        {ocrBusy ? (
                            <ActivityIndicator size="small" color={HOME_COLORS.accent} />
                        ) : (
                            <MaterialCommunityIcons
                                name={isFloatingOcrActive ? 'close' : 'line-scan'}
                                size={22}
                                color={HOME_COLORS.accent}
                            />
                        )}
                    </TouchableOpacity>
                    <Text style={styles.appTopTitle} accessibilityRole="header">Noeul</Text>
                    <TouchableOpacity
                        activeOpacity={0.84}
                        accessibilityRole="button"
                        accessibilityLabel={t('tabs.profile')}
                        onPress={() => navigation?.navigate?.('Profile')}
                        style={styles.appTopIconButton}
                    >
                        <ProfileAvatar user={user} size={34} />
                    </TouchableOpacity>
                </View>
                {ocrMessage ? (
                    <Text
                        accessibilityLiveRegion="polite"
                        numberOfLines={2}
                        style={styles.ocrStatusText}
                    >
                        {ocrMessage}
                    </Text>
                ) : null}

                {featuredBooks.length > 0 ? (
                    <View style={styles.todayGoal}>
                        <TodayGoalCard
                            ownerId={activeOwnerId}
                            refreshKey={homeFocusKey}
                            onStart={() => handleResumeFeaturedBook(featuredBooks[0])}
                        />
                    </View>
                ) : null}

                {featuredBooks.length > 0 ? (
                    <FeaturedBookCarousel
                        key={getBookKey(featuredBooks[0], 'featured')}
                        books={featuredBooks}
                        screenWidth={width}
                        onResumeBook={handleResumeFeaturedBook}
                        opening={openingBook}
                        onPressBook={handleBookPreviewPress}
                    />
                ) : null}

                <View style={styles.libraryControls}>
                    <View style={styles.libraryHeader}>
                        <Text style={styles.libraryTitle} accessibilityRole="header">{t('home.yourShelf')}</Text>
                        <View style={styles.collectionViewIcons}>
                            {activeLibraryTab === 'Books' ? (
                                <>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={t('home.gridView')}
                                        accessibilityState={{ selected: effectiveCollectionViewMode === 'grid' }}
                                        activeOpacity={Motion.pressedOpacity}
                                        onPress={() => setCollectionViewMode('grid')}
                                        style={styles.collectionViewButton}
                                    >
                                        <Feather
                                            name="grid"
                                            size={18}
                                            color={effectiveCollectionViewMode === 'grid' ? HOME_COLORS.accent : HOME_COLORS.faint}
                                        />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={t('home.listView')}
                                        accessibilityState={{ selected: effectiveCollectionViewMode === 'list' }}
                                        activeOpacity={Motion.pressedOpacity}
                                        onPress={() => setCollectionViewMode('list')}
                                        style={styles.collectionViewButton}
                                    >
                                        <Feather
                                            name="list"
                                            size={18}
                                            color={effectiveCollectionViewMode === 'list' ? HOME_COLORS.accent : HOME_COLORS.faint}
                                        />
                                    </TouchableOpacity>
                                </>
                            ) : null}
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={activeLibraryTab === 'Songs' ? t('home.writeSong') : t('home.importBookAction')}
                                activeOpacity={Motion.pressedOpacity}
                                onPress={() => {
                                    if (activeLibraryTab === 'Songs') {
                                        handleAddSong();
                                    } else {
                                        confirmAddBook();
                                    }
                                }}
                                style={styles.collectionViewButton}
                            >
                                <Feather
                                    name="plus"
                                    size={20}
                                    color={HOME_COLORS.accent}
                                />
                            </TouchableOpacity>
                        </View>
                    </View>
                    <ShelfTabs
                        activeId={activeLibraryTab === 'Songs'
                            ? 'songs'
                            : activeBookFilter === 'public-domain' ? 'public-domain' : 'mine'}
                        tabs={[
                            {
                                id: 'mine',
                                label: t('home.myBooks'),
                                onPress: () => {
                                    setActiveBookMenuKey(null);
                                    setActiveLibraryTab('Books');
                                    setActiveBookFilter('all');
                                },
                            },
                            {
                                id: 'public-domain',
                                label: t('home.publicDomain'),
                                onPress: () => {
                                    setActiveBookMenuKey(null);
                                    setActiveLibraryTab('Books');
                                    setActiveBookFilter('public-domain');
                                },
                            },
                            {
                                id: 'songs',
                                label: t('home.songs'),
                                onPress: () => {
                                    setActiveBookMenuKey(null);
                                    setActiveLibraryTab('Songs');
                                    setCollectionViewMode('grid');
                                },
                            },
                        ]}
                    />
                </View>

            {activeLibraryTab === 'Books' ? (
                <View style={styles.booksSection}>
                    <View style={styles.bookFilterRowHidden}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.bookFilterRow}
                    >
                        {BOOK_FILTERS.map((filter) => {
                            const isActive = activeBookFilter === filter.id;
                            const count = bookFilterCounts[filter.id] ?? 0;

                            return (
                                <TouchableOpacity
                                    key={filter.id}
                                    activeOpacity={0.84}
                                    onPress={() => {
                                        setActiveBookMenuKey(null);
                                        setActiveBookFilter(filter.id);
                                    }}
                                    accessibilityLabel={t('home.filterWithCount', {
                                        filter: t(filter.labelKey),
                                        books: formatBookCount(t, 'home.bookCount', count),
                                    })}
                                    style={[
                                        styles.bookFilterChip,
                                        filter.iconOnly && styles.bookFilterIconChip,
                                        isActive && styles.bookFilterChipActive,
                                    ]}
                                >
                                    {filter.iconOnly ? (
                                        <Ionicons
                                            name={isActive ? 'star' : 'star-outline'}
                                            size={17}
                                            color={isActive ? HOME_COLORS.bg : HOME_COLORS.accent}
                                        />
                                    ) : (
                                        <Text style={[
                                            styles.bookFilterChipText,
                                            isActive && styles.bookFilterChipTextActive,
                                        ]}>
                                            {t(filter.labelKey)}
                                        </Text>
                                    )}
                                    <Text style={[
                                        styles.bookFilterChipCount,
                                        isActive && styles.bookFilterChipCountActive,
                                    ]}>
                                        {count}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                    </View>

                    {!showingPublicDomainBooks ? (
                        <>
                            {filteredLibraryBooks.length === 0 && activeBookFilter !== 'favorites' && starterBook ? (
                                renderStarterBookCard(starterBook)
                            ) : filteredLibraryBooks.length === 0 && activeBookFilter !== 'favorites' && starterBookPending ? (
                                <View style={styles.collectionEmptyState} />
                            ) : filteredLibraryBooks.length === 0 ? (
                                renderCollectionEmptyState({
                                    icon: activeBookFilter === 'favorites' ? 'star' : 'book-open',
                                    title: activeBookFilter === 'favorites' ? t('home.noFavoritesTitle') : t('home.shelfEmptyTitle'),
                                    body: activeBookFilter === 'favorites'
                                        ? t('home.noFavoritesBody')
                                        : t('home.shelfEmptyBody'),
                                    primaryLabel: activeBookFilter === 'favorites' ? null : t('home.importEpub'),
                                    primaryIcon: activeBookFilter === 'favorites' ? null : 'file-plus',
                                    onPrimaryPress: confirmAddBook,
                                    secondaryLabel: activeBookFilter === 'favorites' ? null : t('home.browse'),
                                    onSecondaryPress: () => {
                                        setActiveLibraryTab('Books');
                                        setActiveBookFilter('public-domain');
                                    },
                                })
                            ) : (
                                effectiveCollectionViewMode === 'grid'
                                    ? renderBookGrid(filteredLibraryBooks)
                                    : renderBookRows(filteredLibraryBooks, t('home.onDevice'))
                            )}
                        </>
                    ) : showingPublicDomainBooks ? (
                        <>
                            {publicLibraryLoading ? (
                                <View style={styles.emptyBooksPanel}>
                                    <ActivityIndicator size="small" color={HOME_COLORS.accent} />
                                    <Text style={styles.emptyBooksCopy}>{t('home.loadingPublicLibrary')}</Text>
                                    <View style={styles.publicLibraryDiagnostics}>
                                        {getPublicLibraryDiagnosticLines(publicLibraryDiagnostics, t).map((line) => (
                                            <Text key={line} style={styles.publicLibraryDiagnosticText}>
                                                {line}
                                            </Text>
                                        ))}
                                    </View>
                                </View>
                            ) : publicLibraryError ? (
                                <View style={styles.emptyBooksPanel}>
                                    <Text style={styles.emptyBooksTitle}>{t('home.publicLibraryUnavailableTitle')}</Text>
                                    <Text style={styles.emptyBooksCopy}>{t('home.publicLibraryUnavailableBody')}</Text>
                                    <View style={styles.publicLibraryDiagnostics}>
                                        {getPublicLibraryDiagnosticLines(publicLibraryDiagnostics, t).map((line) => (
                                            <Text key={line} style={styles.publicLibraryDiagnosticText}>
                                                {line}
                                            </Text>
                                        ))}
                                    </View>
                                </View>
                            ) : sortedPublicDomainBookRows.length === 0 ? (
                                renderCollectionEmptyState({
                                    icon: 'search',
                                    title: t('home.noMatchesTitle'),
                                    body: t('home.noMatchesBody'),
                                    primaryLabel: t('home.clearFilters'),
                                    primaryIcon: 'rotate-ccw',
                                    onPrimaryPress: () => {
                                        setActivePublicDomainSort('ease');
                                        setPublicDomainSortDirection('asc');
                                    },
                                })
                            ) : publicDomainEaseSections ? (
                                publicDomainEaseSections.map((section) => (
                                    <View key={section.key} style={styles.easeSection}>
                                        <View style={styles.easeSectionHeader}>
                                            <Text style={styles.easeSectionTitle}>{section.title}</Text>
                                            <Text style={styles.easeSectionCount}>{formatNumber(section.books.length)}</Text>
                                        </View>
                                        {effectiveCollectionViewMode === 'grid'
                                            ? renderBookGrid(section.books, styles.bookGridInSection)
                                            : renderBookRows(section.books, t('home.publicDomain'))}
                                    </View>
                                ))
                            ) : (
                                effectiveCollectionViewMode === 'grid'
                                    ? renderBookGrid(sortedPublicDomainBookRows)
                                    : renderBookRows(sortedPublicDomainBookRows, t('home.publicDomain'))
                            )}
                        </>
                    ) : null}
                </View>
            ) : (
                <View style={styles.songsPanel}>
                    {songsLoaded && songs.length === 0 ? (
                        renderCollectionEmptyState({
                            icon: 'music',
                            title: t('home.noSongsYet'),
                            body: t('home.noSongsBody'),
                            primaryLabel: t('home.writeSong'),
                            onPrimaryPress: handleAddSong,
                        })
                    ) : (
                        <View style={styles.songList}>
                            {!songsLoaded ? (
                                <View style={styles.emptySongs}>
                                    <ActivityIndicator size="small" color={HOME_COLORS.accent} />
                                    <Text style={styles.emptySongsText}>{t('home.loadingSongs')}</Text>
                                </View>
                            ) : (
                                songs.map((song, index) => (
                                    <Pressable
                                        key={song.id}
                                        onPress={() => setSelectedSongId(song.id)}
                                        style={({ pressed }) => [
                                            styles.songRow,
                                            index === songs.length - 1 && styles.songRowLast,
                                            pressed && styles.songRowPressed,
                                        ]}
                                    >
                                        <View style={styles.songTile}>
                                            <Text style={[styles.songTileText, getSerifFontForText(song.title)]} numberOfLines={1}>
                                                {String(song.title || '').trim().charAt(0) || '♪'}
                                            </Text>
                                        </View>
                                        <View style={styles.songCopy}>
                                            <Text
                                                style={[
                                                    styles.songTitle,
                                                    getSerifFontForText(song.title),
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {localizeStoredPlaceholder(song.title, t)}
                                            </Text>
                                            <Text style={styles.songMeta} numberOfLines={1}>
                                                {[localizeStoredPlaceholder(song.artist, t), formatSongWordCount(song, t)].filter(Boolean).join(' · ')}
                                            </Text>
                                        </View>
                                        <Feather name="chevron-right" size={20} color={HOME_COLORS.faint} />
                                    </Pressable>
                                ))
                            )}
                        </View>
                    )}
                </View>
            )}
                {!!openingBookUri && (
                    <View style={styles.loadingOverlay}>
                        <ActivityIndicator size="small" color={HOME_COLORS.accent} />
                        <Text style={styles.loadingText}>{t('home.openingBook')}</Text>
                    </View>
                )}
            </Pressable>
            </ScrollView>

            <Modal visible={!!pdfCoverPrompt} animationType="fade" transparent onRequestClose={choosePdfCoverDefault}>
                <View style={styles.modalBackdrop}>
                    <TouchableWithoutFeedback>
                        <View style={styles.pdfCoverModal}>
                            <Text style={styles.editTitle}>{t('home.pdfCover')}</Text>
                            <Text style={styles.pdfCoverCopy}>
                                {pdfCoverPrompt?.pageCount
                                    ? t('home.pdfPageCount', {
                                        title: pdfCoverPrompt.title,
                                        count: pdfCoverPrompt.pageCount,
                                    })
                                    : t('home.pdfReady', {
                                        title: pdfCoverPrompt?.title || 'PDF',
                                    })}
                            </Text>

                            <IconButton
                                tone="accent"
                                label={t('home.useFirstPage')}
                                onPress={choosePdfCoverDefault}
                                icon={<Feather name="image" size={15} color={colors.accentStrong} />}
                                style={styles.pdfCoverDefaultButton}
                            />

                            <Text style={styles.editLabel}>{t('home.specificPage')}</Text>
                            <TextInput
                                value={pdfCoverPageInput}
                                onChangeText={setPdfCoverPageInput}
                                onSubmitEditing={choosePdfCoverCustom}
                                style={styles.editInput}
                                placeholder="1"
                                placeholderTextColor={colors.textSubtle}
                                keyboardType="number-pad"
                                inputMode="numeric"
                                returnKeyType="done"
                                selectTextOnFocus
                            />

                            <View style={styles.pdfCoverActions}>
                                <IconButton
                                    label={t('home.noCover')}
                                    onPress={choosePdfCoverNone}
                                    icon={<Feather name="slash" size={15} color={colors.text} />}
                                    style={styles.pdfCoverActionButton}
                                />
                                <IconButton
                                    label={t('home.usePage')}
                                    onPress={choosePdfCoverCustom}
                                    icon={<Feather name="hash" size={15} color={colors.text} />}
                                    style={styles.pdfCoverActionButton}
                                />
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </Modal>

            <Modal visible={!!editBook} animationType="fade" transparent onRequestClose={() => setEditBook(null)}>
                <TouchableWithoutFeedback onPress={() => setEditBook(null)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.editModal}>
                                <Text style={styles.editTitle}>{t('home.editBook')}</Text>

                                <Text style={styles.editLabel}>{t('common.title')}</Text>
                                <TextInput
                                    value={editDraft.title}
                                    onChangeText={(title) => setEditDraft((prev) => ({ ...prev, title }))}
                                    style={styles.editInput}
                                    placeholder={t('common.untitled')}
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>{t('common.author')}</Text>
                                <TextInput
                                    value={editDraft.author}
                                    onChangeText={(author) => setEditDraft((prev) => ({ ...prev, author }))}
                                    style={styles.editInput}
                                    placeholder={t('common.unknownAuthor')}
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>{t('common.cover')}</Text>
                                <View style={styles.coverRow}>
                                    <EditCoverPreview
                                        book={{
                                            ...editBook,
                                            title: editDraft.title,
                                            author: editDraft.author,
                                            cover: null,
                                        }}
                                        cover={editDraft.cover}
                                    />
                                    <View style={styles.coverActions}>
                                        <IconButton
                                            label={t('home.changeCover')}
                                            onPress={handlePickCover}
                                            icon={<Feather name="image" size={15} color={colors.text} />}
                                        />
                                        <IconButton
                                            label={t('home.removeCover')}
                                            onPress={() => setEditDraft((prev) => ({ ...prev, cover: '' }))}
                                            icon={<Feather name="trash-2" size={15} color={colors.danger} />}
                                        />
                                    </View>
                                </View>

                                <View style={styles.modalActions}>
                                    <IconButton label={t('common.cancel')} onPress={() => setEditBook(null)} />
                                    <IconButton
                                        tone="accent"
                                        label={t('common.save')}
                                        onPress={handleSaveBookEdit}
                                        icon={<Feather name="check" size={15} color={colors.accentStrong} />}
                                    />
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showAddSongModal}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={handleCancelSongAdd}
            >
                <View style={[styles.songEditorScreen, { paddingTop: safeAreaInsets.top }]}>
                    <View style={styles.songEditorHeader}>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={t('common.cancel')}
                            activeOpacity={Motion.pressedOpacity}
                            onPress={handleCancelSongAdd}
                            style={styles.songEditorClose}
                        >
                            <Feather name="x" size={22} color={HOME_COLORS.accent} />
                        </TouchableOpacity>
                        <Text style={styles.songEditorTitle} accessibilityRole="header" numberOfLines={1}>
                            {t('home.writeSong')}
                        </Text>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !songEditorCanSave }}
                            activeOpacity={Motion.pressedOpacity}
                            onPress={handleSubmitSong}
                            disabled={!songEditorCanSave}
                            style={[
                                styles.songEditorSaveButton,
                                !songEditorCanSave && styles.songEditorSaveButtonDisabled,
                            ]}
                        >
                            <Text style={styles.songEditorSaveText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                    </View>

                    <KeyboardAvoidingView
                        style={styles.songEditorBody}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        keyboardVerticalOffset={safeAreaInsets.top}
                    >
                        <View style={styles.songSearchRow}>
                            <Feather name="search" size={18} color={HOME_COLORS.tertiary} />
                            <TextInput
                                value={songSearch.query}
                                onChangeText={handleSongSearchChange}
                                style={styles.songSearchInput}
                                placeholder={t('home.songSearchPlaceholder')}
                                placeholderTextColor={HOME_COLORS.faint}
                                accessibilityLabel={t('home.songSearchPlaceholder')}
                                returnKeyType="search"
                                autoCorrect={false}
                                multiline={false}
                                numberOfLines={1}
                            />
                            {songSearch.status === 'loading' ? (
                                <ActivityIndicator size="small" color={HOME_COLORS.secondary} />
                            ) : null}
                        </View>
                        {songSearch.status === 'done' && songSearch.results.length > 0 ? (
                            <ScrollView
                                style={styles.songSearchResults}
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                            >
                                {songSearch.results.map((song, index) => (
                                    <TouchableOpacity
                                        key={song.id}
                                        style={[
                                            styles.songSearchResult,
                                            index === songSearch.results.length - 1 && styles.songSearchResultLast,
                                        ]}
                                        onPress={() => handlePickSongSuggestion(song)}
                                        activeOpacity={Motion.pressedOpacity}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('home.songSearchUse')}
                                    >
                                        <Text style={styles.songSearchResultTitle} numberOfLines={1}>{song.title}</Text>
                                        <Text style={styles.songSearchResultMeta} numberOfLines={1}>
                                            {[localizeStoredPlaceholder(song.artist, t), song.album].filter(Boolean).join(' · ')}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        ) : null}
                        {songSearch.status === 'done' && songSearch.results.length === 0 ? (
                            <Text style={styles.songSearchNotice}>{t('home.songSearchEmpty')}</Text>
                        ) : null}
                        {songSearch.status === 'error' ? (
                            <Text style={styles.songSearchNotice}>{t('home.songSearchFailed')}</Text>
                        ) : null}

                        <View style={styles.songEditorDividerRow}>
                            <View style={styles.songEditorDividerLine} />
                            <Text style={styles.songEditorDividerText}>{t('home.songEnterYourself')}</Text>
                            <View style={styles.songEditorDividerLine} />
                        </View>

                        <View style={styles.songEditorField}>
                            <Text style={styles.songEditorLabel}>{t('common.title')}</Text>
                            <TextInput
                                value={songDraft.title}
                                onChangeText={(title) => setSongDraft((prev) => ({ ...prev, title }))}
                                style={styles.songEditorInput}
                                placeholder={t('home.songTitlePlaceholder')}
                                placeholderTextColor={HOME_COLORS.faint}
                                accessibilityLabel={t('common.title')}
                                multiline={false}
                                numberOfLines={1}
                            />
                        </View>

                        <View style={styles.songEditorField}>
                            <Text style={styles.songEditorLabel}>{t('common.artist')}</Text>
                            <TextInput
                                value={songDraft.artist}
                                onChangeText={(artist) => setSongDraft((prev) => ({ ...prev, artist }))}
                                style={styles.songEditorInput}
                                placeholder={t('common.artist')}
                                placeholderTextColor={HOME_COLORS.faint}
                                accessibilityLabel={t('common.artist')}
                                multiline={false}
                                numberOfLines={1}
                            />
                        </View>

                        <View style={[styles.songEditorField, styles.songEditorLyricsField]}>
                            <Text style={styles.songEditorLabel}>{t('common.lyrics')}</Text>
                            <TextInput
                                value={songDraft.lyrics}
                                onChangeText={(lyrics) => setSongDraft((prev) => ({ ...prev, lyrics }))}
                                style={styles.songEditorLyricsInput}
                                placeholder={t('home.songLyricsPlaceholder')}
                                placeholderTextColor={HOME_COLORS.faint}
                                accessibilityLabel={t('common.lyrics')}
                                multiline
                                textAlignVertical="top"
                            />
                            <View style={[styles.songEditorFooter, { paddingBottom: safeAreaInsets.bottom + Spacing.md }]}>
                                <Text style={styles.songEditorFooterText}>
                                    {t('home.newSongLineCount', { count: countSongLines(songDraft.lyrics) })}
                                </Text>
                                <Text style={styles.songEditorFooterText}>{t('home.newSongDraftSaved')}</Text>
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                </View>
            </Modal>
            <ScreenCoachTip
                visible={tipId === TIP_IDS.homeOcr}
                title={t('tips.ocrTitle')}
                body={t('tips.ocrBody')}
                anchorRef={ocrButtonRef}
                onClose={() => closeTip(TIP_IDS.homeOcr)}
            />
        </Screen>
        </HomeThemeContext.Provider>
    );
};

const createStyles = (HOME_COLORS, colors) => StyleSheet.create({
    screenFrame: {
        flex: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        position: 'relative',
    },
    screenContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: Layout.tabBarHeight + Spacing.xl5,
    },
    stack: {
        gap: 0,
    },
    appTopBar: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.sm,
        backgroundColor: HOME_COLORS.bg,
    },
    appTopIconButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    appTopAvatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HOME_COLORS.accent,
    },
    appTopAvatarText: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 16,
        lineHeight: 20,
        color: HOME_COLORS.onAccent,
        includeFontPadding: false,
    },
    ocrStatusText: {
        ...textStyles.caption,
        color: HOME_COLORS.secondary,
        textAlign: 'center',
        paddingHorizontal: Spacing.screenHorizontalDense,
        paddingVertical: Spacing.sm,
    },
    appTopTitle: {
        flex: 1,
        textAlign: 'center',
        ...textStyles.appTitle,
        color: HOME_COLORS.text,
    },
    heroSection: {
        paddingTop: Spacing.xl2,
    },
    heroEyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.tertiary,
        textAlign: 'center',
    },
    heroScrollContent: {
        paddingTop: Spacing.xl2,
        paddingBottom: Spacing.xl8,
        alignItems: 'center',
    },
    heroItem: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroCover: {
        borderRadius: 6,
    },
    heroMeta: {
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        alignItems: 'center',
    },
    heroTitle: {
        maxWidth: 300,
        fontSize: 24,
        lineHeight: 32,
        color: HOME_COLORS.text,
        textAlign: 'center',
    },
    heroAuthor: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: HOME_COLORS.sub,
        textAlign: 'center',
        marginTop: 2,
    },
    heroProgressGroup: {
        width: '100%',
        maxWidth: 300,
        alignSelf: 'center',
    },
    heroProgressLabels: {
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: Spacing.xl2,
    },
    heroPercent: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.text,
    },
    heroWords: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.tertiary,
    },
    heroProgressRail: {
        alignSelf: 'stretch',
        height: 3,
        marginTop: Spacing.sm,
        borderRadius: 2,
        backgroundColor: HOME_COLORS.track,
        overflow: 'hidden',
    },
    heroProgressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: HOME_COLORS.accent,
    },
    heroResumeButton: {
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.md,
        height: 50,
        marginTop: Spacing.xl2,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.accent,
    },
    todayGoal: {
        marginHorizontal: 20,
        marginTop: 4,
        marginBottom: 14,
    },
    heroResumeButtonOpening: {
        backgroundColor: HOME_COLORS.surface2,
    },
    heroResumeTextOpening: {
        color: HOME_COLORS.tertiary,
    },
    heroResumeText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 21,
        color: HOME_COLORS.onAccent,
    },
    previewScreenContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    previewScrollContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 104,
    },
    previewScroll: {
        flex: 1,
    },
    previewTopBar: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.sm,
        backgroundColor: HOME_COLORS.bg,
    },
    previewTopSpacer: {
        flex: 1,
    },
    previewIconButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    previewHero: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: Spacing.xl4,
        paddingHorizontal: Spacing.screenHorizontal,
        paddingTop: Spacing.md,
    },
    previewCover: {
        borderRadius: 5,
    },
    previewBookSpine: {
        display: 'none',
    },
    previewSpinePanel: {
        position: 'absolute',
        borderRadius: 3,
    },
    previewSpinePanelRule: {
        position: 'absolute',
        borderWidth: 1,
        opacity: 0.55,
    },
    previewSpineSeam: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 1,
        backgroundColor: HOME_COLORS.divider,
    },
    previewSpineTitleBand: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    previewSpineTitleGlyph: {
        width: '100%',
        fontFamily: fontFamilies.krSerifSemiBold,
        fontWeight: '600',
        textAlign: 'center',
        letterSpacing: 0,
    },
    previewHeroCopy: {
        flex: 1,
        minWidth: 0,
        gap: 4,
        paddingBottom: 4,
    },
    previewTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 26,
        lineHeight: 33,
        color: colors.text,
    },
    previewTitleKorean: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 28,
        lineHeight: 36,
    },
    previewAuthor: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textMuted,
    },
    previewTagWrap: {
        alignSelf: 'flex-start',
        marginTop: Spacing.sm,
        borderRadius: 6,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        backgroundColor: HOME_COLORS.surface2,
    },
    previewTagText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
        color: HOME_COLORS.secondary,
    },
    previewDownloadBlock: {
        paddingTop: Spacing.xl3,
        paddingHorizontal: Spacing.screenHorizontal,
    },
    previewDownloadNote: {
        marginTop: Spacing.xl3,
        paddingHorizontal: Spacing.screenHorizontal,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.tertiary,
    },
    previewDownloadProgressRail: {
        height: 3,
        borderRadius: 2,
        backgroundColor: HOME_COLORS.divider,
        overflow: 'hidden',
    },
    previewDownloadProgressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: HOME_COLORS.accent,
    },
    previewEaseBlock: {
        marginTop: Spacing.xl5,
        marginHorizontal: Spacing.xl3,
        paddingVertical: Spacing.xl3,
        paddingHorizontal: Spacing.xl4,
        gap: Spacing.lg,
        borderWidth: 1,
        borderColor: HOME_COLORS.divider,
        borderRadius: 18,
        backgroundColor: HOME_COLORS.surface,
    },
    previewEaseHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.lg,
    },
    previewEasePercent: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 30,
        lineHeight: 36,
        color: colors.text,
        letterSpacing: -0.5,
    },
    previewEaseBand: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 19,
        color: HOME_COLORS.secondary,
    },
    previewEaseBandEasy: {
        color: colors.readerLevelUnderlineEasy,
    },
    previewEaseBandMid: {
        color: colors.readerLevelUnderlineMid,
    },
    previewEaseRail: {
        height: 6,
        borderRadius: 3,
        backgroundColor: HOME_COLORS.divider,
        overflow: 'hidden',
    },
    previewEaseFill: {
        height: '100%',
        borderRadius: 3,
        backgroundColor: HOME_COLORS.accent,
    },
    previewEaseNote: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: HOME_COLORS.secondary,
    },
    previewEaseEmpty: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.lg,
    },
    previewEaseEmptyText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: HOME_COLORS.tertiary,
    },
    previewMetaGrid: {
        marginTop: Spacing.xl,
        marginHorizontal: Spacing.screenHorizontal,
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: Spacing.xl2,
    },
    previewMetaItem: {
        width: '50%',
        gap: 2,
        paddingRight: Spacing.xl3,
    },
    previewMetaLabel: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: HOME_COLORS.tertiary,
    },
    previewMetaValue: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    previewAboutSection: {
        marginTop: Spacing.xl5,
        marginHorizontal: Spacing.screenHorizontal,
        paddingTop: Spacing.xl4,
        gap: Spacing.md,
        borderTopWidth: 1,
        borderTopColor: HOME_COLORS.divider,
    },
    previewSectionLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.tertiary,
    },
    previewSnippetText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 23,
        color: HOME_COLORS.secondary,
    },
    previewAttributionText: {
        fontFamily: fontFamilies.sansRegular,
        color: HOME_COLORS.faint,
        fontSize: 12,
        lineHeight: 16,
        textAlign: 'right',
    },
    previewNoteBlock: {
        marginTop: Spacing.xl5,
        marginHorizontal: Spacing.xl3,
    },
    previewNoteCard: {
        marginTop: Spacing.md,
        backgroundColor: HOME_COLORS.surface,
        borderWidth: 1,
        borderColor: HOME_COLORS.divider,
        borderRadius: 18,
        paddingVertical: Spacing.xl3,
        paddingHorizontal: Spacing.xl4,
    },
    previewNoteText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 23,
        color: colors.text,
    },
    previewNoteTextKorean: {
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 16,
        lineHeight: 26,
    },
    previewNoSnippet: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.lg,
    },
    previewNoSnippetText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: HOME_COLORS.tertiary,
    },
    previewBottomBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        gap: Spacing.lg,
        paddingTop: Spacing.xl2,
        paddingHorizontal: Spacing.screenHorizontalDense,
        backgroundColor: HOME_COLORS.bg,
        borderTopWidth: 1,
        borderTopColor: HOME_COLORS.divider,
    },
    previewSecondaryButton: {
        flex: 1,
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.md,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.surface,
    },
    previewSecondaryButtonActive: {
        backgroundColor: HOME_COLORS.surface2,
    },
    previewSecondaryButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: HOME_COLORS.text,
    },
    previewPrimaryButton: {
        flex: 1.4,
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.md,
        paddingHorizontal: Spacing.md,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.accent,
    },
    previewPrimaryButtonDisabled: {
        opacity: Motion.disabledOpacity,
    },
    previewPrimaryButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 21,
        color: HOME_COLORS.onAccent,
    },
    koreanInlineText: {
        fontFamily: fontFamilies.krSerifMedium,
    },
    libraryControls: {
        gap: 0,
        marginTop: Spacing.xl5,
        overflow: 'visible',
    },
    libraryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        paddingLeft: Spacing.screenHorizontalDense,
        paddingRight: Spacing.screenHorizontalDense - Spacing.md,
    },
    libraryTitle: {
        flex: 1,
        fontFamily: fontFamilies.displayMedium,
        fontSize: 21,
        lineHeight: 27,
        color: HOME_COLORS.text,
    },
    collectionEyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.tertiary,
    },
    collectionViewIcons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 0,
    },
    collectionViewButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    collectionViewButtonDisabled: {
        opacity: Motion.disabledOpacity,
    },
    libraryTabs: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: Spacing.xl5,
        marginHorizontal: Spacing.screenHorizontalDense,
        marginTop: Spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: HOME_COLORS.divider,
        position: 'relative',
    },
    libraryTab: {
        minHeight: 44,
        justifyContent: 'center',
        paddingVertical: Spacing.lg,
    },
    libraryTabText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        lineHeight: 19,
        color: HOME_COLORS.tertiary,
    },
    libraryTabTextActive: {
        fontFamily: fontFamilies.sansSemiBold,
        color: HOME_COLORS.text,
    },
    libraryTabUnderline: {
        position: 'absolute',
        bottom: 0,
        height: 2,
        borderRadius: 1,
        backgroundColor: HOME_COLORS.accent,
    },
    ocrTabToggle: {
        minHeight: 34,
        marginBottom: 3,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: 13,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.surface,
    },
    ocrTabToggleActive: {
        borderColor: HOME_COLORS.accent,
        backgroundColor: HOME_COLORS.accent,
    },
    ocrTabToggleBusy: {
        opacity: 0.72,
    },
    ocrTabToggleText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 15,
        color: HOME_COLORS.accent,
    },
    ocrTabToggleTextActive: {
        color: HOME_COLORS.onAccent,
    },
    libraryDivider: {
        height: 0,
    },
    booksSection: {
        gap: 0,
    },
    bookFilterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingTop: 14,
        paddingBottom: 14,
    },
    bookFilterRowHidden: {
        display: 'none',
    },
    bookFilterChip: {
        minHeight: 33,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingHorizontal: 15,
        paddingVertical: 7,
        borderRadius: 0,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.bg,
    },
    bookFilterIconChip: {
        minWidth: 48,
        paddingHorizontal: 14,
    },
    bookFilterChipActive: {
        borderColor: HOME_COLORS.text,
        backgroundColor: HOME_COLORS.text,
    },
    bookFilterChipText: {
        ...textStyles.sectionTitle,
        fontSize: 13,
        lineHeight: 17,
        color: HOME_COLORS.sub,
        letterSpacing: 0,
    },
    bookFilterChipTextActive: {
        color: HOME_COLORS.bg,
    },
    bookFilterChipCount: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 14,
        color: HOME_COLORS.faint,
        opacity: 0.65,
    },
    bookFilterChipCountActive: {
        color: HOME_COLORS.bg,
        opacity: 0.65,
    },
    bookSectionHeader: {
        minHeight: 19,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14,
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingTop: 14,
        paddingBottom: 12,
    },
    bookSectionCopy: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    bookSectionCount: {
        ...textStyles.body,
        fontSize: 10,
        lineHeight: 13,
        color: HOME_COLORS.tertiary,
        fontFamily: fontFamilies.sansBold,
        letterSpacing: 0,
    },
    bookSectionHint: {
        ...textStyles.caption,
        maxWidth: 340,
        fontSize: 12,
        lineHeight: 16,
        color: HOME_COLORS.faint,
        letterSpacing: 0,
    },
    bookSectionActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        flexShrink: 1,
        gap: spacing.sm,
    },
    importInlineButton: {
        minHeight: 28,
        justifyContent: 'center',
    },
    importInlineText: {
        ...textStyles.label,
        fontSize: 10,
        lineHeight: 13,
        color: HOME_COLORS.accent,
        letterSpacing: 0,
    },
    publicDomainSortRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 22,
        paddingTop: 0,
        paddingBottom: 14,
    },
    publicDomainSortChip: {
        minHeight: 30,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.bg,
    },
    publicDomainSortChipActive: {
        borderColor: HOME_COLORS.accent,
        backgroundColor: HOME_COLORS.accent,
    },
    publicDomainSortChipText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        color: HOME_COLORS.sub,
        letterSpacing: 0,
    },
    publicDomainSortChipTextActive: {
        color: HOME_COLORS.onAccent,
    },
    emptyBooksPanel: {
        minHeight: 132,
        justifyContent: 'center',
        gap: spacing.xs,
        marginHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        marginTop: 8,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 4,
        backgroundColor: HOME_COLORS.paper,
    },
    emptyBooksTitle: {
        ...textStyles.sectionTitle,
        fontSize: 18,
        lineHeight: 23,
        color: HOME_COLORS.text,
        letterSpacing: 0,
    },
    emptyBooksCopy: {
        ...textStyles.body,
        maxWidth: 360,
        fontSize: 14,
        lineHeight: 20,
        color: HOME_COLORS.sub,
    },
    collectionEmptyState: {
        minHeight: 320,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        paddingTop: Spacing.xl8,
        paddingBottom: Spacing.xl8,
    },
    collectionEmptyIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: Spacing.xl3,
    },
    collectionEmptyTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 22,
        lineHeight: 28,
        textAlign: 'center',
        color: HOME_COLORS.text,
    },
    collectionEmptyCopy: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        maxWidth: 320,
        marginTop: Spacing.lg,
        textAlign: 'center',
        color: HOME_COLORS.sub,
    },
    collectionEmptyActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: Spacing.lg,
        marginTop: Spacing.xl3,
    },
    collectionEmptyPrimary: {
        height: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.md,
        paddingHorizontal: 22,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.accent,
    },
    collectionEmptySecondary: {
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 22,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.surface,
    },
    collectionEmptyPrimaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: HOME_COLORS.onAccent,
    },
    collectionEmptySecondaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 19,
        color: HOME_COLORS.text,
    },
    starterWrap: {
        paddingHorizontal: Spacing.screenHorizontalDense,
        paddingTop: Spacing.xl3,
        paddingBottom: Spacing.xl8,
    },
    starterCard: {
        gap: Spacing.xl2,
        padding: Spacing.xl4,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: HOME_COLORS.divider,
        backgroundColor: HOME_COLORS.surface,
    },
    starterBookRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xl2,
    },
    starterTitle: {
        fontSize: 19,
        lineHeight: 25,
        color: HOME_COLORS.text,
    },
    starterTranslatedTitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        color: HOME_COLORS.secondary,
        marginTop: 2,
    },
    starterCopy: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: HOME_COLORS.secondary,
    },
    starterPrimary: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.md,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.accent,
    },
    starterSecondaryActions: {
        flexDirection: 'row',
        gap: Spacing.md,
    },
    starterSecondary: {
        flex: 1,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.md,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.surface,
    },
    starterSecondaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 19,
        color: HOME_COLORS.text,
    },
    // Library ease groups: a small header over each group's books.
    easeSection: {
        paddingTop: Spacing.xl,
    },
    easeSectionHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.sm,
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingBottom: Spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: HOME_COLORS.divider,
        marginHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingLeft: 0,
        paddingRight: 0,
    },
    easeSectionTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: HOME_COLORS.text,
    },
    easeSectionCount: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.tertiary,
    },
    bookGridInSection: {
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    bookGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: BOOK_GRID_GAP,
        rowGap: Spacing.xl2,
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingTop: Spacing.xl2,
        paddingBottom: Spacing.xl8,
    },
    bookGridDownloadBadge: {
        position: 'absolute',
        left: 3,
        bottom: 3,
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HOME_COLORS.bg,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
    },
    bookTile: {
        gap: 0,
    },
    bookCoverContainer: {
        position: 'relative',
    },
    bookRows: {
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.xl8,
    },
    bookRow: {
        minHeight: 100,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xl2,
        paddingVertical: Spacing.xl,
        borderBottomWidth: 1,
        borderBottomColor: HOME_COLORS.divider,
    },
    bookRowLast: {
        borderBottomWidth: 0,
    },
    bookRowCover: {
        borderRadius: Radii.cover,
    },
    bookRowCoverText: {
        fontSize: 12,
        lineHeight: 16,
    },
    bookRowCopy: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    bookRowTitleLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    bookRowTitle: {
        flexShrink: 1,
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 17,
        lineHeight: 23,
        color: HOME_COLORS.text,
    },
    bookRowAuthor: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.sub,
    },
    bookRowMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: HOME_COLORS.tertiary,
    },
    inlineBadge: {
        borderWidth: Layout.tabBarBorderWidth,
        borderColor: HOME_COLORS.border,
        borderRadius: Radii.badge,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xs,
    },
    inlineBadgeText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: TextStyles.labelSmall.fontSize,
        lineHeight: TextStyles.labelSmall.fontSize + Spacing.xs,
        letterSpacing: 0,
        color: HOME_COLORS.sub,
    },
    bookTileMenuOpen: {
        zIndex: 20,
    },
    coverImage: {
        resizeMode: 'cover',
        backgroundColor: HOME_COLORS.surface2,
    },
    defaultCover: {
        overflow: 'hidden',
        borderRadius: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    defaultCoverRule: {
        height: 1,
        borderRadius: 1,
    },
    defaultCoverTitle: {
        width: '100%',
        letterSpacing: 0,
        textAlign: 'center',
    },
    defaultCoverTitleKorean: {
        fontFamily: fontFamilies.krSerifSemiBold,
    },
    defaultCoverTitleDisplay: {
        fontFamily: fontFamilies.displaySemiBold,
    },
    defaultCoverAuthor: {
        width: '100%',
        fontFamily: fontFamilies.krSerifRegular,
        opacity: 1,
        textAlign: 'center',
    },
    bookCover: {
        borderRadius: 2,
    },
    bookCoverText: {
        fontSize: 21,
        lineHeight: 29,
    },
    bookProgressRail: {
        height: 3,
        marginTop: 5,
        borderRadius: 999,
        backgroundColor: HOME_COLORS.track,
        overflow: 'hidden',
    },
    bookProgressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: HOME_COLORS.accent,
    },
    bookProgressFillSuccess: {
        backgroundColor: HOME_COLORS.success,
    },
    publicDomainAuthor: {
        ...textStyles.caption,
        marginTop: 3,
        fontSize: 10,
        lineHeight: 13,
        color: HOME_COLORS.sub,
        letterSpacing: 0,
    },
    publicDomainMetaRow: {
        minHeight: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 5,
    },
    publicDomainGenreTag: {
        flexShrink: 1,
        maxWidth: '62%',
        minHeight: 18,
        justifyContent: 'center',
        paddingHorizontal: 6,
        borderRadius: 9,
        backgroundColor: HOME_COLORS.accentBg,
    },
    publicDomainGenreText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 8,
        lineHeight: 11,
        color: HOME_COLORS.accentDeep,
        letterSpacing: 0,
    },
    publicDomainWordCount: {
        ...textStyles.caption,
        flexShrink: 1,
        fontSize: 9,
        lineHeight: 12,
        color: HOME_COLORS.faint,
        letterSpacing: 0,
    },
    publicLibraryDiagnostics: {
        gap: 3,
        marginTop: 8,
    },
    publicLibraryDiagnosticText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15,
        color: HOME_COLORS.faint,
        letterSpacing: 0,
    },
    publicDomainActionButton: {
        minHeight: 28,
        marginTop: 7,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: HOME_COLORS.accent,
    },
    publicDomainActionButtonReady: {
        borderWidth: 1,
        borderColor: HOME_COLORS.accent,
        backgroundColor: HOME_COLORS.accentBg,
    },
    publicDomainActionButtonDisabled: {
        opacity: 0.78,
    },
    publicDomainActionText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        color: HOME_COLORS.onAccent,
        letterSpacing: 0,
    },
    publicDomainActionTextReady: {
        color: HOME_COLORS.accentDeep,
    },
    bookMenuButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 3,
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HOME_COLORS.accent,
    },
    bookMenu: {
        position: 'absolute',
        top: 0,
        zIndex: 4,
        minWidth: 160,
        overflow: 'hidden',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.surface,
        shadowColor: HOME_COLORS.text,
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
    },
    bookMenuLeft: {
        left: 0,
    },
    bookMenuRight: {
        right: 0,
    },
    bookMenuItem: {
        minHeight: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
        backgroundColor: HOME_COLORS.surface,
    },
    bookMenuDangerItem: {
        borderTopWidth: 1,
        borderTopColor: HOME_COLORS.border,
    },
    bookMenuSeparatedItem: {
        borderTopWidth: 1,
        borderTopColor: HOME_COLORS.border,
    },
    bookMenuItemText: {
        ...textStyles.body,
        fontSize: 13,
        lineHeight: 17,
        color: HOME_COLORS.text,
    },
    bookMenuDangerText: {
        color: colors.danger,
    },
    bookCloudMeta: {
        ...textStyles.caption,
        marginTop: 5,
        fontSize: 10,
        lineHeight: 13,
        color: HOME_COLORS.faint,
    },
    songsPanel: {
        gap: 12,
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingTop: 14,
        paddingBottom: 28,
    },
    songsActionRow: {
        minHeight: 24,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    songTextAction: {
        minHeight: 24,
        justifyContent: 'center',
    },
    songTextActionLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 0,
        color: HOME_COLORS.accent,
    },
    songList: {
        gap: spacing.sm,
    },
    songRow: {
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.surface,
    },
    songTile: {
        width: 48,
        height: 48,
        borderRadius: 10,
        backgroundColor: HOME_COLORS.frame,
        alignItems: 'center',
        justifyContent: 'center',
    },
    songTileText: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 22,
        lineHeight: 28,
        color: HOME_COLORS.paper,
        includeFontPadding: false,
    },
    songRowLast: {},
    songRowPressed: {
        backgroundColor: HOME_COLORS.surface2,
    },
    songCopy: {
        flex: 1,
        minWidth: 0,
        paddingRight: spacing.sm,
    },
    songTitle: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 17,
        lineHeight: 22,
        color: HOME_COLORS.text,
        letterSpacing: 0,
    },
    songMeta: {
        ...textStyles.body,
        fontSize: 12,
        lineHeight: 17,
        color: HOME_COLORS.faint,
    },
    emptySongs: {
        minHeight: 100,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    emptySongsText: {
        ...textStyles.bodyMuted,
    },
    emptySongsPanel: {
        minHeight: 188,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.xl,
        borderRadius: 4,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.paper,
    },
    emptySongsTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 24,
        lineHeight: 30,
        textAlign: 'center',
        color: HOME_COLORS.text,
        letterSpacing: -0.2,
    },
    emptySongsCopy: {
        ...textStyles.body,
        maxWidth: 330,
        textAlign: 'center',
        fontSize: 15,
        lineHeight: 22,
        color: HOME_COLORS.sub,
    },
    fabScrim: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
        zIndex: 20,
    },
    fabScrimBackdrop: {
        ...StyleSheet.absoluteFillObject,
        overflow: 'hidden',
    },
    fabScrimTint: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(27,28,28,0.34)',
    },
    fabMenu: {
        position: 'absolute',
        right: FAB_EDGE_OFFSET,
        bottom: FAB_WINDOW_BOTTOM_OFFSET + Layout.fabSize + FAB_MENU_GAP,
        alignItems: 'flex-end',
        gap: 14,
        zIndex: 22,
    },
    fabMenuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 12,
    },
    fabMenuText: {
        minHeight: 32,
        paddingHorizontal: 13,
        paddingVertical: 9,
        borderRadius: Radii.input,
        borderWidth: Layout.tabBarBorderWidth,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.bg,
        color: HOME_COLORS.text,
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 0,
        overflow: 'hidden',
        shadowColor: 'rgba(27,28,28,0.16)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 6,
    },
    fabMenuIcon: {
        width: 48,
        height: 48,
        borderRadius: Radii.pill,
        borderWidth: Layout.tabBarBorderWidth,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.bg,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27,28,28,0.16)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 6,
    },
    fab: {
        position: 'absolute',
        right: FAB_EDGE_OFFSET,
        width: Layout.fabSize,
        height: Layout.fabSize,
        borderRadius: Radii.pill,
        backgroundColor: HOME_COLORS.accent,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 23,
        ...HOME_SHADOWS.cta,
    },
    fabScreenAnchor: {
        bottom: FAB_EDGE_OFFSET,
    },
    fabModalAnchor: {
        bottom: FAB_WINDOW_BOTTOM_OFFSET,
    },
    loadingOverlay: {
        position: 'absolute',
        top: spacing.xl,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.surface,
        ...HOME_SHADOWS.card,
    },
    loadingText: {
        ...textStyles.caption,
        color: HOME_COLORS.sub,
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        padding: spacing.xl,
    },
    editModal: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: 28,
        padding: spacing.xl,
        gap: spacing.md,
    },
    pdfCoverModal: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: 28,
        padding: spacing.xl,
        gap: spacing.md,
    },
    pdfCoverCopy: {
        ...textStyles.bodyMuted,
        color: colors.textSubtle,
    },
    pdfCoverDefaultButton: {
        alignSelf: 'stretch',
    },
    pdfCoverActions: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginTop: spacing.xs,
    },
    pdfCoverActionButton: {
        flex: 1,
    },
    songEditorScreen: {
        flex: 1,
        backgroundColor: HOME_COLORS.bg,
    },
    songEditorHeader: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingLeft: Spacing.xl,
        paddingRight: Spacing.xl3,
        paddingTop: Spacing.sm,
    },
    songEditorClose: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    songEditorTitle: {
        flex: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 17,
        lineHeight: 22,
        color: HOME_COLORS.text,
    },
    songEditorSaveButton: {
        minWidth: 64,
        height: 36,
        paddingHorizontal: Spacing.xl3,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HOME_COLORS.accent,
    },
    songEditorSaveButtonDisabled: {
        opacity: 0.35,
    },
    songEditorSaveText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 19,
        color: HOME_COLORS.onAccent,
    },
    songEditorBody: {
        flex: 1,
        paddingHorizontal: Spacing.xl3,
        paddingTop: Spacing.xl,
    },
    songSearchRow: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.lg,
        paddingHorizontal: Spacing.xl2,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.surface,
    },
    songSearchInput: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: HOME_COLORS.text,
        paddingVertical: 0,
        includeFontPadding: false,
    },
    songSearchResults: {
        maxHeight: 280,
        marginTop: Spacing.md,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.surface,
    },
    songSearchResult: {
        minHeight: 56,
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl2,
        paddingVertical: Spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: HOME_COLORS.divider,
    },
    songSearchResultLast: {
        borderBottomWidth: 0,
    },
    songSearchResultTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: HOME_COLORS.text,
    },
    songSearchResultMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.sub,
        marginTop: 2,
    },
    songSearchNotice: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.sub,
        marginTop: Spacing.md,
        paddingHorizontal: Spacing.xs,
    },
    songEditorDividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xl,
        marginTop: Spacing.xl5,
        marginBottom: Spacing.xl3,
    },
    songEditorDividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: HOME_COLORS.border,
    },
    songEditorDividerText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.tertiary,
    },
    songEditorField: {
        gap: Spacing.sm,
        marginBottom: Spacing.xl,
    },
    songEditorLyricsField: {
        flex: 1,
        marginBottom: 0,
    },
    songEditorLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.secondary,
    },
    songEditorInput: {
        height: 48,
        paddingHorizontal: Spacing.xl2,
        paddingVertical: 0,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.surface,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        color: HOME_COLORS.text,
        includeFontPadding: false,
    },
    songEditorLyricsInput: {
        flex: 1,
        minHeight: 160,
        paddingHorizontal: Spacing.xl2,
        paddingTop: Spacing.xl,
        paddingBottom: Spacing.xl,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 14,
        backgroundColor: HOME_COLORS.surface,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 24,
        color: HOME_COLORS.text,
    },
    songEditorFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 2,
    },
    songEditorFooterText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: HOME_COLORS.tertiary,
    },
    editTitle: {
        ...textStyles.title,
    },
    editLabel: {
        ...textStyles.eyebrow,
        letterSpacing: 0,
    },
    editInput: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        color: colors.text,
        backgroundColor: colors.surface,
        ...textStyles.body,
    },
    lyricsInput: {
        minHeight: 190,
        lineHeight: 22,
    },
    coverRow: {
        flexDirection: 'row',
        gap: spacing.md,
        alignItems: 'center',
    },
    coverPreview: {
        width: 72,
        height: 108,
        borderRadius: 16,
        backgroundColor: colors.surfaceMuted,
    },
    coverActions: {
        flex: 1,
        gap: spacing.sm,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
        marginTop: spacing.sm,
    },
    songModalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
    },
    songModalButton: {
        minWidth: 94,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        paddingHorizontal: spacing.lg,
    },
    songModalButtonSecondary: {
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    songModalButtonPrimary: {
        backgroundColor: colors.text,
    },
    songModalButtonSecondaryText: {
        ...textStyles.sectionTitle,
        fontSize: 15,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    songModalButtonPrimaryText: {
        ...textStyles.sectionTitle,
        fontSize: 15,
        color: colors.white,
        letterSpacing: 0,
    },
    pressed: {
        opacity: 0.78,
    },
});

const defaultHomeStyles = createStyles(HOME_COLORS, colors);

export default Home;
