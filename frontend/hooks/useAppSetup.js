import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initAllTables } from '../services/Database';

const BOOKS_STORAGE_KEY = '@ff/books';
const CURRENT_BOOK_STORAGE_KEY = '@ff/current-book';

const useAppSetup = () => {
    const [books, setBooks] = useState([]);
    const [currentBook, setCurrentBook] = useState(null);
    const [loading, setLoading] = useState(true);

    // true when the user presses the download button for a book —
    // tells Read.js to run the preprocessing pipeline on next text extraction
    const [preprocessOnOpen, setPreprocessOnOpen] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const bootstrap = async () => {
            try {
                console.log('[useAppSetup] Initializing database tables...');
                await initAllTables();
                console.log('[useAppSetup] Database ready');

                const [storedBooksRaw, storedCurrentBook] = await Promise.all([
                    AsyncStorage.getItem(BOOKS_STORAGE_KEY),
                    AsyncStorage.getItem(CURRENT_BOOK_STORAGE_KEY),
                ]);

                if (!isMounted) {
                    return;
                }

                const storedBooks = storedBooksRaw ? JSON.parse(storedBooksRaw) : [];
                const nextBooks = Array.isArray(storedBooks) ? storedBooks : [];
                const hasStoredCurrentBook = nextBooks.some((book) => book?.uri === storedCurrentBook);

                setBooks(nextBooks);
                setCurrentBook(hasStoredCurrentBook ? storedCurrentBook : (nextBooks[0]?.uri ?? null));
            } catch (error) {
                console.error('[useAppSetup] App setup bootstrap error:', error);
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        bootstrap();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (loading) {
            return;
        }

        AsyncStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(books)).catch((error) => {
            console.error('[useAppSetup] Failed to persist books:', error);
        });
    }, [books, loading]);

    useEffect(() => {
        if (loading) {
            return;
        }

        if (!currentBook) {
            AsyncStorage.removeItem(CURRENT_BOOK_STORAGE_KEY).catch((error) => {
                console.error('[useAppSetup] Failed to clear current book:', error);
            });
            return;
        }

        AsyncStorage.setItem(CURRENT_BOOK_STORAGE_KEY, currentBook).catch((error) => {
            console.error('[useAppSetup] Failed to persist current book:', error);
        });
    }, [currentBook, loading]);

    // Called by Read.js after preprocessing completes — marks the book as cached
    const updateBookPreprocessed = (uri) => {
        setBooks(prev => prev.map(b => b.uri === uri ? { ...b, preprocessed: true } : b));
    };

    return { books, setBooks, currentBook, setCurrentBook, preprocessOnOpen, setPreprocessOnOpen, updateBookPreprocessed, loading };
};

export default useAppSetup;
