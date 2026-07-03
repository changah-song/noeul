import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import SheetModal from './SheetModal';
import Auth from '../../screens/Auth';
import { spacing, insets } from '../../theme/spacing';

// Presents the existing embedded Auth flow inside the Noeul sheet, so the
// Profile sign-in card can open account creation / login without a new route.
const AuthSheet = ({ visible, onClose }) => (
  <SheetModal visible={visible} onClose={onClose} title="Create account · Log in">
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Auth embedded showHeader={false} onAuthenticated={onClose} />
    </ScrollView>
  </SheetModal>
);

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxxl,
  },
});

export default AuthSheet;
