import { memo, useEffect, useState } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';

// Focus-mode position pill + sentence arrows.
//
// This lives in its own component so the beam-navigation stream (a focus-info
// update on every sentence step) only re-renders these small controls instead
// of the entire reader screen. The parent hands us a `subscribe` function that
// pushes the latest focus info; we hold it in local state here.
const FocusControls = ({
    subscribe,
    focusSpan,
    focusSwipe,
    sendFocusNav,
    focusControlsTranslate,
    focusControlsBaseBottom,
    focusPillTop,
    styles,
    themeColors,
}) => {
    const { t } = useTranslation();
    const [focusInfo, setFocusInfo] = useState({ index: 0, count: 1, total: 0 });

    useEffect(() => subscribe(setFocusInfo), [subscribe]);

    const focusMaxIndex = Math.max(0, focusInfo.total - focusSpan);
    const focusAtStart = focusInfo.index <= 0;
    const focusAtEnd = focusInfo.index >= focusMaxIndex;
    const focusFirstSentence = focusInfo.total > 0 ? Math.min(focusInfo.index + 1, focusInfo.total) : 0;
    const focusLastSentence = Math.min(focusInfo.total, focusInfo.index + focusSpan);
    const focusPositionLabel = focusSpan > 1
        ? t('read.focusSentenceRangeLabel', {
            start: focusFirstSentence,
            end: focusLastSentence,
            total: focusInfo.total,
        })
        : t('read.focusSentenceLabel', {
            current: focusFirstSentence,
            total: focusInfo.total,
        });

    return (
        <>
            {/* Sits at the top of the reading surface, so unlike the arrows it
                does not lift with the dictionary panel — nothing at the bottom
                of the screen can reach it. */}
            <View
                pointerEvents="box-none"
                style={[styles.focusControlsLeft, { top: focusPillTop }]}
            >
                <View style={styles.focusPositionPill}>
                    <MaterialIcons
                        name="wb-iridescent"
                        size={15}
                        color={themeColors.readerSubtleInk}
                    />
                    <Text style={styles.focusPositionLabel}>{focusPositionLabel}</Text>
                </View>
            </View>
            {!focusSwipe ? (
                <Animated.View
                    pointerEvents="box-none"
                    style={[
                        styles.focusArrowControls,
                        {
                            bottom: focusControlsBaseBottom,
                            transform: [{ translateY: focusControlsTranslate }],
                        },
                    ]}
                >
                    <TouchableOpacity
                        style={styles.focusArrowButtonPrev}
                        onPress={() => sendFocusNav('prev')}
                        activeOpacity={0.72}
                        accessibilityRole="button"
                        accessibilityLabel={t('read.focusPreviousSentence')}
                    >
                        <MaterialIcons
                            name="keyboard-arrow-up"
                            size={23}
                            color={focusAtStart ? '#c5c6cb' : themeColors.readerBodyInk}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.focusArrowButtonNext}
                        onPress={() => sendFocusNav('next')}
                        activeOpacity={0.72}
                        accessibilityRole="button"
                        accessibilityLabel={t('read.focusNextSentence')}
                    >
                        <MaterialIcons
                            name="keyboard-arrow-down"
                            size={23}
                            color={focusAtEnd ? '#6b7180' : themeColors.readerPaper}
                        />
                    </TouchableOpacity>
                </Animated.View>
            ) : null}
        </>
    );
};

export default memo(FocusControls);
