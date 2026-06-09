import { useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Reader, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import { useTranslation } from '../../hooks/useTranslation';

const BottomSection = ({
    books,
    setBooks,
    currentBook,
    setHighlightedWord,
    activeLookupText,
    focusMode,
    settings,
    savedWords,
    useHeuristicHighlighting,
    onBookTextExtracted,
    onLocationInfoChange,
    onDismissSelection,
    onBookLoadStarted,
    onBookReady,
    onBookLoadError,
    onNativeTextSelected,
    onLookupPlacementChange,
    onTocChange,
    navigationRef,
}) => {
    const { t } = useTranslation();
    const { getCurrentLocation, goToLocation, injectJavascript } = useReader();
    const currentLocationRef = useRef(null);
    const pendingLocationRestoreRef = useRef('');
    const isFirstRenderRef = useRef(true);
    const previousSettingsRef = useRef(settings);
    const latestHighlightWordsRef = useRef([]);
    const latestHighlightModeRef = useRef(!!useHeuristicHighlighting);
    const latestDarkModeRef = useRef(!!settings.isDarkMode);
    const pendingNativeSelectionTextRef = useRef('');
    const nativeSelectionActiveRef = useRef(false);
    const nativeSelectionTimeoutRef = useRef(null);

    const replayHighlights = () => {
        if (!injectJavascript) {
            return;
        }

        const filtered = latestHighlightWordsRef.current.filter(Boolean);
        const mode = !!latestHighlightModeRef.current;
        const darkMode = !!latestDarkModeRef.current;
        const script = `
            (function() {
                if (typeof window.__setHighlightMode === 'function') {
                    window.__setHighlightMode(${JSON.stringify(mode)});
                }
                if (typeof window.__setHighlightDarkMode === 'function') {
                    window.__setHighlightDarkMode(${JSON.stringify(darkMode)});
                }
                if (typeof window.__updateHighlights === 'function') {
                    window.__updateHighlights(${JSON.stringify(filtered)});
                }
            })();
            true;
        `;
        injectJavascript(script);
    };

    const clearNativeSelection = useCallback(() => {
        if (!injectJavascript) {
            return;
        }

        injectJavascript(`
            (function() {
                try {
                    var contents = rendition.getContents() || [];
                    contents.forEach(function(c) {
                        if (!c || !c.document) return;
                        var sel = typeof c.document.getSelection === 'function'
                            ? c.document.getSelection()
                            : (c.document.defaultView && c.document.defaultView.getSelection
                                ? c.document.defaultView.getSelection()
                                : null);
                        if (sel) sel.removeAllRanges();
                    });
                } catch (e) {}
            })();
            true;
        `);
    }, [injectJavascript]);

    const clearActiveTapHighlight = useCallback(() => {
        if (!injectJavascript) {
            return;
        }

        injectJavascript(`
            (function() {
                try {
                    if (typeof window.__clearActiveTapHighlight === 'function') {
                        window.__clearActiveTapHighlight();
                    }
                } catch (e) {}
            })();
            true;
        `);
    }, [injectJavascript]);

    useEffect(() => {
        return () => {
            if (nativeSelectionTimeoutRef.current) {
                clearTimeout(nativeSelectionTimeoutRef.current);
            }
        };
    }, []);

    const saveCurrentLocation = () => {
        const currentLocation = getCurrentLocation();
        if (!currentLocation || !currentLocation.start) {
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
            href: currentLocation?.start?.href ?? currentLocation?.end?.href ?? null,
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
        onLocationInfoChange?.(info);
        clearNativeSelection();
        clearActiveTapHighlight();
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

    const restoreReaderLocation = useCallback((cfi, delay = 200) => {
        if (!cfi) {
            return;
        }

        currentLocationRef.current = cfi;
        pendingLocationRestoreRef.current = cfi;

        setBooks(prevBooks => prevBooks.map(book =>
            book.uri === currentBook ? { ...book, location: cfi } : book
        ));

        setTimeout(() => {
            if (goToLocation) {
                goToLocation(cfi);
            }
        }, delay);
    }, [currentBook, goToLocation, setBooks]);

    const initialLocation = books.find(book => book.uri === currentBook)?.location;

    useEffect(() => {
        if (!navigationRef) {
            return;
        }

        navigationRef.current = {
            goToHref: (href) => {
                if (href && goToLocation) {
                    goToLocation(href);
                }
            },
        };

        return () => {
            if (navigationRef.current?.goToHref) {
                navigationRef.current = null;
            }
        };
    }, [goToLocation, navigationRef]);

    // When savedWords changes after initial mount, inject updated word list into the
    // already-running WebView without restarting the Reader
    useEffect(() => {
        if (savedWords === null) return;

        latestHighlightWordsRef.current = savedWords.filter(Boolean);
        latestHighlightModeRef.current = !!useHeuristicHighlighting;
        latestDarkModeRef.current = !!settings.isDarkMode;
        replayHighlights();
    }, [savedWords, injectJavascript, settings.isDarkMode, useHeuristicHighlighting]);

    useEffect(() => {
        if (!activeLookupText) {
            clearActiveTapHighlight();
        }
    }, [activeLookupText, clearActiveTapHighlight]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            replayHighlights();
        }, 120);

        return () => clearTimeout(timeoutId);
    }, [focusMode]);

    // Save and restore location when settings change (but not on first render)
    useEffect(() => {
        if (isFirstRenderRef.current) {
            isFirstRenderRef.current = false;
            previousSettingsRef.current = settings;
            return;
        }

        let settleTimeout;

        if (JSON.stringify(previousSettingsRef.current) !== JSON.stringify(settings)) {
            const currentLocation = getCurrentLocation();
            const locationToRestore =
                currentLocation?.start?.cfi ||
                currentLocationRef.current ||
                initialLocation ||
                '';

            if (locationToRestore) {
                restoreReaderLocation(locationToRestore);
            }

            // Page turns can still be settling when a theme toggle happens.
            // Re-read shortly after and prefer the newer CFI if it has advanced.
            settleTimeout = setTimeout(() => {
                const settledLocation = getCurrentLocation()?.start?.cfi;
                if (settledLocation && settledLocation !== pendingLocationRestoreRef.current) {
                    restoreReaderLocation(settledLocation, 60);
                }
            }, 220);

            previousSettingsRef.current = settings;
        }
        return () => {
            if (settleTimeout) {
                clearTimeout(settleTimeout);
            }
        };
    }, [settings, getCurrentLocation, initialLocation, restoreReaderLocation]);

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
                <Text style={styles.noBookText}>{!currentBook ? t('read.noBook') : t('common.loading')}</Text>
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
            onStarted={() => {
                onBookLoadStarted?.();
            }}
            onReady={() => {
                if (pendingLocationRestoreRef.current) {
                    restoreReaderLocation(pendingLocationRestoreRef.current, 60);
                    setTimeout(() => {
                        if (pendingLocationRestoreRef.current) {
                            restoreReaderLocation(pendingLocationRestoreRef.current, 220);
                        }
                    }, 140);
                    setTimeout(() => {
                        pendingLocationRestoreRef.current = '';
                    }, 420);
                }
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
            onNavigationLoaded={({ toc }) => {
                onTocChange?.(Array.isArray(toc) ? toc : []);
            }}
            onRendered={() => {
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
            onSelected={(text) => {
                const selectedText = String(text || '').trim();
                if (selectedText.length > 1) {
                    nativeSelectionActiveRef.current = true;
                    if (nativeSelectionTimeoutRef.current) {
                        clearTimeout(nativeSelectionTimeoutRef.current);
                    }
                    nativeSelectionTimeoutRef.current = setTimeout(() => {
                        nativeSelectionActiveRef.current = false;
                        nativeSelectionTimeoutRef.current = null;
                    }, 1000);

                    if (injectJavascript) {
                        injectJavascript(
                            'window.__nativeSelectionActive = true;' +
                            'setTimeout(function(){ window.__nativeSelectionActive = false; }, 600);' +
                            'true;'
                        );
                    }
                    pendingNativeSelectionTextRef.current = selectedText;
                    onLookupPlacementChange?.('bottom');
                    onNativeTextSelected?.(selectedText);

                    if (injectJavascript) {
                        injectJavascript(`
                            (function() {
                                try {
                                    var placement = 'bottom';
                                    var contents = rendition.getContents() || [];

                                    for (var i = 0; i < contents.length; i++) {
                                        var c = contents[i];
                                        if (!c || !c.document) continue;

                                        var doc = c.document;
                                        var sel = typeof doc.getSelection === 'function'
                                            ? doc.getSelection()
                                            : (doc.defaultView && doc.defaultView.getSelection
                                                ? doc.defaultView.getSelection()
                                                : null);

                                        if (!sel || sel.rangeCount === 0) continue;

                                        var text = sel.toString ? sel.toString().trim() : '';
                                        if (text.length <= 1) continue;

                                        var range = sel.getRangeAt(0);
                                        var rect = range.getBoundingClientRect ? range.getBoundingClientRect() : null;
                                        var viewportHeight = (doc.defaultView && doc.defaultView.innerHeight) || window.innerHeight || 0;

                                        if (rect && viewportHeight) {
                                            var selectionMidY = rect.top + (rect.height / 2);
                                            placement = selectionMidY > (viewportHeight / 2) ? 'top' : 'bottom';
                                        }
                                        break;
                                    }

                                    window.ReactNativeWebView.postMessage(JSON.stringify({
                                        type: 'native-selection',
                                        placement: placement
                                    }));
                                } catch (e) {
                                    window.ReactNativeWebView.postMessage(JSON.stringify({
                                        type: 'native-selection',
                                        placement: 'bottom'
                                    }));
                                }
                            })();
                            true;
                        `);
                    }
                }
            }}
            onLocationChange={() => { saveCurrentLocation() }}
            initialLocation={initialLocation || ""}
            defaultTheme={theme}

            injectedJavascript={`
                var useHeuristicHighlighting = ${JSON.stringify(!!useHeuristicHighlighting)};
                var useDarkHighlightTheme = ${JSON.stringify(!!settings.isDarkMode)};
                var highlightRetryTimeouts = [];
                window.__nativeSelectionActive = false;

                // Mutable set — updated in-place via window.__updateHighlights
                var savedWordsSet = new Set(${JSON.stringify(filteredSavedWords)});

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

                window.__setHighlightDarkMode = function(isDarkMode) {
                    useDarkHighlightTheme = !!isDarkMode;
                    scheduleHighlightPasses('theme-change');
                };

                function clearActiveTapHighlight() {
                    var contents = rendition.getContents() || [];
                    contents.forEach(function(content) {
                        if (!content || !content.document) return;
                        var doc = content.document;
                        var spans = doc.querySelectorAll('span[data-active-tap-highlight]');
                        spans.forEach(function(span) {
                            var parent = span.parentNode;
                            if (!parent) return;
                            while (span.firstChild) {
                                parent.insertBefore(span.firstChild, span);
                            }
                            parent.removeChild(span);
                            parent.normalize();
                        });
                    });
                }

                function applyActiveTapHighlight(doc, range) {
                    clearActiveTapHighlight();
                    if (!doc || !range) return false;
                    try {
                        var text = range.toString ? range.toString().trim() : '';
                        if (!text) return false;

                        var span = doc.createElement('span');
                        span.dataset.activeTapHighlight = 'true';
                        span.style.backgroundColor = useDarkHighlightTheme
                            ? 'rgba(117, 138, 170, 0.24)'
                            : 'rgba(188, 204, 194, 0.32)';
                        span.style.borderRadius = '3px';
                        span.style.boxShadow = useDarkHighlightTheme
                            ? 'inset 0 -1px 0 rgba(166, 188, 214, 0.18)'
                            : 'inset 0 -1px 0 rgba(134, 154, 142, 0.18)';
                        range.surroundContents(span);
                        return true;
                    } catch (e) {
                        return false;
                    }
                }

                window.__clearActiveTapHighlight = clearActiveTapHighlight;

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
                                span.style.backgroundColor = useDarkHighlightTheme
                                    ? 'rgba(198, 160, 100, 0.34)'
                                    : 'rgba(214, 190, 148, 0.42)';
                                span.style.color = useDarkHighlightTheme ? '#f6ead7' : '#4f4031';
                                span.style.borderRadius = '3px';
                                span.style.boxShadow = useDarkHighlightTheme
                                    ? 'inset 0 -1px 0 rgba(242, 219, 176, 0.24)'
                                    : 'inset 0 -1px 0 rgba(110, 98, 85, 0.28)';
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
                        return false;
                    }
                    contents.forEach(function(content) {
                        if (content && content.document) {
                            resetHighlights(content.document);
                            applyHighlights(content.document);
                        }
                    });
                    return true;
                }

                function scheduleHighlightPasses(reason) {
                    clearHighlightRetries();

                    var delays = [0, 120, 320, 700, 1300, 2200];
                    delays.forEach(function(delay) {
                        var timeoutId = setTimeout(function() {
                            try {
                                highlightWords();
                            } catch (e) {
                            }
                        }, delay);
                        highlightRetryTimeouts.push(timeoutId);
                    });
                }

                rendition.on('rendered', function() {
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
                    extractAllBookText();
                });

                rendition.on('relocated', function() {
                    scheduleHighlightPasses('relocated');
                    clearActiveTapHighlight();
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
                        var selectedRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
                        selection.removeAllRanges();
                        return {
                            text: text,
                            range: selectedRange
                        };
                    } catch (err) {
                        return {
                            text: '',
                            range: null
                        };
                    }
                }

                function getPlacementForClientY(clientY, doc) {
                    var view = (doc && doc.defaultView) ? doc.defaultView : window;
                    var innerHeight = view && view.innerHeight ? view.innerHeight : window.innerHeight;
                    return clientY > (innerHeight / 2) ? 'top' : 'bottom';
                }

                rendition.on('click', function(e) {
                    if (window.__nativeSelectionActive) {
                        return;
                    }

                    var target = e.target || null;
                    var doc = target && target.ownerDocument ? target.ownerDocument : null;
                    var content = doc ? getMatchingContent(doc) : null;
                    if (!content || !content.window || !doc) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'dismiss-selection'
                        }));
                        return;
                    }

                    var existingSelection = typeof doc.getSelection === 'function'
                        ? doc.getSelection()
                        : (doc.defaultView && doc.defaultView.getSelection
                            ? doc.defaultView.getSelection()
                            : null);
                    if (existingSelection && !window.__nativeSelectionActive) {
                        existingSelection.removeAllRanges();
                    }
                    clearActiveTapHighlight();

                    if (target && target.dataset && target.dataset.savedHighlight) {
                        var highlightedText = (target.textContent || '').trim();
                        if (highlightedText) {
                            window.ReactNativeWebView.postMessage(JSON.stringify({
                                type: 'word-selected',
                                text: highlightedText,
                                placement: getPlacementForClientY(e.clientY, doc)
                            }));
                            return;
                        }
                    }

                    var selectedText = '';
                    var selectedWordRange = null;
                    var range = null;

                    if (typeof doc.caretRangeFromPoint === 'function') {
                        range = doc.caretRangeFromPoint(e.clientX, e.clientY);
                        var extracted = extractWordFromRange(doc, range);
                        selectedText = extracted.text;
                        selectedWordRange = extracted.range;
                    }

                    if (!selectedText && typeof doc.caretPositionFromPoint === 'function') {
                        var position = doc.caretPositionFromPoint(e.clientX, e.clientY);
                        if (position && position.offsetNode) {
                            range = doc.createRange();
                            range.setStart(position.offsetNode, position.offset);
                            range.setEnd(position.offsetNode, position.offset);
                            var fallbackExtracted = extractWordFromRange(doc, range);
                            selectedText = fallbackExtracted.text;
                            selectedWordRange = fallbackExtracted.range;
                        }
                    }

                    selectedText = selectedText.trim();

                    if (selectedText) {
                        if (!savedWordsSet.has(selectedText) && selectedWordRange) {
                            applyActiveTapHighlight(doc, selectedWordRange);
                        }
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'word-selected',
                            text: selectedText,
                            placement: getPlacementForClientY(e.clientY, doc)
                        }));
                    } else {
                        clearActiveTapHighlight();
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'dismiss-selection'
                        }));
                    }
                });
            `}

            onWebViewMessage={(event) => {
                    const raw = event?.nativeEvent?.data ?? event;
                try {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (parsed?.type === 'extraction-diagnostics') {
                        return;
                    } else if (parsed?.type === 'word-selected') {
                        if (nativeSelectionActiveRef.current) {
                            return;
                        }
                        if (parsed?.placement === 'top' || parsed?.placement === 'bottom') {
                            onLookupPlacementChange?.(parsed.placement);
                        }
                        setHighlightedWord(parsed.text);
                    } else if (parsed?.type === 'dismiss-selection') {
                        if (nativeSelectionActiveRef.current) {
                            return;
                        }
                        pendingNativeSelectionTextRef.current = '';
                        clearNativeSelection();
                        clearActiveTapHighlight();
                        onDismissSelection?.();
                    } else if (parsed?.type === 'native-selection') {
                        if (parsed?.placement === 'top' || parsed?.placement === 'bottom') {
                            onLookupPlacementChange?.(parsed.placement);
                        }
                    } else if (parsed?.type === 'book-text-extracted') {
                        // Full book text arrived — hand it off to Read.js to trigger preprocessing
                        onBookTextExtracted?.(parsed.text);
                    } else if (parsed?.type === 'highlights-updated') {
                        return;
                    } else if (parsed?.type === 'highlight-bridge-ready') {
                        replayHighlights();
                    } else if (parsed?.type === 'debug') {
                        return;
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
