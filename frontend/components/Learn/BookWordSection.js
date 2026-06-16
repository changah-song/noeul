import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card } from '../ui';
import { useTranslation } from '../../hooks/useTranslation';
import { colors, radii, spacing, textStyles, useTheme } from '../../theme';
import WordRow from './WordRow';

const BookWordSection = ({
  section,
  expanded,
  onToggleExpand,
  onStartPractice,
  onToggleFavorite,
  onCycleStatus,
  onCyclePriority,
  onRemoveWord,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const masteredCount = section.words.filter((word) => word.level === 'good').length;
  const favoriteCount = section.words.filter((word) => word.is_favorite).length;
  const progress = typeof section.progress === 'number'
    ? section.progress
    : section.words.length > 0
      ? masteredCount / section.words.length
      : 0;
  const meta = section.meta ?? t('learn.savedWordsMeta', {
    saved: section.words.length,
    mastered: masteredCount,
    favorites: favoriteCount ? t('learn.favoritesMeta', { count: favoriteCount }) : '',
  });
  const actionLabel = section.practiceLabel ?? t('learn.practice');

  return (
    <Card style={styles.card} contentStyle={styles.cardContent}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onToggleExpand} activeOpacity={0.85} style={styles.headerToggle}>
          <View style={styles.copy}>
            <Text style={styles.title}>{section.title}</Text>
            <Text style={styles.meta}>{meta}</Text>
          </View>

          <Feather
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onStartPractice}
          style={[styles.practiceButton, section.words.length === 0 && styles.practiceButtonDisabled]}
          disabled={section.words.length === 0}
        >
          <Feather name="play" size={14} color={colors.accentStrong} />
          <Text style={[styles.practiceLabel, section.words.length === 0 && styles.practiceLabelDisabled]}>{actionLabel}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 6)}%` }]} />
      </View>

      {expanded ? (
        <View style={styles.wordsList}>
          {section.words.map((word) => (
            <WordRow
              key={`${word.word}-${word.hanja ?? ''}-${word.def ?? ''}`}
              vocab={word}
              onToggleFavorite={() => onToggleFavorite(word)}
              onCycleStatus={() => onCycleStatus(word)}
              onCyclePriority={() => onCyclePriority(word)}
              onRemove={() => onRemoveWord(word)}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
};

const createStyles = (colors) => StyleSheet.create({
  card: {
    borderRadius: radii.xl,
  },
  cardContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  title: {
    ...textStyles.sectionTitle,
    fontSize: 19,
  },
  meta: {
    ...textStyles.caption,
  },
  practiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  practiceLabel: {
    ...textStyles.caption,
    color: colors.accentStrong,
  },
  practiceButtonDisabled: {
    opacity: 0.55,
  },
  practiceLabelDisabled: {
    color: colors.textMuted,
  },
  progressTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accentStrong,
  },
  wordsList: {
    gap: 0,
  },
});

const styles = createStyles(colors);

export default BookWordSection;
