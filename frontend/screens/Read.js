import React, { useState, useEffect } from 'react';
import { View, SafeAreaView, StyleSheet, Text, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import { useFocusEffect } from '@react-navigation/native';

import TopSection from '../components/TopSection';
import { AppProvider } from '../contexts/AppContext';

const Read = ({ books, setBooks, currentBook }) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const insets = useSafeAreaInsets();

    useFocusEffect(
        React.useCallback(() => {
            // Reset highlightedWord when the screen loses focus
            return () => setHighlightedWord('');
        }, [])
    );

    return (
        <View style={{ flex: 1 }}>
            <View style={[styles.entireTop, { paddingTop: insets.top }]}>
                <View style={styles.topSection}>
                    <AppProvider>
                        <TopSection highlightedWord={highlightedWord} />
                    </AppProvider>
                </View>
            </View>

            <View style={styles.reader}>
                <ReaderProvider>
                    <BottomSection
                        books={books}
                        setBooks={setBooks}
                        currentBook={currentBook}
                        setHighlightedWord={setHighlightedWord} />
                </ReaderProvider>
            </View>

        </View>
    );
}

const BottomSection = ({ books, setBooks, currentBook, setHighlightedWord }) => {
    const { getCurrentLocation, goToLocation } = useReader();

    const saveCurrentLocation = () => {
        const currentLocation = getCurrentLocation();
        if (!currentLocation || !currentLocation.start) {
            console.log("Failed to get current location or start CFI");
            return;
        }
        const startCfi = currentLocation.start.cfi;
        setBooks(prevBooks => prevBooks.map(book =>
            book.uri === currentBook ? { ...book, location: startCfi } : book
        ));
        console.log('current location', startCfi);
    };

    const initialLocation = books.find(book => book.uri === currentBook)?.location;

    if (!currentBook) {
        return (
            <View style={styles.noBookContainer}>
                <Text style={styles.noBookText}>No book selected</Text>
            </View>
        );
    }

    return (
        <Reader
            src={currentBook}
            fileSystem={useFileSystem}
            enableSelection={true}
            allowScriptedContent={true}
            onSelected={(text) => { setHighlightedWord(text) }}
            onLocationChange={() => { saveCurrentLocation() }}
            initialLocation={initialLocation || ""}
        />
    )
}

const styles = StyleSheet.create({
    entireTop: {
        flex: 0.18,
        backgroundColor: '#85929E',
        borderBottomRightRadius: 5,
        borderBottomLeftRadius: 5
    },
    loadBook: {
        backgroundColor: '#ebf4f6'
    },
    topSection: {
        height: '50%',
    },
    reader: {
        flex: 0.82,
    },
    noBookContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    noBookText: {
        fontSize: 18,
        color: '#6e7b8b',
    }
});

export default Read;
