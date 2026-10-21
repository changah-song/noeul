import { useEffect, useRef, useState } from 'react';
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
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingBottom: 14,
        backgroundColor: 'transparent',
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
    pillHighlight: {
        position: 'absolute',
        top: 4,
        height: 44,
        borderRadius: 22,
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

// Room screens leave at the bottom of their scroll content so the last row
// can scroll clear of the floating pill.
export const PILL_TAB_BAR_CLEARANCE = 96;

// The two destinations in the floating pill. The reader (Read) and Profile are
// reached from inside the app (a book, the avatar) and show no tab bar.
const PILL_ROUTES = [
    { name: 'Home', labelKey: 'tabs.read', icon: 'book-open' },
    { name: 'Learn', labelKey: 'tabs.learn', icon: 'layers' },
];

// Spring for the sliding highlight: quick, settles without a visible wobble.
const SLIDE_SPRING = { stiffness: 320, damping: 30, mass: 1, useNativeDriver: false };
// The trailing edge follows a little looser, so the highlight stretches
// toward the new tab and then catches up.
const TRAIL_SPRING = { stiffness: 190, damping: 26, mass: 1, useNativeDriver: false };

const PillTabContent = ({ icon, label, color }) => (
    <View style={styles.pillTab}>
        <Feather name={icon} size={17} color={color} />
        <Text style={[styles.pillLabel, { color }]}>{label}</Text>
    </View>
);

const PillTab = ({ route, label, icon, index, focused, progress, onPress, onLayout, themeColors }) => {
    // The white ink fades in as the highlight arrives under this tab.
    const activeOpacity = progress.interpolate({
        inputRange: [index - 1, index, index + 1],
        outputRange: [0, 1, 0],
        extrapolate: 'clamp',
    });
    return (
        <Pressable
            onPress={onPress}
            onLayout={onLayout}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            testID={`tab-${route}`}
        >
            <PillTabContent icon={icon} label={label} color={themeColors.textSecondary} />
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: activeOpacity }]} pointerEvents="none">
                <PillTabContent icon={icon} label={label} color={themeColors.white} />
            </Animated.View>
        </Pressable>
    );
};

const PillTabs = ({ state, navigation, themeColors }) => {
    const { t } = useTranslation();
    const current = state.routes[state.index];
    const items = PILL_ROUTES
        .map((item) => ({ ...item, route: state.routes.find((r) => r.name === item.name) }))
        .filter((item) => item.route);
    const activeIndex = Math.max(0, items.findIndex((item) => item.name === current.name));

    const progress = useRef(new Animated.Value(activeIndex)).current;
    const leftEdge = useRef(new Animated.Value(0)).current;
    const rightEdge = useRef(new Animated.Value(0)).current;
    const appear = useRef(new Animated.Value(0)).current;
    const [layouts, setLayouts] = useState({});
    const placed = useRef(false);
    const lastIndex = useRef(activeIndex);
    const measured = items.every((item) => layouts[item.name]);

    // Rise in when the pill comes back (e.g. leaving the reader).
    useEffect(() => {
        Animated.spring(appear, { toValue: 1, stiffness: 240, damping: 24, mass: 1, useNativeDriver: true }).start();
    }, [appear]);

    useEffect(() => {
        if (!measured) return;
        const target = layouts[items[activeIndex].name];
        if (!placed.current) {
            // First measure: put the highlight under the current tab, no slide.
            leftEdge.setValue(target.x);
            rightEdge.setValue(target.x + target.width);
            progress.setValue(activeIndex);
            placed.current = true;
            lastIndex.current = activeIndex;
            return;
        }
        const movingRight = activeIndex >= lastIndex.current;
        lastIndex.current = activeIndex;
        Animated.parallel([
            Animated.spring(leftEdge, { toValue: target.x, ...(movingRight ? TRAIL_SPRING : SLIDE_SPRING) }),
            Animated.spring(rightEdge, { toValue: target.x + target.width, ...(movingRight ? SLIDE_SPRING : TRAIL_SPRING) }),
            Animated.spring(progress, { toValue: activeIndex, ...SLIDE_SPRING }),
        ]).start();
        // items is derived from props each render; layouts/activeIndex cover its changes.
    }, [activeIndex, layouts, measured, leftEdge, rightEdge, progress]);

    const setLayout = (name) => ({ nativeEvent }) => {
        const { x, width } = nativeEvent.layout;
        setLayouts((prev) => (
            prev[name] && prev[name].x === x && prev[name].width === width
                ? prev
                : { ...prev, [name]: { x, width } }
        ));
    };

    return (
        <Animated.View
            accessibilityRole="tablist"
            style={[
                styles.pill,
                { backgroundColor: themeColors.surface, borderColor: themeColors.border },
                {
                    opacity: appear,
                    transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
                },
            ]}
        >
            {measured ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.pillHighlight,
                        {
                            backgroundColor: themeColors.inkSlate,
                            left: leftEdge,
                            width: Animated.subtract(rightEdge, leftEdge),
                        },
                    ]}
                />
            ) : null}
            {items.map((item, index) => {
                const focused = index === activeIndex;
                const onPress = () => {
                    const event = navigation.emit({ type: 'tabPress', target: item.route.key, canPreventDefault: true });
                    if (!focused && !event.defaultPrevented) navigation.navigate(item.route.name);
                };
                return (
                    <PillTab
                        key={item.name}
                        route={item.name}
                        label={t(item.labelKey)}
                        icon={item.icon}
                        index={index}
                        focused={focused}
                        progress={progress}
                        onPress={onPress}
                        onLayout={setLayout(item.name)}
                        themeColors={themeColors}
                    />
                );
            })}
        </Animated.View>
    );
};

/**
 * PillTabBar — the bottom navigation: a small floating pill with Read and
 * Learn. A dark highlight slides between the tabs. Hidden on the reader and
 * Profile routes, and whenever a screen hides its tab bar (focus/fullscreen,
 * OCR, an editor) through tabBarStyle.
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
        // Floats over the screen: the books scroll behind it.
        <View style={styles.pillBar} pointerEvents="box-none">
            <PillTabs state={state} navigation={navigation} themeColors={themeColors} />
        </View>
    );
};
