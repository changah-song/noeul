import { useState } from 'react';
import { View, Text, Image, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Reader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import Icon from 'react-native-vector-icons/FontAwesome';
import useBooks from '../../hooks/useBooks';

const BookList = ({ books, setBooks, currentBook, setCurrentBook, onRequestPreprocess }) => {
    const { loading, bookRendered, setBookRendered, confirmAddBook, handlePress } = useBooks({
        books,
        setBooks,
        currentBook,
        setCurrentBook,
    });

    // ID of the book whose tooltip is currently showing (from long-press)
    const [tooltipBookId, setTooltipBookId] = useState(null);

    const showTooltip = (id) => {
        setTooltipBookId(id);
        setTimeout(() => setTooltipBookId(null), 2500);
    };

    const handleDownloadPress = (item) => {
        if (item.preprocessed) {
            Alert.alert('Already downloaded', 'Vocabulary for this book is already cached locally.');
            return;
        }
        Alert.alert(
            'Download vocabulary?',
            'Pre-caches all word definitions for this book so lookups are instant while reading. May take a few minutes.',
            [
                { text: 'Download', onPress: () => onRequestPreprocess(item.uri) },
                { text: 'Cancel', style: 'cancel' },
            ]
        );
    };

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
                    <TouchableOpacity
                        style={styles.book}
                        onPress={() => {
                            console.log(`[BookList] Book clicked: "${item.title}"`);
                            handlePress(item.uri);
                        }}
                    >
                        <Image
                            style={styles.bookImage}
                            source={item.cover ? { uri: item.cover } : require('../../assets/icon.png')}
                        />
                        <View style={styles.bookInfo}>
                            <View style={{ flexWrap: 'wrap', flexDirection: 'row' }}>
                                <Text style={styles.bookTitle}>{item.title}</Text>
                            </View>
                            <Text style={styles.bookAuthor}>{item.author}</Text>

                            {/* Download / cached indicator */}
                            <View style={styles.downloadRow}>
                                <TouchableOpacity
                                    style={styles.downloadButton}
                                    onPress={() => handleDownloadPress(item)}
                                    onLongPress={() => showTooltip(item.id)}
                                >
                                    <Icon
                                        name={item.preprocessed ? 'check-circle' : 'cloud-download'}
                                        size={22}
                                        color={item.preprocessed ? '#4caf50' : '#3b82f6'}
                                    />
                                </TouchableOpacity>
                                {tooltipBookId === item.id && (
                                    <View style={styles.tooltip}>
                                        <Text style={styles.tooltipText}>
                                            {item.preprocessed
                                                ? 'Vocabulary already downloaded'
                                                : 'Download vocabulary for instant word lookup'}
                                        </Text>
                                    </View>
                                )}
                            </View>
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
        flexDirection: 'column',
    },
    bookTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    bookAuthor: {},
    downloadRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    downloadButton: {
        padding: 4,
    },
    tooltip: {
        marginLeft: 8,
        backgroundColor: 'rgba(0,0,0,0.72)',
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        maxWidth: 200,
    },
    tooltipText: {
        color: '#fff',
        fontSize: 12,
    },
});

export default BookList;
