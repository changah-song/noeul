import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ReaderProvider } from '@epubjs-react-native/core';

import TopSection from '../components/TopSection';
import BottomSection from '../components/BottomSection';
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
