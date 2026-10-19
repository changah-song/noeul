import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
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
import { fontFamilies, radii, spacing } from '../../theme';
import { LISTEN_PITCHES, LISTEN_RATES, loadOnDeviceVoices } from '../../services/listenPlayer';
import { SegmentedControl, createReaderSettingsControlStyles } from './ReaderSettingsControls';

const MAX_HEIGHT_RATIO = 0.72;

// Android's text-to-speech settings: pick the engine, download more voices.
const openTtsSettings = () => {
    Linking.sendIntent('com.android.settings.TTS_SETTINGS').catch(() => {
        Linking.openSettings().catch(() => {});
    });
};

/**
 * ListenVoiceSheet — listen mode's voice settings, opened from the speed chip
 * in the listen bar: speed, pitch, and which of the phone's on-device voices
 * reads the book's language. Tapping a voice selects it and plays a short
 * sample; "Phone default" follows whatever the phone's own setting is.
 *
 * Only voices already on the phone and usable offline are listed (see
 * onDeviceVoicesFor); "Get more voices" opens Android's text-to-speech
 * settings, where the reader can download more for free.
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
}) => {
    const { t } = useTranslation();
    const { height: windowHeight } = useWindowDimensions();
    const styles = useMemo(
        () => createStyles(colors, insets, Math.round(windowHeight * MAX_HEIGHT_RATIO)),
        [colors, insets, windowHeight]
    );
    const controlStyles = useMemo(() => createReaderSettingsControlStyles(colors), [colors]);
    const [voices, setVoices] = useState(null);

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

    // Re-read the list on every open: the reader may have just downloaded a
    // voice in the phone's settings.
    useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        setVoices(null);
        loadOnDeviceVoices(locale).then((list) => {
            if (!cancelled) setVoices(list);
        });
        return () => {
            cancelled = true;
        };
    }, [visible, locale]);

    if (!mounted) return null;

    const rateOptions = LISTEN_RATES.map((value) => ({ value, label: `${value}×` }));
    const pitchOptions = [
        { value: LISTEN_PITCHES[0], label: t('read.listenPitchLower') },
        { value: LISTEN_PITCHES[1], label: t('read.listenPitchNormal') },
        { value: LISTEN_PITCHES[2], label: t('read.listenPitchHigher') },
    ];
    const listedIds = new Set((voices || []).map((voice) => voice.id));
    // A saved voice the phone no longer has reads with the default.
    const selectedId = voiceId && (voices == null || listedIds.has(voiceId)) ? voiceId : null;
    const rows = [
        { id: null, label: t('read.listenVoiceDefault') },
        ...(voices || []).map((voice) => ({
            id: voice.id,
            label: t('read.listenVoiceNumber', { number: voice.number }),
            detail: voice.gender ? t(voice.gender === 'female' ? 'read.listenVoiceFemale' : 'read.listenVoiceMale') : '',
        })),
    ];
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
                <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
                    <View style={styles.handleWrap}>
                        <View style={styles.handle} />
                    </View>
                    <View style={styles.header}>
                        <Text style={styles.title} numberOfLines={1}>{t('read.listenVoiceTitle')}</Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={t('common.close')}
                        >
                            <Feather name="x" size={20} color={colors.readerMutedInk} />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                        <View style={styles.settingRow}>
                            <Text style={styles.settingLabel}>{t('read.listenSpeedLabel')}</Text>
                            <SegmentedControl
                                styles={controlStyles}
                                colors={colors}
                                options={rateOptions}
                                value={rate}
                                onChange={onChangeRate}
                                accessibilityLabel={t('read.listenSpeedLabel')}
                            />
                        </View>
                        <View style={styles.settingRow}>
                            <Text style={styles.settingLabel}>{t('read.listenPitchLabel')}</Text>
                            <SegmentedControl
                                styles={controlStyles}
                                colors={colors}
                                options={pitchOptions}
                                value={pitch}
                                onChange={onChangePitch}
                                accessibilityLabel={t('read.listenPitchLabel')}
                            />
                        </View>

                        <Text style={styles.sectionLabel}>{t('read.listenVoiceLabel')}</Text>
                        <View style={styles.voiceList} accessibilityRole="radiogroup">
                            {rows.map((row, index) => {
                                const selected = row.id === selectedId;
                                const previewing = previewingId !== undefined && previewingId === row.id;
                                return (
                                    <TouchableOpacity
                                        key={row.id ?? 'default'}
                                        style={[styles.voiceRow, index > 0 && styles.voiceRowDivider]}
                                        onPress={() => onSelectVoice(row.id)}
                                        activeOpacity={0.7}
                                        accessibilityRole="radio"
                                        accessibilityState={{ checked: selected }}
                                        accessibilityLabel={row.detail ? `${row.label}, ${row.detail}` : row.label}
                                    >
                                        <MaterialIcons
                                            name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                                            size={20}
                                            color={selected ? colors.inkSlate : colors.readerMutedInk}
                                        />
                                        <Text style={styles.voiceLabel} numberOfLines={1}>{row.label}</Text>
                                        {row.detail ? <Text style={styles.voiceDetail}>{row.detail}</Text> : null}
                                        <TouchableOpacity
                                            style={styles.previewButton}
                                            onPress={() => onPreviewVoice(row.id)}
                                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('read.listenVoicePreview', { voice: row.label })}
                                        >
                                            <MaterialIcons
                                                name={previewing ? 'graphic-eq' : 'play-circle-outline'}
                                                size={24}
                                                color={colors.readerBodyInk}
                                            />
                                        </TouchableOpacity>
                                    </TouchableOpacity>
                                );
                            })}
                            {voices == null ? (
                                <View style={styles.loadingRow}>
                                    <ActivityIndicator size="small" color={colors.readerMutedInk} />
                                </View>
                            ) : null}
                        </View>
                        {voices != null && voices.length === 0 ? (
                            <Text style={styles.note}>{t('read.listenVoiceNoneOffline')}</Text>
                        ) : null}

                        <TouchableOpacity
                            style={styles.moreRow}
                            onPress={openTtsSettings}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="download" size={18} color={colors.readerBodyInk} />
                            <View style={styles.moreText}>
                                <Text style={styles.moreLabel}>{t('read.listenVoiceMore')}</Text>
                                <Text style={styles.moreHint}>{t('read.listenVoiceMoreHint')}</Text>
                            </View>
                            <Feather name="external-link" size={16} color={colors.readerMutedInk} />
                        </TouchableOpacity>
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors, insets = { bottom: 0 }, maxHeight = 560) => StyleSheet.create({
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
        backgroundColor: colors.readerSurface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: colors.readerBorder,
        paddingBottom: (insets?.bottom ?? 0) + spacing.sm,
        elevation: 16,
    },
    handleWrap: {
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 4,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.readerBorder,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: spacing.lg,
        paddingRight: spacing.sm,
        paddingTop: 2,
        paddingBottom: 6,
    },
    title: {
        flex: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 21,
        color: colors.readerBodyInk,
    },
    closeButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    body: {
        flexGrow: 0,
    },
    bodyContent: {
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
    },
    settingRow: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.readerHairline,
    },
    settingLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.readerBodyInk,
    },
    sectionLabel: {
        marginTop: spacing.lg,
        marginBottom: 6,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: colors.readerMutedInk,
    },
    voiceList: {
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.readerBorder,
        overflow: 'hidden',
    },
    voiceRow: {
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 14,
        paddingRight: 8,
    },
    voiceRowDivider: {
        borderTopWidth: 1,
        borderTopColor: colors.readerHairline,
    },
    voiceLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: colors.readerBodyInk,
    },
    voiceDetail: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        color: colors.readerMutedInk,
    },
    previewButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingRow: {
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        borderTopWidth: 1,
        borderTopColor: colors.readerHairline,
    },
    note: {
        marginTop: 8,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.readerMutedInk,
    },
    moreRow: {
        marginTop: spacing.md,
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    moreText: {
        flex: 1,
    },
    moreLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: colors.readerBodyInk,
    },
    moreHint: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: colors.readerMutedInk,
    },
});

export default ListenVoiceSheet;
