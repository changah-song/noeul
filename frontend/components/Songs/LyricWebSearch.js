import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { useTheme } from '../../theme';

// When the song search has nothing, the reader finds the lyrics on the web
// themselves: a Google search for the song opens in this in-app browser, they
// select the lyrics on any page, and "Use selected text" brings the selection
// back into the song editor (no copy, switch and paste).

const LYRICS_WORD = { ko: '가사', zh: '歌词', ja: '歌詞' };

export const lyricSearchUrl = (query, language) => {
    const words = [String(query || '').trim(), LYRICS_WORD[language] || 'lyrics']
        .filter(Boolean)
        .join(' ');
    return `https://www.google.com/search?q=${encodeURIComponent(words)}`;
};

// Hands the page's selected text back; page text from inputs and textareas
// counts too, where getSelection() is empty.
const READ_SELECTION = `(function () {
  var text = '';
  try {
    text = String(window.getSelection ? window.getSelection() : '');
    var el = document.activeElement;
    if (!text && el && typeof el.value === 'string' && el.selectionEnd > el.selectionStart) {
      text = el.value.slice(el.selectionStart, el.selectionEnd);
    }
  } catch (e) {}
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'selection', text: text }));
})(); true;`;

const cleanSelection = (text) => String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const LyricWebSearch = ({ visible, query, language, onClose, onUseText }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const insets = useSafeAreaInsets();
    const webViewRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [canGoBack, setCanGoBack] = useState(false);
    const source = useMemo(() => ({ uri: lyricSearchUrl(query, language) }), [language, query]);

    const handleMessage = useCallback((event) => {
        let message;
        try {
            message = JSON.parse(event?.nativeEvent?.data || '{}');
        } catch (_error) {
            return;
        }
        if (message.type !== 'selection') return;
        const text = cleanSelection(message.text);
        if (!text) {
            Alert.alert(t('song.web.title'), t('song.web.selectFirst'));
            return;
        }
        onUseText?.(text);
    }, [onUseText, t]);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
            <View style={[styles.screen, { paddingTop: insets.top }]}>
                <View style={styles.header}>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                        onPress={onClose}
                        style={styles.iconButton}
                    >
                        <Feather name="x" size={22} color={colors.inkSlate} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={t('common.back')}
                        accessibilityState={{ disabled: !canGoBack }}
                        disabled={!canGoBack}
                        onPress={() => webViewRef.current?.goBack()}
                        style={[styles.iconButton, !canGoBack && styles.disabled]}
                    >
                        <Feather name="chevron-left" size={22} color={colors.inkSlate} />
                    </TouchableOpacity>
                    <Text style={styles.title} numberOfLines={1}>{t('song.web.title')}</Text>
                    {loading ? <ActivityIndicator size="small" color={colors.inkSlate} /> : <View style={styles.spinnerSpace} />}
                </View>
                <WebView
                    ref={webViewRef}
                    source={source}
                    style={styles.webView}
                    onLoadStart={() => setLoading(true)}
                    onLoadEnd={() => setLoading(false)}
                    onNavigationStateChange={(state) => setCanGoBack(Boolean(state.canGoBack))}
                    onMessage={handleMessage}
                    // No pop-up windows: links that would open one load here.
                    setSupportMultipleWindows={false}
                    javaScriptEnabled
                    domStorageEnabled
                    allowsBackForwardNavigationGestures
                />
                <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
                    <Text style={styles.hint}>{t('song.web.hint')}</Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => webViewRef.current?.injectJavaScript(READ_SELECTION)}
                        style={styles.useButton}
                        activeOpacity={0.85}
                    >
                        <Feather name="corner-down-left" size={18} color={colors.readerPaper} />
                        <Text style={styles.useButtonText}>{t('song.web.useSelection')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.readerPaper,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.readerHairline,
    },
    iconButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabled: {
        opacity: 0.35,
    },
    title: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: colors.inkSlate,
        marginLeft: 4,
    },
    spinnerSpace: {
        width: 20,
    },
    webView: {
        flex: 1,
    },
    footer: {
        paddingHorizontal: 16,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.readerHairline,
        backgroundColor: colors.readerPaper,
        gap: 8,
    },
    hint: {
        fontSize: 13,
        color: colors.readerMutedInk,
        textAlign: 'center',
    },
    useButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 48,
        borderRadius: 14,
        backgroundColor: colors.inkSlate,
    },
    useButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.readerPaper,
    },
});

export default LyricWebSearch;
