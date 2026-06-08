import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme/tokens';
import { insets } from '../../theme/spacing';

const Screen = ({
  children,
  scroll = false,
  backgroundColor = colors.backgroundWarm,
  style,
  contentContainerStyle,
  scrollViewProps,
  edges = ['top', 'left', 'right'],
}) => {
  if (scroll) {
    return (
      <SafeAreaView edges={edges} style={[styles.safeArea, { backgroundColor }, style]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          {...scrollViewProps}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={edges} style={[styles.safeArea, { backgroundColor }, style]}>
      <View style={[styles.content, contentContainerStyle]}>{children}</View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: insets.screenTop,
    paddingBottom: insets.screenBottom,
  },
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: insets.screenTop,
    paddingBottom: insets.screenBottom,
  },
});

export default Screen;
