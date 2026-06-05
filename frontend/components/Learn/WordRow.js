import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii, spacing, textStyles } from '../../theme';

const STATUS_META = {
  unorganized: { label: 'New', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  bad: { label: 'Hard', backgroundColor: 'rgba(182, 79, 68, 0.12)', color: colors.danger },
  mid: { label: 'Review', backgroundColor: 'rgba(181, 118, 24, 0.14)', color: colors.warning },
  good: { label: 'Mastered', backgroundColor: 'rgba(47, 125, 76, 0.12)', color: colors.success },
};

const PRIORITY_META = {
  low: { label: 'Low', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  normal: { label: 'Normal', backgroundColor: 'rgba(181, 118, 24, 0.12)', color: colors.warning },
  high: { label: 'High', backgroundColor: 'rgba(182, 79, 68, 0.12)', color: colors.danger },
};

const WordRow = ({ vocab, onToggleFavorite, onCycleStatus, onCyclePriority, onRemove }) => {
  const status = STATUS_META[vocab.level] ?? STATUS_META.unorganized;
  const priority = PRIORITY_META[vocab.priority] ?? PRIORITY_META.normal;

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
          <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onCyclePriority}
          style={[styles.statusPill, { backgroundColor: priority.backgroundColor }]}
        >
          <Text style={[styles.statusLabel, { color: priority.color }]}>{priority.label}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onRemove} style={styles.iconButton}>
          <MaterialIcons name="delete-outline" size={18} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
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

export default WordRow;
