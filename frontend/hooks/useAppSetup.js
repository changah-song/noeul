import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initAllTables } from '../services/Database';
import { cloudBookToLocalBook, fetchUserBooks } from '../services/bookCloudSync';
import { persistCoverDataUri, stripInlineCoverForStorage } from '../services/epubMetadata';
import { GUEST_OWNER_ID, makeScopedStorageKey } from '../services/localDataScope';
import {
    getSyncGeneration,
    isCurrentSyncGeneration,
} from '../services/localOwnerCoordinator';
import {
    fetchUserPreferences,
    getTimestampMs,
    updateUserPreferenceFields,
} from '../services/preferencesCloudSync';

const LEGACY_BOOKS_STORAGE_KEY = '@ff/books';
const LEGACY_CURRENT_BOOK_STORAGE_KEY = '@ff/current-book';
const LEGACY_CURRENT_BOOK_META_STORAGE_KEY = '@ff/current-book-meta';

const getBooksStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'books');
const getCurrentBookStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'current-book');
const getCurrentBookMetaStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'current-book-meta');
const emptyCurrentBookMeta = () => ({ currentBookUri: null, currentBookCloudId: null, updatedAt: null });

let initTablesPromise = null;

const ensureTablesInitialized = () => {
    if (!initTablesPromise) {
        initTablesPromise = initAllTables().catch((error) => {
            initTablesPromise = null;
            throw error;
        });
    }

    return initTablesPromise;
};

const isCursorWindowTooLargeError = (error) => {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('cursorwindow') || message.includes('row too big');
};

const normalizeStoredBooks = async (storedBooks) => Promise.all(
    storedBooks.map(async (book) => {
        if (!book || typeof book !== 'object') {
            return null;
        }

        const cover = typeof book.cover === 'string' ? book.cover.trim() : '';
        if (!cover.startsWith('data:')) {
            return book;
        }

        const persistedCover = await persistCoverDataUri(
            cover,
            `${book.uri || book.id || book.title || 'book'}:${book.title || ''}`
        );

        return { ...book, cover: persistedCover };
    })
).then((books) => books.filter(Boolean));

const normalizeBookList = (books) => (
    Array.isArray(books)
        ? books.filter((book) => book && typeof book === 'object')
        : []
);

const summarizeBookForLog = (book, index) => {
    if (!book || typeof book !== 'object') {
        return { index, invalid: true, type: typeof book };
    }

    return {
        index,
        id: book.id ?? null,
        cloudId: book.cloudId ?? book.cloud_id ?? null,
        uri: book.uri ?? null,
        title: book.title ?? null,
        downloaded: book.downloaded ?? null,
        cloudOwnerId: book.cloudOwnerId ?? book.user_id ?? null,
        cloudFilePath: book.cloudFilePath ?? book.file_path ?? book.file_url ?? null,
    };
};

const summarizeBooksForLog = (books) => (
    Array.isArray(books)
        ? books.slice(0, 8).map(summarizeBookForLog)
        : { invalidBooksValue: true, type: typeof books }
);

const summarizePreferencesForLog = (preferences) => {
    if (!preferences || typeof preferences !== 'object') {
        return preferences ?? null;
    }

    return {
        current_book_cloud_id: preferences.current_book_cloud_id ?? null,
        current_book_uri: preferences.current_book_uri ?? null,
        updated_at: preferences.updated_at ?? null,
    };
};

const logCloudBookSyncError = ({
    error,
    phase,
    userId,
    localBooks,
    cloudBooks,
    cloudPreferences,
    localCurrentBookMeta,
    currentBook,
}) => {
    console.warn('[useAppSetup] Failed to sync cloud books:', error?.message ?? error);
    if (error?.stack) {
        console.warn('[useAppSetup] Cloud book sync stack:', error.stack);
    }
    console.warn('[useAppSetup] Cloud book sync diagnostics:', {
        phase,
        userId,
        currentBook,
        localCurrentBookMeta,
        cloudPreferences: summarizePreferencesForLog(cloudPreferences),
        localBooks: summarizeBooksForLog(localBooks),
        cloudBooks: summarizeBooksForLog(cloudBooks),
    });
};

const mergeCloudBooks = (localBooks = [], cloudBooks = [], userId) => {
    const nextBooks = normalizeBookList(localBooks).map((book) => ({
        ...book,
        downloaded: book.downloaded !== false,
    }));

    normalizeBookList(cloudBooks).forEach((cloudBook) => {
        const cloudFilePath = cloudBook.file_path ?? cloudBook.file_url ?? null;
        if (!cloudBook.id || !cloudFilePath) {
            return;
        }

        const cloudLocalBook = cloudBookToLocalBook(cloudBook);
        const existingIndex = nextBooks.findIndex((book) => (
            book?.cloudId === cloudBook.id
            || book?.cloudFilePath === cloudFilePath
        ));

        if (existingIndex >= 0) {
            const existingBook = nextBooks[existingIndex] ?? {};
            nextBooks[existingIndex] = {
                ...existingBook,
                cloudId: cloudBook.id,
                cloudOwnerId: userId,
                cloudFilePath,
                cloudCoverPath: cloudBook.cover_path ?? existingBook.cloudCoverPath ?? null,
                cloudSyncedAt: cloudBook.updated_at ?? cloudBook.uploaded_at ?? existingBook.cloudSyncedAt ?? null,
                title: cloudBook.title || existingBook.title,
                author: cloudBook.author || existingBook.author,
                originalFilename: cloudBook.original_filename ?? existingBook.originalFilename ?? null,
                size: cloudBook.size_bytes ?? existingBook.size ?? null,
                language: cloudBook.language ?? existingBook.language ?? null,
                progress: typeof cloudBook.progress === 'number' ? cloudBook.progress : (existingBook.progress ?? 0),
                location: cloudBook.location ?? existingBook.location ?? null,
                nativePosition: cloudBook.native_position ?? existingBook.nativePosition ?? null,
                downloaded: existingBook.downloaded !== false && !!existingBook.uri,
            };
            return;
        }

        nextBooks.push({
            ...cloudLocalBook,
            cloudOwnerId: userId,
        });
    });

    return nextBooks;
};

const parseStoredJson = (value, fallback = null) => {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const readCurrentBookMeta = async (ownerId) => {
    const [storedUri, storedMeta] = await Promise.all([
        AsyncStorage.getItem(getCurrentBookStorageKey(ownerId)),
        AsyncStorage.getItem(getCurrentBookMetaStorageKey(ownerId)),
    ]);
    const parsedMeta = parseStoredJson(storedMeta, {});

    return {
        currentBookUri: parsedMeta.currentBookUri ?? parsedMeta.current_book_uri ?? storedUri ?? null,
        currentBookCloudId: parsedMeta.currentBookCloudId ?? parsedMeta.current_book_cloud_id ?? null,
        updatedAt: parsedMeta.updatedAt ?? parsedMeta.updated_at ?? null,
    };
};

const readOwnerBookStorage = async (ownerId) => {
    const scopedKeys = [
        getBooksStorageKey(ownerId),
        getCurrentBookStorageKey(ownerId),
        getCurrentBookMetaStorageKey(ownerId),
    ];

    let storedBooksRaw = null;
    let storedCurrentBook = null;
    let storedCurrentBookMetaRaw = null;

    try {
        [storedBooksRaw, storedCurrentBook, storedCurrentBookMetaRaw] = await Promise.all(
            scopedKeys.map((key) => AsyncStorage.getItem(key))
        );
    } catch (error) {
        if (!isCursorWindowTooLargeError(error)) {
            throw error;
        }

        console.warn('[useAppSetup] Scoped stored book metadata was too large; clearing oversized scoped book list.', error);
        await AsyncStorage.multiRemove(scopedKeys);
    }

    const scopedKeysAreEmpty = !storedBooksRaw && !storedCurrentBook && !storedCurrentBookMetaRaw;
    if (ownerId !== GUEST_OWNER_ID || !scopedKeysAreEmpty) {
        return { storedBooksRaw, storedCurrentBook, storedCurrentBookMetaRaw };
    }

    try {
        const [legacyBooksRaw, legacyCurrentBook, legacyCurrentBookMetaRaw] = await Promise.all([
            AsyncStorage.getItem(LEGACY_BOOKS_STORAGE_KEY),
            AsyncStorage.getItem(LEGACY_CURRENT_BOOK_STORAGE_KEY),
            AsyncStorage.getItem(LEGACY_CURRENT_BOOK_META_STORAGE_KEY),
        ]);

        if (!legacyBooksRaw && !legacyCurrentBook && !legacyCurrentBookMetaRaw) {
            return { storedBooksRaw, storedCurrentBook, storedCurrentBookMetaRaw };
        }

        const writes = [
            [scopedKeys[0], legacyBooksRaw],
            [scopedKeys[1], legacyCurrentBook],
            [scopedKeys[2], legacyCurrentBookMetaRaw],
        ]
            .filter(([, value]) => value != null)
            .map(([key, value]) => AsyncStorage.setItem(key, value));

        await Promise.all(writes);

        return {
            storedBooksRaw: legacyBooksRaw,
            storedCurrentBook: legacyCurrentBook,
            storedCurrentBookMetaRaw: legacyCurrentBookMetaRaw,
        };
    } catch (error) {
        if (!isCursorWindowTooLargeError(error)) {
            throw error;
        }

        console.warn('[useAppSetup] Legacy stored book metadata was too large; skipping guest fallback import.', error);
        return { storedBooksRaw, storedCurrentBook, storedCurrentBookMetaRaw };
    }
};

const buildCurrentBookPreference = (books, currentBookUri, updatedAt = new Date().toISOString()) => {
    const activeBook = normalizeBookList(books).find((book) => book?.uri && book.uri === currentBookUri) ?? null;

    return {
        currentBookUri: currentBookUri ?? null,
        currentBookCloudId: activeBook?.cloudId ?? null,
        updatedAt,
    };
};

const resolveCurrentBookUriFromPreferences = (books, preferences) => {
    if (!preferences) {
        return null;
    }

    const cloudId = preferences.current_book_cloud_id ?? preferences.currentBookCloudId;
    const preferredUri = preferences.current_book_uri ?? preferences.currentBookUri;

    if (cloudId) {
        const cloudBook = normalizeBookList(books).find((book) => book?.cloudId === cloudId);
        if (cloudBook?.downloaded !== false && cloudBook?.uri) {
            return cloudBook.uri;
        }
    }

    if (preferredUri) {
        const localBook = normalizeBookList(books).find((book) => book?.uri === preferredUri);
        if (localBook && localBook.downloaded !== false && localBook.uri) {
            return localBook.uri;
        }
    }

    return null;
};

const useAppSetup = ({ ownerId, ownerReady = true, user = null } = {}) => {
    const [books, setBooks] = useState([]);
    const [currentBook, setCurrentBook] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadedOwnerId, setLoadedOwnerId] = useState(null);
    const booksRef = useRef([]);
    const currentBookRef = useRef(null);
    const currentBookMetaRef = useRef(emptyCurrentBookMeta());
    const currentUserRef = useRef(null);
    const applyingCloudCurrentBookRef = useRef(false);
    const ownerLoadGenerationRef = useRef(0);

    // true when the user presses the download button for a book —
    // tells Read.js to run the preprocessing pipeline on next text extraction
    const [preprocessOnOpen, setPreprocessOnOpen] = useState(false);

    useEffect(() => {
        booksRef.current = books;
    }, [books]);

    useEffect(() => {
        currentBookRef.current = currentBook;
    }, [currentBook]);

    useEffect(() => {
        currentUserRef.current = user?.id && ownerId === user.id ? user : null;
    }, [ownerId, user?.id]);

    useEffect(() => {
        const loadGeneration = ownerLoadGenerationRef.current + 1;
        ownerLoadGenerationRef.current = loadGeneration;
        let isActive = true;

        const bootstrap = async () => {
            setLoading(true);
            setBooks([]);
            setCurrentBook(null);
            currentBookMetaRef.current = emptyCurrentBookMeta();
            currentUserRef.current = null;
            applyingCloudCurrentBookRef.current = false;
            setLoadedOwnerId(null);

            if (!ownerReady || !ownerId) {
                return;
            }

            try {
                await ensureTablesInitialized();

                const {
                    storedBooksRaw,
                    storedCurrentBook,
                    storedCurrentBookMetaRaw,
                } = await readOwnerBookStorage(ownerId);

                if (!isActive || ownerLoadGenerationRef.current !== loadGeneration) {
                    return;
                }

                const storedBooks = storedBooksRaw ? JSON.parse(storedBooksRaw) : [];
                const nextBooks = Array.isArray(storedBooks)
                    ? await normalizeStoredBooks(storedBooks)
                    : [];
                if (!isActive || ownerLoadGenerationRef.current !== loadGeneration) {
                    return;
                }

                const hasStoredCurrentBook = nextBooks.some((book) => book?.uri === storedCurrentBook);
                const storedCurrentBookMeta = parseStoredJson(storedCurrentBookMetaRaw, {});
                currentBookMetaRef.current = {
                    currentBookUri: storedCurrentBookMeta.currentBookUri
                        ?? storedCurrentBookMeta.current_book_uri
                        ?? storedCurrentBook
                        ?? null,
                    currentBookCloudId: storedCurrentBookMeta.currentBookCloudId
                        ?? storedCurrentBookMeta.current_book_cloud_id
                        ?? null,
                    updatedAt: storedCurrentBookMeta.updatedAt ?? storedCurrentBookMeta.updated_at ?? null,
                };

                setBooks(nextBooks);
                setCurrentBook(hasStoredCurrentBook ? storedCurrentBook : (nextBooks[0]?.uri ?? null));
            } catch (error) {
                console.error('[useAppSetup] App setup bootstrap error:', error);
            } finally {
                if (isActive && ownerLoadGenerationRef.current === loadGeneration && ownerReady && ownerId) {
                    setLoadedOwnerId(ownerId);
                    setLoading(false);
                }
            }
        };

        bootstrap();

        return () => {
            isActive = false;
        };
    }, [ownerId, ownerReady]);

    useEffect(() => {
        if (loading || !ownerReady || !ownerId) {
            return;
        }

        const persistableBooks = books.filter((book) => (
            book?.downloaded !== false && book?.uri
        ));
        const storageBooks = persistableBooks.map(stripInlineCoverForStorage);
        const hadInlineCovers = storageBooks.some((book, index) => book !== persistableBooks[index]);

        if (hadInlineCovers) {
            setBooks(storageBooks);
        }

        const storageKey = getBooksStorageKey(ownerId);
        AsyncStorage.setItem(storageKey, JSON.stringify(storageBooks)).catch((error) => {
            console.error('[useAppSetup] Failed to persist books:', error);
        });
    }, [books, loading, ownerId, ownerReady]);

    useEffect(() => {
        if (loading || !ownerReady || !ownerId) {
            return;
        }

        const cloudUser = currentUserRef.current;
        const currentBookStorageKey = getCurrentBookStorageKey(ownerId);
        const currentBookMetaStorageKey = getCurrentBookMetaStorageKey(ownerId);

        if (!currentBook) {
            currentBookMetaRef.current = emptyCurrentBookMeta();
            AsyncStorage.multiRemove([currentBookStorageKey, currentBookMetaStorageKey]).catch((error) => {
                console.error('[useAppSetup] Failed to clear current book:', error);
            });
            if (cloudUser?.id && ownerId === cloudUser.id && !applyingCloudCurrentBookRef.current) {
                updateUserPreferenceFields({
                    user: cloudUser,
                    ownerId,
                    generation: getSyncGeneration(),
                    patch: {
                        current_book_cloud_id: null,
                        current_book_uri: null,
                    },
                }).catch((error) => {
                    console.warn('[useAppSetup] Failed to clear cloud current book preference:', error?.message ?? error);
                });
            }
            applyingCloudCurrentBookRef.current = false;
            return;
        }

        const previousMeta = currentBookMetaRef.current;
        const metaUpdatedAt = previousMeta.currentBookUri === currentBook
            ? previousMeta.updatedAt
            : new Date().toISOString();
        const meta = buildCurrentBookPreference(books, currentBook, metaUpdatedAt);
        currentBookMetaRef.current = meta;

        Promise.all([
            AsyncStorage.setItem(currentBookStorageKey, currentBook),
            AsyncStorage.setItem(currentBookMetaStorageKey, JSON.stringify(meta)),
        ]).catch((error) => {
            console.error('[useAppSetup] Failed to persist current book:', error);
        });

        if (cloudUser?.id && ownerId === cloudUser.id && !applyingCloudCurrentBookRef.current) {
            const syncMeta = {
                ...meta,
                updatedAt: meta.updatedAt ?? new Date().toISOString(),
            };
            currentBookMetaRef.current = syncMeta;
            updateUserPreferenceFields({
                user: cloudUser,
                ownerId,
                generation: getSyncGeneration(),
                patch: {
                    current_book_cloud_id: syncMeta.currentBookCloudId,
                    current_book_uri: syncMeta.currentBookUri,
                    updated_at: syncMeta.updatedAt,
                },
            }).catch((error) => {
                console.warn('[useAppSetup] Failed to sync current book preference:', error?.message ?? error);
            });
        }

        applyingCloudCurrentBookRef.current = false;
    }, [books, currentBook, loading, ownerId, ownerReady]);

    // Called by Read.js after preprocessing completes — marks the book as cached
    const updateBookPreprocessed = (uri) => {
        setBooks(prev => normalizeBookList(prev).map(b => b?.uri === uri ? { ...b, preprocessed: true } : b));
    };

    const syncCloudBooks = useCallback(async ({ user, ownerId: syncOwnerId, generation } = {}) => {
        if (loading || !ownerReady) {
            return;
        }

        if (!user?.id) {
            currentUserRef.current = null;
            return;
        }

        if (syncOwnerId !== user.id) {
            return;
        }

        if (generation != null && !isCurrentSyncGeneration(generation)) {
            return;
        }

        currentUserRef.current = user;
        let phase = 'start';
        let cloudBooks = null;
        let cloudPreferences = null;
        let localCurrentBookMeta = null;
        let mergedBooks = null;

        try {
            phase = 'fetch-cloud-and-local-meta';
            [cloudBooks, cloudPreferences, localCurrentBookMeta] = await Promise.all([
                fetchUserBooks(user.id),
                fetchUserPreferences(user.id).catch((error) => {
                    console.warn('[useAppSetup] Failed to fetch cloud preferences:', error?.message ?? error);
                    return null;
                }),
                readCurrentBookMeta(syncOwnerId),
            ]);
            if (generation != null && !isCurrentSyncGeneration(generation)) {
                return;
            }

            currentBookMetaRef.current = localCurrentBookMeta;
            phase = 'merge-cloud-books';
            mergedBooks = mergeCloudBooks(
                normalizeBookList(booksRef.current).filter((book) => (
                    book.downloaded !== false || book.cloudOwnerId === user.id
                )),
                cloudBooks,
                user.id
            );

            phase = 'set-merged-books';
            setBooks(mergedBooks);

            if (generation != null && !isCurrentSyncGeneration(generation)) {
                return;
            }

            phase = 'resolve-current-book-preference';
            const cloudCurrentUpdatedAt = cloudPreferences?.updated_at ?? null;
            const shouldUseCloudCurrentBook = cloudCurrentUpdatedAt
                && getTimestampMs(cloudCurrentUpdatedAt) > getTimestampMs(localCurrentBookMeta.updatedAt);

            if (shouldUseCloudCurrentBook) {
                const cloudCurrentBookUri = resolveCurrentBookUriFromPreferences(mergedBooks, cloudPreferences);
                if (cloudCurrentBookUri && cloudCurrentBookUri !== currentBookRef.current) {
                    applyingCloudCurrentBookRef.current = true;
                    setCurrentBook(cloudCurrentBookUri);
                }

                const cloudMeta = cloudCurrentBookUri
                    ? buildCurrentBookPreference(mergedBooks, cloudCurrentBookUri, cloudCurrentUpdatedAt)
                    : {
                        currentBookUri: cloudPreferences.current_book_uri ?? null,
                        currentBookCloudId: cloudPreferences.current_book_cloud_id ?? null,
                        updatedAt: cloudCurrentUpdatedAt,
                };
                currentBookMetaRef.current = cloudMeta;
                phase = 'persist-cloud-current-book-meta';
                await AsyncStorage.setItem(getCurrentBookMetaStorageKey(syncOwnerId), JSON.stringify(cloudMeta));
                return;
            }

            phase = 'build-local-current-book-preference';
            const localPreference = buildCurrentBookPreference(
                mergedBooks,
                localCurrentBookMeta.currentBookUri ?? currentBookRef.current,
                localCurrentBookMeta.updatedAt ?? new Date().toISOString()
            );
            currentBookMetaRef.current = localPreference;
            phase = 'sync-current-book-preference';
            await updateUserPreferenceFields({
                user,
                ownerId: syncOwnerId,
                generation,
                patch: {
                    current_book_cloud_id: localPreference.currentBookCloudId,
                    current_book_uri: localPreference.currentBookUri,
                    updated_at: localPreference.updatedAt,
                },
            });
        } catch (error) {
            logCloudBookSyncError({
                error,
                phase,
                userId: user.id,
                localBooks: booksRef.current,
                cloudBooks,
                cloudPreferences,
                localCurrentBookMeta,
                currentBook: currentBookRef.current,
            });
        }
    }, [loading, ownerReady]);

    return {
        books,
        setBooks,
        currentBook,
        setCurrentBook,
        preprocessOnOpen,
        setPreprocessOnOpen,
        updateBookPreprocessed,
        syncCloudBooks,
        loading,
        loadedOwnerId,
    };
};

export default useAppSetup;
