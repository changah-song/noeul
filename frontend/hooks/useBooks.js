import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { isBookPreprocessed } from '../services/Database';
import { uploadUserBook } from '../services/bookCloudSync';
import { readEpubMetadata } from '../services/epubMetadata';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';

const useBooks = ({ books, setBooks, setCurrentBook, onBookImported, user, ownerId, syncGeneration }) => {
    const [isImporting, setIsImporting] = useState(false);
    const [openingBookUri, setOpeningBookUri] = useState(null);

    const navigation = useNavigation();

    const isEpubAsset = (asset) => {
        const name = String(asset?.name || '').toLowerCase();
        const mimeType = String(asset?.mimeType || '').toLowerCase();
        const uri = String(asset?.uri || '').toLowerCase();

        return (
            name.endsWith('.epub') ||
            uri.endsWith('.epub') ||
            mimeType === 'application/epub+zip'
        );
    };

    const pickEpubAsset = async () => {
        const { assets, canceled } = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
        });

        if (canceled || !assets?.[0]) {
            return null;
        }

        const pickedAsset = assets[0];
        if (!isEpubAsset(pickedAsset)) {
            Alert.alert(
                'Unsupported file',
                'Only EPUB files are supported currently.'
            );
            return null;
        }

        return pickedAsset;
    };

    const addBook = async () => {
        try {
            const pickedAsset = await pickEpubAsset();

            if (!pickedAsset) {
                return;
            }

            const { uri } = pickedAsset;
            setIsImporting(true);

            const { title, author, cover, language } = await readEpubMetadata(
                uri,
                pickedAsset?.name || uri.split('/').pop() || 'Untitled'
            );

            const existingBook = books.find(
                (book) => book.downloaded !== false && (
                    book.uri === uri
                    || (book.title === title && book.author === author)
                )
            );

            if (existingBook) {
                const needsMetadataPatch = !existingBook.originalTitle
                    || !existingBook.originalAuthor
                    || !Object.prototype.hasOwnProperty.call(existingBook, 'originalCover')
                    || (!existingBook.cover && cover)
                    || (!existingBook.language && language);

                if (needsMetadataPatch) {
                    setBooks((prevBooks) => prevBooks.map((book) => (
                        book.id === existingBook.id
                            ? {
                                ...book,
                                cover: book.cover || cover,
                                originalTitle: book.originalTitle || title,
                                originalAuthor: book.originalAuthor || author,
                                originalCover: Object.prototype.hasOwnProperty.call(book, 'originalCover')
                                    ? book.originalCover
                                    : cover ?? null,
                                language: book.language || language || null,
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
                id: Math.random().toString(),
                uri,
                size: pickedAsset?.size ?? null,
                title,
                author,
                cover,
                language,
                originalTitle: title,
                originalAuthor: author,
                originalCover: cover ?? null,
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
            setIsImporting(false);
        }
    };

    const confirmAddBook = () => {
        Alert.alert(
            'Import EPUB',
            'Choose an EPUB file to import.',
            [
                { text: 'Import EPUB', onPress: addBook },
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

    return { isImporting, openingBookUri, addBook, confirmAddBook, handlePress };
};

export default useBooks;
