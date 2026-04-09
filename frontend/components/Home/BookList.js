import { View, Text, Image, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Reader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import Icon from 'react-native-vector-icons/FontAwesome';
import useBooks from '../../hooks/useBooks';

const BookList = ({ books, setBooks, currentBook, setCurrentBook }) => {
    const { loading, bookRendered, setBookRendered, confirmAddBook, handlePress } = useBooks({
        books,
        setBooks,
        currentBook,
        setCurrentBook,
    });

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.addButton} onPress={confirmAddBook}>
                <Icon name="plus" size={20} color="#ebf4f6" />
            </TouchableOpacity>

            <FlatList
                showsVerticalScrollIndicator={true}
                style={styles.bookContainer}
                data={books}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.book} onPress={() => { console.log(`[BookList] Book clicked: "${item.title}"`); handlePress(item.uri); }}>
                        <Image
                            style={styles.bookImage}
                            source={item.cover ? { uri: item.cover } : require('../../assets/icon.png')}
                        />
                        <View style={styles.bookInfo}>
                            <View style={{ flexWrap: 'wrap', flexDirection: 'row' }}>
                                <Text style={styles.bookTitle}>{item.title}</Text>
                            </View>
                            <Text style={styles.bookAuthor}>{item.author}</Text>
                        </View>
                    </TouchableOpacity>
                )}
            />

            {loading && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#ebf4f6" />
                </View>
            )}

            {loading && currentBook && (
                <Reader
                    height="0"
                    src={currentBook}
                    fileSystem={useFileSystem}
                    onReady={() => setBookRendered(true)}
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'transparent',
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
        zIndex: 5,
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
        zIndex: 6,
    },
    bookContainer: {
        flex: 1,
        paddingTop: 10,
        width: '100%',
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
        elevation: 5,
    },
    bookImage: {
        width: '25%',
        height: '100%',
        borderRadius: 10,
    },
    bookInfo: {
        marginLeft: 8,
        width: '73%',
        flexWrap: 'wrap',
        flexDirection: 'col',
    },
    bookTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    bookAuthor: {},
});

export default BookList;