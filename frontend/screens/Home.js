import { ReaderProvider } from '@epubjs-react-native/core';
import { Alert, Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import BookList from '../components/Home/BookList';
import useBooks from '../hooks/useBooks';

const Home = ({ navigation, books, setBooks, currentBook, setCurrentBook, setPreprocessOnOpen, signOut }) => {
    const { loading, bookRendered, setBookRendered, addBook, handlePress } = useBooks({
        books,
        setBooks,
        currentBook,
        setCurrentBook,
    });

    // Called when the user taps the download button on a book.
    // Sets the preprocessing flag before navigating so Read.js knows to run the pipeline.
    const onRequestPreprocess = (uri) => {
        setCurrentBook(uri);
        setPreprocessOnOpen(true);
        navigation.navigate('Read');
    };

    const handleSignOut = () => {
        Alert.alert(
            'Sign out',
            'Sign out of FluentFable?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign out',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await signOut?.();
                        } catch (error) {
                            Alert.alert('Sign out failed', error.message);
                        }
                    },
                },
            ]
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Books</Text>
                <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
                    <Text style={styles.signOutText}>Sign out</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.body}>
                <ReaderProvider>
                    <BookList
                        books={books}
                        setBooks={setBooks}
                        currentBook={currentBook}
                        setCurrentBook={setCurrentBook}
                        onRequestPreprocess={onRequestPreprocess}
                    />
                </ReaderProvider>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        height: "12%",
        backgroundColor: '#6e7b8b',
        borderBottomRightRadius: 10,
        borderBottomLeftRadius: 10
    },
    title: {
        position: 'absolute',
        top: 45,
        left: 12,
        fontSize: 25,
        fontFamily: 'Roboto',
        color: '#ebf4f6'
    },
    signOutButton: {
        position: 'absolute',
        top: 50,
        right: 14,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.15)',
    },
    signOutText: {
        color: '#ebf4f6',
        fontSize: 13,
        fontWeight: '700',
    },
    body: {
        height: "88%",
    },
    addButton: {
        position: 'absolute',
        top: 640,
        right: 30,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#f4a261',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 5
    },
    loadingContainer: {
        position: 'absolute',
        top: 640,
        right: 30,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#f4a261',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 6
    },
    handleBooksContainer: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    bookContainer: {
        flex: 1,
        paddingTop: 10,
        width: "100%",
        backgroundColor: 'transparent',
    },
    book: {
        padding: 5,
        margin: 5,
        height: 150,
        flexDirection: 'row',
        backgroundColor: 'white',
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: '#6e7b8b',
        elevation: 5
    },
    bookImage: {
        width: "25%",
        height: "100%",
        borderRadius: 10,
    },
    bookInfo: {
        marginLeft: 8,
        width: "73%",
        flexWrap: 'wrap',
        flexDirection: 'col',
    },
    bookTitle: {
        fontSize: 18,
        fontWeight: 'bold'
    },
    bookAuthor: {
    }
});

export default Home
