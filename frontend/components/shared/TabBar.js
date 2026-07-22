import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamilies } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';

const TAB_LABEL_KEYS = {
    Home: 'tabs.home',
    Read: 'tabs.read',
    Learn: 'tabs.learn',
    Write: 'tabs.write',
    Profile: 'tabs.profile',
};

const TabIcon = ({ routeName, focused, color, activeBorderColor }) => {
    const { t } = useTranslation();
    const labelKey = TAB_LABEL_KEYS[routeName];
    const label = labelKey ? t(labelKey) : String(routeName || '').toUpperCase();

    return (
        <View style={styles.tabContent}>
            <Text style={[
                styles.tabLabel,
                focused && [
                    styles.tabLabelActive,
                    { borderBottomColor: activeBorderColor },
                ],
                { color },
            ]}>
                {label}
            </Text>
        </View>
    );
};

export const createTabBarBaseStyle = (themeColors = colors) => ({
    ...styles.tabBar,
    backgroundColor: themeColors.bgPage,
    borderTopColor: themeColors.border,
});

export const tabScreenOptions = ({ route }, { hideTabChrome = false, themeColors = colors } = {}) => ({
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: themeColors.text,
    tabBarInactiveTintColor: themeColors.textSubtle,
    tabBarStyle: hideTabChrome ? styles.tabBarHidden : createTabBarBaseStyle(themeColors),
    tabBarItemStyle: styles.tabBarItem,
    tabBarIconStyle: styles.iconSlot,
    tabBarIcon: ({ focused, color }) => (
        <TabIcon
            routeName={route.name}
            focused={focused}
            color={color}
            activeBorderColor={themeColors.text}
        />
    ),
    tabBarShowLabel: false,
});

const styles = StyleSheet.create({
    tabBar: {
        height: 64,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: colors.bgPage,
        borderTopWidth: 1,
        borderTopColor: colors.border,
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
    },
    tabLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 1.8,
        paddingBottom: 7,
        textTransform: 'uppercase',
    },
    tabLabelActive: {
        fontFamily: fontFamilies.sansBold,
        paddingBottom: 5,
        borderBottomWidth: 2,
    },
    tabBarHidden: {
        height: 0,
        minHeight: 0,
        maxHeight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderTopWidth: 0,
        elevation: 0,
        shadowOpacity: 0,
        opacity: 0,
        overflow: 'hidden',
    },
});

export const tabBarBaseStyle = createTabBarBaseStyle(colors);
