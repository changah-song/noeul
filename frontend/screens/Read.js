import React, { useState, useEffect, useMemo } from 'react';
import { View, SafeAreaView, StyleSheet, Text, StatusBar, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import { useFocusEffect } from '@react-navigation/native';

import TopSection from '../components/TopSection';
import SettingsMenu from '../components/SettingsMenu';
import { AppProvider } from '../contexts/AppContext';

const Read = ({ books, setBooks, currentBook }) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState({
        fontSize: 18,
        isDarkMode: false,
        flow: 'paginated',
        fontFamily: 'Georgia',
        lineSpacing: 1.5
    });
    const insets = useSafeAreaInsets();

    // Load settings from AsyncStorage on mount
    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const savedSettings = await AsyncStorage.getItem('readerSettings');
            if (savedSettings) {
                setSettings(JSON.parse(savedSettings));
            }
        } catch (error) {
            console.log('Error loading settings:', error);
        }
    };

    const saveSettings = async (newSettings) => {
        try {
            await AsyncStorage.setItem('readerSettings', JSON.stringify(newSettings));
        } catch (error) {
            console.log('Error saving settings:', error);
        }
    };

    const handleSettingChange = (key, value) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        saveSettings(newSettings);
    };

    /* useFocusEffect(
        React.useCallback(() => {
            // Reset highlightedWord when the screen loses focus
            return () => setHighlightedWord('');
        }, [])
    );
    */

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
                        setHighlightedWord={setHighlightedWord}
                        settings={settings}
                    />
                </ReaderProvider>
            </View>

            {/* Settings Button */}
            <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => setShowSettings(true)}
            >
                <Text style={styles.settingsButtonText}>⚙️</Text>
            </TouchableOpacity>

            {/* Settings Menu */}
            <SettingsMenu
                visible={showSettings}
                onClose={() => setShowSettings(false)}
                settings={settings}
                onSettingChange={handleSettingChange}
            />
        </View>
    );
}

const BottomSection = ({ books, setBooks, currentBook, setHighlightedWord, settings }) => {
    const { getCurrentLocation } = useReader();

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

    const theme = useMemo(() => ({
        body: {
            background: settings.isDarkMode ? '#1f2937' : '#ffffff',
            color: settings.isDarkMode ? '#f3f4f6' : '#1f2937',
            'font-size': `${settings.fontSize}px !important`,
            'font-family': `${settings.fontFamily} !important`,
        },
        p: {
            'line-height': `${settings.lineSpacing} !important`,
            'font-size': `${settings.fontSize}px !important`,
            'font-family': `${settings.fontFamily} !important`,
        },
        div: {
            'font-size': `${settings.fontSize}px !important`,
            'font-family': `${settings.fontFamily} !important`,
        },
        span: {
            'font-size': `${settings.fontSize}px !important`,
            'font-family': `${settings.fontFamily} !important`,
        }
    }), [settings.isDarkMode, settings.fontSize, settings.fontFamily, settings.lineSpacing]);

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
            menuItems={[]}
            onSelected={(text) => { setHighlightedWord(text) }}
            onLocationChange={() => { saveCurrentLocation() }}
            initialLocation={initialLocation || ""}
            defaultTheme={theme}
            flow={settings.flow}


            injectedJavascript={`
                console.log("Javascript injection started");

                // Function to highlight words containing specific characters
                function highlightWords() {
                    console.log('Starting word highlighting');
                    
                    var contents = rendition.getContents();
                    if (contents && contents.length > 0) {
                        contents.forEach(function(content) {
                            if (content && content.document) {
                                var doc = content.document;
                                var bodyElement = doc.body;
                                
                                // Function to check if text contains Korean character 가
                                function containsTargetChar(text) {
                                    return text.includes('가');
                                }
                                
                                // Function to wrap matching words in spans
                                function processTextNode(node) {
                                    var text = node.textContent;
                                    var words = text.split(/(\s+)/); // Split by whitespace but keep the spaces
                                    
                                    var hasMatch = false;
                                    var fragment = doc.createDocumentFragment();
                                    
                                    words.forEach(function(word) {
                                        if (word.trim() && containsTargetChar(word)) {
                                            hasMatch = true;
                                            var span = doc.createElement('span');
                                            span.style.backgroundColor = 'red';
                                            span.style.color = 'white';
                                            span.textContent = word;
                                            fragment.appendChild(span);
                                        } else {
                                            fragment.appendChild(doc.createTextNode(word));
                                        }
                                    });
                                    
                                    if (hasMatch) {
                                        node.parentNode.replaceChild(fragment, node);
                                    }
                                }
                                
                                // Walk through all text nodes
                                var walker = doc.createTreeWalker(
                                    bodyElement,
                                    NodeFilter.SHOW_TEXT,
                                    null,
                                    false
                                );
                                
                                var textNodes = [];
                                var node;
                                while (node = walker.nextNode()) {
                                    textNodes.push(node);
                                }
                                
                                textNodes.forEach(processTextNode);
                                console.log('Highlighting complete');
                            }
                        });
                    }
                }
                
                // Run highlighting after content is rendered
                rendition.on('rendered', function() {
                    console.log('Content rendered, applying highlights');
                    highlightWords();
                });
                
                // Also run on location change
                rendition.on('relocated', function() {
                    console.log('Location changed, applying highlights');
                    highlightWords();
                }); 
                


                // Listen to click events and select word
                rendition.on('click', function(e) {
                    console.log('Click detected, attempting to select word');
                    
                    var contents = rendition.getContents();
                    if (contents && contents.length > 0) {
                        var content = contents[0];
                        if (content && content.window) {
                            var selection = content.window.getSelection();
                            var doc = content.document;
                            
                            // Get the click position
                            var range = doc.caretRangeFromPoint(e.clientX, e.clientY);
                            
                            if (range) { 
                                selection.removeAllRanges();
                                selection.addRange(range);
                                
                                // Expand selection to whole word
                                selection.modify('move', 'backward', 'word');
                                selection.modify('extend', 'forward', 'word');
                                
                                var selectedText = selection.toString().trim();
                                console.log('Selected word:', selectedText);
                                
                                if (selectedText) {
                                    window.ReactNativeWebView.postMessage(JSON.stringify({ 
                                        type: 'word-selected', 
                                        text: selectedText
                                    }));
                                }
                            }
                        }
                    }
                });
                
                console.log('Click listener attached');
            `}
            onWebViewMessage={(event) => {
                const raw = event?.nativeEvent?.data ?? event;
                console.log('📱 Received from WebView:', raw);
                console.log("typeof raw:", typeof raw)
            }}

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
    },
    settingsButton: {
        position: 'absolute',
        bottom: 30,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#3b82f6',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    settingsButtonText: {
        fontSize: 24,
    }
});

export default Read;
