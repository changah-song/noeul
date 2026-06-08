import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    useWindowDimensions,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Auth from './Auth';
import { Screen } from '../components/ui';
import { colors, fontFamilies, radii, spacing, textStyles } from '../theme';
import {
    darkenHex,
    getGeneratedBookCoverPalette,
    getStoredBookCoverColors,
    lightenHex,
} from '../services/bookCoverColors';

const WORDS_PER_PAGE = 250;
const SHELF_WIDTH = 346;
const SHELF_GAP = 2;
const MIN_EMPTY_SLOT_WIDTH = 52;
const SHELF_ROW_HEIGHT = 140;
const SHELF_BASE_HEIGHT = 4;
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

const PROFILE_COLORS = {
    bg: '#ece4d6',
    surface: '#faf6ee',
    ink: '#2c2620',
    sub: '#766a59',
    faint: '#a89b86',
    border: '#e4dac6',
    shelf: '#d8c6a6',
    accent: '#b8552e',
    danger: '#c0492f',
    tooltip: '#2c2620',
    white: '#ffffff',
};

const preferenceRows = [
    { label: 'Default language', value: 'English' },
    { label: 'Notifications', value: 'On' },
    { label: 'Reading level', value: 'Beginner' },
    { label: 'Appearance', value: 'Light' },
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

const getBookTitle = (book) => (
    String(book?.title || book?.originalTitle || book?.name || 'Untitled').trim()
);

const getBookAuthor = (book) => (
    String(book?.author || book?.originalAuthor || 'Unknown author').trim()
);

const getBookKey = (book, fallback = '') => (
    book?.cloudId || book?.uri || book?.id || `${getBookTitle(book)}-${fallback}`
);

const spinePaletteForBook = (book) => {
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

const pageLabelForBook = (book) => {
    const pages = estimatePageCount(book);
    return pages
        ? {
            pages,
            tooltip: `${pages} ${pages === 1 ? 'page' : 'pages'}`,
            accessibility: `about ${pages} ${pages === 1 ? 'page' : 'pages'}`,
        }
        : {
            pages: null,
            tooltip: 'Page number unclear, using default',
            accessibility: 'page number unclear, using default spine width',
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

    while (rows.length < 2) {
        rows.push([]);
    }

    return rows;
};

const BookSpine = ({ item, index, activeBookKey, shelfWidth, onShow }) => {
    const { book, spine } = item;
    const bookKey = getBookKey(book, String(index));
    const title = getBookTitle(book);
    const author = getBookAuthor(book);
    const pageLabel = pageLabelForBook(book);
    const isActive = activeBookKey === bookKey;
    const tooltipLeft = tooltipLeftForSpine(item, shelfWidth);
    const tooltipTailLeft = tooltipTailLeftForSpine({ tooltipLeft, spine });
    const showSpineTitle = spine.width >= SPINE_TITLE_MIN_WIDTH;
    const spineTitleGlyphs = showSpineTitle ? getSpineTitleGlyphs(title, spine) : [];

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} by ${author}, ${pageLabel.accessibility}`}
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

const ShelfRow = ({ row, rowIndex, isLast, activeBookKey, shelfWidth, onShowBook }) => (
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
                />
            ))}
            <View style={styles.emptyShelfSlot}>
                <Text style={styles.emptyShelfText}>room{'\n'}to grow</Text>
            </View>
        </View>
        <View style={styles.shelfBase} />
    </View>
);

const PreferenceRow = ({ label, value, accent = false, isLast = false, onPress }) => (
    <TouchableOpacity
        activeOpacity={0.82}
        onPress={onPress}
        style={[styles.preferenceRow, isLast && styles.preferenceRowLast]}
    >
        <Text style={styles.preferenceLabel}>{label}</Text>
        <View style={styles.preferenceValueWrap}>
            <Text style={[styles.preferenceValue, accent && styles.preferenceValueAccent]}>
                {value}
            </Text>
            <Text style={styles.preferenceChevron}>›</Text>
        </View>
    </TouchableOpacity>
);

const Profile = ({ user, signOut, books = [], updateUsername }) => {
    const [activeBookKey, setActiveBookKey] = useState(null);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState('signin');
    const [showNameEditor, setShowNameEditor] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    const { width: viewportWidth } = useWindowDimensions();
    const isGuest = !user?.id;

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
            return 'Recently';
        }

        return new Date(user.created_at).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
        });
    }, [user?.created_at]);

    const completedBooks = useMemo(() => (
        (books || [])
            .filter(isBookCompleted)
            .sort((a, b) => completedTimestamp(b) - completedTimestamp(a))
    ), [books]);

    const shelfWidth = useMemo(() => {
        const availableWidth = viewportWidth - (BOOKSHELF_HORIZONTAL_PADDING * 2);
        return Math.max(
            TOOLTIP_WIDTH + (TOOLTIP_EDGE_PADDING * 2),
            Math.min(SHELF_WIDTH, availableWidth)
        );
    }, [viewportWidth]);

    const shelfRows = useMemo(() => (
        chunkBooksIntoShelfRows(completedBooks, shelfWidth)
    ), [completedBooks, shelfWidth]);

    useEffect(() => {
        if (user?.id) {
            setShowAuthModal(false);
        }
    }, [user?.id]);

    const performSignOut = async () => {
        if (isSigningOut) {
            return;
        }

        setIsSigningOut(true);
        try {
            await signOut?.();
        } catch (error) {
            Alert.alert('Sign out failed', error.message || 'Could not sign out.');
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

    const handlePreferencePress = (label) => {
        dismissActiveBook();
        Alert.alert(label, 'This preference will be configurable soon.');
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
            Alert.alert('Username required', 'Enter a username before saving.');
            return;
        }

        if (!updateUsername) {
            Alert.alert('Username unavailable', 'Username editing is not available right now.');
            return;
        }

        setIsSavingName(true);
        try {
            await updateUsername(nextName);
            setShowNameEditor(false);
        } catch (error) {
            Alert.alert('Save failed', error?.message || 'Could not update your username.');
        } finally {
            setIsSavingName(false);
        }
    };

    return (
        <Screen
            backgroundColor={PROFILE_COLORS.bg}
            contentContainerStyle={styles.screenContent}
        >
            <Pressable
                accessible={false}
                onPress={dismissActiveBook}
                style={styles.screenTapArea}
            >
                <View style={styles.profileHeader}>
                    <View style={styles.profileHeaderTopRow}>
                        <View style={styles.profileIdentity}>
                            <Text style={styles.profileName}>{displayName}</Text>
                            <Text style={styles.profileSubtitle}>
                                {isGuest ? 'Guest mode · local reading' : `Beginner · learning since ${learningSince}`}
                            </Text>
                        </View>
                        {!isGuest ? (
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel="Edit username"
                                activeOpacity={0.78}
                                onPress={openNameEditor}
                                style={styles.editUsernameButton}
                            >
                                <Feather name="edit-2" size={16} color={PROFILE_COLORS.sub} />
                            </TouchableOpacity>
                        ) : null}
                    </View>
                </View>

                <View style={styles.bookshelfSection}>
                    <View style={styles.sectionLabelRow}>
                        <Text style={styles.sectionEyebrow}>Your Bookshelf</Text>
                        <Text style={styles.finishedCount}>{completedBooks.length} finished</Text>
                    </View>

                    {shelfRows.map((row, index) => (
                        <ShelfRow
                            key={`shelf-row-${index}`}
                            row={row}
                            rowIndex={index}
                            isLast={index === shelfRows.length - 1}
                            activeBookKey={activeBookKey}
                            shelfWidth={shelfWidth}
                            onShowBook={setActiveBookKey}
                        />
                    ))}
                </View>

                <View style={styles.preferencesSection}>
                    <View style={styles.sectionLabelRow}>
                        <Text style={styles.sectionEyebrow}>Preferences</Text>
                    </View>
                    <View style={styles.preferencesCard}>
                        {preferenceRows.map((row, index) => (
                            <PreferenceRow
                                key={row.label}
                                label={row.label}
                                value={row.value}
                                accent={index === 0}
                                isLast={index === preferenceRows.length - 1}
                                onPress={() => handlePreferencePress(row.label)}
                            />
                        ))}
                    </View>
                </View>

                {isGuest ? (
                    <View style={styles.guestAccountSection}>
                        <Text style={styles.guestAccountTitle}>Take your library with you</Text>
                        <Text style={styles.guestAccountCopy}>
                            Create an account to sync books, saved words, writing, songs, and progress across devices. Your guest data stays on this device unless you choose to save or merge it.
                        </Text>
                        <View style={styles.guestAuthActions}>
                            <TouchableOpacity
                                activeOpacity={0.86}
                                onPress={() => openAuthModal('signin')}
                                style={[styles.guestAuthButton, styles.guestAuthButtonSecondary]}
                            >
                                <Text style={styles.guestAuthButtonSecondaryText}>Sign in</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.86}
                                onPress={() => openAuthModal('signup')}
                                style={[styles.guestAuthButton, styles.guestAuthButtonPrimary]}
                            >
                                <Text style={styles.guestAuthButtonPrimaryText}>Sign up</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
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
                            <Text style={styles.logoutText}>{isSigningOut ? 'Logging out...' : 'Log out'}</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </Pressable>

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
                                    {authMode === 'signup' ? 'Create account' : 'Sign in'}
                                </Text>
                                <Text style={styles.authModalHelper}>
                                    Use email and password or continue with Google.
                                </Text>
                            </View>
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel="Close sign in"
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
                                <Text style={styles.modalTitle}>Edit username</Text>
                                <TextInput
                                    value={draftName}
                                    onChangeText={setDraftName}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!isSavingName}
                                    placeholder="Username"
                                    placeholderTextColor={PROFILE_COLORS.faint}
                                    style={styles.usernameInput}
                                />
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowNameEditor(false)}
                                        style={styles.modalButton}
                                        disabled={isSavingName}
                                    >
                                        <Text style={styles.modalButtonText}>Cancel</Text>
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
                                            {isSavingName ? 'Saving...' : 'Save'}
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
                                <Text style={styles.modalTitle}>Log out?</Text>
                                <Text style={styles.modalHelper}>
                                    Choose whether to keep this account data cached on this device.
                                </Text>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowSignOutModal(false)}
                                        style={styles.modalButton}
                                    >
                                        <Text style={styles.modalButtonText}>Cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => performSignOut()}
                                        style={[styles.modalButton, styles.modalPrimaryButton]}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            Log out
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

const styles = StyleSheet.create({
    screenContent: {
        flex: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: PROFILE_COLORS.bg,
    },
    screenTapArea: {
        flex: 1,
        width: '100%',
    },
    profileHeader: {
        minHeight: 85,
        paddingTop: 22,
        paddingBottom: 18,
        paddingHorizontal: 22,
        backgroundColor: PROFILE_COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: PROFILE_COLORS.border,
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
        fontFamily: fontFamilies.serifBold,
        fontSize: 24,
        lineHeight: 28,
        letterSpacing: -0.4,
        color: PROFILE_COLORS.ink,
    },
    profileSubtitle: {
        marginTop: 3,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        color: PROFILE_COLORS.sub,
    },
    editUsernameButton: {
        width: 38,
        height: 38,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: PROFILE_COLORS.border,
        backgroundColor: '#f5ead9',
    },
    bookshelfSection: {
        paddingTop: 18,
        paddingHorizontal: BOOKSHELF_HORIZONTAL_PADDING,
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
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14.5,
        textTransform: 'uppercase',
        letterSpacing: 0.66,
        color: PROFILE_COLORS.sub,
    },
    finishedCount: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 15.5,
        color: PROFILE_COLORS.sub,
    },
    shelfBlock: {
        width: '100%',
        height: SHELF_ROW_HEIGHT + SHELF_BASE_HEIGHT,
        marginBottom: 16,
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
        backgroundColor: 'rgba(255,255,255,0.1)',
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
        borderColor: PROFILE_COLORS.border,
    },
    emptyShelfText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15.4,
        textAlign: 'center',
        color: PROFILE_COLORS.faint,
    },
    shelfBase: {
        width: '100%',
        height: SHELF_BASE_HEIGHT,
        backgroundColor: PROFILE_COLORS.shelf,
    },
    bookTooltip: {
        position: 'absolute',
        top: -72,
        width: TOOLTIP_WIDTH,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: PROFILE_COLORS.tooltip,
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
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderTopColor: PROFILE_COLORS.tooltip,
    },
    tooltipTitle: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 11.5,
        lineHeight: 15,
        color: PROFILE_COLORS.white,
    },
    tooltipMeta: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 10.5,
        lineHeight: 13,
        color: 'rgba(255,255,255,0.72)',
    },
    preferencesSection: {
        paddingTop: 8,
        paddingHorizontal: 22,
    },
    preferencesCard: {
        width: '100%',
        borderRadius: 0,
        backgroundColor: PROFILE_COLORS.surface,
        shadowColor: 'rgba(70,48,20,0.36)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 14,
        elevation: 2,
        overflow: 'hidden',
    },
    preferenceRow: {
        minHeight: 52.5,
        paddingVertical: 14,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: PROFILE_COLORS.border,
    },
    preferenceRowLast: {
        borderBottomWidth: 0,
    },
    preferenceLabel: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 19.5,
        color: PROFILE_COLORS.ink,
    },
    preferenceValueWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    preferenceValue: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        color: PROFILE_COLORS.sub,
    },
    preferenceValueAccent: {
        fontSize: 14,
        lineHeight: 18.5,
        color: PROFILE_COLORS.accent,
    },
    preferenceChevron: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 18,
        lineHeight: 23.5,
        color: PROFILE_COLORS.faint,
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
        borderColor: 'rgba(192,73,47,0.267)',
        backgroundColor: PROFILE_COLORS.surface,
        shadowColor: 'rgba(70,48,20,0.36)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 14,
        elevation: 2,
    },
    logoutButtonDisabled: {
        opacity: 0.62,
    },
    logoutText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 19,
        color: PROFILE_COLORS.danger,
    },
    guestAccountSection: {
        marginTop: 'auto',
        paddingHorizontal: 22,
        paddingTop: 14,
        paddingBottom: 18,
        gap: 10,
    },
    guestAccountTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 19,
        lineHeight: 24,
        color: PROFILE_COLORS.ink,
    },
    guestAccountCopy: {
        maxWidth: 360,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12.5,
        lineHeight: 18,
        color: PROFILE_COLORS.sub,
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
        borderColor: PROFILE_COLORS.border,
        backgroundColor: PROFILE_COLORS.surface,
    },
    guestAuthButtonPrimary: {
        backgroundColor: PROFILE_COLORS.ink,
    },
    guestAuthButtonSecondaryText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        color: PROFILE_COLORS.ink,
    },
    guestAuthButtonPrimaryText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        color: PROFILE_COLORS.surface,
    },
    authModalBackdrop: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 18,
        backgroundColor: 'rgba(44,38,32,0.35)',
    },
    authModalScrim: {
        ...StyleSheet.absoluteFillObject,
    },
    authModalCard: {
        maxHeight: '88%',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: PROFILE_COLORS.border,
        backgroundColor: PROFILE_COLORS.surface,
        padding: 18,
        shadowColor: 'rgba(70,48,20,0.36)',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 8,
    },
    authModalHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        paddingBottom: 2,
    },
    authModalCopy: {
        flex: 1,
        gap: 3,
    },
    authModalTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 23,
        lineHeight: 28,
        color: PROFILE_COLORS.ink,
    },
    authModalHelper: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12.5,
        lineHeight: 17,
        color: PROFILE_COLORS.sub,
    },
    authModalCloseButton: {
        width: 34,
        height: 34,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#efe3d0',
    },
    authModalCloseText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 24,
        lineHeight: 28,
        color: PROFILE_COLORS.sub,
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.26)',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    modalCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: colors.border,
        gap: spacing.md,
    },
    modalTitle: {
        ...textStyles.sectionTitle,
    },
    modalHelper: {
        ...textStyles.bodyMuted,
        lineHeight: 20,
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
        backgroundColor: colors.surfaceMuted,
    },
    modalPrimaryButton: {
        backgroundColor: colors.accentSoft,
    },
    modalButtonDisabled: {
        opacity: 0.62,
    },
    usernameInput: {
        minHeight: 46,
        borderWidth: 1,
        borderColor: PROFILE_COLORS.border,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: PROFILE_COLORS.surface,
        color: PROFILE_COLORS.ink,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
    },
    modalButtonText: {
        ...textStyles.label,
        color: colors.text,
    },
    modalPrimaryButtonText: {
        color: colors.accentStrong,
    },
});

export default Profile;
