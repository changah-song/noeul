import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    AppState,
    Easing,
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import { fontFamilies } from '../../theme';
import { LISTEN_PITCHES, LISTEN_RATES, loadWorkingVoices } from '../../services/listenPlayer';
import { openVoiceDownload } from '../../modules/tts-voice-check/src';
import {
    SHEET_PADDING,
    SegmentedControl,
    SettingRow,
    SheetHandle,
    SheetHeader,
    createReaderSettingsControlStyles,
    createSheetChromeStyles,
} from './ReaderSettingsControls';

const MAX_HEIGHT_RATIO = 0.72;

// The speech engine's own voice downloads; Android's text-to-speech settings
// when the engine has no such page (or the build predates the native check).
const openVoiceDownloads = () => {
    if (openVoiceDownload()) return;
    Linking.sendIntent('com.android.settings.TTS_SETTINGS').catch(() => {
        Linking.openSettings().catch(() => {});
    });
};

/**
 * ListenVoiceSheet — listen mode's voice settings, opened from the speed chip
 * in the listen bar: speed, pitch, which of the phone's on-device voices
 * reads the book's language, and (when translations and meanings are read in
 * another language) which voice reads those. Tapping a voice selects it and plays a short
 * sample; "Phone default" follows whatever the phone's own setting is.
 *
 * Only voices that really speak are listed: engines also list voices they
 * never downloaded, so each is heard saying a sample first (see
 * loadWorkingVoices). With no working voice at all the list gives way to a
 * prompt to download one; "Get more voices" opens the engine's downloads, and
 * the list is checked again when the reader comes back.
 */
const ListenVoiceSheet = ({
    visible,
    onClose,
    colors,
    insets,
    locale,
    rate,
    pitch,
    voiceId,
    previewingId,
    onChangeRate,
    onChangePitch,
    onSelectVoice,
    onPreviewVoice,
    // The language translations and meanings are read in (the app's), when
    // it is not the book's; null hides that section.
    translationLocale = null,
    translationVoiceId = null,
    onSelectTranslationVoice,
    onPreviewTranslationVoice,
}) => {
    const { t } = useTranslation();
    const { height: windowHeight } = useWindowDimensions();
    const styles = useMemo(
        () => createStyles(colors, Math.round(windowHeight * MAX_HEIGHT_RATIO)),
        [colors, windowHeight]
    );
    const chrome = useMemo(() => createSheetChromeStyles(colors, insets), [colors, insets]);
    const controlStyles = useMemo(() => createReaderSettingsControlStyles(colors), [colors]);
    // { defaultVoice, voices } from loadWorkingVoices; null while checking.
    const [voices, setVoices] = useState(null);
    const [translationVoices, setTranslationVoices] = useState(null);
    // Bumped when the reader comes back to the app (from downloading a voice).
    const [recheck, setRecheck] = useState(0);

    const [mounted, setMounted] = useState(visible);
    const slideAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.timing(slideAnim, {
                toValue: 1,
                duration: 260,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 180,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }
    }, [visible, slideAnim]);

    useEffect(() => {
        if (!visible) return undefined;
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') setRecheck((value) => value + 1);
        });
        return () => subscription.remove();
    }, [visible]);

    // Re-check on every open and on coming back to the app: the reader may
    // have just downloaded a voice in the phone's settings. The two locales
    // are checked one after the other; both checks use the same engine.
    useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        setVoices(null);
        setTranslationVoices(null);
        (async () => {
            const own = await loadWorkingVoices(locale);
            if (cancelled) return;
            setVoices(own);
            if (translationLocale && translationLocale !== locale) {
                const other = await loadWorkingVoices(translationLocale);
                if (!cancelled) setTranslationVoices(other);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [visible, locale, translationLocale, recheck]);

    if (!mounted) return null;

    const rateOptions = LISTEN_RATES.map((value) => ({ value, label: t('read.listenRateValue', { rate: formatNumber(value) }) }));
    const pitchOptions = [
        { value: LISTEN_PITCHES[0], label: t('read.listenPitchLower') },
        { value: LISTEN_PITCHES[1], label: t('read.listenPitchNormal') },
        { value: LISTEN_PITCHES[2], label: t('read.listenPitchHigher') },
    ];
    // One radio list of voices: "Phone default" (when it speaks), then the
    // phone's working voices. `previewKey` keeps the two lists' sample
    // indicators apart.
    const renderVoiceList = ({ state, chosenId, onSelect, onPreview, label, previewKey }) => {
        if (state == null) {
            return (
                <>
                    <Text style={styles.sectionLabel}>{label}</Text>
                    <View style={[styles.voiceList, styles.loadingRow]}>
                        <ActivityIndicator size="small" color={colors.textTertiary} />
                        <Text style={styles.loadingText}>{t('read.listenVoiceChecking')}</Text>
                    </View>
                </>
            );
        }
        const list = state.voices;
        const defaultWorks = state.defaultVoice !== false;
        if (!defaultWorks && list.length === 0) {
            return (
                <>
                    <Text style={styles.sectionLabel}>{label}</Text>
                    <View style={styles.missingCard}>
                        <Text style={styles.missingText}>{t('read.listenVoiceMissing')}</Text>
                        <TouchableOpacity
                            style={styles.missingButton}
                            onPress={openVoiceDownloads}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={t('read.listenVoiceDownload')}
                        >
                            <Feather name="download" size={16} color={colors.surface} />
                            <Text style={styles.missingButtonLabel}>{t('read.listenVoiceDownload')}</Text>
                        </TouchableOpacity>
                    </View>
                </>
            );
        }
        const listedIds = new Set(list.map((voice) => voice.id));
        // A saved voice the phone no longer has reads with the default.
        const selectedId = chosenId && listedIds.has(chosenId) ? chosenId : null;
        const rows = [
            ...(defaultWorks ? [{ id: null, label: t('read.listenVoiceDefault') }] : []),
            ...list.map((voice) => ({
                id: voice.id,
                label: t('read.listenVoiceNumber', { number: voice.number }),
                detail: voice.gender ? t(voice.gender === 'female' ? 'read.listenVoiceFemale' : 'read.listenVoiceMale') : '',
            })),
        ];
        return (
            <>
                <Text style={styles.sectionLabel}>{label}</Text>
                <View style={styles.voiceList} accessibilityRole="radiogroup" accessibilityLabel={label}>
                    {rows.map((row, index) => {
                        const selected = row.id === selectedId;
                        const previewing = previewingId !== undefined && previewingId === `${previewKey}:${row.id}`;
                        return (
                            <TouchableOpacity
                                key={row.id ?? 'default'}
                                style={[styles.voiceRow, index > 0 && styles.voiceRowDivider]}
                                onPress={() => onSelect?.(row.id)}
                                activeOpacity={0.7}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                accessibilityLabel={row.detail ? `${row.label}, ${row.detail}` : row.label}
                            >
                                <View style={[styles.radio, selected && styles.radioSelected]} />
                                <Text style={styles.voiceLabel} numberOfLines={1}>{row.label}</Text>
                                {row.detail ? <Text style={styles.voiceDetail}>{row.detail}</Text> : null}
                                <TouchableOpacity
                                    style={styles.previewButton}
                                    onPress={() => onPreview?.(row.id)}
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('read.listenVoicePreview', { voice: row.label })}
                                >
                                    <MaterialIcons
                                        name={previewing ? 'graphic-eq' : 'play-circle-outline'}
                                        size={24}
                                        color={colors.inkSlate}
                                    />
                                </TouchableOpacity>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                {list.length === 0 ? (
                    <Text style={styles.note}>{t('read.listenVoiceNoneOffline')}</Text>
                ) : null}
            </>
        );
    };
    const sheetTranslateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] });

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.overlay}>
                <Animated.View pointerEvents="none" style={[styles.scrim, { opacity: slideAnim }]} />
                <Pressable
                    style={styles.backdrop}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                />
                <Animated.View style={[chrome.sheet, styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
                    <SheetHandle styles={chrome} />
                    <SheetHeader
                        styles={chrome}
                        colors={colors}
                        title={t('read.listenVoiceTitle')}
                        onClose={onClose}
                        closeLabel={t('common.close')}
                    />
                    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                        <SettingRow styles={controlStyles} label={t('read.listenSpeedLabel')}>
                            <SegmentedControl
                                styles={controlStyles}
                                colors={colors}
                                options={rateOptions}
                                value={rate}
                                onChange={onChangeRate}
                                accessibilityLabel={t('read.listenSpeedLabel')}
                            />
                        </SettingRow>
                        <SettingRow styles={controlStyles} label={t('read.listenPitchLabel')}>
                            <SegmentedControl
                                styles={controlStyles}
                                colors={colors}
                                options={pitchOptions}
                                value={pitch}
                                onChange={onChangePitch}
                                accessibilityLabel={t('read.listenPitchLabel')}
                            />
                        </SettingRow>

                        {renderVoiceList({
                            state: voices,
                            chosenId: voiceId,
                            onSelect: onSelectVoice,
                            onPreview: onPreviewVoice,
                            label: t('read.listenVoiceLabel'),
                            previewKey: 'book',
                        })}
                        {translationLocale && translationLocale !== locale ? renderVoiceList({
                            state: translationVoices,
                            chosenId: translationVoiceId,
                            onSelect: onSelectTranslationVoice,
                            onPreview: onPreviewTranslationVoice,
                            label: t('read.listenTranslationVoiceLabel'),
                            previewKey: 'translation',
                        }) : null}

                        <TouchableOpacity
                            style={styles.moreRow}
                            onPress={openVoiceDownloads}
                            activeOpacity={0.7}
                            accessibilityRole="link"
                            accessibilityLabel={t('read.listenVoiceMore')}
                        >
                            <View style={styles.moreText}>
                                <Text style={styles.moreLabel}>{t('read.listenVoiceMore')}</Text>
                                <Text style={styles.moreHint}>{t('read.listenVoiceMoreHint')}</Text>
                            </View>
                            <Feather name="external-link" size={16} color={colors.textSubtle} />
                        </TouchableOpacity>
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors, maxHeight = 560) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    sheet: {
        maxHeight,
    },
    body: {
        flexGrow: 0,
    },
    bodyContent: {
        paddingHorizontal: SHEET_PADDING,
        paddingTop: 4,
    },
    sectionLabel: {
        marginTop: 16,
        marginBottom: 8,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    voiceList: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.divider,
        overflow: 'hidden',
    },
    voiceRow: {
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 14,
        paddingRight: 6,
    },
    voiceRowDivider: {
        borderTopWidth: 1,
        borderTopColor: colors.divider,
    },
    radio: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: colors.surface,
    },
    radioSelected: {
        borderWidth: 6,
        borderColor: colors.inkSlate,
    },
    voiceLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    voiceDetail: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textTertiary,
    },
    previewButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingRow: {
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 14,
    },
    loadingText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    missingCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.divider,
        padding: 14,
        gap: 12,
    },
    missingText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.text,
    },
    missingButton: {
        alignSelf: 'flex-start',
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        backgroundColor: colors.inkSlate,
    },
    missingButtonLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 18,
        color: colors.surface,
    },
    note: {
        marginTop: 8,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    moreRow: {
        marginTop: 12,
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    moreText: {
        flex: 1,
    },
    moreLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    moreHint: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textTertiary,
    },
});

export default ListenVoiceSheet;
