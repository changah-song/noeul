import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { Screen, ProgressBar, GradientButton, Press, Switch } from '../components/ui';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useVocabWords } from '../contexts/VocabWordsContext';
import { getEarliestVocabContext, recordReviewOutcome } from '../services/Database';
import { incrementWordsStudied } from '../services/dailyProgress';
import { elevation, useTheme } from '../theme/tokens';
import { fontFamilies, textStyles, typeScale, lineHeights } from '../theme/typography';
import { spacing, insets } from '../theme/spacing';
import { Gradients } from '../theme';

const BACK_OPTIONS_KEY = 'flashcards.backOptions';
const DEFAULT_BACK_OPTIONS = { showHanja: true, showSentence: true };

// Prototype #screen-flashcards: flip runs 600ms on the spec ease; the deck
// advances at 320ms, while the card is edge-on, so the swap is invisible.
const FLIP_DURATION = 600;
const ADVANCE_DELAY = 320;
const FLIP_EASING = Easing.bezier(0.4, 0, 0.2, 1);

// Android elevation on the two stacked flip faces would force the back face
// (higher elevation) to always draw on top, so card shadows are iOS-only.
const FRONT_SHADOW = Platform.OS === 'ios' ? elevation.glass : null;
const BACK_SHADOW = Platform.OS === 'ios' ? elevation.coverLift : null;

// Renders the saved sentence with the reviewed word emphasized, like the
// prototype's example line (비가 <b>추적추적</b> 내렸다).
const SentenceWithWord = ({ sentence, word, style, boldStyle }) => {
  if (!word || !sentence?.includes(word)) {
    return <Text style={style}>{sentence}</Text>;
  }
  const parts = sentence.split(word);
  return (
    <Text style={style}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 ? <Text style={boldStyle}>{word}</Text> : null}
        </React.Fragment>
      ))}
    </Text>
  );
};

export default function Flashcards({ navigation, route }) {
  const { colors, isDarkMode } = useTheme();
  const { activeOwnerId } = useLocalOwner();
  const safeArea = useSafeAreaInsets();
  const dueVocabWords = useVocabWords();

  const paramDeck = route?.params?.deck;
  const deck = useMemo(
    () => (paramDeck?.length ? paramDeck : dueVocabWords),
    [paramDeck, dueVocabWords]
  );

  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [sentence, setSentence] = useState(null);
  const [backOptions, setBackOptions] = useState(DEFAULT_BACK_OPTIONS);
  const [showSettings, setShowSettings] = useState(false);

  const flipAnim = useRef(new Animated.Value(0)).current;
  const advancingRef = useRef(false);
  const currentCard = deck[index] ?? null;
  const total = deck.length;

  useEffect(() => {
    AsyncStorage.getItem(BACK_OPTIONS_KEY)
      .then((raw) => {
        if (raw) setBackOptions({ ...DEFAULT_BACK_OPTIONS, ...JSON.parse(raw) });
      })
      .catch(() => {});
  }, []);

  const updateBackOption = useCallback((key, value) => {
    setBackOptions((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(BACK_OPTIONS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSentence(null);
    if (!currentCard?.word) return undefined;
    getEarliestVocabContext(
      currentCard.word,
      currentCard.hanja,
      currentCard.def,
      currentCard.language ?? 'ko',
      { ownerId: activeOwnerId }
    )
      .then((ctx) => {
        if (!cancelled) setSentence(ctx?.sentence ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeOwnerId, currentCard]);

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });
  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const flipCard = useCallback(() => {
    if (advancingRef.current) return;
    Animated.timing(flipAnim, {
      toValue: isFlipped ? 0 : 180,
      duration: FLIP_DURATION,
      easing: FLIP_EASING,
      useNativeDriver: true,
    }).start();
    setIsFlipped((f) => !f);
  }, [flipAnim, isFlipped]);

  const handleNext = useCallback(async (outcome) => {
    if (!currentCard || advancingRef.current) return;
    advancingRef.current = true;

    try {
      await recordReviewOutcome(
        currentCard.word,
        currentCard.hanja,
        currentCard.def,
        currentCard.level,
        outcome,
        currentCard.language ?? 'ko',
        { ownerId: activeOwnerId, wordData: currentCard }
      );
      await incrementWordsStudied();
    } catch (e) {
      console.warn('[Flashcards] recordReview error:', e);
    }

    Animated.timing(flipAnim, {
      toValue: 0,
      duration: FLIP_DURATION,
      easing: FLIP_EASING,
      useNativeDriver: true,
    }).start();
    setIsFlipped(false);

    setTimeout(() => {
      if (index < total - 1) {
        setIndex((i) => i + 1);
      } else {
        setCompleted(true);
      }
      advancingRef.current = false;
    }, ADVANCE_DELAY);
  }, [activeOwnerId, currentCard, flipAnim, index, total]);

  const gradientColors = isDarkMode ? Gradients.accentDusk : Gradients.accent;

  if (completed || total === 0) {
    return (
      <Screen gradient edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.completedView}>
          <Text style={[textStyles.title, styles.completedTitle]}>All done!</Text>
          <Text style={textStyles.bodyMuted}>
            You reviewed {total} word{total !== 1 ? 's' : ''}.
          </Text>
          <GradientButton label="Back to Vocab" onPress={() => navigation.goBack()} style={{ marginTop: spacing.xl }} />
        </View>
      </Screen>
    );
  }

  const showHanja = backOptions.showHanja && !!currentCard?.hanja;
  const showSentence = backOptions.showSentence && !!sentence;

  return (
    <Screen
      gradient
      edges={['top', 'left', 'right', 'bottom']}
      contentContainerStyle={styles.screenContent}
    >
      {/* Header: close · counter · back-side settings */}
      <View style={styles.header}>
        <Press onPress={() => navigation.goBack()} style={styles.headerBtn} scaleTo={0.9}>
          <Feather name="x" size={22} color={colors.textMuted} />
        </Press>
        <Text style={[textStyles.label, { color: colors.textTertiary }]}>
          {index + 1} / {total}
        </Text>
        <Press onPress={() => setShowSettings(true)} style={styles.headerBtn} scaleTo={0.9}>
          <Feather name="settings" size={20} color={colors.textMuted} />
        </Press>
      </View>

      {/* Deck progress */}
      <View style={styles.progressWrap}>
        <ProgressBar progress={(index + 1) / total} height={5} />
      </View>

      {/* Flip card fills the space between the bar and the actions */}
      <View style={styles.body}>
        <Pressable onPress={flipCard} style={styles.flipScene}>
          {/* Front — frosted glass, Korean word */}
          <Animated.View
            style={[
              styles.face,
              FRONT_SHADOW,
              { transform: [{ perspective: 1400 }, { rotateY: frontInterpolate }] },
            ]}
          >
            <View style={[styles.faceInner, styles.faceFront, { borderColor: colors.surfaceGlassBorder }]}>
              {Platform.OS === 'ios' ? (
                <BlurView
                  intensity={isDarkMode ? 20 : 40}
                  tint={isDarkMode ? 'dark' : 'light'}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceGlass }]} />
              <Text style={[textStyles.eyebrow, styles.faceEyebrow]}>Word</Text>
              <Text style={[styles.frontWord, { color: colors.text }]}>{currentCard?.word ?? ''}</Text>
              <View style={styles.tapHint}>
                <Feather name="rotate-cw" size={13} color={colors.textSubtle} />
                <Text style={[styles.tapHintText, { color: colors.textSubtle }]}>Tap to flip</Text>
              </View>
            </View>
          </Animated.View>

          {/* Back — accent gradient: hanja · definition · first saved sentence */}
          <Animated.View
            style={[
              styles.face,
              BACK_SHADOW,
              { transform: [{ perspective: 1400 }, { rotateY: backInterpolate }] },
            ]}
          >
            <View style={styles.faceInner}>
              <LinearGradient
                colors={gradientColors}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Text style={[textStyles.eyebrow, styles.faceEyebrow, styles.backEyebrow]}>Meaning</Text>
              {showHanja ? (
                <Text style={styles.backHanja}>{currentCard.hanja}</Text>
              ) : null}
              <Text style={styles.backDef}>{currentCard?.def ?? ''}</Text>
              {showSentence ? (
                <SentenceWithWord
                  sentence={sentence}
                  word={currentCard?.word}
                  style={styles.backSentence}
                  boldStyle={styles.backSentenceWord}
                />
              ) : null}
            </View>
          </Animated.View>
        </Pressable>

        {/* Review later · Got it! */}
        <View style={styles.actionRow}>
          <Press
            onPress={() => handleNext('bad')}
            containerStyle={styles.actionFlex}
            style={[
              styles.actionBtn,
              { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderStrong },
            ]}
          >
            <Feather name="rotate-ccw" size={17} color={colors.textMuted} />
            <Text style={[styles.actionLabel, { color: colors.textMuted }]}>Review later</Text>
          </Press>
          <Press
            onPress={() => handleNext('good')}
            containerStyle={styles.actionFlex}
            style={[styles.actionBtn, elevation.fab]}
          >
            <LinearGradient
              colors={gradientColors}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
            />
            <Feather name="check" size={17} color={colors.glyphCream} />
            <Text style={[styles.actionLabel, { color: colors.glyphCream }]}>Got it!</Text>
          </Press>
        </View>
      </View>

      {/* Back-of-card settings sheet */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
            onPress={() => setShowSettings(false)}
          />
          <View
            style={[
              styles.sheet,
              elevation.sheet,
              {
                backgroundColor: colors.popover,
                borderColor: colors.popoverBorder,
                paddingBottom: safeArea.bottom + spacing.xxl,
              },
            ]}
          >
            <View style={[styles.sheetGrabber, { backgroundColor: colors.textSubtle }]} />
            <Text style={[styles.sheetTitle, { color: colors.textTertiary }]}>Card back</Text>

            <View style={styles.sheetRow}>
              <View style={styles.sheetRowCopy}>
                <Text style={[styles.sheetRowLabel, { color: colors.text }]}>Hanja</Text>
                <Text style={[styles.sheetRowDescription, { color: colors.textMuted }]}>
                  Show the word's hanja above the definition
                </Text>
              </View>
              <Switch
                value={backOptions.showHanja}
                onValueChange={(value) => updateBackOption('showHanja', value)}
              />
            </View>

            <View style={[styles.sheetRow, { borderTopWidth: 1, borderTopColor: colors.divider }]}>
              <View style={styles.sheetRowCopy}>
                <Text style={[styles.sheetRowLabel, { color: colors.text }]}>Source sentence</Text>
                <Text style={[styles.sheetRowDescription, { color: colors.textMuted }]}>
                  Show the sentence the word was first saved from
                </Text>
              </View>
              <Switch
                value={backOptions.showSentence}
                onValueChange={(value) => updateBackOption('showSentence', value)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 8,
    paddingRight: 12,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: {
    paddingHorizontal: insets.screenHorizontal,
  },
  body: {
    flex: 1,
    padding: insets.screenHorizontal,
  },
  flipScene: {
    flex: 1,
  },
  face: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    backfaceVisibility: 'hidden',
  },
  faceInner: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  faceFront: {
    borderWidth: 1,
  },
  faceEyebrow: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  backEyebrow: {
    color: 'rgba(255,255,255,0.75)',
  },
  frontWord: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 54,
    lineHeight: 59,
    textAlign: 'center',
  },
  tapHint: {
    position: 'absolute',
    bottom: 22,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tapHintText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.caption,
    lineHeight: lineHeights.caption,
  },
  backHanja: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: typeScale.section,
    lineHeight: lineHeights.section,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  backDef: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 26,
    lineHeight: 33,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  backSentence: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: typeScale.body,
    lineHeight: 22,
    color: '#FFFFFF',
    opacity: 0.92,
    textAlign: 'center',
    marginTop: 18,
  },
  backSentenceWord: {
    fontFamily: fontFamilies.krSerifBold,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: insets.screenHorizontal,
  },
  actionFlex: {
    flex: 1,
  },
  actionBtn: {
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typeScale.body,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: insets.screenHorizontal,
  },
  sheetGrabber: {
    width: 38,
    height: 5,
    borderRadius: 3,
    opacity: 0.4,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
  sheetTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 4,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: 2,
  },
  sheetRowCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  sheetRowLabel: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: typeScale.body,
    lineHeight: 19,
  },
  sheetRowDescription: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.caption,
    lineHeight: 16,
    marginTop: 3,
  },
  completedView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedTitle: {
    marginBottom: spacing.xs,
  },
});
