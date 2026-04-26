import { useState, useEffect } from 'react';
import { initAllTables } from '../services/Database';

const useAppSetup = () => {
    const [books, setBooks] = useState([]);
    const [currentBook, setCurrentBook] = useState(null);

    // true when the user presses the download button for a book —
    // tells Read.js to run the preprocessing pipeline on next text extraction
    const [preprocessOnOpen, setPreprocessOnOpen] = useState(false);

    useEffect(() => {
        console.log('[useAppSetup] Initializing database tables...');
        initAllTables()
            .then(() => console.log('[useAppSetup] Database ready'))
            .catch((error) => console.error('[useAppSetup] Database init error:', error));
    }, []);

    // Called by Read.js after preprocessing completes — marks the book as cached
    const updateBookPreprocessed = (uri) => {
        setBooks(prev => prev.map(b => b.uri === uri ? { ...b, preprocessed: true } : b));
    };

    return { books, setBooks, currentBook, setCurrentBook, preprocessOnOpen, setPreprocessOnOpen, updateBookPreprocessed };
};

export default useAppSetup;
