import React from 'react';
import {
    View,
    Text,
    Modal,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Switch
} from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { colors, elevation, fontFamilies, radii, spacing, textStyles } from '../../theme';

const SettingsMenu = ({
    visible,
    onClose,
    settings,
    onSettingChange
}) => {
    const { t } = useTranslation();
    const fontSizes = [12, 14, 16, 18, 20, 24, 28, 32];
    const lineSpacings = [1.0, 1.2, 1.5, 1.8, 2.0, 2.5];

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <View style={styles.header}>
                        <Text style={styles.title}>{t('read.readerSettings')}</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Text style={styles.closeButtonText}>✕</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.settingsContainer}>
                        {/* Font Size */}
                        <View style={styles.settingSection}>
                            <Text style={styles.settingLabel}>{t('read.fontSize')}</Text>
                            <View style={styles.optionsGrid}>
                                {fontSizes.map((size) => (
                                    <TouchableOpacity
                                        key={size}
                                        style={[
                                            styles.optionButton,
                                            settings.fontSize === size && styles.selectedOption
                                        ]}
                                        onPress={() => onSettingChange('fontSize', size)}
                                    >
                                        <Text style={[
                                            styles.optionText,
                                            settings.fontSize === size && styles.selectedOptionText
                                        ]}>
                                            {size}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        {/* Theme Mode */}
                        <View style={styles.settingSection}>
                            <Text style={styles.settingLabel}>{t('read.themeMode')}</Text>
                            <View style={styles.switchContainer}>
                                <Text style={styles.switchLabel}>
                                    {settings.isDarkMode ? t('read.nightMode') : t('read.dayMode')}
                                </Text>
                                <Switch
                                    value={settings.isDarkMode}
                                    onValueChange={(value) => onSettingChange('isDarkMode', value)}
                                    trackColor={{ false: colors.borderStrong, true: colors.inkSlate }}
                                    thumbColor={settings.isDarkMode ? colors.surfaceMuted : colors.surface}
                                />
                            </View>
                        </View>

                        {/* Line Spacing */}
                        <View style={styles.settingSection}>
                            <Text style={styles.settingLabel}>{t('read.lineSpacing')}</Text>
                            <View style={styles.optionsGrid}>
                                {lineSpacings.map((spacing) => (
                                    <TouchableOpacity
                                        key={spacing}
                                        style={[
                                            styles.optionButton,
                                            settings.lineSpacing === spacing && styles.selectedOption
                                        ]}
                                        onPress={() => onSettingChange('lineSpacing', spacing)}
                                    >
                                        <Text style={[
                                            styles.optionText,
                                            settings.lineSpacing === spacing && styles.selectedOptionText
                                        ]}>
                                            {spacing}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        maxHeight: '80%',
        paddingBottom: spacing.xl,
        ...elevation.sheet,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.xl,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    title: {
        ...textStyles.screenBarTitle,
        color: colors.text,
    },
    closeButton: {
        padding: spacing.xs,
    },
    closeButtonText: {
        fontSize: 24,
        color: colors.textMuted,
    },
    settingsContainer: {
        padding: spacing.xl,
    },
    settingSection: {
        marginBottom: spacing.xxl,
    },
    settingLabel: {
        ...textStyles.eyebrow,
        color: colors.textTertiary,
        marginBottom: spacing.sm,
    },
    optionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
    },
    optionButton: {
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
        borderRadius: radii.xs,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: colors.surface,
        minWidth: 60,
        alignItems: 'center',
    },
    selectedOption: {
        backgroundColor: colors.inkSlate,
        borderColor: colors.inkSlate,
    },
    optionText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.text,
    },
    selectedOptionText: {
        color: colors.surface,
        fontFamily: fontFamilies.sansBold,
    },
    switchContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.md,
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.sm,
    },
    switchLabel: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        color: colors.textMuted,
    },
    fontFamilyContainer: {
        gap: spacing.sm,
    },
    fontFamilyButton: {
        padding: spacing.md,
        borderRadius: radii.xs,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: colors.surface,
    },
    selectedFontFamily: {
        backgroundColor: colors.inkSlate,
        borderColor: colors.inkSlate,
    },
    fontFamilyText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        color: colors.text,
    },
    selectedFontFamilyText: {
        color: colors.surface,
        fontFamily: fontFamilies.sansBold,
    },
});

export default SettingsMenu;
