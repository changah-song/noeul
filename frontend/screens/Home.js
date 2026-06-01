import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Feather, Ionicons } from '@expo/vector-icons';
import { tabBarBaseStyle } from '../components/shared/TabBar';
import SongReader from '../components/Songs/SongReader';
import { IconButton, Screen, SectionHeader } from '../components/ui';
import { colors, fontFamilies, insets, layout, radii, spacing, textStyles } from '../theme';
import useBooks from '../hooks/useBooks';
import { deleteBookIndexEntries } from '../services/Database';
import { getSongLyrics, searchSongs } from '../services/api/songs';

const BOOK_GRID_GAP = 18;
const SONGS_STORAGE_KEY = 'manualSongs';
const EMPTY_SONG_DRAFT = { title: '', artist: '', lyrics: '' };

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
        provider: String(song.provider || '').trim() || null,
        providerId: String(song.providerId || '').trim() || null,
        title,
        artist: String(song.artist || '').trim() || 'Unknown artist',
        album: String(song.album || '').trim(),
        duration: typeof song.duration === 'number' ? song.duration : null,
        instrumental: !!song.instrumental,
        lyrics,
        syncedLyrics: String(song.syncedLyrics || '').trim(),
        lines: countSongLines(lyrics),
        savedTerms: Array.isArray(song.savedTerms)
            ? [...new Set(song.savedTerms.map((term) => String(term || '').trim()).filter(Boolean))]
            : [],
        createdAt: song.createdAt || new Date().toISOString(),
    };
};
const stripSyncedLyricTimestamps = (syncedLyrics) => String(syncedLyrics || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(\[[^\]]+\]\s*)+/, '').trim())
    .filter(Boolean)
    .join('\n');
const getLyricsFromApiSong = (song) => (
    String(song?.plainLyrics || '').trim()
    || stripSyncedLyricTimestamps(song?.syncedLyrics)
);

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
    const [songs, setSongs] = useState([]);
    const [songsLoaded, setSongsLoaded] = useState(false);
    const [songQuery, setSongQuery] = useState('');
    const [songResults, setSongResults] = useState([]);
    const [songSearchLoading, setSongSearchLoading] = useState(false);
    const [songSearchError, setSongSearchError] = useState('');
    const [openingSongId, setOpeningSongId] = useState(null);
    const [selectedSongId, setSelectedSongId] = useState(null);
    const [showAddSongModal, setShowAddSongModal] = useState(false);
    const [songDraft, setSongDraft] = useState(EMPTY_SONG_DRAFT);
    const songSearchRequestRef = useRef(0);
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
        Math.max(width - (insets.screenHorizontal * 2), 288),
        layout.screenMaxWidth - (insets.screenHorizontal * 2)
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
    const selectedSong = useMemo(() => (
        songs.find((song) => song.id === selectedSongId) ?? null
    ), [selectedSongId, songs]);
    const filteredSongs = useMemo(() => {
        const query = songQuery.trim().toLowerCase();

        if (!query) {
            return songs;
        }

        return songs.filter((song) => (
            song.title.toLowerCase().includes(query)
            || song.artist.toLowerCase().includes(query)
            || song.lyrics.toLowerCase().includes(query)
        ));
    }, [songQuery, songs]);
    const isSongSearchActive = songQuery.trim().length > 0;

    useEffect(() => {
        let isMounted = true;

        AsyncStorage.getItem(SONGS_STORAGE_KEY)
            .then((storedSongs) => {
                if (!isMounted || !storedSongs) {
                    return;
                }

                const parsedSongs = JSON.parse(storedSongs);
                if (!Array.isArray(parsedSongs)) {
                    return;
                }

                setSongs(parsedSongs.map(normalizeStoredSong).filter(Boolean));
            })
            .catch((error) => {
                console.error('[Home] Failed to load songs:', error);
            })
            .finally(() => {
                if (isMounted) {
                    setSongsLoaded(true);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!songsLoaded) {
            return;
        }

        AsyncStorage.setItem(SONGS_STORAGE_KEY, JSON.stringify(songs)).catch((error) => {
            console.error('[Home] Failed to save songs:', error);
        });
    }, [songs, songsLoaded]);

    useEffect(() => {
        const query = songQuery.trim();
        const requestId = songSearchRequestRef.current + 1;
        songSearchRequestRef.current = requestId;

        if (!query) {
            setSongResults([]);
            setSongSearchError('');
            setSongSearchLoading(false);
            return undefined;
        }

        setSongResults([]);
        setSongSearchError('');
        setSongSearchLoading(true);

        const timeout = setTimeout(() => {
            searchSongs(query)
                .then((results) => {
                    if (songSearchRequestRef.current !== requestId) {
                        return;
                    }

                    setSongResults(results);
                    setSongSearchError('');
                })
                .catch((error) => {
                    if (songSearchRequestRef.current !== requestId) {
                        return;
                    }

                    console.error('[Home] Song search failed:', error);
                    setSongResults([]);
                    setSongSearchError(error.message || 'Song search failed');
                })
                .finally(() => {
                    if (songSearchRequestRef.current === requestId) {
                        setSongSearchLoading(false);
                    }
                });
        }, 300);

        return () => clearTimeout(timeout);
    }, [songQuery]);

    useEffect(() => {
        if (selectedSongId && !selectedSong) {
            setSelectedSongId(null);
        }
    }, [selectedSong, selectedSongId]);

    useEffect(() => {
        const shouldHideTabBar = !!browseCatalog || !!selectedSong;

        navigation?.setOptions({
            tabBarStyle: shouldHideTabBar ? { display: 'none' } : tabBarBaseStyle,
        });

        return () => {
            navigation?.setOptions({
                tabBarStyle: tabBarBaseStyle,
            });
        };
    }, [browseCatalog, navigation, selectedSong]);

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
            title,
            artist,
            lyrics,
            lines: countSongLines(lyrics),
            savedTerms: [],
            createdAt: new Date().toISOString(),
        };

        setSongs((previous) => [nextSong, ...previous]);
        setShowAddSongModal(false);
        setSongDraft(EMPTY_SONG_DRAFT);
        setActiveLibraryTab('Songs');
    }, [songDraft.artist, songDraft.lyrics, songDraft.title]);

    const handleSongResultPress = useCallback(async (songResult) => {
        if (!songResult?.id || openingSongId) {
            return;
        }

        setOpeningSongId(songResult.id);
        setSongSearchError('');

        try {
            const fullSong = await getSongLyrics(songResult.id);
            const lyrics = getLyricsFromApiSong(fullSong)
                || (fullSong.instrumental ? 'Instrumental' : '');

            if (!lyrics) {
                setSongSearchError('No lyrics were available for that result.');
                return;
            }

            const provider = fullSong.provider || songResult.provider || 'lrclib';
            const providerId = String(fullSong.id || songResult.id);
            const localSong = {
                id: `${provider}:${providerId}`,
                provider,
                providerId,
                title: fullSong.title || songResult.title || 'Untitled song',
                artist: fullSong.artist || songResult.artist || 'Unknown artist',
                album: fullSong.album || songResult.album || '',
                duration: typeof fullSong.duration === 'number' ? fullSong.duration : null,
                instrumental: !!fullSong.instrumental,
                lyrics,
                syncedLyrics: fullSong.syncedLyrics || '',
                lines: fullSong.linesCount || countSongLines(lyrics),
                savedTerms: [],
                createdAt: new Date().toISOString(),
            };

            setSongs((previous) => {
                const alreadySaved = previous.some((song) => (
                    song.id === localSong.id
                    || (song.provider === provider && song.providerId === providerId)
                ));

                return alreadySaved ? previous : [localSong, ...previous];
            });
            setSongQuery('');
            setSongResults([]);
            setSongSearchError('');
        } catch (error) {
            console.error('[Home] Failed to add song result:', error);
            setSongSearchError(error.message || 'Could not load lyrics for that song.');
        } finally {
            setOpeningSongId(null);
        }
    }, [openingSongId]);

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

    if (selectedSong) {
        return (
            <SongReader
                song={selectedSong}
                onClose={() => setSelectedSongId(null)}
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

    if (browseCatalog) {
        return (
            <Screen scroll contentContainerStyle={styles.browseScreenContent}>
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
        <Screen scroll contentContainerStyle={styles.screenContent}>
            <View style={styles.stack}>
                <SectionHeader
                    eyebrow="Home"
                    title="Read stories. Collect the words that matter."
                    subtitle="Reading gives new words context, so every saved word connects back to a story you understand."
                />

                {currentReadingBook ? (
                    <Pressable
                        onPress={() => handlePress(currentReadingBook.uri)}
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
                                <Ionicons name="play" size={18} color={colors.white} />
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

                <TouchableOpacity
                    activeOpacity={0.86}
                    onPress={() => navigation?.navigate('ScreenshotOcr')}
                    style={styles.ocrToolButton}
                >
                    <View style={styles.ocrToolIcon}>
                        <Ionicons name="scan-outline" size={19} color={colors.accentStrong} />
                    </View>
                    <View style={styles.ocrToolCopy}>
                        <Text style={styles.ocrToolTitle}>Screenshot OCR</Text>
                        <Text style={styles.ocrToolMeta}>Korean image lookup lab</Text>
                    </View>
                    <Feather name="chevron-right" size={20} color={colors.textSubtle} />
                </TouchableOpacity>

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
                            <Text style={styles.libraryActionText}>Add song manually</Text>
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
                    <View style={styles.songSearchGroup}>
                        <View style={[
                            styles.searchBox,
                            isSongSearchActive && styles.searchBoxConnected,
                        ]}>
                            <Feather name="search" size={17} color={colors.textSubtle} />
                            <TextInput
                                value={songQuery}
                                onChangeText={setSongQuery}
                                style={styles.searchInput}
                                placeholder="Search title or artist..."
                                placeholderTextColor={colors.textSubtle}
                                returnKeyType="search"
                            />
                            {songQuery ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel="Clear song search"
                                    activeOpacity={0.72}
                                    onPress={() => setSongQuery('')}
                                    style={styles.searchClearButton}
                                >
                                    <Feather name="x" size={15} color={colors.textSubtle} />
                                </TouchableOpacity>
                            ) : null}
                        </View>

                        {isSongSearchActive ? (
                            <View style={styles.songResultsPanel}>
                                {songSearchLoading ? (
                                    <View style={styles.songSearchState}>
                                        <ActivityIndicator size="small" color={colors.accentStrong} />
                                        <Text style={styles.songSearchStateText}>Searching songs...</Text>
                                    </View>
                                ) : null}

                                {songSearchError ? (
                                    <View style={styles.songSearchState}>
                                        <Text style={styles.songSearchError}>{songSearchError}</Text>
                                    </View>
                                ) : null}

                                {!songSearchLoading && !songSearchError && songResults.length === 0 ? (
                                    <View style={styles.songSearchState}>
                                        <Text style={styles.songSearchStateText}>No lyric results yet</Text>
                                    </View>
                                ) : null}

                                {songResults.map((result, index) => {
                                    const isOpening = openingSongId === result.id;

                                    return (
                                        <Pressable
                                            key={`${result.provider}-${result.id}`}
                                            disabled={!!openingSongId}
                                            onPress={() => handleSongResultPress(result)}
                                            style={({ pressed }) => [
                                                styles.songResultRow,
                                                index === songResults.length - 1 && styles.songRowLast,
                                                pressed && styles.songRowPressed,
                                                isOpening && styles.songResultRowDisabled,
                                            ]}
                                        >
                                            <View style={styles.songCopy}>
                                                <Text
                                                    style={[
                                                        styles.songResultTitle,
                                                        getSerifFontForText(result.title),
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {result.title || 'Untitled song'}
                                                </Text>
                                                <Text style={styles.songResultMeta} numberOfLines={1}>
                                                    {[result.artist, result.album].filter(Boolean).join(' · ') || 'Unknown artist'}
                                                </Text>
                                            </View>
                                            {isOpening ? (
                                                <ActivityIndicator size="small" color={colors.accentStrong} />
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                            </View>
                        ) : null}
                    </View>

                    {!isSongSearchActive && songsLoaded && songs.length === 0 ? (
                        <View style={styles.emptySongsPanel}>
                            <Feather name="music" size={24} color={colors.accentStrong} />
                            <Text style={styles.emptySongsTitle}>Add songs you like</Text>
                            <Text style={styles.emptySongsCopy}>
                                Save lyrics here so you can tap words, look them up, and keep the ones you want to remember.
                            </Text>
                        </View>
                    ) : !isSongSearchActive ? (
                        <View style={styles.songList}>
                            {!songsLoaded ? (
                                <View style={styles.emptySongs}>
                                    <ActivityIndicator size="small" color={colors.accentStrong} />
                                    <Text style={styles.emptySongsText}>Loading songs...</Text>
                                </View>
                            ) : (
                                filteredSongs.length > 0 ? filteredSongs.map((song, index) => (
                                    <Pressable
                                        key={song.id}
                                        onPress={() => setSelectedSongId(song.id)}
                                        style={({ pressed }) => [
                                            styles.songRow,
                                            index === filteredSongs.length - 1 && styles.songRowLast,
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
                                )) : (
                                    <View style={styles.emptySongs}>
                                        <Text style={styles.emptySongsText}>No matching songs</Text>
                                    </View>
                                )
                            )}
                        </View>
                    ) : null}
                </View>
            )}

                {!!openingBookUri && (
                    <View style={styles.loadingOverlay}>
                        <ActivityIndicator size="small" color={colors.accentStrong} />
                        <Text style={styles.loadingText}>Opening book...</Text>
                    </View>
                )}
            </View>

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

            <Modal visible={showAddSongModal} animationType="fade" transparent onRequestClose={handleCancelSongAdd}>
                <TouchableWithoutFeedback onPress={handleCancelSongAdd}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.songModal}>
                                <Text style={styles.editTitle}>Add song manually</Text>

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
                </TouchableWithoutFeedback>
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
    ocrToolButton: {
        minHeight: 62,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceElevated,
    },
    ocrToolIcon: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.xs,
        backgroundColor: colors.accentSoft,
    },
    ocrToolCopy: {
        flex: 1,
        minWidth: 0,
    },
    ocrToolTitle: {
        ...textStyles.sectionTitle,
        fontSize: 16,
        lineHeight: 21,
        color: colors.text,
        letterSpacing: 0,
    },
    ocrToolMeta: {
        ...textStyles.caption,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    libraryHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        marginTop: -spacing.md,
        paddingTop: 0,
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
    songSearchGroup: {
        overflow: 'hidden',
        borderRadius: 15,
    },
    searchBox: {
        height: 46,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: '#e6d7bf',
        backgroundColor: colors.surfaceElevated,
    },
    searchBoxConnected: {
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
    },
    searchInput: {
        flex: 1,
        height: '100%',
        padding: 0,
        ...textStyles.body,
        fontSize: 13,
        color: colors.text,
    },
    searchClearButton: {
        width: 26,
        height: 26,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 13,
        backgroundColor: '#f4ede2',
    },
    songResultsPanel: {
        borderWidth: 1,
        borderTopWidth: 0,
        borderColor: '#e6d7bf',
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 15,
        borderBottomRightRadius: 15,
        backgroundColor: colors.surfaceElevated,
        overflow: 'hidden',
    },
    songResultRow: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: 7,
        borderBottomWidth: 1,
        borderBottomColor: '#eadcc6',
    },
    songResultRowDisabled: {
        opacity: 0.64,
    },
    songSearchState: {
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
    },
    songSearchStateText: {
        ...textStyles.caption,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textSubtle,
    },
    songSearchError: {
        ...textStyles.body,
        textAlign: 'center',
        fontSize: 12,
        lineHeight: 17,
        color: colors.danger,
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
    songResultTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 14,
        lineHeight: 18,
        color: colors.text,
        letterSpacing: 0,
    },
    songResultMeta: {
        ...textStyles.body,
        fontSize: 11,
        lineHeight: 15,
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
