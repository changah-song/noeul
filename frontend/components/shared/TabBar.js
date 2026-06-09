import {
    Feather,
    Ionicons,
    MaterialCommunityIcons,
} from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies } from '../../theme';

const TAB_COLORS = {
    surface: '#faf6ee',
    border: '#e4dac6',
    active: '#b8552e',
    idle: '#b3a892',
};

const tabIcons = {
    Home: { Component: Ionicons, name: 'home-outline', labelKey: 'tabs.home' },
    Read: { Component: Ionicons, name: 'book-outline', labelKey: 'tabs.read' },
    Learn: { Component: Ionicons, name: 'sparkles-outline', labelKey: 'tabs.learn' },
    ScreenshotOcr: { Component: Ionicons, name: 'scan-outline', labelKey: 'tabs.ocr' },
    Write: { Component: Feather, name: 'edit-3', labelKey: 'tabs.write' },
    Profile: { Component: MaterialCommunityIcons, name: 'account-circle-outline', labelKey: 'tabs.profile' },
};

const TabIcon = ({ routeName, focused, color }) => {
    const { t } = useTranslation();
    const { Component, name, labelKey } = tabIcons[routeName] ?? tabIcons.Home;

    return (
        <View style={styles.tabContent}>
            <Component
                name={name}
                color={color}
                size={24}
            />
            <Text style={[
                styles.tabLabel,
                focused && styles.tabLabelActive,
                { color },
            ]}>
                {t(labelKey)}
            </Text>
        </View>
    );
};

export const tabScreenOptions = ({ route }, { hideTabChrome = false } = {}) => ({
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: TAB_COLORS.active,
    tabBarInactiveTintColor: TAB_COLORS.idle,
    tabBarStyle: hideTabChrome ? styles.tabBarHidden : tabBarBaseStyle,
    tabBarItemStyle: styles.tabBarItem,
    tabBarIconStyle: styles.iconSlot,
    tabBarIcon: ({ focused, color }) => (
        <TabIcon routeName={route.name} focused={focused} color={color} />
    ),
    tabBarShowLabel: false,
});

const styles = StyleSheet.create({
    tabBar: {
        height: 72,
        paddingTop: 9,
        paddingBottom: 12,
        backgroundColor: TAB_COLORS.surface,
        borderTopWidth: 1,
        borderTopColor: TAB_COLORS.border,
        elevation: 0,
        shadowOpacity: 0,
    },
    tabBarItem: {
        paddingVertical: 0,
        height: '100%',
    },
    iconSlot: {
        marginTop: 0,
        width: '100%',
        height: '100%',
    },
    tabContent: {
        flex: 1,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: 2,
    },
    tabLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 0,
    },
    tabLabelActive: {
        fontFamily: fontFamilies.sansSemiBold,
    },
    tabBarHidden: {
        display: 'none',
    },
});

export const tabBarBaseStyle = styles.tabBar;
