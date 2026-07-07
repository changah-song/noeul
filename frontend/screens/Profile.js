import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Switch,
    useWindowDimensions,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Auth from './Auth';
import { Screen } from '../components/ui';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import {
    getInterfaceLanguageLabel,
    getLanguageLabel,
    KRDICT_INTERFACE_LANGUAGE_OPTIONS,
    normalizeBookLanguage,
    normalizeChineseScript,
    normalizeInterfaceLanguageCode,
} from '../constants/languages';
import {
    getProficiencyLevelForLanguage,
    getProficiencyLevelOptions,
} from '../constants/proficiencyLevels';
import { colors, fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';
import { getDefaultProfileIdForLanguage } from '../services/profileScope';
import { fetchUserProfiles } from '../services/profilesCloudSync';

const WORDS_PER_PAGE = 250;
const SHELF_WIDTH = 346;
const SHELF_GAP = 2;
const MIN_EMPTY_SLOT_WIDTH = 52;
const SHELF_ROW_HEIGHT = 166;
const SHELF_BASE_HEIGHT = 6;
const SHELF_ROW_SPACING = 16;
const SHELF_VIEWPORT_ROW_COUNT = 1;
const SHELF_EXPANSION_ROW_COUNT = 2;
const SHELF_ROW_STRIDE = SHELF_ROW_HEIGHT + SHELF_BASE_HEIGHT + SHELF_ROW_SPACING;
const SHELF_VIEWPORT_HEIGHT = (
    (SHELF_ROW_HEIGHT + SHELF_BASE_HEIGHT) * SHELF_VIEWPORT_ROW_COUNT
) + (SHELF_ROW_SPACING * (SHELF_VIEWPORT_ROW_COUNT - 1));
const SHELF_SCROLL_PAGE_STRIDE = SHELF_ROW_STRIDE * SHELF_VIEWPORT_ROW_COUNT;
const SHELF_SCROLL_THROTTLE_MS = 16;
const DEFAULT_SPINE_WIDTH = 24;
const BOOKSHELF_HORIZONTAL_PADDING = 22;
const SPINE_MIN_HEIGHT = 96;
const SPINE_MAX_HEIGHT = SHELF_ROW_HEIGHT;
const DEFAULT_SPINE_HEIGHT = Math.round((SPINE_MIN_HEIGHT + SPINE_MAX_HEIGHT) / 2);
const SPINE_TITLE_VERTICAL_INSET_EXTRA = 8;
const TOOLTIP_WIDTH = 150;
const TOOLTIP_EDGE_PADDING = 6;
const TOOLTIP_TAIL_SIZE = 7;
const SPINE_TITLE_MIN_WIDTH = 30;
const SPINE_PAGE_BUCKETS = [
    { minPages: 0, maxPages: 24, width: 12 },
    { minPages: 24, maxPages: 48, width: 17 },
    { minPages: 48, maxPages: 80, width: 23 },
    { minPages: 80, maxPages: 160, width: 29 },
    { minPages: 160, maxPages: 280, width: 35 },
    { minPages: 280, maxPages: 420, width: 41 },
    { minPages: 420, maxPages: 640, width: 47 },
];

const getProfileColors = (themeColors) => ({
    bg: themeColors.bgPage,
    surface: themeColors.surface,
    muted: themeColors.surfaceMuted,
    surfaceMuted: themeColors.surfaceMuted,
    ink: themeColors.text,
    sub: themeColors.textTertiary,
    faint: themeColors.textSubtle,
    border: themeColors.divider,
    strongBorder: themeColors.borderStrong,
    shelf: themeColors.textSubtle,
    shelfBase: themeColors.border,
    accent: themeColors.accent,
    danger: themeColors.danger,
    tooltip: themeColors.inkSlate,
    white: themeColors.white,
});

const PROFILE_SPINE_PALETTES = [
    { field: colors.inkSlate, panel: colors.inkSlate, rule: colors.borderStrong, title: colors.borderStrong },
    { field: colors.coverMid, panel: colors.coverMid, rule: colors.surfaceMuted, title: colors.surfaceMuted },
    { field: colors.border, panel: colors.border, rule: colors.textSecondary, title: colors.textSecondary },
    { field: colors.coverSlate, panel: colors.coverSlate, rule: colors.borderStrong, title: colors.borderStrong },
    { field: colors.textMuted, panel: colors.textMuted, rule: colors.surfaceMuted, title: colors.surfaceMuted },
];

const clampProgress = (value) => {
    const progress = Number(value);
    if (!Number.isFinite(progress)) {
        return 0;
    }
    return Math.min(Math.max(progress, 0), 1);
};

const isBookCompleted = (book) => (
    book?.completed === false
        ? false
        : book?.completed === true || clampProgress(book?.progress) >= 1
);

const getBookTitle = (book, t = null) => (
    String(book?.title || book?.originalTitle || book?.name || (t ? t('common.untitled') : 'Untitled')).trim()
);

const getBookAuthor = (book, t = null) => (
    String(book?.author || book?.originalAuthor || (t ? t('common.unknownAuthor') : 'Unknown author')).trim()
);

const getBookKey = (book, fallback = '') => (
    book?.cloudId || book?.uri || book?.id || `${getBookTitle(book)}-${fallback}`
);

const spinePaletteForBook = (book) => {
    const key = `${getBookTitle(book)}-${getBookAuthor(book)}`;
    const hash = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return PROFILE_SPINE_PALETTES[Math.abs(hash) % PROFILE_SPINE_PALETTES.length];
};

const getSpineTitleGlyphs = (title, spine) => {
    const glyphs = String(title || '').replace(/\s/g, '').split('');
    const titleInsetY = spine.titleInsetY || spine.panelInsetY + SPINE_TITLE_VERTICAL_INSET_EXTRA;
    const titleBandHeight = Math.max(0, spine.height - (titleInsetY * 2));
    const maxGlyphs = Math.max(1, Math.floor(Math.max(0, titleBandHeight - 4) / Math.max(1, spine.titleLineHeight)));
    return glyphs.slice(0, maxGlyphs);
};

const firstFiniteNumber = (values) => {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
            return number;
        }
    }
    return null;
};

const getStoredWordCount = (book) => (
    firstFiniteNumber([
        book?.wordCount,
        book?.word_count,
        book?.totalWords,
        book?.total_words,
        book?.estimatedWordCount,
        book?.estimated_word_count,
    ])
);

const estimatePageCount = (book) => {
    const wordCount = getStoredWordCount(book);
    return wordCount ? Math.max(1, Math.ceil(Math.round(wordCount) / WORDS_PER_PAGE)) : null;
};

const getSpinePageBucket = (pages) => {
    const pageCount = Number(pages);
    if (!Number.isFinite(pageCount) || pageCount <= 0) {
        return null;
    }

    return SPINE_PAGE_BUCKETS.find((bucket) => pageCount <= bucket.maxPages)
        || SPINE_PAGE_BUCKETS[SPINE_PAGE_BUCKETS.length - 1];
};

const spineWidthForPages = (pages) => {
    const bucket = getSpinePageBucket(pages);
    return bucket ? bucket.width : DEFAULT_SPINE_WIDTH;
};

const spineHeightForPages = (pages) => {
    const bucket = getSpinePageBucket(pages);
    if (!bucket) {
        return DEFAULT_SPINE_HEIGHT;
    }

    const pageCount = Math.min(Math.max(Number(pages), bucket.minPages), bucket.maxPages);
    const bucketRange = Math.max(1, bucket.maxPages - bucket.minPages);
    const bucketProgress = (pageCount - bucket.minPages) / bucketRange;

    return Math.round(SPINE_MIN_HEIGHT + ((SPINE_MAX_HEIGHT - SPINE_MIN_HEIGHT) * bucketProgress));
};

const pageLabelForBook = (book, t = null) => {
    const pages = estimatePageCount(book);
    return pages
        ? {
            pages,
            tooltip: t
                ? t(pages === 1 ? 'profile.pageSingular' : 'profile.pagePlural', { count: pages })
                : `${pages} ${pages === 1 ? 'page' : 'pages'}`,
            accessibility: t
                ? t(pages === 1 ? 'profile.aboutPageSingular' : 'profile.aboutPagePlural', { count: pages })
                : `about ${pages} ${pages === 1 ? 'page' : 'pages'}`,
        }
        : {
            pages: null,
            tooltip: t ? t('profile.pageNumberUnclear') : 'Page number unclear, using default',
            accessibility: t ? t('profile.pageNumberUnclearA11y') : 'page number unclear, using default spine width',
        };
};

const spineStyleForBook = (book) => {
    const pages = estimatePageCount(book);
    const width = spineWidthForPages(pages);
    const height = spineHeightForPages(pages);
    const palette = spinePaletteForBook(book);
    const panelInsetX = Math.max(2, Math.round(width * (7 / 48)));
    const panelInsetY = Math.max(5, Math.round(height * 0.07));
    const ruleInsetX = Math.max(2, Math.round(width * 0.1));
    const ruleInsetY = Math.max(4, Math.round(height * 0.055));
    const fontSize = Math.min(14, Math.max(10, width * 0.34));
    const titleInsetY = panelInsetY + SPINE_TITLE_VERTICAL_INSET_EXTRA;

    return {
        width,
        height,
        fieldColor: palette.field,
        panelColor: palette.panel,
        ruleColor: palette.rule,
        titleColor: palette.title,
        panelInsetX,
        panelInsetY,
        ruleInsetX,
        ruleInsetY,
        titleInsetY,
        fontSize,
        titleLineHeight: Math.max(12, Math.round(fontSize * 1.18)),
    };
};

const tooltipLeftForSpine = ({ x = 0, spine = {} } = {}, shelfWidth = SHELF_WIDTH) => {
    const spineWidth = spine.width || DEFAULT_SPINE_WIDTH;
    const centeredLeft = x + (spineWidth / 2) - (TOOLTIP_WIDTH / 2);

    if (centeredLeft < TOOLTIP_EDGE_PADDING) {
        return 0;
    }

    if (centeredLeft + TOOLTIP_WIDTH > shelfWidth - TOOLTIP_EDGE_PADDING) {
        return spineWidth - TOOLTIP_WIDTH;
    }

    return centeredLeft - x;
};

const tooltipTailLeftForSpine = ({ tooltipLeft = 0, spine = {} } = {}) => {
    const spineCenter = (spine.width || DEFAULT_SPINE_WIDTH) / 2;
    const centeredTailLeft = spineCenter - tooltipLeft - TOOLTIP_TAIL_SIZE;
    const minLeft = TOOLTIP_TAIL_SIZE;
    const maxLeft = TOOLTIP_WIDTH - (TOOLTIP_TAIL_SIZE * 3);

    return Math.min(Math.max(centeredTailLeft, minLeft), maxLeft);
};

const completedTimestamp = (book) => {
    const candidates = [
        book?.completedAt,
        book?.completed_at,
        book?.updatedAt,
        book?.cloudSyncedAt,
        book?.lastOpenedAt,
        book?.createdAt,
    ];

    for (const value of candidates) {
        const time = new Date(value).getTime();
        if (Number.isFinite(time)) {
            return time;
        }
    }

    return 0;
};

const chunkBooksIntoShelfRows = (books, shelfWidth = SHELF_WIDTH) => {
    const rows = [];
    let currentRow = [];
    let rowWidth = 0;

    books.forEach((book, index) => {
        const spine = spineStyleForBook(book);
        const gapBefore = currentRow.length > 0 ? SHELF_GAP : 0;
        const x = rowWidth + gapBefore;
        const nextWidth = x + spine.width;
        const needsNewRow = (
            currentRow.length > 0
            && nextWidth > shelfWidth - MIN_EMPTY_SLOT_WIDTH
        );

        if (needsNewRow) {
            rows.push(currentRow);
            currentRow = [];
            rowWidth = 0;
        }

        const nextX = needsNewRow ? 0 : x;
        currentRow.push({ book, spine, x: nextX });
        rowWidth = nextX + spine.width;
    });

    if (currentRow.length > 0) {
        rows.push(currentRow);
    }

    return rows;
};

const padShelfRows = (rows, minimumRows) => {
    const paddedRows = [...rows];

    while (paddedRows.length < minimumRows) {
        paddedRows.push([]);
    }

    return paddedRows;
};

const getRenderedShelfRowCount = (actualRowCount) => {
    if (actualRowCount <= SHELF_VIEWPORT_ROW_COUNT) {
        return SHELF_VIEWPORT_ROW_COUNT;
    }

    return Math.max(
        SHELF_VIEWPORT_ROW_COUNT + SHELF_EXPANSION_ROW_COUNT,
        Math.ceil(actualRowCount / SHELF_EXPANSION_ROW_COUNT) * SHELF_EXPANSION_ROW_COUNT
    );
};

const BookSpine = ({ item, index, activeBookKey, shelfWidth, onShow, styles }) => {
    const { t } = useTranslation();
    const { book, spine } = item;
    const bookKey = getBookKey(book, String(index));
    const title = getBookTitle(book, t);
    const author = getBookAuthor(book, t);
    const pageLabel = pageLabelForBook(book, t);
    const isActive = activeBookKey === bookKey;
    const tooltipLeft = tooltipLeftForSpine(item, shelfWidth);
    const tooltipTailLeft = tooltipTailLeftForSpine({ tooltipLeft, spine });
    const showSpineTitle = spine.width >= SPINE_TITLE_MIN_WIDTH;
    const spineTitleGlyphs = showSpineTitle ? getSpineTitleGlyphs(title, spine) : [];

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.bookSpineA11y', {
                title,
                author,
                page: pageLabel.accessibility,
            })}
            onPress={(event) => {
                event?.stopPropagation?.();
                onShow(isActive ? null : bookKey);
            }}
            style={[
                styles.bookSpine,
                {
                    width: spine.width,
                    height: spine.height,
                },
                isActive && styles.bookSpineActive,
            ]}
        >
            <View
                pointerEvents="none"
                style={[
                    styles.spineFace,
                    {
                        backgroundColor: spine.fieldColor,
                    },
                ]}
            >
                <View
                    style={[
                        styles.spinePanel,
                        {
                            top: spine.panelInsetY,
                            bottom: spine.panelInsetY,
                            left: spine.panelInsetX,
                            right: spine.panelInsetX,
                            backgroundColor: spine.panelColor,
                        },
                    ]}
                />
                <View
                    style={[
                        styles.spinePanelRule,
                        {
                            top: spine.ruleInsetY,
                            bottom: spine.ruleInsetY,
                            left: spine.ruleInsetX,
                            right: spine.ruleInsetX,
                            borderColor: spine.ruleColor,
                        },
                    ]}
                />
                <View style={styles.spineSeam} />
                {spineTitleGlyphs.length > 0 ? (
                    <View
                        style={[
                            styles.spineTitleBand,
                            {
                                top: spine.titleInsetY,
                                bottom: spine.titleInsetY,
                            },
                        ]}
                    >
                        {spineTitleGlyphs.map((glyph, glyphIndex) => (
                            <Text
                                key={`${bookKey}-spine-glyph-${glyphIndex}`}
                                style={[
                                    styles.spineTitleGlyph,
                                    {
                                        color: spine.titleColor,
                                        fontSize: spine.fontSize,
                                        lineHeight: spine.titleLineHeight,
                                    },
                                ]}
                                numberOfLines={1}
                            >
                                {glyph}
                            </Text>
                        ))}
                    </View>
                ) : null}
            </View>
            {isActive ? (
                <View style={[styles.bookTooltip, { left: tooltipLeft }]}>
                    <Text style={styles.tooltipTitle} numberOfLines={2}>{title}</Text>
                    <Text style={styles.tooltipMeta} numberOfLines={1}>{author}</Text>
                    <Text style={styles.tooltipMeta}>{pageLabel.tooltip}</Text>
                    <View style={[styles.bookTooltipTail, { left: tooltipTailLeft }]} />
                </View>
            ) : null}
        </Pressable>
    );
};

const ShelfRow = ({ row, rowIndex, isLast, activeBookKey, shelfWidth, onShowBook, styles }) => {
    const { t } = useTranslation();

    return (
        <View style={[styles.shelfBlock, isLast && styles.shelfBlockLast]}>
            <View style={styles.shelfBookRow}>
                {row.map((item, index) => (
                    <BookSpine
                        key={getBookKey(item.book, `${rowIndex}-${index}`)}
                        item={item}
                        index={(rowIndex * 100) + index}
                        activeBookKey={activeBookKey}
                        shelfWidth={shelfWidth}
                        onShow={onShowBook}
                        styles={styles}
                    />
                ))}
                <View style={styles.emptyShelfSlot}>
                    <Text style={styles.emptyShelfText}>{t('profile.emptyShelfLine1')}{'\n'}{t('profile.emptyShelfLine2')}</Text>
                </View>
            </View>
            <View style={styles.shelfBase} />
        </View>
    );
};

const PreferenceRow = ({
    label,
    value,
    accent = false,
    isLast = false,
    onPress,
    rightAccessory,
    styles,
}) => (
    <TouchableOpacity
        activeOpacity={0.82}
        onPress={onPress}
        style={[styles.preferenceRow, isLast && styles.preferenceRowLast]}
    >
        <Text style={styles.preferenceLabel}>{label}</Text>
        {rightAccessory ? rightAccessory : (
            <View style={styles.preferenceValueWrap}>
                <Text style={[styles.preferenceValue, accent && styles.preferenceValueAccent]}>
                    {value}
                </Text>
                <Text style={styles.preferenceChevron}>›</Text>
            </View>
        )}
    </TouchableOpacity>
);

const KO_READING_LEVEL_LABELS = {
    beginner: 'profile.level.beginner',
    intermediate: 'profile.level.intermediate',
    advanced: 'profile.level.advanced',
};

const getProfileLanguageLabel = (language, t = null) => {
    const normalized = normalizeBookLanguage(language);
    return t ? t(`language.${normalized}`) : getLanguageLabel(normalized);
};

const PROFICIENCY_DESCRIPTION_KEYS = {
    'Beginner Korean vocabulary': 'profile.levelDescription.beginnerKorean',
    'Intermediate Korean vocabulary': 'profile.levelDescription.intermediateKorean',
    'Advanced Korean vocabulary': 'profile.levelDescription.advancedKorean',
    'Complete beginner': 'profile.levelDescription.completeBeginner',
    Beginner: 'profile.levelDescription.beginner',
    'Lower intermediate': 'profile.levelDescription.lowerIntermediate',
    Intermediate: 'profile.levelDescription.intermediate',
    'Upper intermediate': 'profile.levelDescription.upperIntermediate',
    Advanced: 'profile.levelDescription.advanced',
    'Advanced learner': 'profile.levelDescription.advancedLearner',
    'Near-native': 'profile.levelDescription.nearNative',
};

const formatProficiencyDescription = (description, t = null) => {
    const key = PROFICIENCY_DESCRIPTION_KEYS[description];
    return key && t ? t(key) : description;
};

const formatProfileReadingLevelLabel = (level, language, t = null) => {
    if (!level) {
        return '';
    }

    if (normalizeBookLanguage(language) === 'ko') {
        return KO_READING_LEVEL_LABELS[level.value] && t
            ? t(KO_READING_LEVEL_LABELS[level.value])
            : level.description || level.label;
    }

    return `${level.label} · ${formatProficiencyDescription(level.description, t)}`;
};

const getReadingLevelOptionLabel = (option, language, t = null) => (
    normalizeBookLanguage(language) === 'ko'
        ? (KO_READING_LEVEL_LABELS[option.value] && t
            ? t(KO_READING_LEVEL_LABELS[option.value])
            : option.description || option.label)
        : option.label
);

const getReadingLevelOptionMeta = (option, language, t = null) => (
    normalizeBookLanguage(language) === 'ko' ? '' : formatProficiencyDescription(option.description, t)
);

const normalizeProfileRow = (profile, fallbackLanguage = 'ko') => {
    const targetLanguage = profile?.target_language || profile?.targetLanguage || fallbackLanguage;
    return {
        id: profile?.id || getDefaultProfileIdForLanguage(targetLanguage),
        target_language: targetLanguage,
        script: targetLanguage === 'zh'
            ? normalizeChineseScript(profile?.script ?? profile?.chinese_script)
            : null,
        display_name: profile?.display_name || profile?.displayName || getLanguageLabel(targetLanguage),
    };
};

const Profile = ({ user, signOut, books = [], updateUsername }) => {
    const [activeBookKey, setActiveBookKey] = useState(null);
    const [visibleShelfPage, setVisibleShelfPage] = useState(1);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState('signin');
    const [showNameEditor, setShowNameEditor] = useState(false);
    const [showInterfaceLanguagePicker, setShowInterfaceLanguagePicker] = useState(false);
    const [showReadingLevelPicker, setShowReadingLevelPicker] = useState(false);
    const [profiles, setProfiles] = useState([]);
    const [profilesLoading, setProfilesLoading] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    const {
        interfaceLanguage,
        setInterfaceLanguage,
        targetLanguage,
        levelsByLanguage,
        setLanguageLevel,
        activeProfileId,
        switchProfile,
        updateLanguageSettings,
        isDarkMode,
        setIsDarkMode,
    } = useAppContext();
    const theme = useTheme();
    const profileColors = useMemo(() => getProfileColors(theme.colors), [theme.colors]);
    const styles = useMemo(() => createStyles(profileColors, theme.colors), [profileColors, theme.colors]);
    const { activeOwnerId, syncGeneration } = useLocalOwner();
    const { t } = useTranslation();
    const { width: viewportWidth } = useWindowDimensions();
    const isAnonymous = Boolean(user?.is_anonymous);
    const isGuest = !user?.id || isAnonymous;

    const displayName = useMemo(() => {
        const metadataName = user?.user_metadata?.username
            || user?.user_metadata?.display_name
            || user?.user_metadata?.name;

        if (metadataName && String(metadataName).trim()) {
            return String(metadataName).trim();
        }

        return 'Reader';
    }, [user?.user_metadata]);

    const learningSince = useMemo(() => {
        if (!user?.created_at) {
            return t('profile.recently');
        }

        return new Date(user.created_at).toLocaleDateString(normalizeInterfaceLanguageCode(interfaceLanguage), {
            month: 'short',
            year: 'numeric',
        });
    }, [interfaceLanguage, t, user?.created_at]);

    const activeProfileBooks = useMemo(() => (
        (books || []).filter((book) => normalizeBookLanguage(book?.language ?? 'ko') === targetLanguage)
    ), [books, targetLanguage]);

    const completedBooks = useMemo(() => (
        activeProfileBooks
            .filter(isBookCompleted)
            .sort((a, b) => completedTimestamp(b) - completedTimestamp(a))
    ), [activeProfileBooks]);

    const shelfWidth = useMemo(() => {
        const availableWidth = viewportWidth - (BOOKSHELF_HORIZONTAL_PADDING * 2);
        return Math.max(
            TOOLTIP_WIDTH + (TOOLTIP_EDGE_PADDING * 2),
            Math.min(SHELF_WIDTH, availableWidth)
        );
    }, [viewportWidth]);

    const actualShelfRows = useMemo(() => (
        chunkBooksIntoShelfRows(completedBooks, shelfWidth)
    ), [completedBooks, shelfWidth]);
    const isBookshelfScrollable = actualShelfRows.length > SHELF_VIEWPORT_ROW_COUNT;
    const renderedShelfRowCount = getRenderedShelfRowCount(actualShelfRows.length);
    const shelfRows = useMemo(() => (
        padShelfRows(actualShelfRows, renderedShelfRowCount)
    ), [actualShelfRows, renderedShelfRowCount]);
    const totalShelfPages = Math.max(1, Math.ceil(shelfRows.length / SHELF_VIEWPORT_ROW_COUNT));
    const interfaceLanguageOptions = KRDICT_INTERFACE_LANGUAGE_OPTIONS;
    const readingLevelOptions = useMemo(
        () => getProficiencyLevelOptions(targetLanguage),
        [targetLanguage]
    );
    const currentReadingLevel = useMemo(
        () => getProficiencyLevelForLanguage(targetLanguage, levelsByLanguage),
        [levelsByLanguage, targetLanguage]
    );
    const fallbackProfiles = useMemo(() => ([
        normalizeProfileRow({
            id: getDefaultProfileIdForLanguage(targetLanguage),
            target_language: targetLanguage,
            display_name: getLanguageLabel(targetLanguage),
        }, targetLanguage),
    ]), [targetLanguage]);
    const availableProfiles = useMemo(() => {
        const sourceProfiles = profiles.length > 0 ? profiles : fallbackProfiles;
        const profilesWithActive = activeProfileId && !sourceProfiles.some((profile) => profile.id === activeProfileId)
            ? [
                normalizeProfileRow({
                    id: activeProfileId,
                    target_language: targetLanguage,
                    display_name: getLanguageLabel(targetLanguage),
                }, targetLanguage),
                ...sourceProfiles,
            ]
            : sourceProfiles;
        const seen = new Set();
        return profilesWithActive
            .map((profile) => normalizeProfileRow(profile, targetLanguage))
            .filter((profile) => {
                const key = profile.target_language || profile.id;
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            });
    }, [activeProfileId, fallbackProfiles, profiles, targetLanguage]);
    const currentProfile = useMemo(() => (
        availableProfiles.find((profile) => profile.id === activeProfileId)
            || availableProfiles.find((profile) => profile.target_language === targetLanguage)
            || fallbackProfiles[0]
    ), [activeProfileId, availableProfiles, fallbackProfiles, targetLanguage]);
    useEffect(() => {
        setVisibleShelfPage((currentPage) => {
            if (!isBookshelfScrollable) {
                return currentPage === 1 ? currentPage : 1;
            }

            return Math.min(Math.max(currentPage, 1), totalShelfPages);
        });
    }, [isBookshelfScrollable, totalShelfPages]);

    useEffect(() => {
        if (user?.id) {
            setShowAuthModal(false);
        }
    }, [user?.id]);

    useEffect(() => {
        let isMounted = true;

        const loadProfiles = async () => {
            if (isGuest) {
                setProfiles([]);
                setProfilesLoading(false);
                return;
            }

            setProfilesLoading(true);
            try {
                const rows = await fetchUserProfiles(user.id);
                if (isMounted) {
                    setProfiles(rows.map((profile) => normalizeProfileRow(profile)));
                }
            } catch (error) {
                console.warn('[Profile] Failed to load language profiles:', error?.message ?? error);
                if (isMounted) {
                    setProfiles([]);
                }
            } finally {
                if (isMounted) {
                    setProfilesLoading(false);
                }
            }
        };

        loadProfiles();

        return () => {
            isMounted = false;
        };
    }, [isGuest, user?.id]);

    const handleBookshelfScroll = useCallback((event) => {
        const offsetY = event?.nativeEvent?.contentOffset?.y || 0;
        const nextPage = Math.min(
            totalShelfPages,
            Math.max(1, Math.round(offsetY / SHELF_SCROLL_PAGE_STRIDE) + 1)
        );

        setVisibleShelfPage((currentPage) => (
            currentPage === nextPage ? currentPage : nextPage
        ));
    }, [totalShelfPages]);

    const performSignOut = async () => {
        if (isSigningOut) {
            return;
        }

        setIsSigningOut(true);
        try {
            await signOut?.();
        } catch (error) {
            Alert.alert(t('profile.signOutFailed'), error.message || t('profile.preferenceSoon'));
        } finally {
            setIsSigningOut(false);
            setShowSignOutModal(false);
        }
    };

    const dismissActiveBook = () => {
        if (activeBookKey) {
            setActiveBookKey(null);
        }
    };

    const handlePreferencePress = (row) => {
        dismissActiveBook();
        if (row.key === 'interfaceLanguage') {
            setShowInterfaceLanguagePicker(true);
            return;
        }

        if (row.key === 'readingLevel') {
            setShowReadingLevelPicker(true);
            return;
        }

        if (row.key === 'appearance') {
            setIsDarkMode(!isDarkMode);
            return;
        }

        Alert.alert(t(row.labelKey), t('profile.preferenceSoon'));
    };

    const handleInterfaceLanguageSelect = (language) => {
        if (language === targetLanguage) {
            return;
        }

        setInterfaceLanguage(language);
        setShowInterfaceLanguagePicker(false);
    };

    const handleReadingLevelSelect = (level) => {
        setLanguageLevel(targetLanguage, level.rank);
        setShowReadingLevelPicker(false);
    };

    const openAuthModal = (mode) => {
        dismissActiveBook();
        setAuthMode(mode);
        setShowAuthModal(true);
    };

    const openNameEditor = () => {
        dismissActiveBook();
        setDraftName(displayName === 'Reader' ? '' : displayName);
        setShowNameEditor(true);
    };

    const handleSaveName = async () => {
        const nextName = draftName.trim();
        if (!nextName) {
            Alert.alert(t('profile.usernameRequiredTitle'), t('profile.usernameRequiredBody'));
            return;
        }

        if (!updateUsername) {
            Alert.alert(t('profile.usernameUnavailableTitle'), t('profile.usernameUnavailableBody'));
            return;
        }

        setIsSavingName(true);
        try {
            await updateUsername(nextName);
            setShowNameEditor(false);
        } catch (error) {
            Alert.alert(t('profile.saveFailed'), error?.message || t('profile.preferenceSoon'));
        } finally {
            setIsSavingName(false);
        }
    };

    return (
        <Screen
            backgroundColor={profileColors.bg}
            contentContainerStyle={styles.screenContent}
        >
            <Pressable
                accessible={false}
                onPress={dismissActiveBook}
                style={styles.screenTapArea}
            >
                <ScrollView
                    style={styles.pageScroller}
                    contentContainerStyle={styles.pageScrollerContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                >
                <View style={styles.appTopBar}>
                    <View style={styles.appTopSide} />
                    <Text style={styles.appTopTitle}>FLUENT FABLE</Text>
                    <View style={styles.appTopSide} />
                </View>
                <View style={styles.profileHeader}>
                    <View style={styles.profileHeaderTopRow}>
                        <View style={styles.profileIdentity}>
                            <Text style={styles.profileName}>{displayName}</Text>
                            <Text style={styles.profileSubtitle}>
                                {isGuest
                                    ? t('profile.guestSubtitle')
                                    : t('profile.userSubtitle', { date: learningSince })}
                            </Text>
                        </View>
                        {!isGuest ? (
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={t('profile.editUsername')}
                                activeOpacity={0.78}
                                onPress={openNameEditor}
                                style={styles.editUsernameButton}
                            >
                                <Feather name="edit-2" size={16} color={profileColors.sub} />
                            </TouchableOpacity>
                        ) : null}
                    </View>
                </View>

                <View style={styles.bookshelfSection}>
                    <View style={styles.sectionLabelRow}>
                        <Text style={styles.sectionEyebrow}>{t('profile.bookshelf')}</Text>
                        <View style={styles.bookshelfMeta}>
                            <Text style={styles.finishedCount}>
                                {t('profile.finished', { count: completedBooks.length })}
                            </Text>
                            {isBookshelfScrollable ? (
                                <Text style={styles.shelfPosition}>
                                    {visibleShelfPage}/{totalShelfPages}
                                </Text>
                            ) : null}
                        </View>
                    </View>

                    {isBookshelfScrollable ? (
                        <ScrollView
                            style={styles.bookshelfScroller}
                            contentContainerStyle={styles.bookshelfScrollerContent}
                            showsVerticalScrollIndicator={false}
                            nestedScrollEnabled
                            onScroll={handleBookshelfScroll}
                            scrollEventThrottle={SHELF_SCROLL_THROTTLE_MS}
                            snapToInterval={SHELF_SCROLL_PAGE_STRIDE}
                            decelerationRate="fast"
                        >
                            {shelfRows.map((row, index) => (
                                <ShelfRow
                                    key={`shelf-row-${index}`}
                                    row={row}
                                    rowIndex={index}
                                    isLast={index === shelfRows.length - 1}
                                    activeBookKey={activeBookKey}
                                    shelfWidth={shelfWidth}
                                    onShowBook={setActiveBookKey}
                                    styles={styles}
                                />
                            ))}
                        </ScrollView>
                    ) : (
                        shelfRows.map((row, index) => (
                            <ShelfRow
                                key={`shelf-row-${index}`}
                                row={row}
                                rowIndex={index}
                                isLast={index === shelfRows.length - 1}
                                activeBookKey={activeBookKey}
                                shelfWidth={shelfWidth}
                                onShowBook={setActiveBookKey}
                                styles={styles}
                            />
                        ))
                    )}
                </View>

                <View style={styles.preferencesSection}>
                    <View style={styles.sectionLabelRow}>
                        <Text style={styles.sectionEyebrow}>{t('profile.preferences')}</Text>
                    </View>
                    <View style={styles.preferencesCard}>
                        <PreferenceRow
                            label={t('profile.interfaceLanguage')}
                            value={getInterfaceLanguageLabel(interfaceLanguage)}
                            accent
                            onPress={() => handlePreferencePress({ key: 'interfaceLanguage', labelKey: 'profile.interfaceLanguage' })}
                            styles={styles}
                        />
                        <PreferenceRow
                            label={t('profile.readingLevel')}
                            value={formatProfileReadingLevelLabel(currentReadingLevel, targetLanguage, t)}
                            accent
                            onPress={() => handlePreferencePress({ key: 'readingLevel', labelKey: 'profile.readingLevel' })}
                            styles={styles}
                        />
                        <PreferenceRow
                            label={t('profile.appearance')}
                            value={isDarkMode ? t('profile.dark') : t('profile.light')}
                            isLast
                            onPress={() => handlePreferencePress({ key: 'appearance', labelKey: 'profile.appearance' })}
                            styles={styles}
                            rightAccessory={(
                                <View style={styles.preferenceValueWrap}>
                                    <Text style={styles.preferenceValue}>
                                        {isDarkMode ? t('profile.dark') : t('profile.light')}
                                    </Text>
                                    <Switch
                                        value={isDarkMode}
                                        onValueChange={setIsDarkMode}
                                        trackColor={{ false: theme.colors.border, true: theme.colors.accentMuted }}
                                        thumbColor={isDarkMode ? theme.colors.readerTappedWordBg : theme.colors.surface}
                                    />
                                </View>
                            )}
                        />
                    </View>
                    {isGuest ? (
                        <View style={styles.guestAccountSection}>
                            <View style={styles.guestAuthActions}>
                                <TouchableOpacity
                                    activeOpacity={0.86}
                                    onPress={() => openAuthModal('signin')}
                                    style={[styles.guestAuthButton, styles.guestAuthButtonSecondary]}
                                >
                                    <Text style={styles.guestAuthButtonSecondaryText}>{t('profile.signIn')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    activeOpacity={0.86}
                                    onPress={() => openAuthModal('signup')}
                                    style={[styles.guestAuthButton, styles.guestAuthButtonPrimary]}
                                >
                                    <Text style={styles.guestAuthButtonPrimaryText}>{t('profile.signUp')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : null}
                </View>

                {!isGuest ? (
                    <View style={styles.logoutSection}>
                        <TouchableOpacity
                            activeOpacity={0.86}
                            onPress={() => {
                                dismissActiveBook();
                                setShowSignOutModal(true);
                            }}
                            disabled={isSigningOut}
                            style={[styles.logoutButton, isSigningOut && styles.logoutButtonDisabled]}
                        >
                            <Text style={styles.logoutText}>
                                {isSigningOut ? t('profile.loggingOut') : t('profile.logout')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : null}
                </ScrollView>
            </Pressable>

            <Modal
                visible={showInterfaceLanguagePicker}
                animationType="fade"
                transparent
                onRequestClose={() => setShowInterfaceLanguagePicker(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowInterfaceLanguagePicker(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.modalCard, styles.languageModalCard]}>
                                <Text style={styles.modalTitle}>{t('profile.interfaceLanguage')}</Text>
                                <View style={styles.languageOptions}>
                                    {interfaceLanguageOptions.map((option) => {
                                        const selected = option.code === interfaceLanguage;
                                        const disabled = option.code === targetLanguage;

                                        return (
                                            <Pressable
                                                key={option.code}
                                                accessibilityRole="radio"
                                                accessibilityState={{ selected, disabled }}
                                                disabled={disabled}
                                                onPress={() => handleInterfaceLanguageSelect(option.code)}
                                                style={[
                                                    styles.languageOptionRow,
                                                    selected && styles.languageOptionRowSelected,
                                                    disabled && styles.languageOptionRowDisabled,
                                                ]}
                                            >
                                                <Feather
                                                    name={selected ? 'check-circle' : 'circle'}
                                                    size={18}
                                                    color={selected && !disabled ? profileColors.accent : profileColors.faint}
                                                />
                                                <Text
                                                    style={[
                                                        styles.languageOptionText,
                                                        selected && styles.languageOptionTextSelected,
                                                        disabled && styles.languageOptionTextDisabled,
                                                    ]}
                                                >
                                                    {option.label}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                                <Text style={styles.languageDisclaimerText}>
                                    {t('profile.translationDisclaimer')}
                                </Text>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showReadingLevelPicker}
                animationType="fade"
                transparent
                onRequestClose={() => setShowReadingLevelPicker(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowReadingLevelPicker(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.modalCard, styles.languageModalCard]}>
                                <Text style={styles.modalTitle}>{t('profile.readingLevel')}</Text>
                                <View style={styles.languageOptions}>
                                    {readingLevelOptions.map((option) => {
                                        const selected = option.rank === currentReadingLevel?.rank;
                                        const optionLabel = getReadingLevelOptionLabel(option, targetLanguage, t);
                                        const optionMeta = getReadingLevelOptionMeta(option, targetLanguage, t);

                                        return (
                                            <Pressable
                                                key={`${targetLanguage}-${option.rank}`}
                                                accessibilityRole="radio"
                                                accessibilityState={{ selected }}
                                                onPress={() => handleReadingLevelSelect(option)}
                                                style={[
                                                    styles.languageOptionRow,
                                                    selected && styles.languageOptionRowSelected,
                                                ]}
                                            >
                                                <Feather
                                                    name={selected ? 'check-circle' : 'circle'}
                                                    size={18}
                                                    color={selected ? profileColors.accent : profileColors.faint}
                                                />
                                                <View style={styles.languageOptionContent}>
                                                    <Text
                                                        style={[
                                                            styles.languageOptionText,
                                                            selected && styles.languageOptionTextSelected,
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {optionLabel}
                                                    </Text>
                                                    {optionMeta ? (
                                                        <Text style={styles.languageOptionMeta} numberOfLines={2}>
                                                            {optionMeta}
                                                        </Text>
                                                    ) : null}
                                                </View>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showAuthModal}
                animationType="fade"
                transparent
                onRequestClose={() => setShowAuthModal(false)}
            >
                <View style={styles.authModalBackdrop}>
                    <Pressable style={styles.authModalScrim} onPress={() => setShowAuthModal(false)} />
                    <View style={styles.authModalCard}>
                        <View style={styles.authModalHeader}>
                            <View style={styles.authModalCopy}>
                                <Text style={styles.authModalTitle}>
                                    {t('profile.authTitle')}
                                </Text>
                                <Text style={styles.authModalHelper}>
                                    {t('profile.authBody')}
                                </Text>
                            </View>
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={t('profile.closeSignIn')}
                                activeOpacity={0.78}
                                onPress={() => setShowAuthModal(false)}
                                style={styles.authModalCloseButton}
                            >
                                <Text style={styles.authModalCloseText}>×</Text>
                            </TouchableOpacity>
                        </View>
                        <Auth
                            key={authMode}
                            embedded
                            initialMode={authMode}
                            showApple={false}
                            showHeader={false}
                            showModeToggle={false}
                            title=""
                            subtitle=""
                            onAuthenticated={() => setShowAuthModal(false)}
                        />
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showNameEditor}
                animationType="fade"
                transparent
                onRequestClose={() => setShowNameEditor(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowNameEditor(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.editUsernameTitle')}</Text>
                                <TextInput
                                    value={draftName}
                                    onChangeText={setDraftName}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!isSavingName}
                                    placeholder={t('profile.usernamePlaceholder')}
                                    placeholderTextColor={profileColors.faint}
                                    style={styles.usernameInput}
                                />
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowNameEditor(false)}
                                        style={styles.modalButton}
                                        disabled={isSavingName}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleSaveName}
                                        style={[
                                            styles.modalButton,
                                            styles.modalPrimaryButton,
                                            isSavingName && styles.modalButtonDisabled,
                                        ]}
                                        disabled={isSavingName}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {isSavingName ? t('common.working') : t('common.save')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showSignOutModal}
                animationType="fade"
                transparent
                onRequestClose={() => setShowSignOutModal(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowSignOutModal(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.logoutTitle')}</Text>
                                <Text style={styles.modalHelper}>
                                    {t('profile.logoutBody')}
                                </Text>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowSignOutModal(false)}
                                        style={styles.modalButton}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => performSignOut()}
                                        style={[styles.modalButton, styles.modalPrimaryButton]}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {t('profile.logout')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </Screen>
    );
};

const createStyles = (profileColors, themeColors) => StyleSheet.create({
    screenContent: {
        flex: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: profileColors.bg,
    },
    screenTapArea: {
        flex: 1,
        width: '100%',
    },
    pageScroller: {
        flex: 1,
        width: '100%',
    },
    pageScrollerContent: {
        flexGrow: 1,
        paddingBottom: 18,
    },
    appTopBar: {
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: profileColors.border,
        backgroundColor: profileColors.bg,
    },
    appTopSide: {
        width: 70,
        alignItems: 'flex-start',
    },
    appTopTitle: {
        flex: 1,
        textAlign: 'center',
        ...textStyles.appTitle,
        color: profileColors.ink,
    },
    profileHeader: {
        minHeight: 92,
        paddingTop: 26,
        paddingBottom: 12,
        paddingHorizontal: 24,
        backgroundColor: profileColors.bg,
        borderBottomWidth: 0,
    },
    profileHeaderTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
    },
    profileIdentity: {
        flex: 1,
        minWidth: 0,
    },
    profileName: {
        width: '100%',
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 32,
        lineHeight: 38,
        letterSpacing: 0,
        color: profileColors.ink,
    },
    profileSubtitle: {
        marginTop: 3,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        color: profileColors.sub,
    },
    editUsernameButton: {
        width: 38,
        height: 38,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.bg,
    },
    bookshelfSection: {
        paddingTop: 4,
        paddingHorizontal: 24,
    },
    sectionLabelRow: {
        width: '100%',
        minHeight: 15.5,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionEyebrow: {
        fontFamily: fontFamilies.displayMedium,
        fontSize: 19,
        lineHeight: 24,
        letterSpacing: 0,
        color: profileColors.ink,
    },
    bookshelfMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    finishedCount: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 15.5,
        color: profileColors.sub,
    },
    shelfPosition: {
        minWidth: 34,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.pill,
        overflow: 'hidden',
        backgroundColor: profileColors.muted,
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        textAlign: 'center',
        color: profileColors.accent,
        fontVariant: ['tabular-nums'],
    },
    bookshelfScroller: {
        width: '100%',
        height: SHELF_VIEWPORT_HEIGHT,
    },
    bookshelfScrollerContent: {
        width: '100%',
    },
    shelfBlock: {
        width: '100%',
        height: SHELF_ROW_HEIGHT + SHELF_BASE_HEIGHT + 10,
        marginBottom: SHELF_ROW_SPACING,
        overflow: 'visible',
    },
    shelfBlockLast: {
        marginBottom: 0,
    },
    shelfBookRow: {
        height: SHELF_ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: SHELF_GAP,
        overflow: 'visible',
    },
    bookSpine: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
    },
    bookSpineActive: {
        zIndex: 20,
    },
    spineFace: {
        ...StyleSheet.absoluteFillObject,
        borderTopLeftRadius: 1,
        borderTopRightRadius: 1,
        overflow: 'hidden',
    },
    spinePanel: {
        position: 'absolute',
        borderRadius: 3,
    },
    spinePanelRule: {
        position: 'absolute',
        borderWidth: 1,
        opacity: 0.55,
    },
    spineSeam: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 1,
        backgroundColor: themeColors.accentSoft,
    },
    spineTitleBand: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    spineTitleGlyph: {
        width: '100%',
        fontFamily: fontFamilies.krSerifSemiBold,
        fontWeight: '600',
        textAlign: 'center',
        letterSpacing: 0,
    },
    emptyShelfSlot: {
        flex: 1,
        minWidth: MIN_EMPTY_SLOT_WIDTH,
        height: SHELF_ROW_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: profileColors.border,
    },
    emptyShelfText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15.4,
        textAlign: 'center',
        color: profileColors.faint,
    },
    shelfBase: {
        width: '100%',
        height: SHELF_BASE_HEIGHT,
        backgroundColor: profileColors.shelf,
        borderRadius: 1,
    },
    bookTooltip: {
        position: 'absolute',
        top: -72,
        width: TOOLTIP_WIDTH,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: profileColors.tooltip,
        zIndex: 30,
        overflow: 'visible',
    },
    bookTooltipTail: {
        position: 'absolute',
        bottom: -(TOOLTIP_TAIL_SIZE - 1),
        width: 0,
        height: 0,
        borderLeftWidth: TOOLTIP_TAIL_SIZE,
        borderRightWidth: TOOLTIP_TAIL_SIZE,
        borderTopWidth: TOOLTIP_TAIL_SIZE,
        borderLeftColor: themeColors.transparent,
        borderRightColor: themeColors.transparent,
        borderTopColor: profileColors.tooltip,
    },
    tooltipTitle: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 11.5,
        lineHeight: 15,
        color: profileColors.white,
    },
    tooltipMeta: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 10.5,
        lineHeight: 13,
        color: profileColors.faint,
    },
    preferencesSection: {
        paddingTop: 22,
        paddingHorizontal: 24,
    },
    preferencesCard: {
        width: '100%',
        borderRadius: 0,
        backgroundColor: profileColors.bg,
        shadowColor: themeColors.transparent,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
        overflow: 'hidden',
    },
    preferenceRow: {
        minHeight: 52.5,
        paddingVertical: 14,
        paddingHorizontal: 0,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: profileColors.border,
    },
    preferenceRowLast: {
        borderBottomWidth: 0,
    },
    preferenceLabel: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 19.5,
        color: profileColors.ink,
    },
    preferenceValueWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexShrink: 1,
        maxWidth: '64%',
        gap: 12,
    },
    preferenceValue: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        textAlign: 'right',
        color: profileColors.sub,
    },
    preferenceValueAccent: {
        fontSize: 14,
        lineHeight: 18.5,
        color: profileColors.accent,
    },
    preferenceChevron: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 18,
        lineHeight: 23.5,
        color: profileColors.faint,
    },
    languageModalCard: {
        gap: 14,
    },
    languageOptions: {
        gap: 8,
    },
    languageOptionRow: {
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
    },
    languageOptionRowSelected: {
        borderColor: profileColors.strongBorder,
        backgroundColor: profileColors.surfaceMuted,
    },
    languageOptionRowDisabled: {
        opacity: 0.56,
    },
    languageOptionContent: {
        flex: 1,
        minWidth: 0,
    },
    languageOptionText: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 18,
        color: profileColors.ink,
    },
    languageOptionTextSelected: {
        fontFamily: fontFamilies.sansBold,
        color: profileColors.accent,
    },
    languageOptionTextStrong: {
        fontFamily: fontFamilies.sansBold,
        letterSpacing: 0.4,
    },
    languageOptionTextDisabled: {
        color: profileColors.faint,
    },
    languageOptionMeta: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11.5,
        lineHeight: 15,
        color: profileColors.sub,
    },
    languageDisclaimerText: {
        marginTop: 4,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11.5,
        lineHeight: 16,
        color: profileColors.sub,
    },
    languageSectionTitle: {
        marginTop: 6,
        fontFamily: fontFamilies.sansBold,
        fontSize: 11.5,
        lineHeight: 15,
        textTransform: 'uppercase',
        color: profileColors.faint,
    },
    logoutSection: {
        marginTop: 'auto',
        paddingTop: 16,
        paddingBottom: 18,
        paddingHorizontal: 22,
    },
    logoutButton: {
        minHeight: 49.5,
        paddingVertical: 14,
        paddingHorizontal: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: profileColors.strongBorder,
        backgroundColor: profileColors.surface,
        shadowColor: themeColors.transparent,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    logoutButtonDisabled: {
        opacity: 0.62,
    },
    logoutText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 19,
        color: profileColors.danger,
    },
    guestAccountSection: {
        paddingTop: 12,
    },
    guestAuthActions: {
        flexDirection: 'row',
        gap: 10,
        paddingTop: 4,
    },
    guestAuthButton: {
        flex: 1,
        minHeight: 46,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    guestAuthButtonSecondary: {
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
    },
    guestAuthButtonPrimary: {
        backgroundColor: profileColors.ink,
    },
    guestAuthButtonSecondaryText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        color: profileColors.ink,
    },
    guestAuthButtonPrimaryText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        color: profileColors.surface,
    },
    authModalBackdrop: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 18,
        backgroundColor: themeColors.overlay,
    },
    authModalScrim: {
        ...StyleSheet.absoluteFillObject,
    },
    authModalCard: {
        maxHeight: '88%',
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
        padding: 18,
        shadowColor: themeColors.transparent,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    authModalHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        paddingBottom: 14,
    },
    authModalCopy: {
        flex: 1,
        gap: 8,
    },
    authModalTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 23,
        lineHeight: 28,
        color: profileColors.ink,
    },
    authModalHelper: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12.5,
        lineHeight: 17,
        color: profileColors.sub,
    },
    authModalCloseButton: {
        width: 34,
        height: 34,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: profileColors.muted,
    },
    authModalCloseText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 24,
        lineHeight: 28,
        color: profileColors.sub,
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: themeColors.overlay,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    modalCard: {
        backgroundColor: themeColors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: themeColors.border,
        gap: spacing.md,
    },
    modalTitle: {
        ...textStyles.sectionTitle,
        color: profileColors.ink,
    },
    modalHelper: {
        ...textStyles.bodyMuted,
        lineHeight: 20,
        color: profileColors.sub,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
    },
    modalButton: {
        minWidth: 88,
        minHeight: 40,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.surfaceMuted,
    },
    modalPrimaryButton: {
        backgroundColor: themeColors.accentSoft,
    },
    modalButtonDisabled: {
        opacity: 0.62,
    },
    usernameInput: {
        minHeight: 46,
        borderWidth: 1,
        borderColor: profileColors.border,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: profileColors.surface,
        color: profileColors.ink,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
    },
    modalButtonText: {
        ...textStyles.label,
        color: themeColors.text,
    },
    modalPrimaryButtonText: {
        color: themeColors.accentStrong,
    },
});

export default Profile;
