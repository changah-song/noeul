import { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Reader, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';

const BottomSection = ({ books, setBooks, currentBook, setHighlightedWord, settings, savedWords }) => {
    const { getCurrentLocation, goToLocation, injectJavascript } = useReader();
    const currentLocationRef = useRef(null);
    const isFirstRenderRef = useRef(true);
    const isFirstSavedWordsRef = useRef(true);
    const previousSettingsRef = useRef(settings);

    const saveCurrentLocation = () => {
        const currentLocation = getCurrentLocation();
        if (!currentLocation || !currentLocation.start) {
            console.log("[BottomSection] Failed to get current location or start CFI");
            return;
        }
        const startCfi = currentLocation.start.cfi;
        currentLocationRef.current = startCfi;
        setBooks(prevBooks => prevBooks.map(book =>
            book.uri === currentBook ? { ...book, location: startCfi } : book
        ));
        console.log(`[BottomSection] Chapter/location changed → CFI: ${startCfi}`);
    };

    const initialLocation = books.find(book => book.uri === currentBook)?.location;

    // When savedWords changes after initial mount, inject updated word list into the
    // already-running WebView without restarting the Reader
    useEffect(() => {
        if (savedWords === null) return;
        if (isFirstSavedWordsRef.current) {
            isFirstSavedWordsRef.current = false;
            return;
        }

        const filtered = savedWords.filter(Boolean);
        console.log(`[BottomSection] savedWords changed (${filtered.length} word(s)), injecting update:`, filtered);

        if (injectJavascript) {
            const script = `
                (function() {
                    if (typeof window.__updateHighlights === 'function') {
                        window.__updateHighlights(${JSON.stringify(filtered)});
                    } else {
                        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
                            JSON.stringify({ type: 'debug', msg: '__updateHighlights not defined yet' })
                        );
                    }
                })();
                true;
            `;
            injectJavascript(script);
        } else {
            console.log('[BottomSection] injectJavascript not available');
        }
    }, [savedWords]);

    // Save and restore location when settings change (but not on first render)
    useEffect(() => {
        if (isFirstRenderRef.current) {
            isFirstRenderRef.current = false;
            previousSettingsRef.current = settings;
            return;
        }

        if (JSON.stringify(previousSettingsRef.current) !== JSON.stringify(settings)) {
            const currentLocation = getCurrentLocation();
            if (currentLocation?.start?.cfi) {
                const locationToRestore = currentLocation.start.cfi;
                currentLocationRef.current = locationToRestore;

                setBooks(prevBooks => prevBooks.map(book =>
                    book.uri === currentBook ? { ...book, location: locationToRestore } : book
                ));

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

    if (!currentBook || savedWords === null) {
        return (
            <View style={styles.noBookContainer}>
                <Text style={styles.noBookText}>{!currentBook ? 'No book selected' : 'Loading...'}</Text>
            </View>
        );
    }

    const filteredSavedWords = savedWords.filter(Boolean);

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
                console.log('[BottomSection] Javascript injection started');

                // Mutable set — updated in-place via window.__updateHighlights
                var savedWordsSet = new Set(${JSON.stringify(filteredSavedWords)});
                console.log('[BottomSection] Initial saved words (' + savedWordsSet.size + '):', ${JSON.stringify(filteredSavedWords)});

                // Called from React Native via injectJavascript() when savedWords changes.
                // Receives the new array directly — no page reload needed.
                window.__updateHighlights = function(words) {
                    savedWordsSet = new Set(words.filter(Boolean));
                    highlightWords();
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'highlights-updated',
                        count: savedWordsSet.size
                    }));
                };

                // Remove all existing highlight spans, restoring plain text nodes
                function resetHighlights(doc) {
                    var spans = doc.querySelectorAll('span[data-saved-highlight]');
                    spans.forEach(function(span) {
                        var parent = span.parentNode;
                        parent.replaceChild(doc.createTextNode(span.textContent), span);
                        parent.normalize();
                    });
                }

                // Returns true if rawToken matches a saved word:
                //   1. Exact match after stripping punctuation
                //   2. Saved word is a prefix of token (e.g. "대표" matches "대표가")
                //   3. Verb stem match: strip trailing 다 (e.g. "실리다" → "실리" matches "실렸다")
                function tokenMatchesSaved(rawToken) {
                    // Strip leading/trailing non-Korean/non-alphanumeric characters (punctuation)
                    var clean = rawToken.replace(/^[^\uAC00-\uD7A3a-zA-Z0-9]+|[^\uAC00-\uD7A3a-zA-Z0-9]+$/g, '');
                    if (!clean) return false;

                    // 1. Exact match
                    if (savedWordsSet.has(clean)) return true;

                    // 2 & 3. Prefix match (only for saved words with 2+ chars to avoid false positives)
                    var iter = savedWordsSet.values();
                    var entry = iter.next();
                    while (!entry.done) {
                        var saved = entry.value;
                        if (saved.length >= 2) {
                            // Noun + particle: "대표" matches "대표가"
                            if (clean.startsWith(saved)) return true;
                            // Verb dictionary form ends in 다: stem match
                            // e.g. "실리다" → stem "실리" matches "실렸다", "실리는"
                            if (saved.length >= 3 && saved[saved.length - 1] === '\ub2e4') {
                                var stem = saved.slice(0, -1);
                                if (clean.startsWith(stem)) return true;
                            }
                        }
                        entry = iter.next();
                    }
                    return false;
                }

                // Walk text nodes and wrap saved words in highlight spans
                function applyHighlights(doc) {
                    var walker = doc.createTreeWalker(
                        doc.body,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                return node.parentNode.dataset && node.parentNode.dataset.savedHighlight
                                    ? NodeFilter.FILTER_REJECT
                                    : NodeFilter.FILTER_ACCEPT;
                            }
                        },
                        false
                    );

                    var textNodes = [];
                    var node;
                    while (node = walker.nextNode()) { textNodes.push(node); }

                    textNodes.forEach(function(node) {
                        var parts = node.textContent.split(/(\\s+)/);
                        var hasMatch = parts.some(function(p) { return p.trim() && tokenMatchesSaved(p); });
                        if (!hasMatch) return;

                        var fragment = doc.createDocumentFragment();
                        parts.forEach(function(part) {
                            if (part.trim() && tokenMatchesSaved(part)) {
                                var span = doc.createElement('span');
                                span.dataset.savedHighlight = 'true';
                                span.style.backgroundColor = 'red';
                                span.style.color = 'white';
                                span.textContent = part;
                                fragment.appendChild(span);
                            } else {
                                fragment.appendChild(doc.createTextNode(part));
                            }
                        });
                        node.parentNode.replaceChild(fragment, node);
                    });
                }

                function highlightWords() {
                    var contents = rendition.getContents();
                    if (!contents || contents.length === 0) return;
                    contents.forEach(function(content) {
                        if (content && content.document) {
                            resetHighlights(content.document);
                            applyHighlights(content.document);
                        }
                    });
                    console.log('[BottomSection] Highlighting complete, ' + savedWordsSet.size + ' saved words');
                }

                rendition.on('rendered', function() {
                    console.log('[BottomSection] Content rendered, applying highlights');
                    highlightWords();
                });

                rendition.on('relocated', function() {
                    console.log('[BottomSection] Location changed, applying highlights');
                    highlightWords();
                });

                // Listen to click events and select word
                rendition.on('click', function(e) {
                    console.log('[BottomSection] Click detected, attempting to select word');

                    var contents = rendition.getContents();
                    if (contents && contents.length > 0) {
                        var content = contents[0];
                        if (content && content.window) {
                            var selection = content.window.getSelection();
                            var doc = content.document;

                            var range = doc.caretRangeFromPoint(e.clientX, e.clientY);

                            if (range) {
                                selection.removeAllRanges();
                                selection.addRange(range);

                                selection.modify('move', 'backward', 'word');
                                selection.modify('extend', 'forward', 'word');

                                var selectedText = selection.toString().trim();
                                console.log('[BottomSection] Selected word:', selectedText);

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

                console.log('[BottomSection] Setup complete, __updateHighlights is ready');
            `}

            onWebViewMessage={(event) => {
                const raw = event?.nativeEvent?.data ?? event;
                try {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (parsed?.type === 'word-selected') {
                        console.log(`[BottomSection] Word tapped: "${parsed.text}"`);
                        setHighlightedWord(parsed.text);
                    } else if (parsed?.type === 'highlights-updated') {
                        console.log(`[BottomSection] Highlights updated successfully (${parsed.count} words)`);
                    } else if (parsed?.type === 'debug') {
                        console.log(`[BottomSection] WebView debug: ${parsed.msg}`);
                    }
                } catch (err) {
                    console.error('[BottomSection] Failed to parse WebView message:', err);
                }
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
