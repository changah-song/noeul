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
import { IconButton, Screen, SectionHeader } from '../components/ui';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { colors, fontFamilies, insets, layout, radii, spacing, textStyles } from '../theme';
import useBooks from '../hooks/useBooks';
import { deleteBookIndexEntries } from '../services/Database';
import { downloadUserBook, softDeleteUserBook } from '../services/bookCloudSync';
import {
    fetchUserPreferences,
    getTimestampMs,
    updateUserPreferenceFields,
} from '../services/preferencesCloudSync';
import { readEpubMetadata } from '../services/epubMetadata';
import { getPublicDomainBooks } from '../services/publicDomainBooks';
import {
    cloudSongToLocalSong,
    fetchUserSongs,
    softDeleteUserSong,
    upsertUserSong,
} from '../services/songCloudSync';
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
    { id: 'favorites', label: 'Favorite books', iconOnly: true },
    { id: 'all', label: 'All books' },
    { id: 'public-domain', label: 'Public domain' },
];

const STACKS_COVER_PALETTES = [
    { bg: '#e7ddc8', accent: '#bf5b3e', ink: '#2f2820' },
    { bg: '#dde4d6', accent: '#5f7a4a', ink: '#27331f' },
    { bg: '#d7dfe7', accent: '#3f6184', ink: '#1f2a35' },
    { bg: '#ece1c8', accent: '#c0902f', ink: '#3a2f17' },
    { bg: '#e9d9d6', accent: '#9c4a52', ink: '#3a1f22' },
    { bg: '#dcd6e2', accent: '#6a5495', ink: '#2a2235' },
    { bg: '#d9e1dd', accent: '#2f7d6b', ink: '#16332c' },
    { bg: '#e7ded2', accent: '#8a6741', ink: '#322517' },
];

const STACKS_COVER_BAR_WIDTHS = [40, 64, 52, 80, 30];
const STACKS_COVER_REF_WIDTH = 200;
const STACKS_COVER_REF_HEIGHT = 298;

const KOREAN_TEXT_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
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
const getBookTitle = (book) => book?.title?.trim() || 'Untitled';
const getBookAuthor = (book) => book?.author?.trim() || 'Unknown author';
const hasKoreanText = (value) => KOREAN_TEXT_PATTERN.test(String(value || ''));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const formatFileSize = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
        return 'Unknown';
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

const formatPreviewDateTime = (value) => {
    if (!value) {
        return 'Not opened yet';
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return 'Not opened yet';
    }

    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

const formatBookLanguage = (language) => {
    const raw = String(language || '').trim();
    if (!raw) {
        return 'Unknown';
    }

    const shortCode = raw.toLowerCase().split(/[-_]/)[0];
    if (shortCode === 'ko' || shortCode === 'en') {
        return getLanguageLabel(shortCode);
    }

    return raw.toUpperCase();
};

const hashStacksCover = (value) => {
    let hash = 0;
    const source = String(value || '');
    for (let index = 0; index < source.length; index += 1) {
        hash = ((hash * 31) + source.charCodeAt(index)) >>> 0;
    }
    return hash;
};

const getStacksCoverPalette = (book) => {
    const source = `${getBookTitle(book)}${getBookAuthor(book)}`;
    return STACKS_COVER_PALETTES[hashStacksCover(source) % STACKS_COVER_PALETTES.length];
};

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
    const title = getBookTitle(book);
    const author = getBookAuthor(book);
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

const getBookStatusLabel = (book) => {
    if (book?.publicDomain) {
        return 'Ready to read';
    }

    return 'Progress';
};

const getBookFormatLabel = (book) => {
    if (book?.publicDomain) {
        return 'Public domain text';
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
    onBack,
    onRead,
    onToggleFavorite,
    onToggleCompleted,
    onDelete,
    onEdit,
}) => {
    const progressPercent = Math.round(getBookProgress(book) * 100);
    const isPublicDomain = !!book?.publicDomain;
    const coverWidth = Math.min(118, Math.max(92, Math.round(contentWidth * 0.3)));
    const coverHeight = Math.round(coverWidth * 1.34);
    const attributionNote = [
        book?.previewSource,
        book?.attributionCategory,
    ].filter(Boolean).join(' · ');
    const readIconName = isBookDownloaded(book) || isPublicDomain ? 'book-outline' : 'download-outline';
    const readActionLabel = actionBusy
        ? 'Preparing'
        : isBookDownloaded(book) || isPublicDomain
            ? 'Read'
            : 'Download';
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
                <Text style={styles.previewTopTitle}>Book</Text>
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
                <View style={[
                    styles.previewHero,
                    isPublicDomain && styles.previewHeroPublicDomain,
                ]}>
                    {!isPublicDomain ? (
                        <BookCover
                            book={book}
                            width={coverWidth}
                            height={coverHeight}
                            index={index}
                            style={styles.previewCover}
                            titleStyle={styles.previewCoverText}
                        />
                    ) : null}

                    <View style={styles.previewHeroCopy}>
                        <Text style={styles.previewEyebrow}>
                            {getBookFormatLabel(book)}
                        </Text>
                        <Text
                            style={[
                                styles.previewTitle,
                                getSerifFontForText(getBookTitle(book)),
                            ]}
                        >
                            {getBookTitle(book)}
                        </Text>
                        <Text
                            style={[
                                styles.previewAuthor,
                                hasKoreanText(getBookAuthor(book)) && styles.koreanInlineText,
                            ]}
                        >
                            {getBookAuthor(book)}
                        </Text>

                        <View style={styles.previewProgressBlock}>
                            <View style={styles.previewProgressHeader}>
                                <Text style={styles.previewProgressLabel}>{getBookStatusLabel(book)}</Text>
                                <Text style={styles.previewProgressValue}>{progressPercent}%</Text>
                            </View>
                            <View style={styles.previewProgressRail}>
                                <View style={[
                                    styles.previewProgressFill,
                                    { width: `${progressPercent}%` },
                                ]} />
                            </View>
                        </View>
                    </View>
                </View>

                <View style={styles.previewActionRow}>
                    <PreviewActionButton
                        label={favorite ? 'Remove favorite' : 'Favorite book'}
                        description={favorite ? 'Remove this book from favorites.' : 'Mark this book as a favorite.'}
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
                        label={completed ? 'Mark unfinished' : 'Mark completed'}
                        description={completed ? 'Mark this book as not completed.' : 'Mark this book as completed reading.'}
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
                        label="Delete book"
                        description="Remove this book from your library."
                        danger
                        onPress={onDelete}
                        icon={<Ionicons name="trash-outline" size={22} color={colors.danger} />}
                    />
                    <PreviewActionButton
                        label="Edit book"
                        description="Change the title, author, or cover."
                        onPress={onEdit}
                        icon={<Ionicons name="create-outline" size={22} color={colors.textMuted} />}
                    />
                </View>

                <View style={styles.previewMetaList}>
                        {isPublicDomain ? (
                            <>
                                <View style={styles.previewMetaRow}>
                                    <Text style={styles.previewMetaLabel}>Title</Text>
                                    <View style={styles.previewMetaValueGroup}>
                                        <Text
                                            style={[
                                                styles.previewMetaValue,
                                                getSerifFontForText(getBookTitle(book)),
                                            ]}
                                        >
                                            {getBookTitle(book)}
                                        </Text>
                                        {book?.titleTranslation ? (
                                            <Text style={styles.previewMetaTranslation}>
                                                {book.titleTranslation}
                                            </Text>
                                        ) : null}
                                    </View>
                                </View>
                                <View style={styles.previewMetaRow}>
                                    <Text style={styles.previewMetaLabel}>Author</Text>
                                    <View style={styles.previewMetaValueGroup}>
                                        <Text
                                            style={[
                                                styles.previewMetaValue,
                                                hasKoreanText(getBookAuthor(book)) && styles.koreanInlineText,
                                            ]}
                                        >
                                            {getBookAuthor(book)}
                                        </Text>
                                        {book?.authorTranslation ? (
                                            <Text style={styles.previewMetaTranslation}>
                                                {book.authorTranslation}
                                            </Text>
                                        ) : null}
                                    </View>
                                </View>
                            </>
                        ) : null}
                        {!isPublicDomain ? (
                            <>
                                <View style={styles.previewMetaRow}>
                                    <Text style={styles.previewMetaLabel}>Language</Text>
                                    <Text style={styles.previewMetaValue}>
                                        {formatBookLanguage(book?.language)}
                                    </Text>
                                </View>
                                <View style={styles.previewMetaRow}>
                                    <Text style={styles.previewMetaLabel}>Last opened</Text>
                                    <Text style={styles.previewMetaValue}>
                                        {formatPreviewDateTime(book?.lastOpenedAt)}
                                    </Text>
                                </View>
                                <View style={styles.previewMetaRow}>
                                    <Text style={styles.previewMetaLabel}>File size</Text>
                                    <Text style={styles.previewMetaValue}>
                                        {formatFileSize(book?.size)}
                                    </Text>
                                </View>
                            </>
                        ) : null}
                        {book?.genre ? (
                            <View style={styles.previewMetaRow}>
                                <Text style={styles.previewMetaLabel}>Genre</Text>
                                <Text style={styles.previewMetaValue}>{book.genre}</Text>
                            </View>
                        ) : null}
                </View>

                {isPublicDomain && book?.snippet ? (
                    <View style={styles.previewSnippetSection}>
                        <Text style={styles.previewSectionLabel}>Snippet</Text>
                        <Text style={styles.previewSnippetText}>{book.snippet}</Text>
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
    const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
    const [editBook, setEditBook] = useState(null);
    const [editDraft, setEditDraft] = useState({ title: '', author: '', cover: '' });
    const [activeLibraryTab, setActiveLibraryTab] = useState('Books');
    const [activeBookFilter, setActiveBookFilter] = useState('all');
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
    const activeOwnerIdRef = useRef(activeOwnerId);
    activeOwnerIdRef.current = activeOwnerId;
    const ocrActionInFlightRef = useRef(false);
    const ocrSettingsRef = useRef({ floatingPreferred: false, updatedAt: null });
    const ocrSettingsCloudUserRef = useRef(null);
    const { width } = useWindowDimensions();
    const {
        isImporting,
        openingBookUri,
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
    const bookTileWidth = Math.floor((contentWidth - (BOOK_GRID_GAP * 2)) / 3);
    const bookCoverHeight = Math.round(bookTileWidth * 1.34);
    const publicDomainBooks = useMemo(() => getPublicDomainBooks(), []);
    const publicDomainBookRows = useMemo(() => (
        publicDomainBooks.map((book) => {
            const localBook = books.find((candidate) => candidate.uri === book.uri);
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
                }
                : book;
        })
    ), [books, publicDomainBooks]);
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
        'public-domain': publicDomainBookRows.length,
    }), [books.length, favoriteBooks.length, publicDomainBookRows.length]);
    const filteredLibraryBooks = useMemo(() => {
        if (activeBookFilter === 'favorites') {
            return favoriteBooks;
        }

        return recentBooks;
    }, [activeBookFilter, favoriteBooks, recentBooks]);
    const showingEmptyLibraryPublicDomainIntro = books.length === 0 && activeBookFilter === 'all';
    const showingPublicDomainBooks = activeLibraryTab === 'Books'
        && (activeBookFilter === 'public-domain' || showingEmptyLibraryPublicDomainIntro);
    const bookSectionTitle = showingPublicDomainBooks
        ? showingEmptyLibraryPublicDomainIntro
            ? 'Start with a public domain book'
            : 'Public domain books'
        : activeBookFilter === 'favorites'
            ? 'Favorite books'
            : 'All books';
    const bookSectionHint = showingPublicDomainBooks
        ? showingEmptyLibraryPublicDomainIntro
            ? 'Pick a public domain book below, or import your own EPUB.'
            : 'Browse public domain Korean texts and add one to your library.'
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
                            storedSongs = JSON.stringify(normalizedLegacySongs);
                            await AsyncStorage.setItem(storageKey, storedSongs);
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
    }, [activeOwnerId]);

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
                setOcrMessage('Screen text scanner is ready.');
            } else if (status.status === 'floating_widget_hidden') {
                setOcrMessage('Screen text scanner is off.');
            } else if (status.status === 'screen_capture_stopped') {
                setOcrMessage('Screen capture stopped.');
            }
        });

        const errorSubscription = addOverlayErrorListener((error = {}) => {
            setOcrMessage(error.message || 'Screen text scanner failed.');
        });

        return () => {
            statusSubscription.remove();
            errorSubscription.remove();
        };
    }, [mergeOcrStatus]);

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

        AsyncStorage.setItem(getSongsStorageKey(activeOwnerId), JSON.stringify(songs)).catch((error) => {
            console.error('[Home] Failed to save songs:', error);
        });
    }, [activeOwnerId, songs, songsLoaded]);

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
            Alert.alert('Screen text scanner', 'Screen text scanning is only available on Android right now.');
            return;
        }

        ocrActionInFlightRef.current = true;
        setOcrBusy(true);
        setOcrMessage(isFloatingOcrVisible ? 'Turning scanner off...' : 'Starting scanner...');

        try {
            if (isFloatingOcrVisible) {
                await stopFloatingWidget();
                mergeOcrStatus({ floatingVisible: false, resultOverlayVisible: false });
                persistOcrSettings({ floatingPreferred: false });
                setOcrMessage('Screen text scanner is off.');
                return;
            }

            let overlayGranted = isOverlayPermissionGranted();
            if (!overlayGranted) {
                setOcrMessage('Allow display over other apps to use the floating scanner.');
                const overlayResult = await requestOverlayPermission();
                overlayGranted = !!overlayResult?.granted || isOverlayPermissionGranted();
            }

            if (!overlayGranted) {
                mergeOcrStatus({ overlayPermissionGranted: false });
                setOcrMessage('Display over other apps was not allowed.');
                return;
            }
            mergeOcrStatus({ overlayPermissionGranted: true });

            let captureActive = isScreenCaptureActive();
            if (!captureActive) {
                setOcrMessage('Allow screen capture once to start this scanner session.');
                const captureResult = await requestScreenCapture();
                captureActive = !!captureResult?.active || !!captureResult?.granted;
                if (captureActive) {
                    captureActive = await waitForScreenCapture();
                }
            }

            if (!captureActive) {
                mergeOcrStatus({ screenCaptureActive: false, floatingVisible: false });
                setOcrMessage('Screen capture was not allowed.');
                return;
            }
            mergeOcrStatus({ screenCaptureActive: true });

            const startResult = await startFloatingWidget();
            const visible = !!startResult?.visible;
            mergeOcrStatus({ floatingVisible: visible });
            persistOcrSettings({ floatingPreferred: visible });
            setOcrMessage(visible ? 'Tap the floating bubble to scan text.' : 'Scanner bubble did not start.');
        } catch (error) {
            const message = error?.message || 'Screen text scanner failed.';
            setOcrMessage(message);
            Alert.alert('Screen text scanner', message);
        } finally {
            ocrActionInFlightRef.current = false;
            setOcrBusy(false);
        }
    }, [isFloatingOcrVisible, mergeOcrStatus, ocrBusy, persistOcrSettings, waitForScreenCapture]);

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
            Alert.alert('Download unavailable', 'Sign in again to download this book.');
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
                            downloaded: true,
                            lastOpenedAt: openedAt,
                        };
                    }

                    return candidate;
                });

                return replaced ? nextBooks : [...nextBooks, { ...localBook, lastOpenedAt: openedAt }];
            });
            setCurrentBook(localBook.uri);
            navigation.navigate('Read');
        } catch (error) {
            console.warn('[Home] Failed to download cloud book:', error);
            Alert.alert('Download failed', error?.message || 'This book could not be downloaded right now.');
        } finally {
            setDownloadingBookId(null);
        }
    }, [activeOwnerId, downloadingBookId, navigation, setBooks, setCurrentBook, syncGeneration, syncPaused, user]);

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
            'Remove book',
            `Remove "${getBookTitle(bookToDelete)}" from your collection?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
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
    }, [activeOwnerId, currentBook, setBooks, setCurrentBook, setPreprocessOnOpen, syncGeneration, user]);

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
            Alert.alert('Not in library', 'This public domain text has not been added to your library yet.');
            return;
        }

        handleDeleteBook(selectedPreviewBook);
    }, [books, handleDeleteBook, selectedPreviewBook]);

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
            updateBookRecord(book, {
                title: String(book.originalTitle || book.title || 'Untitled').trim() || 'Untitled',
                author: String(book.originalAuthor || book.author || 'Unknown author').trim() || 'Unknown author',
                cover: book.originalCover ?? null,
            });
            return;
        }

        if (!isBookDownloaded(book) || !book.uri) {
            Alert.alert('Reset unavailable', 'Original metadata is only available after this book is downloaded.');
            return;
        }

        try {
            const metadata = await readEpubMetadata(
                book.uri,
                book.originalFilename || book.title || 'Untitled'
            );
            const title = String(metadata?.title || book.title || 'Untitled').trim() || 'Untitled';
            const author = String(metadata?.author || book.author || 'Unknown author').trim() || 'Unknown author';
            const cover = metadata?.cover ?? null;

            updateBookRecord(book, {
                title,
                author,
                cover,
                originalTitle: title,
                originalAuthor: author,
                originalCover: cover,
            });
        } catch (error) {
            console.warn('[Home] Failed to reset book metadata:', error);
            Alert.alert('Reset failed', error?.message || 'Original book metadata could not be restored.');
        }
    }, [publicDomainBooks, updateBookRecord]);

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

    const handleSaveBookEdit = useCallback(() => {
        if (!editBook) {
            return;
        }

        updateBookRecord(editBook, {
            title: editDraft.title.trim() || 'Untitled',
            author: editDraft.author.trim() || 'Unknown author',
            cover: editDraft.cover.trim() || null,
        });
        setEditBook(null);
    }, [editBook, editDraft.author, editDraft.cover, editDraft.title, updateBookRecord]);

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
        const artist = songDraft.artist.trim() || 'Unknown artist';
        const lyrics = songDraft.lyrics.trim();

        if (!title || !lyrics) {
            Alert.alert('Missing song details', 'Add a title and lyrics before submitting.');
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

        setSongs((previous) => [nextSong, ...previous]);
        syncSongToCloud(nextSong);
        setShowAddSongModal(false);
        setSongDraft(EMPTY_SONG_DRAFT);
        setActiveLibraryTab('Songs');
    }, [songDraft.artist, songDraft.lyrics, songDraft.title, syncSongToCloud]);

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

        setSongs((previous) => previous.map((song) => (
            song.id === songId ? updatedSong : song
        )));
        syncSongToCloud(updatedSong);
    }, [songs, syncSongToCloud]);

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

    if (selectedSong) {
        return (
            <SongReader
                song={selectedSong}
                onClose={() => setSelectedSongId(null)}
                onSongUpdate={(patch) => handleUpdateSong(selectedSong.id, patch)}
                onSongDelete={() => handleDeleteSong(selectedSong.id)}
                onSavedTermsChange={(savedTerms) => {
                    setSongs((previous) => previous.map((song) => (
                        song.id === selectedSong.id
                            ? { ...song, savedTerms }
                            : song
                    )));
                }}
            />
        );
    }

    if (selectedPreviewBook) {
        const previewKey = getBookKey(selectedPreviewBook, `${selectedBookPreview?.index ?? 0}`);
        const previewUri = selectedPreviewBook.uri;
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
                onBack={() => setSelectedBookPreview(null)}
                onRead={handleReadPreviewBook}
                onToggleFavorite={handleTogglePreviewFavorite}
                onToggleCompleted={handleTogglePreviewCompleted}
                onDelete={handleDeletePreviewBook}
                onEdit={handleEditPreviewBook}
            />
        );
    }

    return (
        <Screen scroll contentContainerStyle={styles.screenContent}>
            <Pressable
                accessible={false}
                disabled={!activeBookMenuKey}
                onPress={() => setActiveBookMenuKey(null)}
                style={styles.stack}
            >
                <SectionHeader
                    eyebrow="Home"
                    title="Read stories. Collect the words that matter."
                    subtitle="Reading gives new words context, so every saved word connects back to a story you understand."
                />

                {currentReadingBook ? (
                    <Pressable
                        onPress={() => handleBookPress(currentReadingBook)}
                        style={({ pressed }) => [pressed && styles.pressed]}
                    >
                        <View style={styles.continueCard}>
                            <BookCover
                                book={currentReadingBook}
                                width={36}
                                height={50}
                                index={0}
                                style={styles.continueCover}
                                titleStyle={styles.continueCoverText}
                                showBars={false}
                            />

                            <View style={styles.continueCopy}>
                                <Text style={styles.continueEyebrow}>
                                    {isBookDownloaded(currentReadingBook)
                                        ? `CONTINUE · ${currentProgressPercent}%`
                                        : 'CLOUD BOOK'}
                                </Text>
                                <View style={styles.continueMetaRow}>
                                    <Text
                                        style={[
                                            styles.continueTitle,
                                            getSerifFontForText(getBookTitle(currentReadingBook)),
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {getBookTitle(currentReadingBook)}
                                    </Text>
                                    <Text style={styles.continueDivider}>·</Text>
                                    <Text
                                        style={[
                                            styles.continueAuthor,
                                            hasKoreanText(getBookAuthor(currentReadingBook)) && styles.koreanInlineText,
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {getBookAuthor(currentReadingBook)}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.continuePlayButton}>
                                <Ionicons
                                    name={isBookDownloaded(currentReadingBook) ? 'play' : 'download-outline'}
                                    size={18}
                                    color={colors.white}
                                />
                            </View>
                        </View>
                    </Pressable>
                ) : (
                    <View style={styles.emptyContinueCard}>
                        <Feather name="book-open" size={24} color={colors.accentStrong} />
                        <Text style={styles.emptyContinueTitle}>
                            Choose a book below
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
                                    Books
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
                                    Songs
                                </Text>
                            </View>
                            {activeLibraryTab === 'Songs' ? <View style={styles.libraryTabUnderline} /> : null}
                        </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            activeOpacity={0.84}
                            accessibilityRole="switch"
                            accessibilityLabel={isFloatingOcrVisible ? 'Turn off screen text scanner' : 'Turn on screen text scanner'}
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
                                <ActivityIndicator size="small" color={colors.accentStrong} />
                            ) : (
                                <Ionicons
                                    name="scan-outline"
                                    size={15}
                                    color={isFloatingOcrVisible ? colors.white : colors.accentStrong}
                                />
                            )}
                            <Text style={[
                                styles.ocrTabToggleText,
                                isFloatingOcrVisible && styles.ocrTabToggleTextActive,
                            ]}>
                                OCR
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {activeLibraryTab === 'Songs' ? (
                        <TouchableOpacity
                            activeOpacity={0.88}
                            onPress={handleAddSong}
                            style={styles.libraryAction}
                        >
                            <Feather name="plus" size={16} color={colors.accentStrong} />
                            <Text style={styles.libraryActionText}>Add song</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>

            {activeLibraryTab === 'Books' ? (
                <View style={styles.booksSection}>
                    <View style={styles.bookFilterRow}>
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
                                    accessibilityLabel={`${filter.label}, ${count} books`}
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
                                            color={isActive ? colors.white : colors.warning}
                                        />
                                    ) : (
                                        <Text style={[
                                            styles.bookFilterChipText,
                                            isActive && styles.bookFilterChipTextActive,
                                        ]}>
                                            {filter.label}
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
                    </View>

                    {!showingPublicDomainBooks ? (
                        <>
                            <View style={styles.bookSectionHeader}>
                                <View style={styles.bookSectionCopy}>
                                    <Text style={styles.bookSectionCount}>
                                        {bookSectionTitle}
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
                                                <ActivityIndicator size="small" color={colors.accentStrong} />
                                            ) : (
                                                <Text style={styles.importInlineText}>+ Import .epub</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                ) : null}
                            </View>

                            {filteredLibraryBooks.length === 0 ? (
                                <View style={styles.emptyBooksPanel}>
                                    <Text style={styles.emptyBooksTitle}>
                                        {activeBookFilter === 'favorites' ? 'No favorites yet' : 'No books here yet'}
                                    </Text>
                                    <Text style={styles.emptyBooksCopy}>
                                        {activeBookFilter === 'favorites'
                                            ? 'Open a book preview and tap the star to save it here.'
                                            : 'Import an EPUB or search public domain books to start reading.'}
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
                                                        <ActivityIndicator size="small" color={colors.white} />
                                                    ) : (
                                                        <Feather name="download" size={14} color={colors.white} />
                                                    )}
                                                </View>
                                            ) : null}
                                            <TouchableOpacity
                                                accessibilityRole="button"
                                                accessibilityLabel={`Book options for ${getBookTitle(book)}`}
                                                activeOpacity={0.84}
                                                onPress={(event) => {
                                                    event?.stopPropagation?.();
                                                    setActiveBookMenuKey((currentKey) => (
                                                        currentKey === bookKey ? null : bookKey
                                                    ));
                                                }}
                                                style={styles.bookMenuButton}
                                            >
                                                <Feather name="more-vertical" size={16} color={colors.white} />
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
                                                        <Text style={styles.bookMenuItemText}>Edit</Text>
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
                                                        <Text style={styles.bookMenuItemText}>Reset to original</Text>
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
                                                            Delete
                                                        </Text>
                                                    </TouchableOpacity>
                                                </View>
                                            ) : null}
                                            <Text
                                                style={[
                                                    styles.bookTitle,
                                                    getSerifFontForText(getBookTitle(book)),
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {getBookTitle(book)}
                                            </Text>
                                            <View style={styles.bookProgressRail}>
                                                <View style={[
                                                    styles.bookProgressFill,
                                                    { width: `${Math.round(getBookProgress(book) * 100)}%` },
                                                ]} />
                                            </View>
                                            {!isBookDownloaded(book) ? (
                                                <Text style={styles.bookCloudMeta} numberOfLines={1}>
                                                    {downloadingBookId === bookKey
                                                        ? 'Downloading...'
                                                        : 'Available to download'}
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
                                        {bookSectionTitle}
                                    </Text>
                                    {bookSectionHint ? (
                                        <Text style={styles.bookSectionHint}>{bookSectionHint}</Text>
                                    ) : null}
                                </View>
                                {activeBookFilter === 'all' ? (
                                    <View style={styles.bookSectionActions}>
                                        <TouchableOpacity
                                            activeOpacity={0.84}
                                            onPress={confirmAddBook}
                                            style={styles.importInlineButton}
                                        >
                                            {isImporting ? (
                                                <ActivityIndicator size="small" color={colors.accentStrong} />
                                            ) : (
                                                <Text style={styles.importInlineText}>+ Import .epub</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                ) : null}
                            </View>

                            <View style={styles.bookGrid}>
                                {publicDomainBookRows.map((book, index) => (
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
                                                getSerifFontForText(getBookTitle(book)),
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {getBookTitle(book)}
                                        </Text>
                                        <View style={styles.bookProgressRail}>
                                            <View style={[
                                                styles.bookProgressFill,
                                                { width: `${Math.round(getBookProgress(book) * 100)}%` },
                                            ]} />
                                        </View>
                                        <Text style={styles.bookCloudMeta} numberOfLines={1}>
                                            {getBookAuthor(book)}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        </>
                    ) : null}
                </View>
            ) : (
                <View style={styles.songsPanel}>
                    {songsLoaded && songs.length === 0 ? (
                        <View style={styles.emptySongsPanel}>
                            <Feather name="music" size={24} color={colors.accentStrong} />
                            <Text style={styles.emptySongsTitle}>Add songs you like</Text>
                            <Text style={styles.emptySongsCopy}>
                                Save lyrics here so you can tap words, look them up, and keep the ones you want to remember.
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.songList}>
                            {!songsLoaded ? (
                                <View style={styles.emptySongs}>
                                    <ActivityIndicator size="small" color={colors.accentStrong} />
                                    <Text style={styles.emptySongsText}>Loading songs...</Text>
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
                                        <Feather name="chevron-right" size={23} color={colors.textSubtle} />
                                    </Pressable>
                                ))
                            )}
                        </View>
                    )}
                </View>
            )}

                {!!openingBookUri && (
                    <View style={styles.loadingOverlay}>
                        <ActivityIndicator size="small" color={colors.accentStrong} />
                        <Text style={styles.loadingText}>Opening book...</Text>
                    </View>
                )}
            </Pressable>

            <Modal visible={!!editBook} animationType="fade" transparent onRequestClose={() => setEditBook(null)}>
                <TouchableWithoutFeedback onPress={() => setEditBook(null)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.editModal}>
                                <Text style={styles.editTitle}>Edit book</Text>

                                <Text style={styles.editLabel}>Title</Text>
                                <TextInput
                                    value={editDraft.title}
                                    onChangeText={(title) => setEditDraft((prev) => ({ ...prev, title }))}
                                    style={styles.editInput}
                                    placeholder="Untitled"
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>Author</Text>
                                <TextInput
                                    value={editDraft.author}
                                    onChangeText={(author) => setEditDraft((prev) => ({ ...prev, author }))}
                                    style={styles.editInput}
                                    placeholder="Unknown author"
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>Cover</Text>
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
                                            label="Change cover"
                                            onPress={handlePickCover}
                                            icon={<Feather name="image" size={15} color={colors.text} />}
                                        />
                                        <IconButton
                                            label="Remove cover"
                                            onPress={() => setEditDraft((prev) => ({ ...prev, cover: '' }))}
                                            icon={<Feather name="trash-2" size={15} color={colors.danger} />}
                                        />
                                    </View>
                                </View>

                                <View style={styles.modalActions}>
                                    <IconButton label="Cancel" onPress={() => setEditBook(null)} />
                                    <IconButton
                                        tone="accent"
                                        label="Save"
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
                            <Text style={styles.editTitle}>Add song</Text>

                            <ScrollView
                                style={styles.songModalScroll}
                                contentContainerStyle={styles.songModalContent}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                            >
                                <Text style={styles.editLabel}>Title</Text>
                                <TextInput
                                    value={songDraft.title}
                                    onChangeText={(title) => setSongDraft((prev) => ({ ...prev, title }))}
                                    style={styles.editInput}
                                    placeholder="Song title"
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>Artist</Text>
                                <TextInput
                                    value={songDraft.artist}
                                    onChangeText={(artist) => setSongDraft((prev) => ({ ...prev, artist }))}
                                    style={styles.editInput}
                                    placeholder="Artist"
                                    placeholderTextColor={colors.textSubtle}
                                />

                                <Text style={styles.editLabel}>Lyrics</Text>
                                <TextInput
                                    value={songDraft.lyrics}
                                    onChangeText={(lyrics) => setSongDraft((prev) => ({ ...prev, lyrics }))}
                                    style={[styles.editInput, styles.lyricsInput]}
                                    placeholder="Paste lyrics here"
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
                                    <Text style={styles.songModalButtonSecondaryText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    activeOpacity={0.84}
                                    onPress={handleSubmitSong}
                                    style={[styles.songModalButton, styles.songModalButtonPrimary]}
                                >
                                    <Text style={styles.songModalButtonPrimaryText}>Submit</Text>
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
        paddingBottom: spacing.xl * 2,
    },
    stack: {
        gap: spacing.lg,
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
        gap: spacing.md,
    },
    previewHeroPublicDomain: {
        flexDirection: 'column',
        gap: spacing.sm,
    },
    previewCover: {
        borderRadius: 8,
    },
    previewCoverText: {
        fontSize: 12,
        lineHeight: 16,
    },
    previewHeroCopy: {
        flex: 1,
        minWidth: 0,
        gap: spacing.xs,
        paddingTop: spacing.xs,
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
        color: colors.accent,
        letterSpacing: 1.4,
    },
    previewTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 26,
        lineHeight: 33,
        color: colors.text,
        letterSpacing: 0,
    },
    previewAuthor: {
        ...textStyles.body,
        fontSize: 16,
        lineHeight: 22,
        color: colors.textMuted,
    },
    previewProgressBlock: {
        gap: spacing.xs,
        marginTop: spacing.md,
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
        minHeight: 68,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 6,
        paddingLeft: spacing.sm,
        paddingRight: spacing.xs,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#eadfcb',
        backgroundColor: '#fffaf2',
        overflow: 'hidden',
    },
    continueCover: {
        borderRadius: 5,
    },
    continueCoverText: {
        fontSize: 7,
        lineHeight: 9,
    },
    continueCopy: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    continueEyebrow: {
        ...textStyles.eyebrow,
        fontSize: 9,
        lineHeight: 12,
        color: colors.accent,
        letterSpacing: 2,
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
        fontSize: 15,
        lineHeight: 19,
        color: colors.text,
        letterSpacing: 0,
    },
    continueDivider: {
        ...textStyles.body,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textSubtle,
    },
    continueAuthor: {
        ...textStyles.body,
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        lineHeight: 18,
        color: colors.textSubtle,
    },
    koreanInlineText: {
        fontFamily: fontFamilies.krSerifMedium,
    },
    continuePlayButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accent,
    },
    emptyContinueCard: {
        minHeight: 138,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        borderRadius: 26,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#e6d7bf',
        backgroundColor: '#fffaf0',
    },
    emptyContinueTitle: {
        ...textStyles.sectionTitle,
        fontSize: 16,
        color: colors.accentStrong,
        letterSpacing: 0,
    },
    libraryControls: {
        gap: spacing.xs,
        marginTop: -spacing.md,
        overflow: 'visible',
    },
    libraryHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingTop: 0,
        overflow: 'visible',
    },
    libraryTabs: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        overflow: 'visible',
    },
    libraryTab: {
        minHeight: 56,
        paddingTop: 6,
        justifyContent: 'flex-start',
        overflow: 'visible',
    },
    libraryTabLabelRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingTop: 7,
        paddingBottom: 2,
        overflow: 'visible',
    },
    libraryTabText: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 21,
        color: '#9d917f',
        includeFontPadding: true,
        letterSpacing: 0,
    },
    libraryTabTextActive: {
        color: colors.text,
    },
    libraryTabUnderline: {
        width: 54,
        height: 3,
        marginTop: 5,
        borderRadius: 999,
        backgroundColor: colors.accent,
    },
    ocrTabToggle: {
        minHeight: 32,
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: '#eadfcb',
        backgroundColor: '#fffaf2',
    },
    ocrTabToggleActive: {
        borderColor: colors.accentStrong,
        backgroundColor: colors.accentStrong,
    },
    ocrTabToggleBusy: {
        opacity: 0.72,
    },
    ocrTabToggleText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 15,
        color: colors.accentStrong,
    },
    ocrTabToggleTextActive: {
        color: colors.white,
    },
    libraryAction: {
        height: 36,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: spacing.md,
        borderRadius: 999,
        backgroundColor: '#fff2d8',
    },
    libraryActionText: {
        ...textStyles.sectionTitle,
        fontSize: 14,
        lineHeight: 18,
        color: colors.accentStrong,
        letterSpacing: 0,
    },
    booksSection: {
        gap: spacing.md,
        marginTop: -spacing.sm,
    },
    bookFilterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: spacing.xs,
    },
    bookFilterChip: {
        height: 38,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingHorizontal: spacing.sm,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#eadfcb',
        backgroundColor: '#fffaf2',
    },
    bookFilterIconChip: {
        minWidth: 46,
        paddingHorizontal: spacing.sm,
    },
    bookFilterChipActive: {
        borderColor: colors.text,
        backgroundColor: colors.text,
    },
    bookFilterChipText: {
        ...textStyles.sectionTitle,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    bookFilterChipTextActive: {
        color: colors.white,
    },
    bookFilterChipCount: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        color: colors.textSubtle,
        opacity: 0.62,
    },
    bookFilterChipCountActive: {
        color: colors.white,
        opacity: 0.66,
    },
    bookSectionHeader: {
        minHeight: 28,
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: spacing.md,
    },
    bookSectionCopy: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    bookSectionCount: {
        ...textStyles.body,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textSubtle,
    },
    bookSectionHint: {
        ...textStyles.caption,
        maxWidth: 340,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textSubtle,
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
        fontSize: 15,
        lineHeight: 20,
        color: colors.accentStrong,
        letterSpacing: 0,
    },
    emptyBooksPanel: {
        minHeight: 132,
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
        borderWidth: 1,
        borderColor: '#eadfcb',
        borderRadius: 16,
        backgroundColor: '#fffaf2',
    },
    emptyBooksTitle: {
        ...textStyles.sectionTitle,
        fontSize: 18,
        lineHeight: 23,
        color: colors.text,
        letterSpacing: 0,
    },
    emptyBooksCopy: {
        ...textStyles.body,
        maxWidth: 360,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSubtle,
    },
    bookGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: BOOK_GRID_GAP,
    },
    bookTile: {
        gap: spacing.xs,
        position: 'relative',
    },
    bookTileMenuOpen: {
        zIndex: 20,
    },
    coverImage: {
        resizeMode: 'cover',
        backgroundColor: colors.surfaceMuted,
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
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0,
    },
    bookProgressRail: {
        height: 3,
        borderRadius: 999,
        backgroundColor: '#e5dac7',
        overflow: 'hidden',
    },
    bookProgressFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: colors.accent,
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
        backgroundColor: colors.accentStrong,
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
        backgroundColor: 'rgba(43, 39, 33, 0.74)',
    },
    bookMenu: {
        position: 'absolute',
        top: 0,
        zIndex: 4,
        minWidth: 160,
        overflow: 'hidden',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e4d5be',
        backgroundColor: colors.surfaceElevated,
        shadowColor: '#2b2721',
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
        backgroundColor: colors.surfaceElevated,
    },
    bookMenuDangerItem: {
        borderTopWidth: 1,
        borderTopColor: '#f0e4d2',
    },
    bookMenuSeparatedItem: {
        borderTopWidth: 1,
        borderTopColor: '#f0e4d2',
    },
    bookMenuItemText: {
        ...textStyles.body,
        fontSize: 13,
        lineHeight: 17,
        color: colors.text,
    },
    bookMenuDangerText: {
        color: colors.danger,
    },
    bookCloudMeta: {
        ...textStyles.caption,
        fontSize: 10,
        lineHeight: 13,
        color: colors.textSubtle,
    },
    songsPanel: {
        gap: spacing.md,
        marginTop: -spacing.xs,
    },
    songList: {
        borderWidth: 1,
        borderColor: '#e6d7bf',
        borderRadius: 15,
        backgroundColor: colors.surfaceElevated,
        overflow: 'hidden',
    },
    songRow: {
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: '#eadcc6',
    },
    songRowLast: {
        borderBottomWidth: 0,
    },
    songRowPressed: {
        backgroundColor: '#fff8eb',
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
        color: colors.text,
        letterSpacing: 0,
    },
    songMeta: {
        ...textStyles.body,
        fontSize: 12,
        lineHeight: 17,
        color: colors.textSubtle,
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
        borderRadius: 18,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#e6d7bf',
        backgroundColor: '#fffaf2',
    },
    emptySongsTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 24,
        lineHeight: 30,
        textAlign: 'center',
        color: colors.text,
        letterSpacing: 0,
    },
    emptySongsCopy: {
        ...textStyles.body,
        maxWidth: 330,
        textAlign: 'center',
        fontSize: 15,
        lineHeight: 22,
        color: colors.textMuted,
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
        backgroundColor: colors.surfaceElevated,
    },
    loadingText: {
        ...textStyles.caption,
        color: colors.textMuted,
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
