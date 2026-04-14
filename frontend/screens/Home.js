import { ReaderProvider } from '@epubjs-react-native/core';
import { Text, View, StyleSheet } from 'react-native';
import BookList from '../components/Home/BookList';
import useBooks from '../hooks/useBooks';

const Home = ({ navigation, books, setBooks, currentBook, setCurrentBook, setPreprocessOnOpen }) => {
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

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Books</Text>
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