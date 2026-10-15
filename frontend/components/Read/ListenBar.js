import { memo } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { LISTEN_RATES } from '../../services/listenPlayer';

// Listen-mode transport: previous / play-pause / next, the speed chip, and the
// study toggles (stop on underlined words; add the AI meaning). Sits where the
// focus arrows normally are and lifts with the dictionary panel the same way.
const ListenBar = ({
    playing,
    rate,
    explainWords,
    aiMeaning,
    aiAvailable,
    onTogglePlay,
    onPrevious,
    onNext,
    onCycleRate,
    onToggleExplain,
    onToggleAi,
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
                    style={styles.listenChip}
                    onPress={onCycleRate}
                    activeOpacity={0.72}
                    accessibilityRole="button"
                    accessibilityLabel={t('read.listenSpeed', { rate: rateLabel })}
                >
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
                {explainWords && aiAvailable ? (
                    <TouchableOpacity
                        style={[styles.listenChip, aiMeaning ? styles.listenChipActive : null]}
                        onPress={onToggleAi}
                        activeOpacity={0.72}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: !!aiMeaning }}
                        accessibilityLabel={t('read.listenAi')}
                    >
                        <MaterialIcons
                            name="auto-awesome"
                            size={16}
                            color={aiMeaning ? themeColors.readerPaper : themeColors.readerBodyInk}
                        />
                    </TouchableOpacity>
                ) : null}
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
