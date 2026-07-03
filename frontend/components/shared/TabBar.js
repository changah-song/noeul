import { Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, fontFamilies } from '../../theme';

const tabLabels = {
  Home: 'HOME',
  Read: 'READ',
  Learn: 'VOCAB',
  Write: 'WRITE',
  Profile: 'PROFILE',
};

const TabIcon = ({ routeName, focused, color, activeBorderColor }) => {
  const label = tabLabels[routeName] ?? String(routeName || '').toUpperCase();

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
  // Glass tab bar — frosted over the gradient sky
  backgroundColor: Platform.OS === 'ios'
    ? 'transparent'
    : themeColors.surfaceGlass ?? 'rgba(255,255,255,0.55)',
  borderTopColor: themeColors.border,
});

export const tabScreenOptions = ({ route }, { hideTabChrome = false, themeColors = colors } = {}) => ({
  headerShown: false,
  tabBarHideOnKeyboard: true,
  tabBarActiveTintColor: themeColors.accent,        // coral for active tab
  tabBarInactiveTintColor: themeColors.textSubtle,
  tabBarStyle: hideTabChrome ? styles.tabBarHidden : createTabBarBaseStyle(themeColors),
  tabBarItemStyle: styles.tabBarItem,
  tabBarIconStyle: styles.iconSlot,
  tabBarIcon: ({ focused, color }) => (
    <TabIcon
      routeName={route.name}
      focused={focused}
      color={color}
      activeBorderColor={themeColors.accent}       // coral underline
    />
  ),
  tabBarShowLabel: false,
  // Frosted glass blur on iOS via the system blur
  tabBarBlurEffect: 'systemUltraThinMaterial',
  tabBarBackground: () => Platform.OS === 'ios' ? (
    <BlurView
      intensity={50}
      tint="light"
      style={StyleSheet.absoluteFill}
    />
  ) : null,
});

const styles = StyleSheet.create({
  tabBar: {
    height: 64,
    paddingTop: 0,
    paddingBottom: 0,
    borderTopWidth: 1,
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
    justifyContent: 'flex-end',
    paddingBottom: 18,
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
