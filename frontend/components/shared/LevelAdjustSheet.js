import { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { SheetFrame } from './WordCheckModal';

/**
 * LevelAdjustSheet — Profile's "Underlines feel off?": more or fewer
 * underlines (the reader's underline slider; it opens the reading settings of
 * the book being read), or the word check (once a week; `checkDaysLeft` > 0
 * shows when it's back). `onCheck` is omitted for languages without one.
 */
const LevelAdjustSheet = ({ visible, onClose, onUnderlines, onCheck, checkDaysLeft = 0 }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const checkLocked = checkDaysLeft > 0;

    return (
        <SheetFrame visible={visible} onClose={onClose} title={t('level.adjustTitle')}>
            <Text style={styles.intro}>{t('level.adjustIntro')}</Text>

            <TouchableOpacity onPress={onUnderlines} style={styles.option} accessibilityRole="button">
                <View style={styles.optionIcon}>
                    <Feather name="sliders" size={18} color={colors.text} />
                </View>
                <View style={styles.optionText}>
                    <Text style={styles.optionTitle}>{t('level.adjustSlider')}</Text>
                    <Text style={styles.optionNote}>{t('level.adjustSliderNote')}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textTertiary} />
            </TouchableOpacity>

            {onCheck ? (
                <TouchableOpacity
                    onPress={onCheck}
                    disabled={checkLocked}
                    style={[styles.option, styles.checkOption, checkLocked && styles.checkLocked]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: checkLocked }}
                >
                    <View style={[styles.optionIcon, styles.checkIcon]}>
                        <Feather name="check-square" size={18} color={checkLocked ? colors.textTertiary : colors.white} />
                    </View>
                    <View style={styles.optionText}>
                        <Text style={[styles.optionTitle, !checkLocked && styles.checkTitle]}>
                            {t('level.adjustCheck')}
                        </Text>
                        <Text style={[styles.optionNote, !checkLocked && styles.checkNote]}>
                            {checkLocked
                                ? t('level.checkWait', { count: checkDaysLeft })
                                : t('level.adjustCheckNote')}
                        </Text>
                    </View>
                    {checkLocked ? (
                        <Feather name="lock" size={16} color={colors.textTertiary} />
                    ) : (
                        <Feather name="chevron-right" size={18} color={colors.white} />
                    )}
                </TouchableOpacity>
            ) : null}
        </SheetFrame>
    );
};

const createStyles = (colors) => ({
    intro: {
        marginHorizontal: 20,
        marginBottom: 14,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    option: {
        marginHorizontal: 16,
        marginBottom: 10,
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    optionIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
    },
    optionText: {
        flex: 1,
        minWidth: 0,
    },
    optionTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    optionNote: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
    },
    checkOption: {
        backgroundColor: colors.danger,
        borderColor: colors.danger,
    },
    checkIcon: {
        backgroundColor: 'rgba(255, 255, 255, 0.18)',
    },
    checkTitle: {
        color: colors.white,
    },
    checkNote: {
        color: colors.white,
        opacity: 0.88,
    },
    checkLocked: {
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.border,
    },
});

export default LevelAdjustSheet;
