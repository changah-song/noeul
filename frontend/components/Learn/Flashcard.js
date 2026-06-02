import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card } from '../ui';
import { colors, radii, spacing, textStyles } from '../../theme';

const STATUS_ACTIONS = [
  { key: 'bad', label: 'Hard', tone: 'danger' },
  { key: 'mid', label: 'Okay', tone: 'warning' },
  { key: 'good', label: 'Easy', tone: 'success' },
];

const toneStyles = {
  danger: {
    backgroundColor: 'rgba(182, 79, 68, 0.12)',
    color: colors.danger,
  },
  warning: {
    backgroundColor: 'rgba(181, 118, 24, 0.12)',
    color: colors.warning,
  },
  success: {
    backgroundColor: 'rgba(47, 125, 76, 0.12)',
    color: colors.success,
  },
};

const toTitleLabel = (value) => {
  if (!value) {
    return 'New';
  }

  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
};

const Flashcard = ({ vocab, title, index, total, onClose, onMark }) => {
  const [isFlipped, setIsFlipped] = useState(false);

  const hanjaText = useMemo(
    () => (vocab?.hanja && vocab.hanja !== 'N/A' ? vocab.hanja : null),
    [vocab?.hanja]
  );
  const learningMeta = useMemo(() => {
    const encounterCount = Number(vocab?.encounter_count) || 0;
    const maturityLabel = vocab?.maturityMeta?.label || toTitleLabel(vocab?.maturity);

    return `Seen ${encounterCount}x · ${maturityLabel}`;
  }, [vocab?.encounter_count, vocab?.maturity, vocab?.maturityMeta?.label]);

  if (!vocab) {
    return null;
  }

  return (
    <Card style={styles.shell} contentStyle={styles.shellContent}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>Flashcards</Text>
          <Text style={styles.deckTitle}>{title}</Text>
          <Text style={styles.progress}>{index + 1} of {total}</Text>
        </View>

        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Feather name="x" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      <Pressable onPress={() => setIsFlipped((prev) => !prev)} style={styles.cardArea}>
        <View style={styles.cardFace}>
          {!isFlipped ? (
            <>
              <Text style={styles.word}>{vocab.word}</Text>
              {hanjaText ? <Text style={styles.hanja}>{hanjaText}</Text> : null}
              <Text style={styles.learningMeta}>{learningMeta}</Text>
              <Text style={styles.flipHint}>Tap to reveal definition</Text>
            </>
          ) : (
            <>
              <Text style={styles.wordSmall}>{vocab.word}</Text>
              {hanjaText ? <Text style={styles.hanja}>{hanjaText}</Text> : null}
              <Text style={styles.learningMeta}>{learningMeta}</Text>
              <Text style={styles.definition}>{vocab.def}</Text>
              <Text style={styles.flipHint}>Tap again to hide</Text>
            </>
          )}
        </View>
      </Pressable>

      <View style={styles.actions}>
        {STATUS_ACTIONS.map((action) => (
          <TouchableOpacity
            key={action.key}
            onPress={() => {
              setIsFlipped(false);
              onMark(action.key);
            }}
            style={[
              styles.actionButton,
              { backgroundColor: toneStyles[action.tone].backgroundColor },
            ]}
          >
            <Text style={[styles.actionLabel, { color: toneStyles[action.tone].color }]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.xl,
  },
  shellContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  kicker: {
    ...textStyles.eyebrow,
  },
  deckTitle: {
    ...textStyles.sectionTitle,
    fontSize: 22,
  },
  progress: {
    ...textStyles.caption,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  cardArea: {
    minHeight: 280,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  word: {
    ...textStyles.hero,
    textAlign: 'center',
  },
  wordSmall: {
    ...textStyles.title,
    textAlign: 'center',
  },
  hanja: {
    ...textStyles.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  learningMeta: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  definition: {
    ...textStyles.body,
    textAlign: 'center',
  },
  flipHint: {
    ...textStyles.caption,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
  },
  actionLabel: {
    ...textStyles.label,
  },
});

export default Flashcard;
