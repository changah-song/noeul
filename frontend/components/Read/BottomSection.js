import { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Reader, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';

const BottomSection = ({
    books,
    setBooks,
    currentBook,
    setHighlightedWord,
    settings,
    savedWords,
    useHeuristicHighlighting,
    onBookTextExtracted,
    onLocationInfoChange,
    onDismissSelection,
    onBookLoadStarted,
    onBookReady,
    onBookLoadError,
}) => {
    const { getCurrentLocation, goToLocation, injectJavascript } = useReader();
    const currentLocationRef = useRef(null);
    const isFirstRenderRef = useRef(true);
    const previousSettingsRef = useRef(settings);
    const latestHighlightWordsRef = useRef([]);
    const latestHighlightModeRef = useRef(!!useHeuristicHighlighting);

    const replayHighlights = () => {
        if (!injectJavascript) {
            return;
        }

        const filtered = latestHighlightWordsRef.current.filter(Boolean);
        const mode = !!latestHighlightModeRef.current;
        const script = `
            (function() {
                if (typeof window.__setHighlightMode === 'function') {
                    window.__setHighlightMode(${JSON.stringify(mode)});
                }
                if (typeof window.__updateHighlights === 'function') {
                    window.__updateHighlights(${JSON.stringify(filtered)});
                }
            })();
            true;
        `;
        injectJavascript(script);
    };

    const saveCurrentLocation = () => {
        const currentLocation = getCurrentLocation();
        if (!currentLocation || !currentLocation.start) {
            console.log("[BottomSection] Failed to get current location or start CFI");
            return;
        }
        const startCfi = currentLocation.start.cfi;
        const displayed = currentLocation?.start?.displayed || currentLocation?.end?.displayed;
        const percentage = currentLocation?.start?.percentage ?? currentLocation?.percentage ?? null;
        const info = {
            cfi: startCfi,
            page: displayed?.page ?? null,
            total: displayed?.total ?? null,
            percentage: typeof percentage === 'number' ? percentage : null,
        };
        currentLocationRef.current = startCfi;
        setBooks(prevBooks => prevBooks.map(book =>
            book.uri === currentBook
                ? {
                    ...book,
                    location: startCfi,
                    progress: typeof info.percentage === 'number' ? info.percentage : (book.progress ?? 0),
                }
                : book
        ));
        console.log(`[BottomSection] Chapter/location changed → CFI: ${startCfi}`);
        onLocationInfoChange?.(info);
        onDismissSelection?.();

        // The visible section is most reliable once relocation has settled.
        // Replaying here catches cases where early startup passes happen
        // before the initial paginated DOM is fully ready for wrapping.
        replayHighlights();
        setTimeout(() => {
            replayHighlights();
        }, 200);
        setTimeout(() => {
            replayHighlights();
        }, 700);
    };

    const initialLocation = books.find(book => book.uri === currentBook)?.location;

    // When savedWords changes after initial mount, inject updated word list into the
    // already-running WebView without restarting the Reader
    useEffect(() => {
        if (savedWords === null) return;

        latestHighlightWordsRef.current = savedWords.filter(Boolean);
        latestHighlightModeRef.current = !!useHeuristicHighlighting;
        replayHighlights();
    }, [savedWords, injectJavascript, useHeuristicHighlighting]);

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
            enableSelection={false}
            allowScriptedContent={true}
            menuItems={[]}
            onStarted={() => {
                console.log('[BottomSection] Reader started loading book');
                onBookLoadStarted?.();
            }}
            onReady={() => {
                console.log('[BottomSection] Reader displayed book successfully');
                replayHighlights();
                setTimeout(() => {
                    replayHighlights();
                }, 300);
                setTimeout(() => {
                    replayHighlights();
                }, 900);
                setTimeout(() => {
                    replayHighlights();
                }, 1800);
                onBookReady?.();
            }}
            onRendered={() => {
                console.log('[BottomSection] Reader rendered a section, replaying highlights');
                replayHighlights();
                setTimeout(() => {
                    replayHighlights();
                }, 250);
                setTimeout(() => {
                    replayHighlights();
                }, 800);
            }}
            onDisplayError={(reason) => {
                console.error('[BottomSection] Reader failed to display book:', reason);
                onBookLoadError?.(reason);
            }}
            onLocationChange={() => { saveCurrentLocation() }}
            initialLocation={initialLocation || ""}
            defaultTheme={theme}

            injectedJavascript={`
                console.log('[BottomSection] Javascript injection started');
                var useHeuristicHighlighting = ${JSON.stringify(!!useHeuristicHighlighting)};
                var highlightRetryTimeouts = [];

                // Mutable set — updated in-place via window.__updateHighlights
                var savedWordsSet = new Set(${JSON.stringify(filteredSavedWords)});
                console.log('[BottomSection] Initial saved words (' + savedWordsSet.size + '):', ${JSON.stringify(filteredSavedWords)});

                function clearHighlightRetries() {
                    while (highlightRetryTimeouts.length) {
                        clearTimeout(highlightRetryTimeouts.pop());
                    }
                }

                // Called from React Native via injectJavascript() when savedWords changes.
                // Receives the new array directly — no page reload needed.
                window.__updateHighlights = function(words) {
                    savedWordsSet = new Set(words.filter(Boolean));
                    scheduleHighlightPasses('update');
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'highlights-updated',
                        count: savedWordsSet.size
                    }));
                };

                window.__setHighlightMode = function(useHeuristic) {
                    useHeuristicHighlighting = !!useHeuristic;
                    scheduleHighlightPasses('mode-change');
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

                // During background preprocessing we temporarily fall back to the
                // older fuzzy matcher so saved words still highlight reasonably
                // well before book_index is ready. Once preprocessing finishes,
                // React Native passes exact surface terms and turns this off.
                function tokenMatchesSaved(rawToken) {
                    var clean = rawToken.replace(/^[^\uAC00-\uD7A3a-zA-Z0-9]+|[^\uAC00-\uD7A3a-zA-Z0-9]+$/g, '');
                    if (!clean) return false;

                    if (!useHeuristicHighlighting) {
                        return savedWordsSet.has(clean);
                    }

                    if (savedWordsSet.has(clean)) return true;

                    var iter = savedWordsSet.values();
                    var entry = iter.next();
                    while (!entry.done) {
                        var saved = entry.value;
                        if (saved.length >= 2) {
                            if (clean.startsWith(saved)) return true;

                            if (saved.length >= 3 && saved[saved.length - 1] === '\ub2e4') {
                                var stem = saved.slice(0, -1);
                                if (clean.startsWith(stem)) return true;

                                if (stem[stem.length - 1] === '\ud558') {
                                    var haeStem = stem.slice(0, -1) + '\ud574';
                                    if (clean.startsWith(haeStem)) return true;
                                }
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
                                span.style.backgroundColor = 'rgba(214, 190, 148, 0.42)';
                                span.style.color = '#4f4031';
                                span.style.borderRadius = '3px';
                                span.style.boxShadow = 'inset 0 -1px 0 rgba(110, 98, 85, 0.28)';
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
                    if (!contents || contents.length === 0) {
                        console.log('[BottomSection] highlightWords skipped — no rendered contents yet');
                        return false;
                    }
                    contents.forEach(function(content) {
                        if (content && content.document) {
                            resetHighlights(content.document);
                            applyHighlights(content.document);
                        }
                    });
                    console.log('[BottomSection] Highlighting complete, ' + savedWordsSet.size + ' saved words');
                    return true;
                }

                function scheduleHighlightPasses(reason) {
                    clearHighlightRetries();

                    var delays = [0, 120, 320, 700, 1300, 2200];
                    delays.forEach(function(delay) {
                        var timeoutId = setTimeout(function() {
                            try {
                                var applied = highlightWords();
                                if (applied) {
                                    console.log('[BottomSection] Highlight pass succeeded (' + reason + ') after ' + delay + 'ms');
                                }
                            } catch (e) {
                                console.log('[BottomSection] Highlight pass failed (' + reason + '):', String(e));
                            }
                        }, delay);
                        highlightRetryTimeouts.push(timeoutId);
                    });
                }

                rendition.on('rendered', function() {
                    console.log('[BottomSection] Content rendered, applying highlights');
                    scheduleHighlightPasses('rendered');
                });

                // The 'rendered' event may already have fired before this script
                // was injected. Apply highlights immediately for the already-
                // displayed chapter as soon as the bridge is set up.
                scheduleHighlightPasses('initial-setup');

                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'highlight-bridge-ready'
                }));

                // ── Book Text Extraction ──────────────────────────────────────
                // Called once after the book is ready to extract all text from
                // every spine item (chapter) for backend preprocessing.
                // Each section is loaded, text is grabbed, then unloaded to free memory.
                async function extractAllBookText() {
                    var allText = [];
                    var spineItems = rendition.book.spine.items;
                    var diagnostics = [];

                    var parser = new DOMParser();
                    for (var i = 0; i < spineItems.length; i++) {
                        var item = spineItems[i];
                        var href = item.href || item.url || null;
                        if (!href) {
                            diagnostics.push({ i: i, error: 'no href on spine item' });
                            continue;
                        }
                        try {
                            var raw = await rendition.book.load(href);
                            // raw may be a string (XML/HTML) or already a Document
                            var doc = (typeof raw === 'string')
                                ? parser.parseFromString(raw, 'application/xhtml+xml')
                                : (raw.document || raw);
                            var bodyEl = doc.body || doc.querySelector('body') || doc.documentElement;
                            var text = bodyEl ? (bodyEl.textContent || '') : '';
                            diagnostics.push({ i: i, href: href, chars: text.length });
                            if (text.length > 0) allText.push(text);
                        } catch (err) {
                            diagnostics.push({ i: i, href: href, error: String(err) });
                        }
                    }

                    var combined = allText.join(' ');

                    // Send diagnostics first so they appear even if text is empty
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'extraction-diagnostics',
                        spineCount: spineItems.length,
                        items: diagnostics,
                        totalChars: combined.length,
                    }));

                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'book-text-extracted',
                        text: combined,
                    }));
                }

                // Trigger extraction once the book's spine is fully loaded
                rendition.book.ready.then(function() {
                    console.log('[BottomSection] Book ready, triggering text extraction');
                    extractAllBookText();
                });

                rendition.on('relocated', function() {
                    console.log('[BottomSection] Location changed, applying highlights');
                    scheduleHighlightPasses('relocated');
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'dismiss-selection'
                    }));
                });

                // Listen to click events and select word
                function getMatchingContent(doc) {
                    var contents = rendition.getContents() || [];
                    for (var i = 0; i < contents.length; i++) {
                        if (contents[i] && contents[i].document === doc) {
                            return contents[i];
                        }
                    }
                    return contents[0] || null;
                }

                function extractWordFromRange(doc, range) {
                    if (!range) return '';
                    try {
                        var selection = doc.defaultView.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                        selection.modify('move', 'backward', 'word');
                        selection.modify('extend', 'forward', 'word');
                        var text = selection.toString().trim();
                        selection.removeAllRanges();
                        return text;
                    } catch (err) {
                        return '';
                    }
                }

                rendition.on('click', function(e) {
                    console.log('[BottomSection] Click detected, attempting to select word');

                    var target = e.target || null;
                    var doc = target && target.ownerDocument ? target.ownerDocument : null;
                    var content = doc ? getMatchingContent(doc) : null;
                    if (!content || !content.window || !doc) {
                        onDismissSelection?.();
                        return;
                    }

                    if (target && target.dataset && target.dataset.savedHighlight) {
                        var highlightedText = (target.textContent || '').trim();
                        if (highlightedText) {
                            window.ReactNativeWebView.postMessage(JSON.stringify({
                                type: 'word-selected',
                                text: highlightedText
                            }));
                            return;
                        }
                    }

                    var selectedText = '';
                    var range = null;

                    if (typeof doc.caretRangeFromPoint === 'function') {
                        range = doc.caretRangeFromPoint(e.clientX, e.clientY);
                        selectedText = extractWordFromRange(doc, range);
                    }

                    if (!selectedText && typeof doc.caretPositionFromPoint === 'function') {
                        var position = doc.caretPositionFromPoint(e.clientX, e.clientY);
                        if (position && position.offsetNode) {
                            range = doc.createRange();
                            range.setStart(position.offsetNode, position.offset);
                            range.setEnd(position.offsetNode, position.offset);
                            selectedText = extractWordFromRange(doc, range);
                        }
                    }

                    selectedText = selectedText.trim();
                    console.log('[BottomSection] Selected word:', selectedText);

                    if (selectedText) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'word-selected',
                            text: selectedText
                        }));
                    } else {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'dismiss-selection'
                        }));
                    }
                });

                console.log('[BottomSection] Setup complete, __updateHighlights is ready');
            `}

            onWebViewMessage={(event) => {
                const raw = event?.nativeEvent?.data ?? event;
                try {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (parsed?.type === 'extraction-diagnostics') {
                        console.log(`[BottomSection] Extraction diagnostics — spineCount: ${parsed.spineCount}, totalChars: ${parsed.totalChars}`);
                        (parsed.items || []).forEach(item => {
                            if (item.error) {
                                console.log(`  [spine ${item.i}] ERROR: ${item.error}`);
                            } else {
                                console.log(`  [spine ${item.i}] href=${item.href} | hasBody=${item.hasBody} | docElTag=${item.docElTag} | chars=${item.chars}`);
                            }
                        });
                    } else if (parsed?.type === 'word-selected') {
                        console.log(`[BottomSection] Word tapped: "${parsed.text}"`);
                        setHighlightedWord(parsed.text);
                    } else if (parsed?.type === 'dismiss-selection') {
                        console.log('[BottomSection] Dismissing selection');
                        onDismissSelection?.();
                    } else if (parsed?.type === 'book-text-extracted') {
                        // Full book text arrived — hand it off to Read.js to trigger preprocessing
                        console.log(`[BottomSection] Received extracted text (${parsed.text?.length?.toLocaleString()} chars), forwarding to parent`);
                        onBookTextExtracted?.(parsed.text);
                    } else if (parsed?.type === 'highlights-updated') {
                        console.log(`[BottomSection] Highlights updated successfully (${parsed.count} words)`);
                    } else if (parsed?.type === 'highlight-bridge-ready') {
                        console.log('[BottomSection] Highlight bridge ready, replaying latest highlight payload');
                        replayHighlights();
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
