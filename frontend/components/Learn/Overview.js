import { useMemo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { colors, radii, spacing, textStyles, useTheme } from '../../theme';

const Overview = () => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);

    return (
        <View style={styles.container}>
            <View style={styles.newSection}>
                <Text style={[styles.label, styles.labelMuted]}>{t('learn.proficiency.new')}</Text>
            </View>
            <View style={styles.slots}>
                <View style={[styles.section, styles.sectionStrong]}>
                    <Text style={[styles.label, styles.labelStrong]}>{t('learn.mastered')}</Text>
                </View>
                <View style={[styles.section, styles.sectionMid]}>
                    <Text style={styles.label}>{t('learn.review')}</Text>
                </View>
                <View style={[styles.section, styles.sectionMuted]}>
                    <Text style={styles.label}>{t('learn.hard')}</Text>
            </View>
            </View>
        </View>
    )
}

const createStyles = (colors) => StyleSheet.create({
    container: {
        width: '95%',
        alignSelf: 'center',
        marginTop: 5,
        marginBottom: 20
    },
    slots: {
        flexDirection: 'row',
        justifyContent: 'center'
    }, 
    section: {
        width: '32%',
        borderRadius: radii.sm,
        margin: spacing.xxs,
        alignItems: 'center'
    },
    newSection: {
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        borderRadius: radii.sm,
        margin: spacing.xxs,
        marginBottom: spacing.xs,
    },
    sectionStrong: {
        backgroundColor: colors.inkSlate,
    },
    sectionMid: {
        backgroundColor: colors.textTertiary,
    },
    sectionMuted: {
        backgroundColor: colors.textSubtle,
    },
    label: {
        ...textStyles.caption,
        color: colors.surface,
    },
    labelStrong: {
        color: colors.surface,
    },
    labelMuted: {
        color: colors.textMuted,
    },
})

const styles = createStyles(colors);

export default Overview
