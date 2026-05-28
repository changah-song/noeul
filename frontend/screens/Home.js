import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
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
import * as DocumentPicker from 'expo-document-picker';
import { Feather } from '@expo/vector-icons';
import { IconButton, Screen } from '../components/ui';
import { colors, fontFamilies, layout, spacing, textStyles } from '../theme';
import useBooks from '../hooks/useBooks';
import { deleteBookIndexEntries } from '../services/Database';

const BOOK_GRID_GAP = 18;

const SONG_LIBRARY = [
    { id: 'spring-day', title: '봄날', artist: 'BTS', lines: 32, colors: ['#c98745', '#dcc53a'] },
    { id: 'eight', title: '에잇', artist: 'IU', lines: 28, colors: ['#cfe15a', '#49cf34'] },
    { id: 'antifragile', title: 'Antifragile', artist: 'LE SSERAFIM', lines: 41, colors: ['#70d867', '#35d37c'] },
    { id: 'love-lee', title: 'Love Lee', artist: 'AKMU', lines: 36, colors: ['#69d1bd', '#33b6d5'] },
    { id: 'ditto', title: 'Ditto', artist: 'NewJeans', lines: 30, colors: ['#96d0f2', '#6793da'] },
    { id: 'through-the-night', title: '밤편지', artist: 'IU', lines: 34, colors: ['#7074bd', '#464b9a'] },
    { id: 'dynamite', title: 'Dynamite', artist: 'BTS', lines: 29, colors: ['#f4b55d', '#e17e44'] },
    { id: 'hype-boy', title: 'Hype Boy', artist: 'NewJeans', lines: 33, colors: ['#f27fa1', '#c85fd0'] },
    { id: 'palette', title: 'Palette', artist: 'IU', lines: 31, colors: ['#cda569', '#87a768'] },
    { id: 'tomboy', title: 'Tomboy', artist: '(G)I-DLE', lines: 35, colors: ['#ec6d6d', '#b74444'] },
    { id: 'left-right', title: 'Left Right', artist: 'XG', lines: 27, colors: ['#62a2df', '#4b68d4'] },
    { id: 'super-shy', title: 'Super Shy', artist: 'NewJeans', lines: 26, colors: ['#7fdac8', '#4bb8f0'] },
];

const BOOK_FILTERS = [
    { id: 'library', label: 'My library' },
    { id: 'classics', label: 'Classics' },
    { id: 'public-domain', label: 'Public domain' },
];

const DIFFICULTY_FILTERS = ['All levels', 'Beginner', 'Intermediate', 'Advanced'];

const BROWSE_CATALOGS = {
    classics: {
        id: 'classics',
        eyebrow: 'AI-SUMMARIZED',
        title: 'Classics',
        subtitle: 'Long books, rewritten short · 8 books',
        shelfCopy: 'Long classics, rewritten short',
        emptyTitle: 'Classics, made readable.',
        emptyCopy: 'Long, dense classics rewritten in plain Korean at your level.',
        emptyButton: 'Browse 8 classics',
        emptyFootnote: 'Powered by AI · adapts to your level',
        books: [
            { id: 'demian', title: 'Demian', author: 'Hermann Hesse', authorShort: 'HERMANN HESSE', difficulty: 'Intermediate', length: '18 min', color: '#344934', titleColor: '#f6eddc' },
            { id: 'crime-punishment', title: 'Crime and Punishment', author: 'Dostoevsky', authorShort: 'DOSTOYEVSKY', difficulty: 'Advanced', length: '45 min', color: '#633a2e', titleColor: '#f6eddc' },
            { id: 'stranger', title: 'The Stranger', author: 'Albert Camus', authorShort: 'ALBERT CAMUS', difficulty: 'Beginner', length: '22 min', color: '#9a884b', titleColor: '#1f1a14' },
            { id: 'norwegian-wood', title: 'Norwegian Wood', author: 'Haruki Murakami', authorShort: 'HARUKI MURAKAMI', difficulty: 'Intermediate', length: '31 min', color: '#2b5968', titleColor: '#f6eddc' },
            { id: 'metamorphosis', title: 'The Metamorphosis', author: 'Franz Kafka', authorShort: 'FRANZ KAFKA', difficulty: 'Beginner', length: '16 min', color: '#343434', titleColor: '#f0d39a' },
            { id: 'kitchen', title: 'Kitchen', author: 'Banana Yoshimoto', authorShort: 'BANANA YOSHIMOTO', difficulty: 'Beginner', length: '20 min', color: '#6a4052', titleColor: '#ead6dc' },
            { id: 'siddhartha', title: 'Siddhartha', author: 'Hermann Hesse', authorShort: 'HERMANN HESSE', difficulty: 'Intermediate', length: '26 min', color: '#725337', titleColor: '#f6eddc' },
            { id: 'dorian-gray', title: 'Dorian Gray', author: 'Oscar Wilde', authorShort: 'OSCAR WILDE', difficulty: 'Advanced', length: '36 min', color: '#283e48', titleColor: '#f2d674' },
        ],
    },
    'public-domain': {
        id: 'public-domain',
        eyebrow: 'PUBLIC DOMAIN',
        title: 'Public domain',
        subtitle: 'Full Korean text · free forever · 8 books',
        shelfCopy: 'Free books, full Korean text',
        emptyTitle: 'Free books, full text.',
        emptyCopy: 'Classic works in their complete Korean translation, free forever.',
        emptyButton: 'Browse 8+ books',
        emptyFootnote: 'Public domain · free forever',
        books: [
            { id: 'pride-prejudice', title: 'Pride and Prejudice', author: 'Jane Austen', authorShort: 'JANE AUSTEN', difficulty: 'Advanced', length: '61 ch.', color: '#794621', titleColor: '#f6eddc' },
            { id: 'gatsby', title: 'The Great Gatsby', author: 'F. S. Fitzgerald', authorShort: 'F. S. FITZGERALD', difficulty: 'Intermediate', length: '9 ch.', color: '#1f3340', titleColor: '#f2d674' },
            { id: 'walden', title: 'Walden', author: 'H. D. Thoreau', authorShort: 'H. D. THOREAU', difficulty: 'Advanced', length: '18 ch.', color: '#475f37', titleColor: '#f6eddc' },
            { id: 'frankenstein', title: 'Frankenstein', author: 'Mary Shelley', authorShort: 'MARY SHELLEY', difficulty: 'Advanced', length: '24 ch.', color: '#2d2d2b', titleColor: '#e0b27a' },
            { id: 'alice', title: "Alice's Adventures", author: 'Lewis Carroll', authorShort: 'LEWIS CARROLL', difficulty: 'Beginner', length: '12 ch.', color: '#255d5b', titleColor: '#f6eddc' },
            { id: 'jane-eyre', title: 'Jane Eyre', author: 'Charlotte Bronte', authorShort: 'CHARLOTTE BRONTE', difficulty: 'Advanced', length: '38 ch.', color: '#5f4438', titleColor: '#f6eddc' },
            { id: 'sherlock', title: 'Sherlock Holmes', author: 'Arthur Conan Doyle', authorShort: 'A. C. DOYLE', difficulty: 'Intermediate', length: '12 ch.', color: '#384a4d', titleColor: '#e9d4a0' },
            { id: 'secret-garden', title: 'The Secret Garden', author: 'Frances Hodgson Burnett', authorShort: 'F. H. BURNETT', difficulty: 'Beginner', length: '27 ch.', color: '#58663f', titleColor: '#f6eddc' },
        ],
    },
};

const BOOK_COVER_PALETTES = [
    { background: '#17172c', foreground: '#ff2f86' },
    { background: '#2c2c3f', foreground: '#36b7e8' },
    { background: '#5c915c', foreground: '#f7f5e8' },
    { background: '#523a32', foreground: '#ffd24f' },
    { background: '#1f433d', foreground: '#c8f7dc' },
    { background: '#ece2ca', foreground: '#252018' },
];

const KOREAN_TEXT_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getBookTitle = (book) => book?.title?.trim() || 'Untitled';
const getBookAuthor = (book) => book?.author?.trim() || 'Unknown author';
const hasKoreanText = (value) => KOREAN_TEXT_PATTERN.test(String(value || ''));

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

const getPaletteForBook = (book, index = 0) => {
    const source = `${book?.uri || ''}${book?.title || ''}${index}`;
    const hash = source.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return BOOK_COVER_PALETTES[hash % BOOK_COVER_PALETTES.length];
};

const BookCover = ({ book, width, height, index, style, titleStyle }) => {
    if (book?.cover) {
        return (
            <Image
                source={{ uri: book.cover }}
                style={[styles.coverImage, { width, height }, style]}
            />
        );
    }

    const palette = getPaletteForBook(book, index);

    return (
        <View style={[
            styles.coverFallback,
            {
                width,
                height,
                backgroundColor: palette.background,
            },
            style,
        ]}>
            <Text
                numberOfLines={2}
                style={[
                    styles.coverFallbackText,
                    { color: palette.foreground },
                    getSerifFontForText(getBookTitle(book)),
                    titleStyle,
                ]}
            >
                {getBookTitle(book)}
            </Text>
        </View>
    );
};

const CatalogBookCover = ({ book, width, height, style, compact = false }) => (
    <View style={[
        styles.catalogCover,
        {
            width,
            height,
            backgroundColor: book.color,
        },
        style,
    ]}>
        <Text
            style={[
                styles.catalogCoverTitle,
                compact && styles.catalogCoverTitleCompact,
                { color: book.titleColor },
            ]}
            numberOfLines={3}
        >
            {book.title}
        </Text>
        <Text
            style={[
                styles.catalogCoverAuthor,
                compact && styles.catalogCoverAuthorCompact,
                { color: book.titleColor },
            ]}
            numberOfLines={2}
        >
            {book.authorShort || book.author}
        </Text>
    </View>
);

const Home = ({ books, setBooks, currentBook, setCurrentBook, setPreprocessOnOpen, navigation }) => {
    const [editBook, setEditBook] = useState(null);
    const [editDraft, setEditDraft] = useState({ title: '', author: '', cover: '' });
    const [activeLibraryTab, setActiveLibraryTab] = useState('Books');
    const [activeBookFilter, setActiveBookFilter] = useState('library');
    const [browseCatalogId, setBrowseCatalogId] = useState(null);
    const [activeDifficulty, setActiveDifficulty] = useState('All levels');
    const [songQuery, setSongQuery] = useState('');
    const [widgetEnabled, setWidgetEnabled] = useState(true);
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
    });

    const currentReadingBook = useMemo(() => (
        books.find((book) => book.uri === currentBook) ?? books[0] ?? null
    ), [books, currentBook]);
    const currentProgressPercent = Math.round(getBookProgress(currentReadingBook) * 100);

    const contentWidth = Math.min(
        Math.max(width - (spacing.md * 2), 288),
        layout.screenMaxWidth - (spacing.md * 2)
    );
    const bookTileWidth = Math.floor((contentWidth - (BOOK_GRID_GAP * 2)) / 3);
    const bookCoverHeight = Math.round(bookTileWidth * 1.34);
    const catalogTileWidth = Math.floor((contentWidth - BOOK_GRID_GAP) / 2);
    const catalogCoverHeight = Math.round(catalogTileWidth * 1.44);
    const bookFilterCounts = useMemo(() => ({
        library: books.length,
        classics: 0,
        'public-domain': 0,
    }), [books.length]);
    const activeShelfCatalog = BROWSE_CATALOGS[activeBookFilter] ?? null;
    const activeBookFilterCount = bookFilterCounts[activeBookFilter] ?? 0;
    const browseCatalog = browseCatalogId ? BROWSE_CATALOGS[browseCatalogId] : null;
    const filteredBrowseBooks = useMemo(() => {
        if (!browseCatalog) {
            return [];
        }

        if (activeDifficulty === 'All levels') {
            return browseCatalog.books;
        }

        return browseCatalog.books.filter((book) => book.difficulty === activeDifficulty);
    }, [activeDifficulty, browseCatalog]);

    const filteredSongs = useMemo(() => {
        const query = songQuery.trim().toLowerCase();

        if (!query) {
            return SONG_LIBRARY.slice(0, 4);
        }

        return SONG_LIBRARY.filter((song) => (
            song.title.toLowerCase().includes(query)
            || song.artist.toLowerCase().includes(query)
        ));
    }, [songQuery]);

    useEffect(() => {
        navigation?.setOptions({
            tabBarStyle: browseCatalog ? { display: 'none' } : undefined,
        });
    }, [browseCatalog, navigation]);

    const updateBookRecord = useCallback((uri, patch) => {
        setBooks((prevBooks) => prevBooks.map((book) => (
            book.uri === uri ? { ...book, ...patch } : book
        )));
    }, [setBooks]);

    const handleDeleteBook = useCallback((bookToDelete) => {
        Alert.alert(
            'Remove book',
            `Remove "${getBookTitle(bookToDelete)}" from your collection?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        await deleteBookIndexEntries(bookToDelete.uri);
                        setBooks((prevBooks) => {
                            const remainingBooks = prevBooks.filter((book) => book.uri !== bookToDelete.uri);

                            if (currentBook === bookToDelete.uri) {
                                setCurrentBook(remainingBooks[0]?.uri ?? null);
                                setPreprocessOnOpen(false);
                            }

                            return remainingBooks;
                        });
                    },
                },
            ]
        );
    }, [currentBook, setBooks, setCurrentBook, setPreprocessOnOpen]);

    const handleEditBook = useCallback((book) => {
        if (!book) {
            return;
        }

        setEditBook(book);
        setEditDraft({
            title: book.title || '',
            author: book.author || '',
            cover: book.cover || '',
        });
    }, []);

    const handleBookLongPress = useCallback((book) => {
        Alert.alert(
            getBookTitle(book),
            getBookAuthor(book),
            [
                { text: 'Open', onPress: () => handlePress(book.uri) },
                { text: 'Edit details', onPress: () => handleEditBook(book) },
                { text: 'Remove', style: 'destructive', onPress: () => handleDeleteBook(book) },
                { text: 'Cancel', style: 'cancel' },
            ]
        );
    }, [handleDeleteBook, handleEditBook, handlePress]);

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

        updateBookRecord(editBook.uri, {
            title: editDraft.title.trim() || 'Untitled',
            author: editDraft.author.trim() || 'Unknown author',
            cover: editDraft.cover.trim() || null,
        });
        setEditBook(null);
    }, [editBook, editDraft.author, editDraft.cover, editDraft.title, updateBookRecord]);

    const handleAddSong = useCallback(() => {
        Alert.alert('Add song', 'Song importing is not wired up yet.');
    }, []);

    const openBrowseCatalog = useCallback((catalogId) => {
        setBrowseCatalogId(catalogId);
        setActiveDifficulty('All levels');
    }, []);

    const closeBrowseCatalog = useCallback(() => {
        setBrowseCatalogId(null);
    }, []);

    const handlePlaceholderBookPress = useCallback((book) => {
        Alert.alert(
            book.title,
            'This is placeholder catalog content for now.'
        );
    }, []);

    if (browseCatalog) {
        return (
            <Screen scroll backgroundColor="#fbf7ef" contentContainerStyle={styles.browseScreenContent}>
                <View style={styles.browseTopBar}>
                    <TouchableOpacity
                        activeOpacity={0.78}
                        onPress={closeBrowseCatalog}
                        style={styles.browseIconButton}
                    >
                        <Feather name="chevron-left" size={30} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        activeOpacity={0.78}
                        onPress={() => Alert.alert('Search', 'Search is placeholder-only for now.')}
                        style={styles.browseIconButton}
                    >
                        <Feather name="search" size={25} color={colors.textMuted} />
                    </TouchableOpacity>
                </View>

                <View style={styles.browseTitleBlock}>
                    <Text style={styles.browseEyebrow}>{browseCatalog.eyebrow}</Text>
                    <Text style={styles.browseTitle}>{browseCatalog.title}</Text>
                    <Text style={styles.browseSubtitle}>{browseCatalog.subtitle}</Text>
                </View>

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.difficultyFilters}
                >
                    {DIFFICULTY_FILTERS.map((difficulty) => {
                        const isActive = activeDifficulty === difficulty;

                        return (
                            <TouchableOpacity
                                key={difficulty}
                                activeOpacity={0.84}
                                onPress={() => setActiveDifficulty(difficulty)}
                                style={[
                                    styles.difficultyChip,
                                    isActive && styles.difficultyChipActive,
                                ]}
                            >
                                <Text style={[
                                    styles.difficultyChipText,
                                    isActive && styles.difficultyChipTextActive,
                                ]}>
                                    {difficulty}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                <View style={styles.catalogGrid}>
                    {filteredBrowseBooks.map((book) => (
                        <View
                            key={book.id}
                            style={[
                                styles.catalogTile,
                                { width: catalogTileWidth },
                            ]}
                        >
                            <CatalogBookCover
                                book={book}
                                width={catalogTileWidth}
                                height={catalogCoverHeight}
                            />
                            <Text style={styles.catalogMeta} numberOfLines={1}>
                                {book.difficulty.toUpperCase()} · {book.length}
                            </Text>
                            <Text style={styles.catalogBookTitle} numberOfLines={2}>
                                {book.title}
                            </Text>
                            <Text style={styles.catalogBookAuthor} numberOfLines={1}>
                                {book.author}
                            </Text>
                            <TouchableOpacity
                                activeOpacity={0.84}
                                onPress={() => handlePlaceholderBookPress(book)}
                                style={styles.catalogAddButton}
                            >
                                <Feather name="plus" size={17} color={colors.text} />
                                <Text style={styles.catalogAddButtonText}>Add to library</Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                </View>
            </Screen>
        );
    }

    return (
        <Screen scroll backgroundColor="#fbf7ef" contentContainerStyle={styles.screenContent}>
            <View style={styles.headerRow}>
                <Text
                    style={styles.brandTitle}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                >
                    Fluent<Text style={styles.brandTitleAccent}>Fable</Text>
                </Text>

                <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: widgetEnabled }}
                    onPress={() => setWidgetEnabled((enabled) => !enabled)}
                    style={({ pressed }) => [
                        styles.widgetPill,
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={styles.widgetText} numberOfLines={1}>
                        Widget
                    </Text>
                    <View style={[styles.widgetSwitch, widgetEnabled && styles.widgetSwitchOn]}>
                        <View style={[styles.widgetKnob, widgetEnabled && styles.widgetKnobOn]} />
                    </View>
                </Pressable>
            </View>

            {currentReadingBook ? (
                <Pressable
                    onPress={() => handlePress(currentReadingBook.uri)}
                    style={({ pressed }) => [pressed && styles.pressed]}
                >
                    <View style={styles.continueCard}>
                        <BookCover
                            book={currentReadingBook}
                            width={42}
                            height={60}
                            index={0}
                            style={styles.continueCover}
                            titleStyle={styles.continueCoverText}
                        />

                        <View style={styles.continueCopy}>
                            <Text style={styles.continueEyebrow}>CONTINUE · {currentProgressPercent}%</Text>
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
                            <Feather name="play" size={17} color={colors.white} />
                        </View>
                    </View>
                </Pressable>
            ) : (
                <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={confirmAddBook}
                    style={styles.emptyContinueCard}
                >
                    {isImporting ? (
                        <ActivityIndicator size="small" color={colors.accentStrong} />
                    ) : (
                        <Feather name="plus" size={24} color={colors.accentStrong} />
                    )}
                    <Text style={styles.emptyContinueTitle}>
                        Import your first book
                    </Text>
                </TouchableOpacity>
            )}

            <View style={styles.libraryHeader}>
                <View style={styles.libraryTabs}>
                    <TouchableOpacity
                        activeOpacity={0.82}
                        onPress={() => setActiveLibraryTab('Books')}
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
                        onPress={() => setActiveLibraryTab('Songs')}
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
                                    onPress={() => setActiveBookFilter(filter.id)}
                                    style={[
                                        styles.bookFilterChip,
                                        isActive && styles.bookFilterChipActive,
                                    ]}
                                >
                                    <Text style={[
                                        styles.bookFilterChipText,
                                        isActive && styles.bookFilterChipTextActive,
                                    ]}>
                                        {filter.label}
                                    </Text>
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

                    {activeBookFilter === 'library' ? (
                        <>
                            <View style={styles.bookSectionHeader}>
                                <Text style={styles.bookSectionCount}>
                                    {books.length} {books.length === 1 ? 'book' : 'books'}
                                </Text>
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

                            <View style={styles.bookGrid}>
                                {books.map((book, index) => (
                                    <Pressable
                                        key={book.uri || book.id || `${book.title}-${index}`}
                                        onPress={() => handlePress(book.uri)}
                                        onLongPress={() => handleBookLongPress(book)}
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
                                    </Pressable>
                                ))}

                                <TouchableOpacity
                                    activeOpacity={0.88}
                                    onPress={confirmAddBook}
                                    style={[styles.addBookTile, { width: bookTileWidth, height: bookCoverHeight }]}
                                >
                                    {isImporting ? (
                                        <ActivityIndicator size="small" color={colors.textSubtle} />
                                    ) : (
                                        <Feather name="plus" size={30} color={colors.textSubtle} />
                                    )}
                                    <Text style={styles.addBookText}>Import</Text>
                                    <Text style={styles.addBookSubtext}>.epub</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : activeShelfCatalog && activeBookFilterCount === 0 ? (
                        <View style={styles.emptyCatalogPanel}>
                            <View style={styles.emptyStack}>
                                {activeShelfCatalog.books.slice(0, 3).map((book, index) => (
                                    <CatalogBookCover
                                        key={book.id}
                                        book={book}
                                        width={82}
                                        height={116}
                                        compact
                                        style={[
                                            styles.emptyStackCover,
                                            {
                                                marginLeft: index === 0 ? 0 : -24,
                                                transform: [{ rotate: `${[-8, 2, 8][index]}deg` }],
                                                zIndex: index === 1 ? 3 : 2,
                                            },
                                        ]}
                                    />
                                ))}
                            </View>
                            <Text style={styles.emptyCatalogTitle}>
                                {activeShelfCatalog.emptyTitle}
                            </Text>
                            <Text style={styles.emptyCatalogCopy}>
                                {activeShelfCatalog.emptyCopy}
                            </Text>
                            <TouchableOpacity
                                activeOpacity={0.86}
                                onPress={() => openBrowseCatalog(activeBookFilter)}
                                style={styles.emptyCatalogButton}
                            >
                                <Text style={styles.emptyCatalogButtonText}>
                                    {activeShelfCatalog.emptyButton}
                                </Text>
                                <Feather name="arrow-right" size={18} color={colors.white} />
                            </TouchableOpacity>
                            <Text style={styles.emptyCatalogFootnote}>
                                {activeShelfCatalog.emptyFootnote}
                            </Text>
                        </View>
                    ) : activeShelfCatalog ? (
                        <View style={styles.categoryPreviewSection}>
                            <View style={styles.categoryPreviewHeader}>
                                <Text style={styles.categoryPreviewCopy}>
                                    {activeShelfCatalog.shelfCopy}
                                </Text>
                                <TouchableOpacity
                                    activeOpacity={0.84}
                                    onPress={() => openBrowseCatalog(activeBookFilter)}
                                >
                                    <Text style={styles.categoryBrowseLink}>Browse →</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={styles.bookGrid}>
                                <TouchableOpacity
                                    activeOpacity={0.88}
                                    onPress={() => openBrowseCatalog(activeBookFilter)}
                                    style={[styles.addBookTile, { width: bookTileWidth, height: bookCoverHeight }]}
                                >
                                    <Feather name="plus" size={30} color={colors.textSubtle} />
                                    <Text style={styles.addBookText}>Browse</Text>
                                    <Text style={styles.addBookSubtext}>8+</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : null}
                </View>
            ) : (
                <View style={styles.songsPanel}>
                    <View style={styles.searchBox}>
                        <Feather name="search" size={19} color={colors.textSubtle} />
                        <TextInput
                            value={songQuery}
                            onChangeText={setSongQuery}
                            style={styles.searchInput}
                            placeholder="Search title, artist, or lyric..."
                            placeholderTextColor={colors.textSubtle}
                            returnKeyType="search"
                        />
                    </View>

                    <View style={styles.songList}>
                        {filteredSongs.length > 0 ? (
                            filteredSongs.map((song, index) => (
                                <Pressable
                                    key={song.id}
                                    onPress={() => Alert.alert(song.title, 'Song reading is not wired up yet.')}
                                    style={({ pressed }) => [
                                        styles.songRow,
                                        index === filteredSongs.length - 1 && styles.songRowLast,
                                        pressed && styles.songRowPressed,
                                    ]}
                                >
                                    <View style={[
                                        styles.songIcon,
                                        { backgroundColor: song.colors[0] },
                                    ]}>
                                        <View style={[styles.songIconAccent, { backgroundColor: song.colors[1] }]} />
                                        <Feather name="music" size={22} color={colors.white} />
                                    </View>
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
                                            {song.artist} · {song.lines} lines
                                        </Text>
                                    </View>
                                    <Feather name="chevron-right" size={23} color={colors.textSubtle} />
                                </Pressable>
                            ))
                        ) : (
                            <View style={styles.emptySongs}>
                                <Text style={styles.emptySongsText}>No songs found</Text>
                            </View>
                        )}
                    </View>
                </View>
            )}

            {!!openingBookUri && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="small" color={colors.accentStrong} />
                    <Text style={styles.loadingText}>Opening book...</Text>
                </View>
            )}

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
                                    <Image
                                        source={editDraft.cover ? { uri: editDraft.cover } : require('../assets/icon.png')}
                                        style={styles.coverPreview}
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
        </Screen>
    );
};

const styles = StyleSheet.create({
    screenContent: {
        flexGrow: 1,
        paddingHorizontal: spacing.md,
        paddingTop: 0,
        paddingBottom: spacing.xxxl,
        gap: spacing.lg,
    },
    browseScreenContent: {
        flexGrow: 1,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xxxl,
        gap: spacing.md,
    },
    browseTopBar: {
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    browseIconButton: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 19,
    },
    browseTitleBlock: {
        gap: 2,
    },
    browseEyebrow: {
        ...textStyles.eyebrow,
        fontSize: 13,
        lineHeight: 17,
        color: colors.accent,
        letterSpacing: 3,
    },
    browseTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 37,
        lineHeight: 45,
        color: colors.text,
        includeFontPadding: true,
        letterSpacing: 0,
    },
    browseSubtitle: {
        ...textStyles.body,
        fontSize: 16,
        lineHeight: 22,
        color: colors.textMuted,
    },
    difficultyFilters: {
        gap: spacing.sm,
        paddingRight: spacing.md,
        paddingVertical: spacing.xs,
    },
    difficultyChip: {
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#eadfcb',
        backgroundColor: '#fffaf2',
    },
    difficultyChipActive: {
        borderColor: colors.text,
        backgroundColor: colors.text,
    },
    difficultyChipText: {
        ...textStyles.sectionTitle,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    difficultyChipTextActive: {
        color: colors.white,
    },
    catalogGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: BOOK_GRID_GAP,
        paddingTop: spacing.xs,
    },
    catalogTile: {
        gap: 4,
        marginBottom: spacing.lg,
    },
    catalogCover: {
        justifyContent: 'space-between',
        padding: spacing.md,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: colors.surfaceMuted,
        boxShadow: '0 8px 14px rgba(41, 28, 14, 0.10)',
    },
    catalogCoverTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 19,
        lineHeight: 23,
        letterSpacing: 0,
    },
    catalogCoverTitleCompact: {
        fontSize: 13,
        lineHeight: 16,
    },
    catalogCoverAuthor: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 1.3,
        opacity: 0.78,
    },
    catalogCoverAuthorCompact: {
        fontSize: 8,
        lineHeight: 11,
        letterSpacing: 0.7,
    },
    catalogMeta: {
        ...textStyles.eyebrow,
        marginTop: spacing.xs,
        color: colors.textSubtle,
        letterSpacing: 1.1,
    },
    catalogBookTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 20,
        lineHeight: 24,
        color: colors.text,
        letterSpacing: 0,
    },
    catalogBookAuthor: {
        ...textStyles.body,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textMuted,
    },
    catalogAddButton: {
        height: 42,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        marginTop: spacing.xs,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#eadfcb',
        backgroundColor: '#fffaf2',
    },
    catalogAddButtonText: {
        ...textStyles.sectionTitle,
        fontSize: 15,
        lineHeight: 20,
        letterSpacing: 0,
    },
    headerRow: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    brandTitle: {
        flex: 1,
        fontFamily: fontFamilies.displayBold,
        fontSize: 36,
        lineHeight: 46,
        color: colors.text,
        includeFontPadding: true,
        letterSpacing: 0,
    },
    brandTitleAccent: {
        fontFamily: fontFamilies.displayBold,
        color: '#9b5f00',
    },
    widgetPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        width: 112,
        height: 36,
        paddingLeft: spacing.sm,
        paddingRight: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e6d7bf',
        backgroundColor: colors.surfaceElevated,
    },
    widgetText: {
        ...textStyles.sectionTitle,
        flex: 1,
        fontSize: 12,
        lineHeight: 15,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    widgetSwitch: {
        width: 42,
        height: 24,
        borderRadius: 999,
        padding: 3,
        alignItems: 'flex-start',
        justifyContent: 'center',
        backgroundColor: '#dfd5c5',
    },
    widgetSwitchOn: {
        alignItems: 'flex-end',
        backgroundColor: colors.accent,
    },
    widgetKnob: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: colors.white,
    },
    widgetKnobOn: {
        backgroundColor: colors.white,
    },
    continueCard: {
        minHeight: 80,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        paddingLeft: spacing.sm,
        paddingRight: spacing.xs,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#eadfcb',
        backgroundColor: '#fffaf2',
        overflow: 'hidden',
    },
    continueCover: {
        borderRadius: 5,
    },
    continueCoverText: {
        fontSize: 8,
        lineHeight: 10,
    },
    continueCopy: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    continueEyebrow: {
        ...textStyles.eyebrow,
        fontSize: 11,
        lineHeight: 15,
        color: colors.accent,
        letterSpacing: 2.4,
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
        fontSize: 17,
        lineHeight: 22,
        color: colors.text,
        letterSpacing: 0,
    },
    continueDivider: {
        ...textStyles.body,
        fontSize: 15,
        lineHeight: 19,
        color: colors.textSubtle,
    },
    continueAuthor: {
        ...textStyles.body,
        flex: 1,
        minWidth: 0,
        fontSize: 16,
        lineHeight: 21,
        color: colors.textSubtle,
    },
    koreanInlineText: {
        fontFamily: fontFamilies.krSerifMedium,
    },
    continuePlayButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
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
    libraryHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingTop: spacing.md,
        overflow: 'visible',
    },
    libraryTabs: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.lg,
        overflow: 'visible',
    },
    libraryTab: {
        minHeight: 62,
        paddingTop: 8,
        justifyContent: 'flex-start',
        overflow: 'visible',
    },
    libraryTabLabelRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingTop: 8,
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
    libraryAction: {
        height: 36,
        marginTop: 18,
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
        ...textStyles.caption,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textSubtle,
    },
    bookFilterChipCountActive: {
        color: '#bdb4a6',
    },
    bookSectionHeader: {
        minHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    bookSectionCount: {
        ...textStyles.body,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textSubtle,
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
    emptyCatalogPanel: {
        alignItems: 'center',
        paddingTop: spacing.xl,
        gap: spacing.md,
    },
    emptyStack: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 136,
        marginBottom: spacing.md,
    },
    emptyStackCover: {
        borderRadius: 4,
    },
    emptyCatalogTitle: {
        fontFamily: fontFamilies.serifBold,
        maxWidth: 340,
        textAlign: 'center',
        fontSize: 28,
        lineHeight: 34,
        color: colors.text,
        letterSpacing: 0,
    },
    emptyCatalogCopy: {
        ...textStyles.body,
        maxWidth: 360,
        textAlign: 'center',
        fontSize: 16,
        lineHeight: 24,
        color: colors.textMuted,
    },
    emptyCatalogButton: {
        height: 54,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        marginTop: spacing.xs,
        paddingHorizontal: spacing.xl,
        borderRadius: 999,
        backgroundColor: colors.text,
    },
    emptyCatalogButtonText: {
        ...textStyles.sectionTitle,
        fontSize: 16,
        lineHeight: 20,
        color: colors.white,
        letterSpacing: 0,
    },
    emptyCatalogFootnote: {
        ...textStyles.body,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSubtle,
    },
    categoryPreviewSection: {
        gap: spacing.md,
    },
    categoryPreviewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    categoryPreviewCopy: {
        ...textStyles.body,
        flex: 1,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textSubtle,
    },
    categoryBrowseLink: {
        ...textStyles.sectionTitle,
        fontSize: 15,
        lineHeight: 20,
        color: colors.accentStrong,
        letterSpacing: 0,
    },
    bookGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: BOOK_GRID_GAP,
    },
    bookTile: {
        gap: spacing.xs,
    },
    coverImage: {
        resizeMode: 'cover',
        backgroundColor: colors.surfaceMuted,
    },
    coverFallback: {
        alignItems: 'center',
        paddingTop: spacing.md,
        paddingHorizontal: spacing.sm,
        overflow: 'hidden',
    },
    coverFallbackText: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 13,
        lineHeight: 17,
        letterSpacing: 0,
        textAlign: 'center',
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
    addBookTile: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        borderRadius: 5,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: '#e8d9be',
        backgroundColor: 'rgba(255, 255, 255, 0.28)',
    },
    addBookText: {
        ...textStyles.caption,
        fontSize: 12,
        color: colors.textSubtle,
    },
    addBookSubtext: {
        ...textStyles.caption,
        marginTop: -spacing.xs,
        fontSize: 11,
        color: colors.textSubtle,
    },
    songsPanel: {
        gap: spacing.md,
        marginTop: -spacing.xs,
    },
    searchBox: {
        height: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: '#e6d7bf',
        backgroundColor: colors.surfaceElevated,
    },
    searchInput: {
        flex: 1,
        height: '100%',
        padding: 0,
        ...textStyles.body,
        fontSize: 14,
        color: colors.text,
    },
    songList: {
        borderWidth: 1,
        borderColor: '#e6d7bf',
        borderRadius: 15,
        backgroundColor: colors.surfaceElevated,
        overflow: 'hidden',
    },
    songRow: {
        minHeight: 83,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
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
    songIcon: {
        width: 52,
        height: 52,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    songIconAccent: {
        position: 'absolute',
        width: 54,
        height: 54,
        right: -24,
        bottom: -18,
        borderRadius: 999,
        opacity: 0.9,
    },
    songCopy: {
        flex: 1,
        minWidth: 0,
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
    },
    emptySongsText: {
        ...textStyles.bodyMuted,
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
    pressed: {
        opacity: 0.78,
    },
});

export default Home;
