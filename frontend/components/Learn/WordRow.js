import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { colors, radii, spacing, textStyles, useTheme } from '../../theme';

const createStatusMeta = (colors) => ({
  unorganized: { labelKey: 'learn.proficiency.new', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  bad: { labelKey: 'learn.hard', backgroundColor: colors.surfaceMuted, color: colors.textTertiary },
  mid: { labelKey: 'learn.review', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  good: { labelKey: 'learn.mastered', backgroundColor: colors.surfaceMuted, color: colors.accent },
});

const createPriorityMeta = (colors) => ({
  low: { labelKey: 'learn.lowPriority', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  normal: { labelKey: 'learn.normalPriority', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  high: { labelKey: 'learn.highPriority', backgroundColor: colors.surfaceMuted, color: colors.accent },
});

const STATUS_META = createStatusMeta(colors);
const PRIORITY_META = createPriorityMeta(colors);

const WordRow = ({ vocab, onToggleFavorite, onCycleStatus, onCyclePriority, onRemove }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const statusMeta = useMemo(() => createStatusMeta(colors), [colors]);
  const priorityMeta = useMemo(() => createPriorityMeta(colors), [colors]);
  const status = statusMeta[vocab.level] ?? statusMeta.unorganized;
  const priority = priorityMeta[vocab.priority] ?? priorityMeta.normal;

  return (
    <View style={styles.row}>
      <View style={styles.mainCopy}>
        <View style={styles.titleRow}>
          <Text style={styles.word}>{vocab.word}</Text>
          {vocab.hanja ? <Text style={styles.hanja}>{vocab.hanja}</Text> : null}
        </View>
        <Text style={styles.definition} numberOfLines={2}>
          {vocab.def}
        </Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={onToggleFavorite} style={styles.iconButton}>
          <MaterialIcons
            name={vocab.is_favorite ? 'star' : 'star-outline'}
            size={16}
            color={vocab.is_favorite ? colors.accentStrong : colors.textSubtle}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onCycleStatus}
          style={[styles.statusPill, { backgroundColor: status.backgroundColor }]}
        >
          <Text style={[styles.statusLabel, { color: status.color }]}>{t(status.labelKey)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onCyclePriority}
          style={[styles.statusPill, { backgroundColor: priority.backgroundColor }]}
        >
          <Text style={[styles.statusLabel, { color: priority.color }]}>{t(priority.labelKey)}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onRemove} style={styles.iconButton}>
          <MaterialIcons name="delete-outline" size={18} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mainCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  word: {
    ...textStyles.label,
    color: colors.text,
    fontSize: 15,
  },
  hanja: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  definition: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  controls: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  statusPill: {
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  statusLabel: {
    ...textStyles.caption,
  },
});

const styles = createStyles(colors);

export default WordRow;
