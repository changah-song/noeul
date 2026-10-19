import { memo } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { LISTEN_RATES } from '../../services/listenPlayer';

// Listen-mode transport: previous / play-pause / next, the voice chip (shows
// the speed; opens speed, pitch and voice settings), and the study toggles (stop on underlined words; read each sentence's translation).
// Sits where the focus arrows normally are and lifts with the dictionary
// panel the same way.
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
    const rateLabel = `${(LISTEN_RATES.includes(rate) ? rate : 1).toString().replace(/\.0$/, '')}×`;

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
                    <MaterialIcons name="skip-previous" size={22} color={themeColors.readerBodyInk} />
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
                    <MaterialIcons name="skip-next" size={22} color={themeColors.readerBodyInk} />
                </TouchableOpacity>
                <View style={styles.listenDivider} />
                <TouchableOpacity
                    style={[styles.listenChip, styles.listenVoiceChip]}
                    onPress={onOpenVoice}
                    activeOpacity={0.72}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('read.listenVoiceTitle')}, ${t('read.listenSpeed', { rate: rateLabel })}`}
                >
                    <MaterialIcons name="record-voice-over" size={15} color={themeColors.readerBodyInk} />
                    <Text style={styles.listenChipLabel}>{rateLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.listenChip, explainWords ? styles.listenChipActive : null]}
                    onPress={onToggleExplain}
                    activeOpacity={0.72}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: !!explainWords }}
                    accessibilityLabel={t('read.listenExplain')}
                >
                    <MaterialIcons
                        name="school"
                        size={16}
                        color={explainWords ? themeColors.readerPaper : themeColors.readerBodyInk}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.listenChip, translateSentences ? styles.listenChipActive : null]}
                    onPress={onToggleTranslate}
                    activeOpacity={0.72}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: !!translateSentences }}
                    accessibilityLabel={t('read.listenTranslate')}
                >
                    <MaterialIcons
                        name="translate"
                        size={16}
                        color={translateSentences ? themeColors.readerPaper : themeColors.readerBodyInk}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.listenButton}
                    onPress={onClose}
                    activeOpacity={0.72}
                    accessibilityRole="button"
                    accessibilityLabel={t('read.listenStop')}
                >
                    <MaterialIcons name="close" size={20} color={themeColors.readerSubtleInk} />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );
};

export default memo(ListenBar);
