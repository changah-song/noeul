import { useState, useEffect, useCallback, useRef } from 'react';
import { Text, View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
// icons for UI
import { Feather } from '@expo/vector-icons';
import { MaterialIcons } from '@expo/vector-icons';
// context for dictMode
import { useAppContext } from '../../../contexts/AppContext'; // import context
// logic components for tranlsation and dictionary
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

const TopSection = ({ highlightedWord }) => {
    // global variable loading and function to edit
    const { dictMode, setDictMode } = useAppContext();
    const [isLoading, setIsLoading] = useState(false);
    const prevWordRef = useRef('');

    const toggleContent = () => {
        setDictMode(!dictMode);
    };

    // Set loading when highlightedWord changes to a different word
    useEffect(() => {
        if (highlightedWord && highlightedWord !== prevWordRef.current) {
            console.log('Setting loading true for word:', highlightedWord);
            setIsLoading(true);
            prevWordRef.current = highlightedWord;

            // Safety timeout to prevent infinite loading (5 seconds max)
            const timeout = setTimeout(() => {
                console.log('Safety timeout: forcing loading to false');
                setIsLoading(false);
            }, 5000);

            return () => clearTimeout(timeout);
        }
    }, [highlightedWord]);

    // Also set loading when switching between dict/translation mode
    useEffect(() => {
        if (highlightedWord) {
            console.log('Mode changed, setting loading true');
            setIsLoading(true);
        }
    }, [dictMode]);

    const handleContentLoaded = useCallback(() => {
        console.log('Content loaded, setting loading false');
        setIsLoading(false);
    }, []);

    return (
        <View>
            {/* shows highlighted word, header */}
            <View style={styles.title}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', fontFamily: 'serif' }}>{highlightedWord}</Text>
                </ScrollView>
            </View>

            {/* toggle between translator and dictionary */}
            <TouchableOpacity onPress={toggleContent} style={styles.toggleButton}>
                {dictMode ? <MaterialIcons name="translate" size={25} color="black" /> : <Feather name="book-open" size={25} color="black" />}
            </TouchableOpacity>

            {/* show loading indicator while content is loading */}
            {isLoading && highlightedWord && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color="#ffffff" />
                </View>
            )}

            {/* show either dictionary or translator content depending on dictMode status */}
            <View style={{ opacity: isLoading ? 0 : 1 }}>
                {dictMode ?
                <DictionaryContent highlightedWord={highlightedWord} onContentLoaded={handleContentLoaded} /> :
                <TranslationContent highlightedWord={highlightedWord} onContentLoaded={handleContentLoaded} />}
            </View>
        </View>
    );
  };

const styles = StyleSheet.create({
    title: {
        position: 'absolute',
        top: 2,
        left: 5,
        width: '85%',
        height: 25,
    },
    toggleButton: {
        left: 370,
        top: 10
    },
    loadingContainer: {
        position: 'absolute',
        top: 30,
        left: 5,
    }
});

export default TopSection