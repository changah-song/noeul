import { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { resetTips } from '../../services/tips';
import { SheetFrame } from './WordCheckModal';

// Everything Noeul does, each with the icon its button uses in the app.
const FEATURES = [
    { key: 'tap', Icon: MaterialCommunityIcons, icon: 'gesture-tap', titleKey: 'onboarding.tapTitle', bodyKey: 'onboarding.tapDetail' },
    { key: 'hold', Icon: MaterialIcons, icon: 'auto-awesome', titleKey: 'onboarding.holdTitle', bodyKey: 'onboarding.holdDetail' },
    { key: 'sentence', Icon: MaterialIcons, icon: 'subtitles', titleKey: 'onboarding.sentenceTitle', bodyKey: 'onboarding.sentenceDetail' },
    { key: 'underlines', Icon: MaterialCommunityIcons, icon: 'format-underline', titleKey: 'tips.underlinesTitle', bodyKey: 'onboarding.tourNote' },
    { key: 'saved', Icon: MaterialIcons, icon: 'bookmark-border', titleKey: 'tips.savedFeatureTitle', bodyKey: 'tips.savedBody' },
    { key: 'focus', Icon: Feather, icon: 'eye', titleKey: 'tips.focusTitle', bodyKey: 'tips.focusBody' },
    { key: 'listen', Icon: Feather, icon: 'headphones', titleKey: 'tips.listenTitle', bodyKey: 'tips.listenBody' },
    { key: 'cards', Icon: MaterialCommunityIcons, icon: 'cards-outline', titleKey: 'tips.cardsTitle', bodyKey: 'tips.cardsBody' },
    { key: 'audio', Icon: Feather, icon: 'headphones', titleKey: 'tips.learnAudioTitle', bodyKey: 'tips.learnAudioBody' },
    { key: 'level', Icon: Feather, icon: 'bar-chart-2', titleKey: 'tips.levelTitle', bodyKey: 'tips.levelBody' },
    { key: 'scan', Icon: MaterialCommunityIcons, icon: 'line-scan', titleKey: 'tips.ocrTitle', bodyKey: 'tips.ocrBody' },
    { key: 'songs', Icon: Feather, icon: 'music', titleKey: 'tips.songsTitle', bodyKey: 'tips.songsBody' },
];

/**
 * FeatureGuideSheet — Profile's "Show tips": what Noeul can do, one row per
 * feature with its icon, and a button to see the in-app tips again.
 */
const FeatureGuideSheet = ({ visible, onClose }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [tipsReset, setTipsReset] = useState(false);

    return (
        <SheetFrame
            visible={visible}
            onClose={() => {
                setTipsReset(false);
                onClose?.();
            }}
            title={t('tips.guideTitle')}
            fillRatio={0.86}
        >
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {FEATURES.map(({ key, Icon, icon, titleKey, bodyKey }) => (
                    <View key={key} style={styles.row}>
                        <View style={styles.icon}>
                            <Icon name={icon} size={20} color={colors.text} />
                        </View>
                        <View style={styles.copy}>
                            <Text style={styles.title}>{t(titleKey)}</Text>
                            <Text style={styles.body}>{t(bodyKey)}</Text>
                        </View>
                    </View>
                ))}
            </ScrollView>
            <TouchableOpacity
                onPress={async () => {
                    await resetTips();
                    setTipsReset(true);
                }}
                disabled={tipsReset}
                style={[styles.button, tipsReset && styles.buttonDone]}
                accessibilityRole="button"
            >
                {tipsReset ? <Feather name="check" size={16} color={colors.textSecondary} /> : null}
                <Text style={[styles.buttonText, tipsReset && styles.buttonTextDone]}>
                    {tipsReset ? t('tips.showAgainDone') : t('tips.showAgain')}
                </Text>
            </TouchableOpacity>
        </SheetFrame>
    );
};

const createStyles = (colors) => ({
    list: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    icon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    body: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        lineHeight: 19,
        color: colors.textSecondary,
    },
    button: {
        marginTop: 12,
        marginHorizontal: 16,
        height: 48,
        borderRadius: 14,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
    buttonDone: {
        backgroundColor: colors.surfaceMuted,
    },
    buttonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
    buttonTextDone: {
        color: colors.textSecondary,
    },
});

export default FeatureGuideSheet;
