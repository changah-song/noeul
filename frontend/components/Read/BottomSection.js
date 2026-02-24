import { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Reader, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';

const BottomSection = ({ books, setBooks, currentBook, setHighlightedWord, settings }) => {
    const { getCurrentLocation, goToLocation } = useReader();
    const currentLocationRef = useRef(null);
    const isFirstRenderRef = useRef(true);
    const previousSettingsRef = useRef(settings);

    const saveCurrentLocation = () => {
        const currentLocation = getCurrentLocation();
        if (!currentLocation || !currentLocation.start) {
            console.log("Failed to get current location or start CFI");
            return;
        }
        const startCfi = currentLocation.start.cfi;
        currentLocationRef.current = startCfi;
        setBooks(prevBooks => prevBooks.map(book =>
            book.uri === currentBook ? { ...book, location: startCfi } : book
        ));
        console.log('current location', startCfi);
    };

    const initialLocation = books.find(book => book.uri === currentBook)?.location;

    // Save and restore location when settings change (but not on first render)
    useEffect(() => {
        if (isFirstRenderRef.current) {
            isFirstRenderRef.current = false;
            previousSettingsRef.current = settings;
            return;
        }

        // Check if settings actually changed
        if (JSON.stringify(previousSettingsRef.current) !== JSON.stringify(settings)) {
            // Save current location immediately to books state
            const currentLocation = getCurrentLocation();
            if (currentLocation?.start?.cfi) {
                const locationToRestore = currentLocation.start.cfi;
                currentLocationRef.current = locationToRestore;

                // Update books state immediately so initialLocation is current
                setBooks(prevBooks => prevBooks.map(book =>
                    book.uri === currentBook ? { ...book, location: locationToRestore } : book
                ));

                // Also restore via goToLocation after Reader re-renders
                setTimeout(() => {
                    if (goToLocation) {
                        goToLocation(locationToRestore);
                    }
                }, 200);
            }
            previousSettingsRef.current = settings;
        }
    }, [settings, getCurrentLocation, goToLocation, setBooks, currentBook]);

    const theme = useMemo(() => ({
        body: {
            background: settings.isDarkMode ? '#1f2937' : '#ffffff',
            color: settings.isDarkMode ? '#f3f4f6' : '#1f2937',
            'font-size': `${settings.fontSize}px !important`,
        },
        p: {
            'line-height': `${settings.lineSpacing} !important`,
            'font-size': `${settings.fontSize}px !important`,
        },
        div: {
            'font-size': `${settings.fontSize}px !important`,
        },
        span: {
            'font-size': `${settings.fontSize}px !important`,
        }
    }), [settings.isDarkMode, settings.fontSize, settings.lineSpacing]);

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
    );
};

const styles = StyleSheet.create({
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

export default BottomSection;