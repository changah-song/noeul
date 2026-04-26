import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { isBookPreprocessed } from '../services/Database';
import { readEpubMetadata } from '../services/epubMetadata';

const useBooks = ({ books, setBooks, currentBook, setCurrentBook, onBookImported }) => {
    const [isImporting, setIsImporting] = useState(false);
    const [openingBookUri, setOpeningBookUri] = useState(null);

    const navigation = useNavigation();

    const addBook = async () => {
        try {
            const { assets } = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
            if (!assets) return;

            const pickedAsset = assets[0];
            const { uri } = pickedAsset;
            setIsImporting(true);

            const { title, author, cover } = await readEpubMetadata(
                uri,
                pickedAsset?.name || uri.split('/').pop() || 'Untitled'
            );

            const bookExists = books.some(
                (book) => book.uri === uri || (
                    book.title === title && book.author === author && book.cover === cover
                )
            );

            if (bookExists) {
                Alert.alert('Duplicate Book', 'This book is already loaded.');
                setIsImporting(false);
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
                progress: 0,
                preprocessed,
                preprocessing: false,
            };

            setBooks((prevBooks) => [...prevBooks, newBook]);

            // Keep the current continue-reading book stable after the first import.
            if (!currentBook && books.length === 0) {
                setCurrentBook(uri);
            }

            onBookImported?.(newBook);
            setIsImporting(false);
        } catch (error) {
            console.log("[useBooks] Error in addBook:", error);
            setIsImporting(false);
        }
    };

    const confirmAddBook = () => {
        Alert.alert(
            'Instructions',
            'Choose an EPUB file to load',
            [
                { text: 'Ok', onPress: addBook },
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
