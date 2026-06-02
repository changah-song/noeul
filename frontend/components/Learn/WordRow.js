import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii, spacing, textStyles } from '../../theme';

const STATUS_META = {
  unorganized: { label: 'New', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  bad: { label: 'Hard', backgroundColor: 'rgba(182, 79, 68, 0.12)', color: colors.danger },
  mid: { label: 'Okay', backgroundColor: 'rgba(181, 118, 24, 0.14)', color: colors.warning },
  good: { label: 'Good', backgroundColor: 'rgba(47, 125, 76, 0.12)', color: colors.success },
};

const PRIORITY_META = {
  low: { label: 'Low', backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  normal: { label: 'Normal', backgroundColor: 'rgba(181, 118, 24, 0.12)', color: colors.warning },
  high: { label: 'High', backgroundColor: 'rgba(182, 79, 68, 0.12)', color: colors.danger },
};

const MATURITY_TONE_META = {
  neutral: { backgroundColor: colors.surfaceMuted, color: colors.textMuted },
  warning: { backgroundColor: 'rgba(181, 118, 24, 0.14)', color: colors.warning },
  info: { backgroundColor: 'rgba(200, 125, 0, 0.12)', color: colors.accentStrong },
  success: { backgroundColor: 'rgba(47, 125, 76, 0.12)', color: colors.success },
  muted: { backgroundColor: colors.surfaceStrong, color: colors.textSubtle },
};

const formatLastSeenDate = (dateValue) => {
  if (!dateValue) {
    return null;
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
};

const getLastSeenText = (vocab) => {
  if (vocab.last_encounter_source_title) {
    return `Last seen in ${vocab.last_encounter_source_title}`;
  }

  const dateText = formatLastSeenDate(vocab.last_encountered_at);
  if (dateText) {
    return `Last seen ${dateText}`;
  }

  return 'No reading encounters yet';
};

const WordRow = ({ vocab, onPress, onToggleFavorite, onCycleStatus, onCyclePriority, onRemove }) => {
  const status = STATUS_META[vocab.level] ?? STATUS_META.unorganized;
  const priority = PRIORITY_META[vocab.priority] ?? PRIORITY_META.normal;
  const maturityMeta = vocab.maturityMeta ?? { label: 'New', tone: 'neutral' };
  const maturityTone = MATURITY_TONE_META[maturityMeta.tone] ?? MATURITY_TONE_META.neutral;
  const encounterCount = Number(vocab.encounter_count) || 0;
  const encounterDayCount = Number(vocab.encounter_day_count) || 0;
  const lastSeenText = getLastSeenText(vocab);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.mainCopy}>
        <View style={styles.titleRow}>
          <Text style={styles.word} selectable>{vocab.word}</Text>
          {vocab.hanja ? <Text style={styles.hanja} selectable>{vocab.hanja}</Text> : null}
        </View>
        <Text style={styles.definition} numberOfLines={2} selectable>
          {vocab.def}
        </Text>

        <View style={styles.learningMetaRow}>
          <View style={[styles.maturityBadge, { backgroundColor: maturityTone.backgroundColor }]}>
            <Text style={[styles.maturityLabel, { color: maturityTone.color }]}>
              {maturityMeta.label}
            </Text>
          </View>
          <Text style={styles.encounterText}>
            seen {encounterCount}x{encounterDayCount > 1 ? ` · ${encounterDayCount} days` : ''}
          </Text>
        </View>

        <Text style={styles.lastSeenText} numberOfLines={1}>
          {lastSeenText}
        </Text>

        <View style={styles.secondaryControls}>
          <TouchableOpacity
            onPress={onCycleStatus}
            style={[styles.secondaryPill, { backgroundColor: status.backgroundColor }]}
          >
            <Text style={[styles.secondaryPillLabel, { color: status.color }]}>Level {status.label}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onCyclePriority}
            style={[styles.secondaryPill, { backgroundColor: priority.backgroundColor }]}
          >
            <Text style={[styles.secondaryPillLabel, { color: priority.color }]}>Priority {priority.label}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={onToggleFavorite} style={styles.iconButton}>
          <MaterialIcons
            name={vocab.is_favorite ? 'star' : 'star-outline'}
            size={16}
            color={vocab.is_favorite ? colors.accentStrong : colors.textSubtle}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={onRemove} style={styles.iconButton}>
          <MaterialIcons name="delete-outline" size={18} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: 0.72,
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
    paddingTop: 2,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  learningMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: 2,
  },
  maturityBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  maturityLabel: {
    ...textStyles.caption,
  },
  encounterText: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  lastSeenText: {
    ...textStyles.caption,
    color: colors.textSubtle,
  },
  secondaryControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: 2,
  },
  secondaryPill: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  secondaryPillLabel: {
    ...textStyles.caption,
  },
});

export default WordRow;
