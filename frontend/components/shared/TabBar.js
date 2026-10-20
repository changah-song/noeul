import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
    pillBar: {
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 14,
    },
    pill: {
        flexDirection: 'row',
        gap: 4,
        padding: 4,
        borderRadius: 26,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
    },
    pillTab: {
        height: 44,
        paddingHorizontal: 18,
        borderRadius: 22,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    pillLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
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

// The two destinations in the floating pill. The reader (Read) and Profile are
// reached from inside the app (a book, the avatar) and show no tab bar.
const PILL_ROUTES = [
    { name: 'Home', labelKey: 'tabs.read', icon: 'book-open' },
    { name: 'Learn', labelKey: 'tabs.learn', icon: 'layers' },
];

const PillTab = ({ route, labelKey, icon, focused, onPress, themeColors }) => {
    const { t } = useTranslation();
    const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
    useEffect(() => {
        Animated.timing(progress, {
            toValue: focused ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [focused, progress]);
    const background = progress.interpolate({
        inputRange: [0, 1],
        outputRange: ['rgba(0,0,0,0)', themeColors.inkSlate],
    });
    const ink = focused ? themeColors.white : themeColors.textSecondary;
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(labelKey)}
            testID={`tab-${route}`}
        >
            <Animated.View style={[styles.pillTab, { backgroundColor: background }]}>
                <Feather name={icon} size={17} color={ink} />
                <Text style={[styles.pillLabel, { color: ink }]}>{t(labelKey)}</Text>
            </Animated.View>
        </Pressable>
    );
};

/**
 * PillTabBar — the bottom navigation: a small floating pill with Read and
 * Learn. Hidden on the reader and Profile routes, and whenever a screen hides
 * its tab bar (focus/fullscreen, OCR, an editor) through tabBarStyle.
 */
export const PillTabBar = ({ state, navigation, descriptors, themeColors = colors }) => {
    const current = state.routes[state.index];
    const options = descriptors[current.key]?.options ?? {};
    const hiddenStyle = StyleSheet.flatten(options.tabBarStyle) || {};
    if (
        current.name === 'Read'
        || current.name === 'Profile'
        || hiddenStyle.display === 'none'
        || hiddenStyle.height === 0
    ) {
        return null;
    }
    return (
        <View style={[styles.pillBar, { backgroundColor: themeColors.bgPage }]}>
            <View
                accessibilityRole="tablist"
                style={[styles.pill, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
            >
                {PILL_ROUTES.map((item) => {
                    const route = state.routes.find((r) => r.name === item.name);
                    if (!route) return null;
                    const focused = current.name === item.name;
                    const onPress = () => {
                        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                        if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                    };
                    return (
                        <PillTab
                            key={item.name}
                            route={item.name}
                            labelKey={item.labelKey}
                            icon={item.icon}
                            focused={focused}
                            onPress={onPress}
                            themeColors={themeColors}
                        />
                    );
                })}
            </View>
        </View>
    );
};
