import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
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
import * as DocumentPicker from 'expo-document-picker';
import { Feather, Ionicons } from '@expo/vector-icons';
import { tabBarBaseStyle } from '../components/shared/TabBar';
import SongReader from '../components/Songs/SongReader';
import { IconButton, Screen } from '../components/ui';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import { colors, fontFamilies, insets, layout, radii, spacing, textStyles } from '../theme';
import useBooks from '../hooks/useBooks';
import { deleteBookIndexEntries } from '../services/Database';
import {
    darkenHex,
    extractBookCoverColors,
    getGeneratedBookCoverPalette,
    getPublicDomainBookCoverColors,
    getStoredBookCoverColors,
    lightenHex,
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
import {
    cloudSongToLocalSong,
    fetchUserSongs,
    softDeleteUserSong,
    upsertUserSong,
} from '../services/songCloudSync';
import {
    isSongStorageLimitError,
    serializeSongsForStorage,
} from '../services/songStorageLimits';
import { GUEST_OWNER_ID, makeScopedStorageKey } from '../services/localDataScope';
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
import { getLanguageLabel } from '../constants/languages';

const BOOK_GRID_GAP = 18;
const HOME_CONTENT_HORIZONTAL_PADDING = 22;
const WORDS_PER_PAGE = 250;
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
const getSongsStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'manual-songs');
const OCR_SETTINGS_KEY = '@ff/ocr-settings';
const EMPTY_SONG_DRAFT = { title: '', artist: '', lyrics: '' };
const DEFAULT_SONG_FONT_SIZE = 28;
const EMPTY_OCR_STATUS = {
    overlayPermissionGranted: false,
    screenCaptureActive: false,
    floatingVisible: false,
    resultOverlayVisible: false,
};

const BOOK_FILTERS = [
    { id: 'favorites', labelKey: 'home.favoriteBooks', iconOnly: true },
    { id: 'all', labelKey: 'home.myBooks' },
    { id: 'public-domain', labelKey: 'home.publicDomain' },
];

const PUBLIC_DOMAIN_SORTS = [
    { id: 'title', labelKey: 'home.alphabetical' },
    { id: 'author', labelKey: 'common.author' },
    { id: 'length', labelKey: 'home.length' },
    { id: 'genre', labelKey: 'home.genre' },
];

const HOME_COLORS = {
    bg: '#ece4d6',
    surface: '#faf6ee',
    surface2: '#f2ecdf',
    paper: '#f8efe2',
    text: '#2c2620',
    sub: '#766a59',
    faint: '#a89b86',
    border: '#e4dac6',
    accent: '#b8552e',
    accentBg: '#f5e6db',
    accentDeep: '#93421f',
    onAccent: '#ffffff',
    success: '#5a8a4a',
    track: '#e6ddcd',
    continueBorder: '#eaddc7',
};

const HOME_SHADOWS = {
    card: {
        shadowColor: 'rgba(70,48,20,0.36)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 14,
        elevation: 2,
    },
    cta: {
        shadowColor: 'rgba(184,85,46,0.52)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 14,
        elevation: 3,
    },
};

const STACKS_COVER_BAR_WIDTHS = [40, 64, 52, 80, 30];
const STACKS_COVER_REF_WIDTH = 200;
const STACKS_COVER_REF_HEIGHT = 298;

const KOREAN_TEXT_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const showSongStorageLimitAlert = (error, t) => {
    const fallbackMessage = t ? t('home.songStorageLimitFallback') : 'Saved songs are too large to store locally.';
    Alert.alert(
        t ? t('home.songStorageLimitTitle') : 'Song storage limit reached',
        t
            ? t('home.songStorageLimitBody', { message: error?.message ?? fallbackMessage })
            : `${error?.message ?? fallbackMessage} Remove some songs or shorten lyrics before adding more.`
    );
};
const countSongLines = (lyrics) => String(lyrics || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;
const normalizeStoredSong = (song) => {
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
        artist: String(song.artist || '').trim() || 'Unknown artist',
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
    };
};
const getBookTitle = (book, t = null) => book?.title?.trim() || (t ? t('common.untitled') : 'Untitled');
const getBookAuthor = (book, t = null) => book?.author?.trim() || (t ? t('common.unknownAuthor') : 'Unknown author');
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

const mergeLocalAndCloudSongs = (localSongs, cloudRows) => {
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
                merged.push(normalizeStoredSong(cloudSongToLocalSong(cloudRow)));
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
            }));
            return;
        }

        merged.push(localSong);
        localOnly.push(localSong);
        keptLocalIds.add(id);
    });

    return {
        songs: merged
            .filter(Boolean)
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
const getBookKey = (book, fallback = '') => book?.cloudId || book?.uri || book?.id || fallback;
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

const formatFileSize = (bytes, t = null) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
        return t ? t('common.unknown') : 'Unknown';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = unitIndex === 0 || size >= 10 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
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

const formatWordCount = (wordCount, t = null) => (
    wordCount
        ? (t ? t('home.words', { count: wordCount.toLocaleString() }) : `${wordCount.toLocaleString()} words`)
        : (t ? t('common.unknown') : 'Unknown')
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

const formatPreviewDateTime = (value, t = null) => {
    if (!value) {
        return t ? t('home.notOpened') : 'Not opened yet';
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return t ? t('home.notOpened') : 'Not opened yet';
    }

    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

const formatBookLanguage = (language, t = null) => {
    const raw = String(language || '').trim();
    if (!raw) {
        return t ? t('common.unknown') : 'Unknown';
    }

    const shortCode = raw.toLowerCase().split(/[-_]/)[0];
    if (shortCode === 'ko' || shortCode === 'en') {
        return getLanguageLabel(shortCode);
    }

    return raw.toUpperCase();
};

const getStacksCoverPalette = (book) => getGeneratedBookCoverPalette(book);

const getStacksCoverTitleSize = (title, baseSize) => {
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

const BookCover = ({ book, width, height, index, style, titleStyle, showBars = true }) => {
    const { t } = useTranslation();
    const [coverFailed, setCoverFailed] = useState(false);
    const coverUri = typeof book?.cover === 'string' ? book.cover.trim() : '';

    useEffect(() => {
        setCoverFailed(false);
    }, [coverUri]);

    if (coverUri && !coverFailed) {
        return (
            <Image
                source={{ uri: coverUri }}
                style={[styles.coverImage, { width, height }, style]}
                onError={() => setCoverFailed(true)}
            />
        );
    }

    const palette = getStacksCoverPalette(book);
    const scaleX = width / STACKS_COVER_REF_WIDTH;
    const scaleY = height / STACKS_COVER_REF_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    const title = getBookTitle(book, t);
    const author = getBookAuthor(book, t);
    const titleFontSize = getStacksCoverTitleSize(title, 26 * scale);

    return (
        <View style={[
            styles.stacksCover,
            {
                width,
                height,
                backgroundColor: palette.bg,
            },
            style,
        ]}>
            <View style={[
                styles.stacksCoverSpine,
                { width: Math.max(3, 7 * scaleX) },
            ]} />
            <View style={[
                styles.stacksCoverCopy,
                {
                    top: 24 * scaleY,
                    left: 20 * scaleX,
                    right: 20 * scaleX,
                },
            ]}>
                <Text
                    numberOfLines={3}
                    style={[
                        styles.stacksCoverTitle,
                        getSerifFontForText(title),
                        titleStyle,
                        {
                            color: palette.ink,
                            fontSize: titleFontSize,
                            lineHeight: Math.round(titleFontSize * 1.28),
                        },
                    ]}
                >
                    {title}
                </Text>
                <Text
                    numberOfLines={2}
                    style={[
                        styles.stacksCoverAuthor,
                        {
                            color: palette.ink,
                            fontSize: Math.max(8, Math.round(12 * scale)),
                            lineHeight: Math.max(11, Math.round(16 * scale)),
                            marginTop: Math.max(3, Math.round(7 * scaleY)),
                        },
                    ]}
                >
                    {author}
                </Text>
            </View>
            {showBars ? (
                <View style={[
                    styles.stacksCoverBars,
                    {
                        left: 20 * scaleX,
                        bottom: 26 * scaleY,
                        gap: Math.max(3, Math.round(7 * scaleY)),
                    },
                ]}>
                    {STACKS_COVER_BAR_WIDTHS.map((barWidth, barIndex) => (
                        <View
                            key={`${book?.uri || book?.id || 'book'}-bar-${barIndex}`}
                            style={{
                                width: Math.max(14, barWidth * scaleX),
                                height: Math.max(3, 7 * scaleY),
                                borderRadius: Math.max(2, 4 * scale),
                                backgroundColor: palette.accent,
                                opacity: 0.55 + (barIndex * 0.1),
                            }}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
};

const PreviewBookSpine = ({ book, height }) => {
    const { t } = useTranslation();
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
    if (cover) {
        return (
            <Image
                source={{ uri: cover }}
                style={styles.coverPreview}
            />
        );
    }

    return (
        <BookCover
            book={book}
            width={72}
            height={108}
            index={0}
            style={styles.coverPreview}
        />
    );
};

const buildPublicDomainLocalBook = (book, patch = {}) => ({
    ...book,
    ...getPublicDomainBookCoverColors(book),
    ...patch,
    id: book?.id || `public-domain-${book?.publicDomainId}`,
    publicDomain: true,
    format: 'txt',
    downloaded: true,
    originalTitle: book?.originalTitle || book?.title,
    originalAuthor: book?.originalAuthor || book?.author,
    originalCover: book?.originalCover ?? book?.cover ?? null,
    progress: patch.progress ?? book?.progress ?? 0,
    location: patch.location ?? book?.location ?? null,
    nativePosition: patch.nativePosition ?? book?.nativePosition ?? null,
    preprocessed: patch.preprocessed ?? book?.preprocessed ?? false,
    preprocessing: false,
});

const getBookStatusLabel = (book, t = null) => {
    if (book?.publicDomain) {
        return t ? t('home.readyToRead') : 'Ready to read';
    }

    return t ? t('home.progress') : 'Progress';
};

const getBookFormatLabel = (book, t = null) => {
    if (book?.publicDomain) {
        return t ? t('home.publicDomainText') : 'Public domain text';
    }

    return String(book?.format || 'epub').toUpperCase();
};

const PreviewActionButton = ({
    icon,
    active = false,
    danger = false,
    label,
    description,
    onPress,
}) => (
    <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        activeOpacity={0.82}
        onPress={onPress}
        onLongPress={() => {
            Alert.alert(label, description || label);
        }}
        style={[
            styles.previewActionButton,
            active && styles.previewActionButtonActive,
            danger && styles.previewActionButtonDanger,
        ]}
    >
        {icon}
    </TouchableOpacity>
);

const BookPreview = ({
    book,
    index = 0,
    contentWidth,
    actionBusy = false,
    isInLibrary = true,
    onBack,
    onRead,
    onAddToLibrary,
    onToggleFavorite,
    onToggleCompleted,
    onDelete,
    onEdit,
}) => {
    const { t } = useTranslation();
    const progressPercent = Math.round(getBookProgress(book) * 100);
    const isPublicDomain = !!book?.publicDomain;
    const wordCount = getBookWordCount(book);
    const coverWidth = Math.min(156, Math.max(122, Math.round(contentWidth * 0.4)));
    const coverHeight = Math.round(coverWidth * 1.34);
    const attributionNote = [
        book?.previewSource,
        book?.attributionCategory,
    ].filter(Boolean).join(' · ');
    const readIconName = isBookDownloaded(book) || isPublicDomain ? 'book-outline' : 'download-outline';
    const readActionLabel = actionBusy
        ? t('home.preparing')
        : isBookDownloaded(book) || isPublicDomain
            ? t('home.read')
            : t('home.download');
    const favorite = isBookFavorite(book);
    const completed = isBookCompleted(book);

    return (
        <Screen contentContainerStyle={styles.previewScreenContent}>
            <View style={styles.previewTopBar}>
                <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={onBack}
                    style={styles.previewBackButton}
                >
                    <Feather name="arrow-left" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.previewTopTitle}>{t('home.book')}</Text>
                <TouchableOpacity
                    activeOpacity={0.88}
                    disabled={actionBusy}
                    onPress={onRead}
                    style={[
                        styles.previewTopReadButton,
                        actionBusy && styles.previewTopReadButtonDisabled,
                    ]}
                >
                    {actionBusy ? (
                        <ActivityIndicator size="small" color={colors.white} />
                    ) : (
                        <Ionicons
                            name={readIconName}
                            size={16}
                            color={colors.white}
                        />
                    )}
                    <Text style={styles.previewTopReadButtonText}>
                        {readActionLabel}
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.previewScroll}
                contentContainerStyle={styles.previewScrollContent}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.previewStack}>
                    <View style={styles.previewHero}>
                        <View style={styles.previewBookVisualColumn}>
                            <View style={styles.previewBookVisual}>
                                <BookCover
                                    book={book}
                                    width={coverWidth}
                                    height={coverHeight}
                                    index={index}
                                    style={styles.previewCover}
                                    titleStyle={styles.previewCoverText}
                                />
                                <PreviewBookSpine book={book} height={coverHeight} />
                            </View>
                        </View>

                        <View style={styles.previewHeroCopy}>
                            <Text style={styles.previewEyebrow}>
                                {getBookFormatLabel(book, t)}
                            </Text>
                            <Text
                                style={[
                                    styles.previewTitle,
                                    getSerifFontForText(getBookTitle(book, t)),
                                ]}
                            >
                                {getBookTitle(book, t)}
                            </Text>
                            <Text
                                style={[
                                    styles.previewAuthor,
                                    hasKoreanText(getBookAuthor(book, t)) && styles.koreanInlineText,
                                ]}
                            >
                                {getBookAuthor(book, t)}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.previewProgressBlock}>
                        <View style={styles.previewProgressHeader}>
                            <Text style={styles.previewProgressLabel}>{getBookStatusLabel(book, t)}</Text>
                            <Text style={styles.previewProgressValue}>{progressPercent}%</Text>
                        </View>
                        <View style={styles.previewProgressRail}>
                            <View style={[
                                styles.previewProgressFill,
                                { width: `${progressPercent}%` },
                            ]} />
                        </View>
                    </View>

                    {isPublicDomain && !isInLibrary ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={t('home.addToLibrary')}
                            activeOpacity={0.86}
                            onPress={onAddToLibrary}
                            style={styles.previewAddLibraryButton}
                        >
                            <Ionicons name="add-circle-outline" size={18} color={colors.white} />
                            <Text style={styles.previewAddLibraryButtonText}>
                                {t('home.addToLibrary')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}

                    <View style={styles.previewActionRow}>
                        <PreviewActionButton
                            label={favorite ? t('home.removeFavorite') : t('home.favoriteBook')}
                            description={favorite ? t('home.removeFavoriteDescription') : t('home.favoriteBookDescription')}
                            active={favorite}
                            onPress={onToggleFavorite}
                            icon={(
                                <Ionicons
                                    name={favorite ? 'star' : 'star-outline'}
                                    size={22}
                                    color={favorite ? colors.warning : colors.textMuted}
                                />
                            )}
                        />
                        <PreviewActionButton
                            label={completed ? t('home.markUnfinished') : t('home.markCompleted')}
                            description={completed ? t('home.markUnfinishedDescription') : t('home.markCompletedDescription')}
                            active={completed}
                            onPress={onToggleCompleted}
                            icon={(
                                <Ionicons
                                    name={completed ? 'checkmark-done-circle' : 'checkmark-done-circle-outline'}
                                    size={23}
                                    color={completed ? colors.success : colors.textMuted}
                                />
                            )}
                        />
                        <PreviewActionButton
                            label={t('home.deleteBook')}
                            description={t('home.deleteBookDescription')}
                            danger
                            onPress={onDelete}
                            icon={<Ionicons name="trash-outline" size={22} color={colors.danger} />}
                        />
                        <PreviewActionButton
                            label={t('home.editBook')}
                            description={t('home.editBookDescription')}
                            onPress={onEdit}
                            icon={<Ionicons name="create-outline" size={22} color={colors.textMuted} />}
                        />
                    </View>

                    <View style={styles.previewMetaList}>
                        <View style={styles.previewMetaRow}>
                            <Text style={styles.previewMetaLabel}>{t('common.title')}</Text>
                            <View style={styles.previewMetaValueGroup}>
                                <Text
                                    style={[
                                        styles.previewMetaValue,
                                        getSerifFontForText(getBookTitle(book, t)),
                                    ]}
                                >
                                    {getBookTitle(book, t)}
                                </Text>
                                {book?.titleTranslation ? (
                                    <Text style={styles.previewMetaTranslation}>
                                        {book.titleTranslation}
                                    </Text>
                                ) : null}
                            </View>
                        </View>
                        <View style={styles.previewMetaRow}>
                            <Text style={styles.previewMetaLabel}>{t('common.author')}</Text>
                            <View style={styles.previewMetaValueGroup}>
                                <Text
                                    style={[
                                        styles.previewMetaValue,
                                        hasKoreanText(getBookAuthor(book, t)) && styles.koreanInlineText,
                                    ]}
                                >
                                    {getBookAuthor(book, t)}
                                </Text>
                                {book?.authorTranslation ? (
                                    <Text style={styles.previewMetaTranslation}>
                                        {book.authorTranslation}
                                    </Text>
                                ) : null}
                            </View>
                        </View>
                        <View style={styles.previewMetaRow}>
                            <Text style={styles.previewMetaLabel}>{t('home.language')}</Text>
                            <Text style={styles.previewMetaValue}>
                                {formatBookLanguage(book?.language, t)}
                            </Text>
                        </View>
                        <View style={styles.previewMetaRow}>
                            <Text style={styles.previewMetaLabel}>{t('home.lastOpened')}</Text>
                            <Text style={styles.previewMetaValue}>
                                {formatPreviewDateTime(book?.lastOpenedAt, t)}
                            </Text>
                        </View>
                        <View style={styles.previewMetaRow}>
                            <Text style={styles.previewMetaLabel}>{t('home.wordCount')}</Text>
                            <Text style={styles.previewMetaValue}>
                                {formatWordCount(wordCount, t)}
                            </Text>
                        </View>
                        {!isPublicDomain ? (
                            <View style={styles.previewMetaRow}>
                                <Text style={styles.previewMetaLabel}>{t('home.fileSize')}</Text>
                                <Text style={styles.previewMetaValue}>
                                    {formatFileSize(book?.size, t)}
                                </Text>
                            </View>
                        ) : null}
                        {(isPublicDomain && book?.genre) || !isPublicDomain ? (
                            <View style={styles.previewMetaRow}>
                                <Text style={styles.previewMetaLabel}>{t('home.genre')}</Text>
                                <Text style={styles.previewMetaValue}>
                                    {isPublicDomain ? book.genre : t('home.autoDetectionSoon')}
                                </Text>
                            </View>
                        ) : null}
                    </View>

                    {(isPublicDomain && book?.snippet) || !isPublicDomain ? (
                        <View style={styles.previewSnippetSection}>
                            <Text style={styles.previewSectionLabel}>{t('home.snippet')}</Text>
                            <Text style={styles.previewSnippetText}>
                                {isPublicDomain ? book.snippet : t('home.autoDetectionSoon')}
                            </Text>
                            {attributionNote ? (
                                <Text style={styles.previewAttributionText}>
                                    {attributionNote}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            </ScrollView>
        </Screen>
    );
};

const Home = ({ books, setBooks, currentBook, setCurrentBook, setPreprocessOnOpen, navigation, user }) => {
    const { t } = useTranslation();
    const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
    const [editBook, setEditBook] = useState(null);
    const [editDraft, setEditDraft] = useState({ title: '', author: '', cover: '' });
    const [activeLibraryTab, setActiveLibraryTab] = useState('Books');
    const [activeBookFilter, setActiveBookFilter] = useState('all');
    const [activePublicDomainSort, setActivePublicDomainSort] = useState('title');
    const [publicDomainSortDirection, setPublicDomainSortDirection] = useState('asc');
    const [activeBookMenuKey, setActiveBookMenuKey] = useState(null);
    const [songs, setSongs] = useState([]);
    const [songsLoaded, setSongsLoaded] = useState(false);
    const [downloadingBookId, setDownloadingBookId] = useState(null);
    const [selectedSongId, setSelectedSongId] = useState(null);
    const [selectedBookPreview, setSelectedBookPreview] = useState(null);
    const [showAddSongModal, setShowAddSongModal] = useState(false);
    const [songDraft, setSongDraft] = useState(EMPTY_SONG_DRAFT);
    const [ocrStatus, setOcrStatus] = useState(EMPTY_OCR_STATUS);
    const [ocrBusy, setOcrBusy] = useState(false);
    const [, setOcrMessage] = useState('');
    const [ocrSettingsLoaded, setOcrSettingsLoaded] = useState(false);
    const songCloudSyncOwnerRef = useRef(null);
    const songStorageLimitAlertedRef = useRef(false);
    const activeOwnerIdRef = useRef(activeOwnerId);
    activeOwnerIdRef.current = activeOwnerId;
    const ocrActionInFlightRef = useRef(false);
    const ocrSettingsRef = useRef({ floatingPreferred: false, updatedAt: null });
    const ocrSettingsCloudUserRef = useRef(null);
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
    });

    const currentReadingBook = useMemo(() => (
        books.find((book) => book.uri && book.uri === currentBook)
        ?? books.find(isBookDownloaded)
        ?? books[0]
        ?? null
    ), [books, currentBook]);
    const currentProgressPercent = Math.round(getBookProgress(currentReadingBook) * 100);

    const contentWidth = Math.min(
        Math.max(width - (insets.screenHorizontal * 2), 288),
        layout.screenMaxWidth - (insets.screenHorizontal * 2)
    );
    const homeGridContentWidth = Math.max(width - (HOME_CONTENT_HORIZONTAL_PADDING * 2), 0);
    const bookTileWidth = Math.max(Math.floor((homeGridContentWidth - (BOOK_GRID_GAP * 2)) / 3), 0);
    const bookCoverHeight = Math.round(bookTileWidth * 1.34);
    const publicDomainBooks = useMemo(() => getPublicDomainBooks(), []);
    const publicDomainBookRows = useMemo(() => (
        publicDomainBooks.map((book) => {
            const localBook = books.find((candidate) => candidate.uri === book.uri);
            const catalogCoverColors = getPublicDomainBookCoverColors(book);
            const hasCustomCover = !!localBook?.cover;
            return localBook
                ? {
                    ...book,
                    ...localBook,
                    publicDomain: true,
                    downloaded: true,
                    format: 'txt',
                    previewSource: localBook.previewSource ?? book.previewSource,
                    attributionCategory: localBook.attributionCategory ?? book.attributionCategory,
                    titleTranslation: localBook.titleTranslation ?? book.titleTranslation,
                    authorTranslation: localBook.authorTranslation ?? book.authorTranslation,
                    attribution: localBook.attribution ?? book.attribution,
                    snippet: localBook.snippet ?? book.snippet,
                    genre: localBook.genre ?? book.genre,
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
                };
        })
    ), [books, publicDomainBooks]);
    const sortedPublicDomainBookRows = useMemo(() => (
        publicDomainBookRows
            .map((book, index) => ({ book, index }))
            .sort((a, b) => {
                const direction = publicDomainSortDirection === 'desc' ? -1 : 1;
                let sortResult = 0;

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
    ), [activePublicDomainSort, publicDomainBookRows, publicDomainSortDirection]);
    const favoriteBooks = useMemo(() => books.filter(isBookFavorite), [books]);
    const recentBooks = useMemo(() => (
        books
            .map((book, index) => ({ book, index }))
            .sort((a, b) => {
                const timestampDiff = getBookRecentTimestamp(b.book) - getBookRecentTimestamp(a.book);
                return timestampDiff || a.index - b.index;
            })
            .map(({ book }) => book)
    ), [books]);
    const bookFilterCounts = useMemo(() => ({
        favorites: favoriteBooks.length,
        all: books.length,
        'public-domain': sortedPublicDomainBookRows.length,
    }), [books.length, favoriteBooks.length, sortedPublicDomainBookRows.length]);
    const filteredLibraryBooks = useMemo(() => {
        if (activeBookFilter === 'favorites') {
            return favoriteBooks;
        }

        return recentBooks;
    }, [activeBookFilter, favoriteBooks, recentBooks]);
    const showingPublicDomainBooks = activeLibraryTab === 'Books' && activeBookFilter === 'public-domain';
    const bookSectionLabel = showingPublicDomainBooks
        ? t('home.publicDomainCount', {
            count: sortedPublicDomainBookRows.length,
            noun: sortedPublicDomainBookRows.length === 1 ? t('home.bookSingular') : t('home.bookPlural'),
        })
        : activeBookFilter === 'favorites'
            ? t('home.favoriteCount', {
                count: favoriteBooks.length,
                noun: favoriteBooks.length === 1 ? t('home.bookSingular') : t('home.bookPlural'),
            })
            : t('home.bookCount', {
                count: books.length,
                noun: books.length === 1 ? t('home.bookSingular') : t('home.bookPlural'),
            });
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
            return publicDomainBookRows.find((book) => book.uri === previewBook.uri) ?? previewBook;
        }

        return books.find((book) => (
            (previewBook.cloudId && book.cloudId === previewBook.cloudId)
            || (previewBook.uri && book.uri === previewBook.uri)
            || (previewBook.id && book.id === previewBook.id)
        )) ?? previewBook;
    }, [books, publicDomainBookRows, selectedBookPreview]);
    const isFloatingOcrVisible = Platform.OS === 'android' && ocrStatus.floatingVisible;

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
            song,
        }).catch((error) => {
            console.warn('[Home] Failed to sync song:', error?.message ?? error);
        });
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

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

        const cloudRows = await fetchUserSongs(user.id, { includeDeleted: true });
        if (!isCurrentSyncGeneration(generation) || ownerId !== activeOwnerIdRef.current) {
            return;
        }

        const normalizedLocalSongs = songs.map(normalizeStoredSong).filter(Boolean);
        const { songs: mergedSongs, localOnly } = mergeLocalAndCloudSongs(normalizedLocalSongs, cloudRows);

        if (!isCurrentSyncGeneration(generation) || ownerId !== activeOwnerIdRef.current) {
            return;
        }

        setSongs((currentSongs) => (
            isCurrentSyncGeneration(generation) && ownerId === activeOwnerIdRef.current
                ? mergedSongs
                : currentSongs
        ));

        if (!isCurrentSyncGeneration(generation) || ownerId !== activeOwnerIdRef.current) {
            return;
        }

        for (const song of localOnly) {
            if (!isCurrentSyncGeneration(generation) || ownerId !== activeOwnerIdRef.current) {
                return;
            }

            try {
                assertCanUploadForOwner({ ownerId, user });
                await upsertUserSong({
                    user,
                    ownerId,
                    generation,
                    song,
                });
            } catch (error) {
                console.warn('[Home] Failed to upload local song:', error?.message ?? error);
            }
        }
    }, [activeOwnerId, songs, syncGeneration, syncPaused, user]);

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
            floatingVisible: typeof nextStatus.floatingVisible === 'boolean'
                ? nextStatus.floatingVisible
                : previous.floatingVisible,
            resultOverlayVisible: typeof nextStatus.resultOverlayVisible === 'boolean'
                ? nextStatus.resultOverlayVisible
                : previous.resultOverlayVisible,
        }));
    }, []);

    const waitForScreenCapture = useCallback(async () => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
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

            try {
                const storageKey = getSongsStorageKey(ownerId);
                let storedSongs = await AsyncStorage.getItem(storageKey);

                if (!storedSongs && ownerId === GUEST_OWNER_ID) {
                    const legacySongs = await AsyncStorage.getItem(LEGACY_SONGS_STORAGE_KEY);
                    if (legacySongs) {
                        const parsedLegacySongs = JSON.parse(legacySongs);
                        if (Array.isArray(parsedLegacySongs)) {
                            const normalizedLegacySongs = parsedLegacySongs
                                .map(normalizeStoredSong)
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

                setSongs(parsedSongs.map(normalizeStoredSong).filter(Boolean));
            } catch (error) {
                console.error('[Home] Failed to load songs:', error);
            } finally {
                if (isActive) {
                    setSongsLoaded(true);
                }
            }
        };

        loadSongs();

        return () => {
            isActive = false;
        };
    }, [activeOwnerId, t]);

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
            setOcrMessage(error.message || t('home.ocrFailed'));
        });

        return () => {
            statusSubscription.remove();
            errorSubscription.remove();
        };
    }, [mergeOcrStatus, t]);

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

        AsyncStorage.setItem(getSongsStorageKey(activeOwnerId), serializedSongs)
            .then(() => {
                songStorageLimitAlertedRef.current = false;
            })
            .catch((error) => {
                console.error('[Home] Failed to save songs:', error);
            });
    }, [activeOwnerId, songs, songsLoaded, t]);

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

        const syncKey = `${activeOwnerId}:${user.id}`;
        if (songCloudSyncOwnerRef.current === syncKey) {
            return;
        }

        songCloudSyncOwnerRef.current = syncKey;
        syncSongsFromCloud().catch((error) => {
            songCloudSyncOwnerRef.current = null;
            console.warn('[Home] Failed to sync cloud songs:', error?.message ?? error);
        });
    }, [activeOwnerId, songsLoaded, syncGeneration, syncPaused, syncSongsFromCloud, user?.id]);

    useEffect(() => {
        if (selectedSongId && !selectedSong) {
            setSelectedSongId(null);
        }
    }, [selectedSong, selectedSongId]);

    useEffect(() => {
        const shouldHideTabBar = !!selectedSong || !!selectedPreviewBook;

        navigation?.setOptions({
            tabBarStyle: shouldHideTabBar ? { display: 'none' } : tabBarBaseStyle,
        });

        return () => {
            navigation?.setOptions({
                tabBarStyle: tabBarBaseStyle,
            });
        };
    }, [navigation, selectedPreviewBook, selectedSong]);

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
        setOcrMessage(isFloatingOcrVisible ? t('home.ocrTurningOff') : t('home.ocrStarting'));

        try {
            if (isFloatingOcrVisible) {
                await stopFloatingWidget();
                mergeOcrStatus({ floatingVisible: false, resultOverlayVisible: false });
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
                    captureActive = await waitForScreenCapture();
                }
            }

            if (!captureActive) {
                mergeOcrStatus({ screenCaptureActive: false, floatingVisible: false });
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
            const message = error?.message || t('home.ocrFailed');
            setOcrMessage(message);
            Alert.alert(t('home.ocrScanner'), message);
        } finally {
            ocrActionInFlightRef.current = false;
            setOcrBusy(false);
        }
    }, [isFloatingOcrVisible, mergeOcrStatus, ocrBusy, persistOcrSettings, t, waitForScreenCapture]);

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
        if (downloadingBookId) {
            return;
        }

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
            navigation.navigate('Read');
        } catch (error) {
            console.warn('[Home] Failed to download cloud book:', error);
            Alert.alert(t('home.downloadFailedTitle'), error?.message || t('home.downloadFailedBody'));
        } finally {
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

        if (!isBookDownloaded(book)) {
            handleDownloadBook(book);
            return;
        }

        const openedAt = new Date().toISOString();
        updateBookRecord(book, { lastOpenedAt: openedAt });
        handlePress(book.uri);
    }, [activeBookMenuKey, handleDownloadBook, handlePress, updateBookRecord]);

    const handlePublicDomainBookPress = useCallback((book) => {
        if (!book?.uri) {
            return;
        }

        const localBook = buildPublicDomainLocalBook(book, {
            lastOpenedAt: new Date().toISOString(),
        });

        setBooks((prevBooks) => {
            const exists = prevBooks.some((candidate) => candidate.uri === localBook.uri);
            if (exists) {
                return prevBooks.map((candidate) => (
                    candidate.uri === localBook.uri
                        ? {
                            ...localBook,
                            ...candidate,
                            publicDomain: true,
                            downloaded: true,
                            format: 'txt',
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
        setCurrentBook(localBook.uri);
        setPreprocessOnOpen(false);
        navigation.navigate('Read');
    }, [navigation, setBooks, setCurrentBook, setPreprocessOnOpen]);

    const addPublicDomainBookToLibrary = useCallback((book) => {
        if (!book?.uri) {
            return null;
        }

        const localBook = buildPublicDomainLocalBook(book);

        setBooks((prevBooks) => {
            const exists = prevBooks.some((candidate) => candidate.uri === localBook.uri);
            if (exists) {
                return prevBooks;
            }

            return [...prevBooks, localBook];
        });
        setActiveLibraryTab('Books');
        setActiveBookFilter('all');
        return localBook;
    }, [setBooks]);

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
                const exists = prevBooks.some((candidate) => candidate.uri === localBook.uri);
                if (exists) {
                    return prevBooks.map((candidate) => (
                        candidate.uri === localBook.uri
                            ? {
                                ...localBook,
                                ...candidate,
                                ...nextPatch,
                                publicDomain: true,
                                downloaded: true,
                                format: 'txt',
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

    const handleTogglePreviewCompleted = useCallback(() => {
        if (!selectedPreviewBook) {
            return;
        }

        const nextCompleted = !isBookCompleted(selectedPreviewBook);
        upsertPreviewBookPatch(selectedPreviewBook, {
            completed: nextCompleted,
            completedAt: nextCompleted ? new Date().toISOString() : null,
            progress: nextCompleted ? 1 : selectedPreviewBook.progress ?? 0,
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
                            await deleteBookIndexEntries(bookToDelete.uri, { ownerId: activeOwnerId });
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
            title: book.title || '',
            author: book.author || '',
            cover: book.cover || '',
        });
    }, []);

    const handleDeletePreviewBook = useCallback(() => {
        if (!selectedPreviewBook) {
            return;
        }

        const existsInLibrary = books.some((book) => (
            selectedPreviewBook.cloudId
                ? book.cloudId === selectedPreviewBook.cloudId
                : book.uri === selectedPreviewBook.uri
        ));

        if (selectedPreviewBook.publicDomain && !existsInLibrary) {
            Alert.alert(t('home.notInLibraryTitle'), t('home.notInLibraryBody'));
            return;
        }

        handleDeleteBook(selectedPreviewBook);
    }, [books, handleDeleteBook, selectedPreviewBook, t]);

    const handleEditPreviewBook = useCallback(() => {
        if (!selectedPreviewBook) {
            return;
        }

        if (selectedPreviewBook.publicDomain) {
            const localBook = buildPublicDomainLocalBook(selectedPreviewBook);
            setBooks((prevBooks) => {
                const exists = prevBooks.some((book) => book.uri === localBook.uri);
                if (exists) {
                    return prevBooks;
                }

                return [...prevBooks, localBook];
            });
            setSelectedBookPreview(null);
            handleEditBook(localBook);
            return;
        }

        setSelectedBookPreview(null);
        handleEditBook(selectedPreviewBook);
    }, [handleEditBook, selectedPreviewBook, setBooks]);

    const handleResetBookToOriginal = useCallback(async (book) => {
        if (!book) {
            return;
        }

        setActiveBookMenuKey(null);

        const publicDomainOriginal = book.publicDomain
            ? publicDomainBooks.find((candidate) => candidate.uri === book.uri)
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
                title: String(book.originalTitle || book.title || t('common.untitled')).trim() || t('common.untitled'),
                author: String(book.originalAuthor || book.author || t('common.unknownAuthor')).trim() || t('common.unknownAuthor'),
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
            const fallbackName = book.originalFilename || book.title || t('common.untitled');
            const metadata = isPdfBook(book)
                ? await readPdfMetadata(book.uri, fallbackName)
                : await readEpubMetadata(book.uri, fallbackName);
            const title = String(metadata?.title || book.title || t('common.untitled')).trim() || t('common.untitled');
            const author = String(metadata?.author || book.author || t('common.unknownAuthor')).trim() || t('common.unknownAuthor');
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
            Alert.alert(t('home.resetFailedTitle'), error?.message || t('home.resetFailedBody'));
        }
    }, [publicDomainBooks, t, updateBookRecord]);

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
            title: editDraft.title.trim() || t('common.untitled'),
            author: editDraft.author.trim() || t('common.unknownAuthor'),
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

    const handleAddSong = useCallback(() => {
        setSongDraft(EMPTY_SONG_DRAFT);
        setShowAddSongModal(true);
    }, []);

    const handleCancelSongAdd = useCallback(() => {
        setShowAddSongModal(false);
        setSongDraft(EMPTY_SONG_DRAFT);
    }, []);

    const handleSubmitSong = useCallback(() => {
        const title = songDraft.title.trim();
        const artist = songDraft.artist.trim() || t('common.unknownArtist');
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
    }, [songDraft.artist, songDraft.lyrics, songDraft.title, songs, syncSongToCloud, t]);

    const handleUpdateSong = useCallback((songId, patch) => {
        const currentSong = songs.find((song) => song.id === songId);
        if (!currentSong) {
            return;
        }

        const nextSong = {
            ...currentSong,
            ...patch,
            lines: patch.lyrics !== undefined ? countSongLines(patch.lyrics) : currentSong.lines,
            updatedAt: new Date().toISOString(),
        };
        const updatedSong = normalizeStoredSong(nextSong) ?? currentSong;
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
    }, [songs, syncSongToCloud, t]);

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
        }).catch((error) => {
            console.warn('[Home] Failed to delete cloud song:', error?.message ?? error);
        });
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

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

    if (selectedSong) {
        return (
            <SongReader
                song={selectedSong}
                onClose={() => setSelectedSongId(null)}
                onSongUpdate={(patch) => handleUpdateSong(selectedSong.id, patch)}
                onSongDelete={() => handleDeleteSong(selectedSong.id)}
                onSavedTermsChange={handleSelectedSongSavedTermsChange}
            />
        );
    }

    if (selectedPreviewBook) {
        const previewKey = getBookKey(selectedPreviewBook, `${selectedBookPreview?.index ?? 0}`);
        const previewUri = selectedPreviewBook.uri;
        const previewBookInLibrary = selectedPreviewBook.publicDomain
            ? books.some((book) => book.uri === selectedPreviewBook.uri)
            : true;
        const previewActionBusy = (
            (!isBookDownloaded(selectedPreviewBook) && downloadingBookId === previewKey)
            || (!!previewUri && openingBookUri === previewUri)
        );

        return (
            <BookPreview
                book={selectedPreviewBook}
                index={selectedBookPreview?.index ?? 0}
                contentWidth={contentWidth}
                actionBusy={previewActionBusy}
                isInLibrary={previewBookInLibrary}
                onBack={() => setSelectedBookPreview(null)}
                onRead={handleReadPreviewBook}
                onAddToLibrary={handleAddPreviewBookToLibrary}
                onToggleFavorite={handleTogglePreviewFavorite}
                onToggleCompleted={handleTogglePreviewCompleted}
                onDelete={handleDeletePreviewBook}
                onEdit={handleEditPreviewBook}
            />
        );
    }

    return (
        <Screen scroll backgroundColor={HOME_COLORS.bg} contentContainerStyle={styles.screenContent}>
            <Pressable
                accessible={false}
                disabled={!activeBookMenuKey}
                onPress={() => setActiveBookMenuKey(null)}
                style={styles.stack}
            >
                <View style={styles.homeHeroHeader}>
                    <Text style={styles.homeHeroEyebrow}>{t('home.title')}</Text>
                    <Text style={styles.homeHeroTitle}>
                        {t('home.heroTitle')}
                    </Text>
                    <Text style={styles.homeHeroSubtitle}>
                        {t('home.heroSubtitle')}
                    </Text>
                </View>

                {currentReadingBook ? (
                    <Pressable
                        onPress={() => handleBookPress(currentReadingBook)}
                        style={({ pressed }) => [pressed && styles.pressed]}
                    >
                        <View style={styles.continueCard}>
                            <BookCover
                                book={currentReadingBook}
                                width={46}
                                height={62}
                                index={0}
                                style={styles.continueCover}
                                titleStyle={styles.continueCoverText}
                                showBars={false}
                            />

                            <View style={styles.continueCopy}>
                                <Text style={styles.continueEyebrow}>
                                    {isBookDownloaded(currentReadingBook)
                                        ? t('home.continue', { percent: currentProgressPercent })
                                        : t('home.cloudBook')}
                                </Text>
                                <View style={styles.continueMetaRow}>
                                    <Text
                                        style={[
                                            styles.continueTitle,
                                            getSerifFontForText(getBookTitle(currentReadingBook, t)),
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {getBookTitle(currentReadingBook, t)}
                                    </Text>
                                    <Text style={styles.continueDivider}>·</Text>
                                    <Text
                                        style={[
                                            styles.continueAuthor,
                                            hasKoreanText(getBookAuthor(currentReadingBook, t)) && styles.koreanInlineText,
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {getBookAuthor(currentReadingBook, t)}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.continuePlayButton}>
                                <Ionicons
                                    name={isBookDownloaded(currentReadingBook) ? 'play' : 'download-outline'}
                                    size={18}
                                    color={HOME_COLORS.onAccent}
                                />
                            </View>
                        </View>
                    </Pressable>
                ) : (
                    <View style={styles.emptyContinueCard}>
                        <Feather name="book-open" size={24} color={HOME_COLORS.accent} />
                        <Text style={styles.emptyContinueTitle}>
                            {t('home.chooseBook')}
                        </Text>
                    </View>
                )}

                <View style={styles.libraryControls}>
                    <View style={styles.libraryHeader}>
                        <View style={styles.libraryTabs}>
                            <TouchableOpacity
                                activeOpacity={0.82}
                                onPress={() => {
                                    setActiveBookMenuKey(null);
                                    setActiveLibraryTab('Books');
                                }}
                                style={styles.libraryTab}
                            >
                                <View style={styles.libraryTabLabelRow}>
                                    <Text style={[
                                        styles.libraryTabText,
                                        activeLibraryTab === 'Books' && styles.libraryTabTextActive,
                                    ]}>
                                        {t('home.books')}
                                    </Text>
                                </View>
                                {activeLibraryTab === 'Books' ? <View style={styles.libraryTabUnderline} /> : null}
                            </TouchableOpacity>

                            <TouchableOpacity
                                activeOpacity={0.82}
                                onPress={() => {
                                    setActiveBookMenuKey(null);
                                    setActiveLibraryTab('Songs');
                                }}
                                style={styles.libraryTab}
                            >
                                <View style={styles.libraryTabLabelRow}>
                                    <Text style={[
                                        styles.libraryTabText,
                                        activeLibraryTab === 'Songs' && styles.libraryTabTextActive,
                                    ]}>
                                        {t('home.songs')}
                                    </Text>
                                </View>
                                {activeLibraryTab === 'Songs' ? <View style={styles.libraryTabUnderline} /> : null}
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            activeOpacity={0.84}
                            accessibilityRole="switch"
                            accessibilityLabel={isFloatingOcrVisible ? t('home.turnOcrOff') : t('home.turnOcrOn')}
                            accessibilityState={{ checked: isFloatingOcrVisible, busy: ocrBusy }}
                            disabled={ocrBusy}
                            onPress={handleFloatingOcrToggle}
                            style={[
                                styles.ocrTabToggle,
                                isFloatingOcrVisible && styles.ocrTabToggleActive,
                                ocrBusy && styles.ocrTabToggleBusy,
                            ]}
                        >
                            {ocrBusy ? (
                                <ActivityIndicator size="small" color={HOME_COLORS.accent} />
                            ) : (
                                <Ionicons
                                    name="scan-outline"
                                    size={15}
                                    color={isFloatingOcrVisible ? HOME_COLORS.onAccent : HOME_COLORS.accent}
                                />
                            )}
                            <Text style={[
                                styles.ocrTabToggleText,
                                isFloatingOcrVisible && styles.ocrTabToggleTextActive,
                            ]}>
                                {t('home.ocr')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.libraryDivider} />
                </View>

            {activeLibraryTab === 'Books' ? (
                <View style={styles.booksSection}>
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
                                    accessibilityLabel={`${t(filter.labelKey)}, ${count} ${t('home.bookPlural')}`}
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

                    {!showingPublicDomainBooks ? (
                        <>
                            <View style={styles.bookSectionHeader}>
                                <View style={styles.bookSectionCopy}>
                                    <Text style={styles.bookSectionCount}>
                                        {bookSectionLabel}
                                    </Text>
                                </View>
                                {activeBookFilter === 'all' ? (
                                    <View style={styles.bookSectionActions}>
                                        <TouchableOpacity
                                            activeOpacity={0.84}
                                            onPress={confirmAddBook}
                                            style={styles.importInlineButton}
                                        >
                                            {isImporting ? (
                                                <ActivityIndicator size="small" color={HOME_COLORS.accent} />
                                            ) : (
                                                <Text style={styles.importInlineText}>{t('home.importBook')}</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                ) : null}
                            </View>

                            {filteredLibraryBooks.length === 0 ? (
                                <View style={styles.emptyBooksPanel}>
                                    <Text style={styles.emptyBooksTitle}>
                                        {activeBookFilter === 'favorites' ? t('home.noFavoritesTitle') : t('home.noBooksTitle')}
                                    </Text>
                                    <Text style={styles.emptyBooksCopy}>
                                        {activeBookFilter === 'favorites'
                                            ? t('home.noFavoritesBody')
                                            : t('home.noBooksBody')}
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.bookGrid}>
                                    {filteredLibraryBooks.map((book, index) => {
                                        const bookKey = getBookKey(book, `${index}`);
                                        const isBookMenuOpen = activeBookMenuKey === bookKey;
                                        const shouldAlignMenuLeft = index % 3 === 0;

                                    return (
                                        <Pressable
                                            key={book.uri || book.id || `${book.title}-${index}`}
                                            onPress={() => handleBookPreviewPress(book, index)}
                                            style={({ pressed }) => [
                                                styles.bookTile,
                                                { width: bookTileWidth },
                                                isBookMenuOpen && styles.bookTileMenuOpen,
                                                pressed && styles.pressed,
                                            ]}
                                        >
                                            <BookCover
                                                book={book}
                                                width={bookTileWidth}
                                                height={bookCoverHeight}
                                                index={index}
                                                style={styles.bookCover}
                                                titleStyle={styles.bookCoverText}
                                            />
                                            {!isBookDownloaded(book) ? (
                                                <View style={styles.bookDownloadBadge}>
                                                    {downloadingBookId === bookKey ? (
                                                        <ActivityIndicator size="small" color={HOME_COLORS.onAccent} />
                                                    ) : (
                                                        <Feather name="download" size={14} color={HOME_COLORS.onAccent} />
                                                    )}
                                                </View>
                                            ) : null}
                                            <TouchableOpacity
                                                accessibilityRole="button"
                                                accessibilityLabel={t('home.bookOptions', { title: getBookTitle(book, t) })}
                                                activeOpacity={0.84}
                                                onPress={(event) => {
                                                    event?.stopPropagation?.();
                                                    setActiveBookMenuKey((currentKey) => (
                                                        currentKey === bookKey ? null : bookKey
                                                    ));
                                                }}
                                                style={styles.bookMenuButton}
                                            >
                                                <Feather name="more-vertical" size={16} color={HOME_COLORS.onAccent} />
                                            </TouchableOpacity>
                                            {isBookMenuOpen ? (
                                                <View style={[
                                                    styles.bookMenu,
                                                    shouldAlignMenuLeft ? styles.bookMenuLeft : styles.bookMenuRight,
                                                ]}>
                                                    <TouchableOpacity
                                                        activeOpacity={0.78}
                                                        onPress={(event) => {
                                                            event?.stopPropagation?.();
                                                            handleEditBook(book);
                                                        }}
                                                        style={styles.bookMenuItem}
                                                    >
                                                        <Feather name="edit-2" size={14} color={colors.text} />
                                                        <Text style={styles.bookMenuItemText}>{t('common.edit')}</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        activeOpacity={0.78}
                                                        onPress={(event) => {
                                                            event?.stopPropagation?.();
                                                            handleResetBookToOriginal(book);
                                                        }}
                                                        style={[styles.bookMenuItem, styles.bookMenuSeparatedItem]}
                                                    >
                                                        <Feather name="rotate-ccw" size={14} color={colors.text} />
                                                        <Text style={styles.bookMenuItemText}>{t('home.resetOriginal')}</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        activeOpacity={0.78}
                                                        onPress={(event) => {
                                                            event?.stopPropagation?.();
                                                            setActiveBookMenuKey(null);
                                                            handleDeleteBook(book);
                                                        }}
                                                        style={[styles.bookMenuItem, styles.bookMenuDangerItem]}
                                                    >
                                                        <Feather name="trash-2" size={14} color={colors.danger} />
                                                        <Text style={[styles.bookMenuItemText, styles.bookMenuDangerText]}>
                                                            {t('common.delete')}
                                                        </Text>
                                                    </TouchableOpacity>
                                                </View>
                                            ) : null}
                                            <Text
                                                style={[
                                                    styles.bookTitle,
                                                    getSerifFontForText(getBookTitle(book, t)),
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {getBookTitle(book, t)}
                                            </Text>
                                            <View style={styles.bookProgressRail}>
                                                <View style={[
                                                    styles.bookProgressFill,
                                                    getBookProgress(book) > 0.75 && styles.bookProgressFillSuccess,
                                                    { width: `${Math.round(getBookProgress(book) * 100)}%` },
                                                ]} />
                                            </View>
                                            {!isBookDownloaded(book) ? (
                                                <Text style={styles.bookCloudMeta} numberOfLines={1}>
                                                    {downloadingBookId === bookKey
                                                        ? t('home.downloading')
                                                        : t('home.availableToDownload')}
                                                </Text>
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                                </View>
                            )}
                        </>
                    ) : showingPublicDomainBooks ? (
                        <>
                            <View style={styles.bookSectionHeader}>
                                <View style={styles.bookSectionCopy}>
                                    <Text style={styles.bookSectionCount}>
                                        {bookSectionLabel}
                                    </Text>
                                    {bookSectionHint ? (
                                        <Text style={styles.bookSectionHint}>{bookSectionHint}</Text>
                                    ) : null}
                                </View>
                            </View>

                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.publicDomainSortRow}
                            >
                                {PUBLIC_DOMAIN_SORTS.map((sort) => {
                                    const isActive = activePublicDomainSort === sort.id;

                                    return (
                                        <TouchableOpacity
                                            key={sort.id}
                                            activeOpacity={0.84}
                                            onPress={() => {
                                                setActiveBookMenuKey(null);
                                                if (isActive) {
                                                    setPublicDomainSortDirection((currentDirection) => (
                                                        currentDirection === 'asc' ? 'desc' : 'asc'
                                                    ));
                                                    return;
                                                }

                                                setActivePublicDomainSort(sort.id);
                                                setPublicDomainSortDirection('asc');
                                            }}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('home.sortPublicDomain', {
                                                label: t(sort.labelKey),
                                                direction: isActive && publicDomainSortDirection === 'desc'
                                                    ? t('home.descending')
                                                    : t('home.ascending'),
                                            })}
                                            style={[
                                                styles.publicDomainSortChip,
                                                isActive && styles.publicDomainSortChipActive,
                                            ]}
                                        >
                                            <Text style={[
                                                styles.publicDomainSortChipText,
                                                isActive && styles.publicDomainSortChipTextActive,
                                            ]}>
                                                {t(sort.labelKey)}
                                            </Text>
                                            {isActive ? (
                                                <Feather
                                                    name={publicDomainSortDirection === 'asc' ? 'arrow-up' : 'arrow-down'}
                                                    size={12}
                                                    color={HOME_COLORS.accentDeep}
                                                />
                                            ) : null}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            <View style={styles.bookGrid}>
                                {sortedPublicDomainBookRows.map((book, index) => (
                                    <Pressable
                                        key={book.uri}
                                        onPress={() => handleBookPreviewPress(book, index)}
                                        style={({ pressed }) => [
                                            styles.bookTile,
                                            { width: bookTileWidth },
                                            pressed && styles.pressed,
                                        ]}
                                    >
                                        <BookCover
                                            book={book}
                                            width={bookTileWidth}
                                            height={bookCoverHeight}
                                            index={index}
                                            style={styles.bookCover}
                                            titleStyle={styles.bookCoverText}
                                        />
                                        <Text
                                            style={[
                                                styles.bookTitle,
                                                getSerifFontForText(getBookTitle(book, t)),
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {getBookTitle(book, t)}
                                        </Text>
                                        <Text style={styles.publicDomainAuthor} numberOfLines={1}>
                                            {getBookAuthor(book, t)}
                                        </Text>
                                        <View style={styles.publicDomainMetaRow}>
                                            {book?.genre ? (
                                                <View style={styles.publicDomainGenreTag}>
                                                    <Text style={styles.publicDomainGenreText} numberOfLines={1}>
                                                        {book.genre}
                                                    </Text>
                                                </View>
                                            ) : null}
                                            <Text style={styles.publicDomainWordCount} numberOfLines={1}>
                                                {formatWordCount(getBookWordCount(book), t)}
                                            </Text>
                                        </View>
                                    </Pressable>
                                ))}
                            </View>
                        </>
                    ) : null}
                </View>
            ) : (
                <View style={styles.songsPanel}>
                    <View style={styles.songsActionRow}>
                        <TouchableOpacity
                            activeOpacity={0.88}
                            onPress={handleAddSong}
                            style={styles.songTextAction}
                        >
                            <Text style={styles.songTextActionLabel}>{t('home.addSong')}</Text>
                        </TouchableOpacity>
                    </View>
                    {songsLoaded && songs.length === 0 ? (
                        <View style={styles.emptySongsPanel}>
                            <Feather name="music" size={24} color={HOME_COLORS.accent} />
                            <Text style={styles.emptySongsTitle}>{t('home.emptySongsTitle')}</Text>
                            <Text style={styles.emptySongsCopy}>
                                {t('home.emptySongsBody')}
                            </Text>
                        </View>
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
                                        <View style={styles.songCopy}>
                                            <Text
                                                style={[
                                                    styles.songTitle,
                                                    getSerifFontForText(song.title),
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {song.title}
                                            </Text>
                                            <Text style={styles.songMeta} numberOfLines={1}>
                                                {song.artist}
                                            </Text>
                                        </View>
                                        <Feather name="chevron-right" size={23} color={HOME_COLORS.faint} />
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

            <Modal visible={showAddSongModal} animationType="fade" transparent onRequestClose={() => {}}>
                <View style={styles.modalBackdrop}>
                    <TouchableWithoutFeedback>
                        <View style={styles.songModal}>
                            <Text style={styles.editTitle}>{t('home.addSongTitle')}</Text>

                            <ScrollView
                                style={styles.songModalScroll}
                                contentContainerStyle={styles.songModalContent}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                            >
                                <Text style={styles.editLabel}>{t('common.title')}</Text>
                                <TextInput
                                    value={songDraft.title}
                                    onChangeText={(title) => setSongDraft((prev) => ({ ...prev, title }))}
                                    style={styles.editInput}
                                    placeholder={t('home.songTitlePlaceholder')}
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>{t('common.artist')}</Text>
                                <TextInput
                                    value={songDraft.artist}
                                    onChangeText={(artist) => setSongDraft((prev) => ({ ...prev, artist }))}
                                    style={styles.editInput}
                                    placeholder={t('common.artist')}
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>{t('common.lyrics')}</Text>
                                <TextInput
                                    value={songDraft.lyrics}
                                    onChangeText={(lyrics) => setSongDraft((prev) => ({ ...prev, lyrics }))}
                                    style={[styles.editInput, styles.lyricsInput]}
                                    placeholder={t('home.pasteLyrics')}
                                    placeholderTextColor={colors.textSubtle}
                                    multiline
                                    textAlignVertical="top"
                                />
                            </ScrollView>

                            <View style={styles.songModalActions}>
                                <TouchableOpacity
                                    activeOpacity={0.84}
                                    onPress={handleCancelSongAdd}
                                    style={[styles.songModalButton, styles.songModalButtonSecondary]}
                                >
                                    <Text style={styles.songModalButtonSecondaryText}>{t('common.cancel')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    activeOpacity={0.84}
                                    onPress={handleSubmitSong}
                                    style={[styles.songModalButton, styles.songModalButtonPrimary]}
                                >
                                    <Text style={styles.songModalButtonPrimaryText}>{t('common.submit')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </Modal>
        </Screen>
    );
};

const styles = StyleSheet.create({
    screenContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: spacing.xl * 2,
    },
    stack: {
        gap: 0,
    },
    homeHeroHeader: {
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingTop: 26,
        paddingBottom: 2,
    },
    homeHeroEyebrow: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14.5,
        textTransform: 'uppercase',
        letterSpacing: 1.32,
        color: HOME_COLORS.sub,
    },
    homeHeroTitle: {
        fontFamily: fontFamilies.serifBold,
        marginTop: 8,
        fontSize: 27,
        lineHeight: 32,
        letterSpacing: -0.4,
        color: HOME_COLORS.text,
    },
    homeHeroSubtitle: {
        fontFamily: fontFamilies.sansRegular,
        marginTop: 10,
        maxWidth: 346,
        fontSize: 14,
        lineHeight: 21,
        color: HOME_COLORS.sub,
    },
    previewScreenContent: {
        paddingHorizontal: 0,
        paddingBottom: 0,
    },
    previewScrollContent: {
        paddingHorizontal: insets.screenHorizontal,
        paddingTop: spacing.lg,
        paddingBottom: spacing.xl * 2,
    },
    previewScroll: {
        flex: 1,
    },
    previewStack: {
        gap: spacing.lg,
    },
    previewTopBar: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: insets.screenHorizontal,
        paddingBottom: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: '#e6d7bf',
    },
    previewBackButton: {
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
    },
    previewTopTitle: {
        ...textStyles.sectionTitle,
        fontSize: 16,
        lineHeight: 21,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    previewTopReadButton: {
        minWidth: 84,
        height: 38,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: spacing.sm,
        borderRadius: 999,
        backgroundColor: colors.accentStrong,
    },
    previewTopReadButtonDisabled: {
        opacity: 0.74,
    },
    previewTopReadButtonText: {
        ...textStyles.sectionTitle,
        fontSize: 14,
        lineHeight: 18,
        color: colors.white,
        letterSpacing: 0,
    },
    previewHero: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: spacing.md,
    },
    previewBookVisualColumn: {
        flexShrink: 0,
        gap: spacing.sm,
    },
    previewBookVisual: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
    },
    previewCover: {
        borderRadius: 8,
    },
    previewCoverText: {
        fontSize: 13,
        lineHeight: 18,
    },
    previewBookSpine: {
        position: 'relative',
        borderTopLeftRadius: 1,
        borderTopRightRadius: 1,
        overflow: 'hidden',
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
        backgroundColor: 'rgba(255,255,255,0.1)',
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
        minWidth: 118,
        alignItems: 'flex-end',
        gap: spacing.xs,
        paddingTop: spacing.sm,
    },
    previewAddLibraryButton: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: radii.xs,
        backgroundColor: colors.accentStrong,
    },
    previewAddLibraryButtonText: {
        ...textStyles.sectionTitle,
        fontSize: 14,
        lineHeight: 18,
        color: colors.white,
        letterSpacing: 0,
    },
    previewActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    previewActionButton: {
        flex: 1,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.xs,
        borderWidth: 1,
        borderColor: '#e6d7bf',
        backgroundColor: colors.surface,
    },
    previewActionButtonActive: {
        borderColor: '#ddb76d',
        backgroundColor: '#fff4d8',
    },
    previewActionButtonDanger: {
        borderColor: '#ecd0cb',
        backgroundColor: '#fff7f5',
    },
    previewEyebrow: {
        ...textStyles.eyebrow,
        width: '100%',
        textAlign: 'right',
        color: colors.accent,
        letterSpacing: 1.4,
    },
    previewTitle: {
        fontFamily: fontFamilies.serifBold,
        width: '100%',
        fontSize: 26,
        lineHeight: 33,
        textAlign: 'right',
        color: colors.text,
        letterSpacing: 0,
    },
    previewAuthor: {
        ...textStyles.body,
        width: '100%',
        fontSize: 16,
        lineHeight: 22,
        textAlign: 'right',
        color: colors.textMuted,
    },
    previewProgressBlock: {
        gap: spacing.xs,
    },
    previewProgressHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    previewProgressLabel: {
        ...textStyles.caption,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    previewProgressValue: {
        ...textStyles.caption,
        color: colors.accentStrong,
        letterSpacing: 0,
    },
    previewProgressRail: {
        height: 5,
        borderRadius: 999,
        backgroundColor: '#e5dac7',
        overflow: 'hidden',
    },
    previewProgressFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: colors.accent,
    },
    previewMetaList: {
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: '#e6d7bf',
    },
    previewMetaRow: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: '#eadfcb',
    },
    previewMetaLabel: {
        ...textStyles.caption,
        flexShrink: 0,
        color: colors.textSubtle,
        letterSpacing: 0,
    },
    previewMetaValue: {
        ...textStyles.body,
        flex: 1,
        minWidth: 0,
        textAlign: 'right',
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
    },
    previewMetaValueGroup: {
        flex: 1,
        minWidth: 0,
        alignItems: 'flex-end',
        gap: 2,
    },
    previewMetaTranslation: {
        ...textStyles.caption,
        textAlign: 'right',
        color: colors.textSubtle,
        letterSpacing: 0,
    },
    previewSnippetSection: {
        gap: spacing.sm,
        paddingTop: spacing.xs,
    },
    previewSectionLabel: {
        ...textStyles.eyebrow,
        color: colors.textSubtle,
        letterSpacing: 1.4,
    },
    previewSnippetText: {
        ...textStyles.body,
        fontSize: 15,
        lineHeight: 22,
        color: colors.text,
    },
    previewAttributionText: {
        ...textStyles.caption,
        marginTop: spacing.xs,
        color: colors.textSubtle,
        letterSpacing: 0,
    },
    continueCard: {
        minHeight: 92,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginHorizontal: 22,
        marginTop: 28,
        paddingVertical: 14,
        paddingLeft: 16,
        paddingRight: 16,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: HOME_COLORS.continueBorder,
        backgroundColor: HOME_COLORS.paper,
        overflow: 'hidden',
        ...HOME_SHADOWS.card,
    },
    continueCover: {
        borderRadius: 4,
    },
    continueCoverText: {
        fontSize: 10,
        lineHeight: 14,
    },
    continueCopy: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    continueEyebrow: {
        ...textStyles.eyebrow,
        fontSize: 11,
        lineHeight: 14,
        color: HOME_COLORS.accent,
        letterSpacing: 0.66,
    },
    continueMetaRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        minWidth: 0,
        gap: spacing.xs,
    },
    continueTitle: {
        fontFamily: fontFamilies.serifBold,
        flexShrink: 1,
        maxWidth: '54%',
        fontSize: 16,
        lineHeight: 22,
        color: HOME_COLORS.text,
        letterSpacing: 0,
    },
    continueDivider: {
        ...textStyles.body,
        fontSize: 13,
        lineHeight: 17,
        color: HOME_COLORS.faint,
    },
    continueAuthor: {
        ...textStyles.body,
        flex: 1,
        minWidth: 0,
        fontSize: 16,
        lineHeight: 22,
        color: HOME_COLORS.faint,
    },
    koreanInlineText: {
        fontFamily: fontFamilies.krSerifMedium,
    },
    continuePlayButton: {
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HOME_COLORS.accent,
        ...HOME_SHADOWS.cta,
    },
    emptyContinueCard: {
        minHeight: 82,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        marginHorizontal: 22,
        marginTop: 16,
        borderRadius: radii.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.paper,
    },
    emptyContinueTitle: {
        ...textStyles.sectionTitle,
        fontSize: 16,
        color: HOME_COLORS.accent,
        letterSpacing: 0,
    },
    libraryControls: {
        gap: 0,
        marginTop: 22,
        overflow: 'visible',
    },
    libraryHeader: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        overflow: 'visible',
    },
    libraryTabs: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 22,
        overflow: 'visible',
    },
    libraryTab: {
        minHeight: 35,
        justifyContent: 'flex-start',
        overflow: 'visible',
    },
    libraryTabLabelRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingBottom: 8,
        overflow: 'visible',
    },
    libraryTabText: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 21,
        lineHeight: 27,
        color: HOME_COLORS.faint,
        includeFontPadding: true,
        letterSpacing: -0.2,
    },
    libraryTabTextActive: {
        color: HOME_COLORS.text,
    },
    libraryTabUnderline: {
        width: '100%',
        height: 3,
        borderRadius: 2,
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
        height: 1,
        marginHorizontal: 22,
        backgroundColor: HOME_COLORS.border,
    },
    booksSection: {
        gap: 0,
    },
    bookFilterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 22,
        paddingTop: 14,
        paddingBottom: 14,
    },
    bookFilterChip: {
        minHeight: 33,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingHorizontal: 15,
        paddingVertical: 7,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: 'transparent',
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
        paddingHorizontal: 22,
        paddingTop: 0,
        paddingBottom: 14,
    },
    bookSectionCopy: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    bookSectionCount: {
        ...textStyles.body,
        fontSize: 13,
        lineHeight: 18,
        color: HOME_COLORS.sub,
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
        ...textStyles.sectionTitle,
        fontSize: 14,
        lineHeight: 20,
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
        borderRadius: 16,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: 'rgba(250, 246, 238, 0.48)',
    },
    publicDomainSortChipActive: {
        borderColor: HOME_COLORS.accent,
        backgroundColor: HOME_COLORS.accentBg,
    },
    publicDomainSortChipText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        color: HOME_COLORS.sub,
        letterSpacing: 0,
    },
    publicDomainSortChipTextActive: {
        color: HOME_COLORS.accentDeep,
    },
    emptyBooksPanel: {
        minHeight: 132,
        justifyContent: 'center',
        gap: spacing.xs,
        marginHorizontal: 22,
        marginTop: 8,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 16,
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
    bookGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: BOOK_GRID_GAP,
        paddingHorizontal: HOME_CONTENT_HORIZONTAL_PADDING,
        paddingTop: 0,
        paddingBottom: 28,
    },
    bookTile: {
        gap: 0,
        position: 'relative',
    },
    bookTileMenuOpen: {
        zIndex: 20,
    },
    coverImage: {
        resizeMode: 'cover',
        backgroundColor: HOME_COLORS.surface2,
    },
    stacksCover: {
        overflow: 'hidden',
        position: 'relative',
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    stacksCoverSpine: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        zIndex: 5,
        backgroundColor: 'rgba(0, 0, 0, 0.08)',
    },
    stacksCoverCopy: {
        position: 'absolute',
    },
    stacksCoverTitle: {
        fontFamily: fontFamilies.krSerifBold,
        fontWeight: '600',
        letterSpacing: 0,
    },
    stacksCoverAuthor: {
        fontFamily: fontFamilies.sansRegular,
        letterSpacing: 0,
        opacity: 0.7,
    },
    stacksCoverBars: {
        position: 'absolute',
    },
    bookCover: {
        borderRadius: 5,
    },
    bookCoverText: {
        fontSize: 13,
        lineHeight: 18,
    },
    bookTitle: {
        ...textStyles.sectionTitle,
        marginTop: 8,
        fontSize: 13,
        lineHeight: 17,
        color: HOME_COLORS.text,
        letterSpacing: 0,
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
        borderRadius: 999,
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
    bookDownloadBadge: {
        position: 'absolute',
        top: 8,
        left: 8,
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HOME_COLORS.accent,
    },
    bookMenuButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 3,
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(44, 38, 32, 0.74)',
    },
    bookMenu: {
        position: 'absolute',
        top: 0,
        zIndex: 4,
        minWidth: 160,
        overflow: 'hidden',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        backgroundColor: HOME_COLORS.surface,
        shadowColor: HOME_COLORS.text,
        shadowOpacity: 0.16,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 7,
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
        paddingHorizontal: 22,
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
        fontSize: 14,
        lineHeight: 18,
        color: HOME_COLORS.accent,
    },
    songList: {
        borderWidth: 1,
        borderColor: HOME_COLORS.border,
        borderRadius: 16,
        backgroundColor: HOME_COLORS.surface,
        overflow: 'hidden',
    },
    songRow: {
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: HOME_COLORS.border,
    },
    songRowLast: {
        borderBottomWidth: 0,
    },
    songRowPressed: {
        backgroundColor: HOME_COLORS.paper,
    },
    songCopy: {
        flex: 1,
        minWidth: 0,
        paddingRight: spacing.sm,
    },
    songTitle: {
        fontFamily: fontFamilies.serifBold,
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
        borderRadius: radii.md,
        borderWidth: 1.5,
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
    loadingOverlay: {
        position: 'absolute',
        top: spacing.xl,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: 999,
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
    songModal: {
        maxHeight: '82%',
        backgroundColor: colors.surfaceElevated,
        borderRadius: 28,
        padding: spacing.xl,
        gap: spacing.md,
    },
    songModalScroll: {
        maxHeight: 460,
    },
    songModalContent: {
        gap: spacing.sm,
        paddingBottom: spacing.xs,
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

export default Home;
