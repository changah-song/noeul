import { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { isBookPreprocessed } from '../services/Database';
import { extractBookCoverColors } from '../services/bookCoverColors';
import { uploadUserBook } from '../services/bookCloudSync';
import { readEpubMetadata } from '../services/epubMetadata';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { readPdfMetadata, renderPdfCover } from '../services/pdfMetadata';

const createBookId = () => {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const useBooks = ({ books, setBooks, setCurrentBook, onBookImported, user, ownerId, syncGeneration }) => {
    const [isImporting, setIsImporting] = useState(false);
    const [openingBookUri, setOpeningBookUri] = useState(null);
    const [pdfCoverPrompt, setPdfCoverPrompt] = useState(null);
    const [pdfCoverPageInput, setPdfCoverPageInput] = useState('1');
    const pdfCoverChoiceResolverRef = useRef(null);

    const navigation = useNavigation();

    const getAssetFormat = (asset) => {
        const name = String(asset?.name || '').toLowerCase();
        const mimeType = String(asset?.mimeType || '').toLowerCase();
        const uri = String(asset?.uri || '').toLowerCase();

        if (
            name.endsWith('.pdf') ||
            uri.endsWith('.pdf') ||
            mimeType === 'application/pdf'
        ) {
            return 'pdf';
        }

        if (
            name.endsWith('.epub') ||
            uri.endsWith('.epub') ||
            mimeType === 'application/epub+zip'
        ) {
            return 'epub';
        }

        return null;
    };

    const pickBookAsset = async () => {
        const { assets, canceled } = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
        });

        if (canceled || !assets?.[0]) {
            return null;
        }

        const pickedAsset = assets[0];
        const format = getAssetFormat(pickedAsset);
        if (!format) {
            Alert.alert(
                'Unsupported file',
                'Choose an EPUB or PDF file to import.'
            );
            return null;
        }

        if (format === 'pdf' && Platform.OS !== 'android') {
            Alert.alert(
                'PDF import unavailable',
                'PDF reading uses the Android native reader in this build.'
            );
            return null;
        }

        return { ...pickedAsset, format };
    };

    const promptForPdfCoverChoice = (metadata = {}) => new Promise((resolve) => {
        if (pdfCoverChoiceResolverRef.current) {
            pdfCoverChoiceResolverRef.current({ type: 'page', pageNumber: 1 });
        }

        pdfCoverChoiceResolverRef.current = resolve;
        setPdfCoverPageInput('1');
        setPdfCoverPrompt({
            title: metadata.title || 'Untitled',
            author: metadata.author || '',
            pageCount: Number(metadata.pageCount) || null,
        });
    });

    const resolvePdfCoverChoice = (choice) => {
        const resolver = pdfCoverChoiceResolverRef.current;
        pdfCoverChoiceResolverRef.current = null;
        setPdfCoverPrompt(null);
        setPdfCoverPageInput('1');
        resolver?.(choice);
    };

    const handlePdfCoverPageInputChange = (value) => {
        setPdfCoverPageInput(String(value || '').replace(/[^\d]/g, '').slice(0, 5));
    };

    const parsePdfCoverPageNumber = (value) => {
        const pageNumber = Number.parseInt(String(value || '1'), 10);
        const pageCount = Number(pdfCoverPrompt?.pageCount) || null;

        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
            return null;
        }

        if (pageCount && pageNumber > pageCount) {
            return null;
        }

        return pageNumber;
    };

    const choosePdfCoverDefault = () => {
        resolvePdfCoverChoice({ type: 'page', pageNumber: 1 });
    };

    const choosePdfCoverNone = () => {
        resolvePdfCoverChoice({ type: 'none' });
    };

    const choosePdfCoverCustom = () => {
        const pageNumber = parsePdfCoverPageNumber(pdfCoverPageInput);
        if (!pageNumber) {
            const pageCount = Number(pdfCoverPrompt?.pageCount) || null;
            Alert.alert(
                'Invalid page',
                pageCount
                    ? `Enter a page number from 1 to ${pageCount}.`
                    : 'Enter a page number of 1 or higher.'
            );
            return;
        }

        resolvePdfCoverChoice({ type: 'page', pageNumber });
    };

    const addBook = async () => {
        try {
            const pickedAsset = await pickBookAsset();

            if (!pickedAsset) {
                return;
            }

            const { uri } = pickedAsset;
            const format = pickedAsset.format || 'epub';
            setIsImporting(true);

            const fallbackName = pickedAsset?.name || uri.split('/').pop() || 'Untitled';
            const metadata = format === 'pdf'
                ? await readPdfMetadata(uri, fallbackName)
                : await readEpubMetadata(uri, fallbackName);
            const { title, author, language, wordCount } = metadata;
            let cover = metadata.cover;
            let pdfCoverPageNumber = null;

            if (format === 'pdf') {
                const coverChoice = await promptForPdfCoverChoice(metadata);
                if (coverChoice?.type === 'page') {
                    pdfCoverPageNumber = coverChoice.pageNumber || 1;
                    try {
                        cover = await renderPdfCover(uri, fallbackName, pdfCoverPageNumber);
                    } catch (coverError) {
                        console.warn('[useBooks] PDF cover render failed; importing without cover:', coverError);
                        Alert.alert(
                            'Cover not generated',
                            'The PDF will still import, but the selected cover page could not be rendered.'
                        );
                        cover = null;
                        pdfCoverPageNumber = null;
                    }
                } else {
                    cover = null;
                }
            }

            const coverColors = cover
                ? await extractBookCoverColors({
                    coverUri: cover,
                    cacheKey: `import:${uri}:${title}:${author}`,
                })
                : {};

            const existingBook = books.find(
                (book) => book.downloaded !== false && (
                    book.uri === uri
                    || (
                        book.title === title
                        && book.author === author
                        && String(book.format || 'epub').toLowerCase() === format
                    )
                )
            );

            if (existingBook) {
                const needsMetadataPatch = !existingBook.originalTitle
                    || !existingBook.originalAuthor
                    || !Object.prototype.hasOwnProperty.call(existingBook, 'originalCover')
                    || (!existingBook.cover && cover)
                    || (!existingBook.language && language)
                    || (!existingBook.wordCount && wordCount)
                    || (!existingBook.format && format)
                    || (!existingBook.coverAccentColor && coverColors.coverAccentColor)
                    || (!existingBook.coverBackgroundColor && coverColors.coverBackgroundColor)
                    || (!existingBook.pdfCoverPageNumber && pdfCoverPageNumber);

                if (needsMetadataPatch) {
                    setBooks((prevBooks) => prevBooks.map((book) => (
                        book.id === existingBook.id
                            ? {
                                ...book,
                                cover: book.cover || cover,
                                coverAccentColor: book.coverAccentColor || coverColors.coverAccentColor,
                                coverBackgroundColor: book.coverBackgroundColor || coverColors.coverBackgroundColor,
                                originalTitle: book.originalTitle || title,
                                originalAuthor: book.originalAuthor || author,
                                originalCover: Object.prototype.hasOwnProperty.call(book, 'originalCover')
                                    ? book.originalCover
                                    : cover ?? null,
                                originalFilename: book.originalFilename || fallbackName,
                                format: book.format || format,
                                language: book.language || language || null,
                                wordCount: book.wordCount || wordCount || null,
                                pdfCoverPageNumber: book.pdfCoverPageNumber || pdfCoverPageNumber || null,
                            }
                            : book
                    )));
                }
                setCurrentBook(existingBook.uri);
                setIsImporting(false);
                navigation.navigate('Read');
                return;
            }

            const preprocessed = await isBookPreprocessed(uri, { ownerId });
            const newBook = {
                id: createBookId(),
                uri,
                size: pickedAsset?.size ?? null,
                format,
                title,
                author,
                cover,
                ...coverColors,
                language,
                wordCount: wordCount ?? null,
                pdfCoverPageNumber,
                originalTitle: title,
                originalAuthor: author,
                originalCover: cover ?? null,
                originalFilename: fallbackName,
                location: null,
                nativePosition: null,
                progress: 0,
                preprocessed,
                preprocessing: false,
                cloudId: null,
                cloudFilePath: null,
                cloudSyncedAt: null,
                downloaded: true,
            };

            setBooks((prevBooks) => [...prevBooks, newBook]);

            setCurrentBook(uri);
            onBookImported?.(newBook);
            setIsImporting(false);
            navigation.navigate('Read');

            if (user?.id && ownerId === user.id && isCurrentSyncGeneration(syncGeneration)) {
                uploadUserBook({
                    user,
                    ownerId,
                    generation: syncGeneration,
                    localBook: newBook,
                    pickedAsset,
                })
                    .then((cloudBook) => {
                        if (!isCurrentSyncGeneration(syncGeneration)) {
                            return;
                        }
                        setBooks((prevBooks) => prevBooks.map((book) => (
                            book.id === newBook.id
                                ? {
                                    ...book,
                                    cloudId: cloudBook.id,
                                    cloudOwnerId: cloudBook.user_id,
                                    cloudFilePath: cloudBook.file_path,
                                    cloudCoverPath: cloudBook.cover_path ?? null,
                                    cloudSyncedAt: cloudBook.updated_at ?? cloudBook.uploaded_at ?? new Date().toISOString(),
                                    downloaded: true,
                                }
                                : book
                        )));
                    })
                    .catch((uploadError) => {
                        console.warn('[useBooks] Cloud book upload failed; local import remains usable:', uploadError);
                    });
            }
        } catch (error) {
            console.error("[useBooks] Error in addBook:", error);
            Alert.alert(
                'Import failed',
                error?.message || 'This book could not be imported.'
            );
            setIsImporting(false);
        }
    };

    const confirmAddBook = () => {
        Alert.alert(
            'Import book',
            'Choose an EPUB or PDF file to import.',
            [
                { text: 'Import', onPress: addBook },
                { text: 'Cancel', style: 'cancel' }
            ]
        );
    };

    const handlePress = async (uri) => {
        try {
            setOpeningBookUri(uri);
            setCurrentBook(uri);
            navigation.navigate('Read');
        } catch (error) {
            console.error("[useBooks] Error handling book press:", error);
        } finally {
            setTimeout(() => {
                setOpeningBookUri((current) => (current === uri ? null : current));
            }, 900);
        }
    };

    return {
        isImporting,
        openingBookUri,
        pdfCoverPrompt,
        pdfCoverPageInput,
        setPdfCoverPageInput: handlePdfCoverPageInputChange,
        choosePdfCoverDefault,
        choosePdfCoverNone,
        choosePdfCoverCustom,
        addBook,
        confirmAddBook,
        handlePress,
    };
};

export default useBooks;
