import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import SheetModal from './SheetModal';
import { LEGAL_DOCS } from '../../constants/legalContent';
import { useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';
import { spacing, insets } from '../../theme/spacing';

// Renders the parsed Terms of Use / Privacy Policy inside the Noeul sheet.
// `doc` is a key of LEGAL_DOCS ('terms' | 'privacy').
const LegalSheet = ({ visible, doc, onClose }) => {
  const { colors } = useTheme();
  const content = LEGAL_DOCS[doc];

  if (!content) return null;

  const renderBlock = (block, key) => {
    if (block.type === 'sub') {
      return (
        <Text key={key} style={[styles.sub, { color: colors.text }]}>
          {block.text}
        </Text>
      );
    }
    if (block.type === 'bullet') {
      return (
        <View key={key} style={styles.bulletRow}>
          <Text style={[styles.bulletDot, { color: colors.accent }]}>•</Text>
          <Text style={[styles.paragraph, styles.bulletText, { color: colors.textSecondary }]}>
            {block.text}
          </Text>
        </View>
      );
    }
    return (
      <Text key={key} style={[styles.paragraph, { color: colors.textSecondary }]}>
        {block.text}
      </Text>
    );
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title={content.title}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.updated, { color: colors.textTertiary }]}>
          {content.updated}
        </Text>
        {content.sections.map((section, sectionIndex) => (
          <View key={sectionIndex}>
            {section.heading ? (
              <Text style={[styles.heading, { color: colors.text }]}>
                {section.heading}
              </Text>
            ) : null}
            {section.blocks.map((block, blockIndex) => renderBlock(block, blockIndex))}
          </View>
        ))}
      </ScrollView>
    </SheetModal>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingBottom: spacing.xxxl,
  },
  updated: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: spacing.xs,
  },
  heading: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 19,
    lineHeight: 24,
    marginTop: spacing.xl,
    marginBottom: spacing.xxs,
  },
  sub: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: spacing.md,
  },
  paragraph: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    paddingLeft: spacing.xs,
  },
  bulletDot: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
    marginRight: spacing.xs,
  },
  bulletText: {
    flex: 1,
  },
});

export default LegalSheet;
