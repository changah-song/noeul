import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { IconButton } from '../ui';
import { Motion } from '../../theme';
import { elevation, radii, useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';
import { spacing, insets } from '../../theme/spacing';

// Noeul bottom sheet — scrim + radius-xl sheet sliding up over 275ms
// (--dur-sheet), dismissing over 225ms. Popover surface, soft sheet shadow.
const SheetModal = ({ visible, onClose, title, children }) => {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: Motion.sheetOpenDuration,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: Motion.sheetDismissDuration,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [anim, visible]);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  if (!mounted) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [windowHeight, 0],
  });

  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={handleClose}>
      <View style={styles.fill}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.overlay, opacity: anim },
          ]}
        >
          <Pressable style={styles.fill} onPress={handleClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.popover,
              borderColor: colors.popoverBorder,
              marginTop: safeArea.top + spacing.xxxl,
              paddingBottom: Math.max(safeArea.bottom, insets.screenBottom),
              transform: [{ translateY }],
            },
            elevation.sheet,
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <IconButton
              tone="muted"
              size={34}
              onPress={handleClose}
              icon={<Feather name="x" size={17} color={colors.textMuted} />}
            />
          </View>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    flex: 1,
    fontFamily: fontFamilies.displayMedium,
    fontSize: 20,
    lineHeight: 26,
  },
  body: {
    flex: 1,
  },
});

export default SheetModal;
