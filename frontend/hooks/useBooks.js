import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { isBookPreprocessed } from '../services/Database';
import { readEpubMetadata } from '../services/epubMetadata';

const useBooks = ({ books, setBooks, setCurrentBook, onBookImported }) => {
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

            const { title, author, cover } = await readEpubMetadata(
                uri,
                pickedAsset?.name || uri.split('/').pop() || 'Untitled'
            );

            const existingBook = books.find(
                (book) => book.uri === uri || (
                    book.title === title && book.author === author
                )
            );

            if (existingBook) {
                if (!existingBook.cover && cover) {
                    setBooks((prevBooks) => prevBooks.map((book) => (
                        book.id === existingBook.id
                            ? { ...book, cover }
                            : book
                    )));
                }
                setCurrentBook(existingBook.uri);
                setIsImporting(false);
                navigation.navigate('Read');
                return;
            }

            const preprocessed = await isBookPreprocessed(uri);
            const newBook = {
                id: Math.random().toString(),
                uri,
                size: pickedAsset?.size ?? null,
                title,
                author,
                cover,
                location: null,
                nativePosition: null,
                progress: 0,
                preprocessed,
                preprocessing: false,
            };

            setBooks((prevBooks) => [...prevBooks, newBook]);

            setCurrentBook(uri);
            onBookImported?.(newBook);
            setIsImporting(false);
            navigation.navigate('Read');
        } catch (error) {
            console.log("[useBooks] Error in addBook:", error);
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
