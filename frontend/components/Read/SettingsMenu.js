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

const SettingsMenu = ({
    visible,
    onClose,
    settings,
    onSettingChange
}) => {
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
                        <Text style={styles.title}>Reader Settings</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Text style={styles.closeButtonText}>✕</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.settingsContainer}>
                        {/* Font Size */}
                        <View style={styles.settingSection}>
                            <Text style={styles.settingLabel}>Font Size</Text>
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
                            <Text style={styles.settingLabel}>Theme Mode</Text>
                            <View style={styles.switchContainer}>
                                <Text style={styles.switchLabel}>
                                    {settings.isDarkMode ? 'Night Mode' : 'Day Mode'}
                                </Text>
                                <Switch
                                    value={settings.isDarkMode}
                                    onValueChange={(value) => onSettingChange('isDarkMode', value)}
                                    trackColor={{ false: '#d1d5db', true: '#4b5563' }}
                                    thumbColor={settings.isDarkMode ? '#1f2937' : '#f3f4f6'}
                                />
                            </View>
                        </View>

                        {/* Line Spacing */}
                        <View style={styles.settingSection}>
                            <Text style={styles.settingLabel}>Line Spacing</Text>
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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
        paddingBottom: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    closeButton: {
        padding: 5,
    },
    closeButtonText: {
        fontSize: 24,
        color: '#6b7280',
    },
    settingsContainer: {
        padding: 20,
    },
    settingSection: {
        marginBottom: 30,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 12,
    },
    optionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    optionButton: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#d1d5db',
        backgroundColor: '#fff',
        minWidth: 60,
        alignItems: 'center',
    },
    selectedOption: {
        backgroundColor: '#3b82f6',
        borderColor: '#3b82f6',
    },
    optionText: {
        fontSize: 14,
        color: '#374151',
    },
    selectedOptionText: {
        color: '#fff',
        fontWeight: '600',
    },
    switchContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#f9fafb',
        borderRadius: 8,
    },
    switchLabel: {
        fontSize: 16,
        color: '#374151',
    },
    fontFamilyContainer: {
        gap: 10,
    },
    fontFamilyButton: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#d1d5db',
        backgroundColor: '#fff',
    },
    selectedFontFamily: {
        backgroundColor: '#3b82f6',
        borderColor: '#3b82f6',
    },
    fontFamilyText: {
        fontSize: 16,
        color: '#374151',
    },
    selectedFontFamilyText: {
        color: '#fff',
        fontWeight: '600',
    },
});

export default SettingsMenu;
