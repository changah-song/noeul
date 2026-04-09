import { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { useReader } from '@epubjs-react-native/core';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';

const useBooks = ({ books, setBooks, currentBook, setCurrentBook }) => {
    const [loading, setLoading] = useState(false);
    const [bookRendered, setBookRendered] = useState(false);

    const navigation = useNavigation();
    const { getMeta } = useReader();

    const addBook = async () => {
        try {
            const { assets } = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
            if (!assets) return;
            const { uri } = assets[0];
            setCurrentBook(uri);
            setBookRendered(false);
            setLoading(true);
        } catch (error) {
            console.log("[useBooks] Error in addBook:", error);
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

    useEffect(() => {
        console.log("[useBooks] Book rendered, bookRendered:", bookRendered)
        if (bookRendered && currentBook) {
            const fetchMeta = async () => {
                try {
                    const { title, author, cover } = getMeta();
                    console.log(`[useBooks] Book meta fetched → title: "${title}", author: "${author}"`);

                    const bookExists = books.some(
                        book => book.title === title && book.author === author && book.cover === cover
                    );
                    if (bookExists) {
                        Alert.alert('Duplicate Book', 'This book is already loaded.');
                        return;
                    }
                    setBooks(prevBooks => [
                        ...prevBooks,
                        { id: Math.random().toString(), uri: currentBook, title, author, cover, location: null }
                    ]);
                } catch (error) {
                    console.log("[useBooks] Error fetching meta:", error);
                } finally {
                    setLoading(false);
                }
            };

            fetchMeta();
        }
    }, [bookRendered]);

    const handlePress = async (uri) => {
        try {
            setLoading(true);
            await setCurrentBook(uri);
            setBookRendered(false);
            navigation.navigate('Read');
        } catch (error) {
            console.error("[useBooks] Error handling book press:", error);
        } finally {
            setLoading(false);
        }
    };

    return { loading, bookRendered, setBookRendered, addBook, confirmAddBook, handlePress };
};

export default useBooks;