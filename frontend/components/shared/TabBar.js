import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamilies, useTheme } from '../../theme';
import { springs, springTo, useReducedMotion } from '../../theme/motion';
import { tapSelect } from '../../services/haptics';
import { useTranslation } from '../../hooks/useTranslation';

const TAB_LABEL_KEYS = {
    Home: 'tabs.library',
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


const isHiddenStyle = (style) => {
    const flat = StyleSheet.flatten(style) || {};
    return flat.display === 'none' || flat.height === 0 || flat.maxHeight === 0;
};

/**
 * PaperTabBar — the redesign's tab bar: four text labels on the paper, no
 * box or icons, and a teal underline that slides to the selected tab on a
 * critically damped spring (re-targeted from wherever it is if the reader
 * taps again mid-flight). Labels name what is inside (Library, not Home).
 * A screen hides it by setting its tabBarStyle to display: none / height 0,
 * as before.
 */
export const PaperTabBar = ({ state, descriptors, navigation }) => {
    const { colors: themeColors } = useTheme();
    const { t } = useTranslation();
    const reduced = useReducedMotion();
    // route key -> { itemX, itemW, labelW }
    const [boxes, setBoxes] = useState({});
    const x = useRef(new Animated.Value(0)).current;
    const width = useRef(new Animated.Value(0)).current;
    const placed = useRef(false);
    const focusedKey = state.routes[state.index]?.key;
    const focusedOptions = descriptors[focusedKey]?.options || {};

    const measure = (key, patch) => setBoxes((previous) => {
        const current = previous[key] || {};
        if (Object.keys(patch).every((k) => current[k] === patch[k])) return previous;
        return { ...previous, [key]: { ...current, ...patch } };
    });

    useEffect(() => {
        const box = boxes[focusedKey];
        if (!box || box.itemX == null || box.labelW == null) return;
        const left = box.itemX + (box.itemW - box.labelW) / 2;
        if (!placed.current || reduced) {
            x.setValue(left);
            width.setValue(box.labelW);
            placed.current = true;
            return;
        }
        Animated.parallel([
            springTo(x, left, { spring: springs.snappy, useNativeDriver: false }),
            springTo(width, box.labelW, { spring: springs.snappy, useNativeDriver: false }),
        ]).start();
    }, [boxes, focusedKey, reduced, width, x]);

    if (isHiddenStyle(focusedOptions.tabBarStyle)) {
        return null;
    }

    return (
        <View accessibilityRole="tablist" style={[paperStyles.bar, { backgroundColor: themeColors.bgPage }]}>
            {state.routes.map((route, index) => {
                const focused = index === state.index;
                const labelKey = TAB_LABEL_KEYS[route.name];
                const label = labelKey ? t(labelKey) : route.name;
                const onPress = () => {
                    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                    if (!focused && !event.defaultPrevented) {
                        tapSelect();
                        navigation.navigate(route.name, route.params);
                    }
                };
                return (
                    <Pressable
                        key={route.key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: focused }}
                        accessibilityLabel={label}
                        onPress={onPress}
                        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                        onLayout={(event) => {
                            const { x: itemX, width: itemW } = event.nativeEvent.layout;
                            measure(route.key, { itemX, itemW });
                        }}
                        style={paperStyles.item}
                    >
                        {({ pressed }) => (
                            <Text
                                onLayout={(event) => measure(route.key, { labelW: event.nativeEvent.layout.width })}
                                style={[
                                    paperStyles.label,
                                    {
                                        color: focused ? themeColors.text : themeColors.textMuted,
                                        fontFamily: focused ? fontFamilies.sansSemiBold : fontFamilies.sansRegular,
                                        opacity: pressed && !focused ? 0.55 : 1,
                                    },
                                ]}
                            >
                                {label}
                            </Text>
                        )}
                    </Pressable>
                );
            })}
            <Animated.View
                pointerEvents="none"
                style={[paperStyles.indicator, { backgroundColor: themeColors.tint, left: x, width }]}
            />
        </View>
    );
};

const paperStyles = StyleSheet.create({
    bar: {
        height: 60,
        flexDirection: 'row',
        alignItems: 'center',
    },
    item: {
        flex: 1,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: {
        fontSize: 15,
        lineHeight: 20,
    },
    indicator: {
        position: 'absolute',
        bottom: 12,
        height: 2,
        borderRadius: 1,
    },
});
