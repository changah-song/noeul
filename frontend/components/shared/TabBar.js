import {
    Entypo,
    Feather,
    FontAwesome6,
    Ionicons,
    MaterialCommunityIcons,
} from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../../theme';

const tabIcons = {
    Home: { Component: Entypo, name: 'home' },
    Read: { Component: FontAwesome6, name: 'book-open' },
    Learn: { Component: Ionicons, name: 'sparkles-outline' },
    Write: { Component: Feather, name: 'edit-3' },
    Profile: { Component: MaterialCommunityIcons, name: 'account-circle-outline' },
};

export const tabScreenOptions = ({ route }, { hideTabChrome = false } = {}) => ({
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.textSubtle,
    tabBarStyle: tabBarBaseStyle,
    tabBarItemStyle: styles.tabBarItem,
    tabBarIconStyle: styles.iconSlot,
    tabBarIcon: ({ focused, color }) => {
        const { Component, name } = tabIcons[route.name];
        return (
            <View style={[styles.iconContainer, focused && styles.iconContainerActive, hideTabChrome && styles.iconContainerHidden]}>
                <Component
                    name={name}
                    color={focused ? colors.accentStrong : color}
                    size={route.name === 'Profile' ? 23 : 21}
                />
            </View>
        );
    },
    tabBarShowLabel: false,
});

const styles = StyleSheet.create({
    tabBar: {
        height: 52,
        paddingTop: 2,
        paddingBottom: 4,
        paddingHorizontal: spacing.sm,
        backgroundColor: colors.surfaceElevated,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        elevation: 0,
        shadowOpacity: 0,
    },
    tabBarItem: {
        paddingVertical: 0,
    },
    iconSlot: {
        marginTop: 0,
    },
    iconContainer: {
        width: 40,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.pill,
    },
    iconContainerActive: {
        backgroundColor: colors.accentSoft,
    },
    iconContainerHidden: {
        opacity: 0,
    },
});

export const tabBarBaseStyle = styles.tabBar;
