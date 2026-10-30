import { memo } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { LISTEN_RATES } from '../../services/listenPlayer';
import { formatNumber } from '../../services/interfaceLanguage';

// Listen-mode transport, a floating rounded bar: previous / play-pause /
// next, the speed chip (opens speed, pitch and voice settings), the two study
// toggles (dictionary mode: stop on underlined words; translation mode: read
// each sentence's translation), then close. Sits where the focus arrows
// normally are and lifts with the dictionary panel the same way.
const ListenBar = ({
    playing,
    rate,
    explainWords,
    translateSentences,
    onTogglePlay,
    onPrevious,
    onNext,
    onOpenVoice,
    onToggleExplain,
    onToggleTranslate,
    onClose,
    bottom,
    translateY,
    styles,
    themeColors,
}) => {
    const { t } = useTranslation();
    const rateLabel = t('read.listenRateValue', { rate: formatNumber(LISTEN_RATES.includes(rate) ? rate : 1) });

    return (
        <Animated.View
            pointerEvents="box-none"
            style={[styles.listenBarWrap, { bottom, transform: [{ translateY }] }]}
        >
            <View style={styles.listenBar}>
                <TouchableOpacity
                    style={styles.listenButton}
                    onPress={onPrevious}
                    activeOpacity={0.72}
                    accessibilityRole="button"
                    accessibilityLabel={t('read.focusPreviousSentence')}
                >
                    <MaterialIcons name="skip-previous" size={24} color={themeColors.inkSlate} />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.listenPlayButton}
                    onPress={onTogglePlay}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: playing }}
                    accessibilityLabel={playing ? t('read.listenPause') : t('read.listenPlay')}
                >
                    <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={26} color={themeColors.readerPaper} />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.listenButton}
                    onPress={onNext}
                    activeOpacity={0.72}
                    accessibilityRole="button"
                    accessibilityLabel={t('read.focusNextSentence')}
                >
                    <MaterialIcons name="skip-next" size={24} color={themeColors.inkSlate} />
                </TouchableOpacity>
                <View style={styles.listenDivider} />
                <TouchableOpacity
                    style={styles.listenSpeedChip}
                    onPress={onOpenVoice}
                    activeOpacity={0.72}
                    hitSlop={{ top: 4, bottom: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('read.listenVoiceTitle')}, ${t('read.listenSpeed', { rate: rateLabel })}`}
                >
                    <MaterialCommunityIcons name="waveform" size={15} color={themeColors.inkSlate} />
                    <Text style={styles.listenSpeedLabel}>{rateLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.listenToggle, explainWords ? styles.listenToggleActive : null]}
                    onPress={onToggleExplain}
                    activeOpacity={0.72}
                    hitSlop={{ top: 4, bottom: 4 }}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: !!explainWords }}
                    accessibilityLabel={t('read.listenExplain')}
                >
                    <MaterialIcons
                        name="school"
                        size={17}
                        color={explainWords ? themeColors.readerPaper : themeColors.inkSlate}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.listenToggle, translateSentences ? styles.listenToggleActive : null]}
                    onPress={onToggleTranslate}
                    activeOpacity={0.72}
                    hitSlop={{ top: 4, bottom: 4 }}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: !!translateSentences }}
                    accessibilityLabel={t('read.listenTranslate')}
                >
                    <MaterialIcons
                        name="translate"
                        size={17}
                        color={translateSentences ? themeColors.readerPaper : themeColors.inkSlate}
                    />
                </TouchableOpacity>
                <View style={styles.listenSpacer} />
                <TouchableOpacity
                    style={styles.listenCloseButton}
                    onPress={onClose}
                    activeOpacity={0.72}
                    accessibilityRole="button"
                    accessibilityLabel={t('read.listenStop')}
                >
                    <Feather name="x" size={20} color={themeColors.textTertiary} />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );
};

export default memo(ListenBar);
