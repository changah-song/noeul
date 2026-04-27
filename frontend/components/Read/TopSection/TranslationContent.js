import React, { useState, useEffect, useRef } from 'react';
import { Text, View, ScrollView, StyleSheet } from 'react-native';
import Translator from 'react-native-translator';
import { colors, spacing, textStyles } from '../../../theme';

const TranslationContent = ({ highlightedWord, isDarkMode, onContentLoaded }) => {
    const [googleTranslated, setGoogleTranslated] = useState('');
    const [showOffline, setShowOffline] = useState(false);
    const translationArrivedRef = useRef(false);

    const palette = isDarkMode
        ? {
            text: '#f3ede3',
            muted: '#b6aa99',
        }
        : {
            text: colors.text,
            muted: colors.textMuted,
        };

    useEffect(() => {
        setGoogleTranslated('');
        setShowOffline(false);
    }, [highlightedWord]);

    useEffect(() => {
        setShowOffline(false);
        translationArrivedRef.current = false;
        if (!highlightedWord) return;

        const timer = setTimeout(() => {
            if (!translationArrivedRef.current) setShowOffline(true);
        }, 8000);
        return () => clearTimeout(timer);
    }, [highlightedWord]);

    useEffect(() => {
        if (googleTranslated) {
            translationArrivedRef.current = true;
            setShowOffline(false);
            onContentLoaded?.();
        }
    }, [googleTranslated, onContentLoaded]);

    return (
        <View style={styles.container}>
            <View style={styles.hiddenTranslatorHost}>
                <Translator
                    from="ko"
                    to="en"
                    value={highlightedWord}
                    type="google"
                    onTranslated={(t) => setGoogleTranslated(t)}
                />
            </View>

            <ScrollView
                style={styles.translationSection}
                contentContainerStyle={styles.translationContent}
                showsVerticalScrollIndicator={true}
            >
                {showOffline
                    ? <Text style={[styles.offlineText, { color: palette.muted }]}>Internet connection required</Text>
                    : googleTranslated
                        ? <Text style={[styles.translationText, { color: palette.text }]}>{googleTranslated}</Text>
                        : null
                }
            </ScrollView>   
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        minHeight: 0,
    },
    hiddenTranslatorHost: {
        width: 0,
        height: 0,
        opacity: 0,
        overflow: 'hidden',
    },
    translationSection: {
        flex: 1,
        minHeight: 0,
    },
    translationContent: {
        flexGrow: 1,
        paddingRight: spacing.xs,
        paddingBottom: spacing.md,
    },
    offlineText: {
        ...textStyles.caption,
        color: colors.textMuted,
        fontStyle: 'italic',
    },
    translationText: {
        ...textStyles.body,
        flexShrink: 1,
        color: colors.text,
        lineHeight: 24,
    },
});

export default TranslationContent;
