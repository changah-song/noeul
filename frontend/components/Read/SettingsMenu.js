import React, { useMemo } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
} from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { colors, fontFamilies } from '../../theme';
import {
    SHEET_PADDING,
    SettingRow,
    SheetHandle,
    SheetHeader,
    ToggleSwitch,
    createReaderSettingsControlStyles,
    createSheetChromeStyles,
} from './ReaderSettingsControls';

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];
const LINE_SPACINGS = [1.0, 1.2, 1.5, 1.8, 2.0, 2.5];

/**
 * SettingsMenu — the older, standalone reader settings sheet (font size,
 * dark mode, line spacing as chip grids). Uses the shared reader sheet chrome.
 */
const SettingsMenu = ({
    visible,
    onClose,
    settings,
    onSettingChange
}) => {
    const { t } = useTranslation();
    const chrome = useMemo(() => createSheetChromeStyles(colors), []);
    const controlStyles = useMemo(() => createReaderSettingsControlStyles(colors), []);

    const renderChips = (values, selectedValue, key) => (
        <View style={styles.chips}>
            {values.map((value) => {
                const selected = selectedValue === value;
                return (
                    <TouchableOpacity
                        key={value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => onSettingChange(key, value)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                    >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {value}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                />
                <View style={[chrome.sheet, styles.sheet]}>
                    <SheetHandle styles={chrome} />
                    <SheetHeader
                        styles={chrome}
                        colors={colors}
                        title={t('read.settings')}
                        onClose={onClose}
                        closeLabel={t('common.close')}
                    />

                    <ScrollView contentContainerStyle={styles.body}>
                        <Text style={[chrome.sectionLabel, styles.sectionLabel]}>{t('read.fontSize')}</Text>
                        {renderChips(FONT_SIZES, settings.fontSize, 'fontSize')}

                        <SettingRow styles={controlStyles} label={t('read.darkMode')}>
                            <ToggleSwitch
                                styles={controlStyles}
                                colors={colors}
                                value={!!settings.isDarkMode}
                                onChange={(value) => onSettingChange('isDarkMode', value)}
                                accessibilityLabel={t('read.darkMode')}
                            />
                        </SettingRow>

                        <Text style={[chrome.sectionLabel, styles.sectionLabel]}>{t('read.lineSpacing')}</Text>
                        {renderChips(LINE_SPACINGS, settings.lineSpacing, 'lineSpacing')}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'flex-end',
    },
    sheet: {
        maxHeight: '80%',
    },
    body: {
        paddingHorizontal: SHEET_PADDING,
        paddingTop: 4,
    },
    sectionLabel: {
        marginTop: 16,
        marginBottom: 10,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 8,
    },
    chip: {
        minWidth: 52,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chipSelected: {
        backgroundColor: colors.inkSlate,
        borderColor: colors.inkSlate,
    },
    chipText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.text,
    },
    chipTextSelected: {
        fontFamily: fontFamilies.sansSemiBold,
        color: colors.surface,
    },
});

export default React.memo(SettingsMenu);
