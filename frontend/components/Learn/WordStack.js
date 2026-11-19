import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';

// The Learning and Long-term tabs: every waiting word as a card, soonest
// first. The cards of one day overlap into a stack with only each card's top
// strip (the word) showing; touching a card pulls it open. A rule separates
// one day's stack from the next and ends in a dot on the timeline, the line
// down the right edge. The days are named only while the scrubber (the handle
// on that line) is being dragged.

// The strip of a card left showing above the next one.
const STRIP_HEIGHT = 46;
// How far each card tucks under the one after it (hides its foot).
const OVERLAP = 12;
const BODY_HEIGHT = 120;
// Room on the right for the timeline; its line runs down the middle.
const TIMELINE_WIDTH = 30;
const SECTION_GAP = 12;
const NODE_SIZE = 7;
const DOT_COUNT = 4;
// A card's borders, top and bottom.
const CARD_BORDER = 2;
// How far down the stack each closed card adds.
const ROW_ADVANCE = STRIP_HEIGHT + CARD_BORDER;

// Where each card's strip starts, measured from the top of the stack with
// every card closed, and which card a given point falls on. Worked out from
// the layout constants (measuring a few hundred rows on every change is too
// slow), so it must be kept in step with the styles below.
export const getStackOffsets = (items) => {
  let y = 0;
  return items.map((item, index) => {
    if (item.showWhen) {
      y += (index === 0 ? 0 : OVERLAP + SECTION_GAP) + NODE_SIZE + SECTION_GAP;
    }
    const top = y;
    y += ROW_ADVANCE;
    return top;
  });
};

// The index of the card at `y` (from the top of the stack), given which card
// is open, if any. Points above the first or below the last card clamp.
export const findStackIndexAt = (offsets, y, openIndex = -1) => {
  if (offsets.length === 0) {
    return -1;
  }
  let closedY = y;
  if (openIndex >= 0) {
    const openTop = offsets[openIndex];
    if (y >= openTop && y < openTop + ROW_ADVANCE + BODY_HEIGHT) {
      return openIndex;
    }
    if (y >= openTop + ROW_ADVANCE + BODY_HEIGHT) {
      closedY = y - BODY_HEIGHT;
    }
  }
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= closedY) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

const StackCard = React.memo(({
  item,
  expanded,
  isFirst,
  quick,
  labelOpacity,
  onToggle,
  onOpen,
  onLongPress,
  styles,
  colors,
  noDefinitionLabel,
}) => {
  const open = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(open, {
      toValue: expanded ? 1 : 0,
      // Under the scrubber cards slide open and shut quickly as the handle
      // passes; a tap takes its time.
      duration: quick ? 160 : (expanded ? 300 : 220),
      easing: Easing.out(Easing.cubic),
      // Height pushes the cards below it down, which only layout can do.
      useNativeDriver: false,
    }).start();
  }, [expanded, open, quick]);

  const { word } = item;

  return (
    <>
      {item.showWhen ? (
        // A new day: a rule across to the timeline, ending in its dot. The
        // day's name sits by the dot, shown only while the scrubber is held.
        <View style={[styles.sectionRule, isFirst && styles.sectionRuleFirst]}>
          <View style={styles.sectionLine} />
          <View style={styles.sectionNode} />
          <Animated.View pointerEvents="none" style={[styles.dayLabel, { opacity: labelOpacity }]}>
            <Text numberOfLines={1} style={styles.dayLabelText}>{item.whenLabel}</Text>
          </Animated.View>
        </View>
      ) : null}
      <View style={styles.cardRow}>
        <Pressable
          onPress={() => onToggle(item.key)}
          onLongPress={() => onLongPress?.(word)}
          delayLongPress={320}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${word.word}, ${item.whenLabel}`}
          style={[styles.card, expanded && styles.cardOpen]}
        >
          <View style={styles.strip}>
            <Text numberOfLines={1} style={styles.word}>{word.word}</Text>
            {word.hanja ? <Text numberOfLines={1} style={styles.hanja}>{word.hanja}</Text> : null}
          </View>

          <Animated.View
            style={[
              styles.body,
              {
                height: open.interpolate({ inputRange: [0, 1], outputRange: [0, BODY_HEIGHT] }),
                opacity: open.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] }),
              },
            ]}
          >
            {expanded ? (
              <View style={styles.bodyInner}>
                <Text numberOfLines={3} style={styles.definition}>{word.def || noDefinitionLabel}</Text>
                {item.metaLabel ? <Text numberOfLines={1} style={styles.meta}>{item.metaLabel}</Text> : null}
                <View style={styles.footer}>
                  <View style={styles.dots}>
                    {Array.from({ length: DOT_COUNT }).map((_, index) => (
                      <View
                        key={index}
                        style={[styles.dot, index < item.strength ? styles.dotFilled : styles.dotEmpty]}
                      />
                    ))}
                  </View>
                  <Text numberOfLines={1} style={styles.footerWhen}>{item.whenLabel}</Text>
                  <Pressable
                    onPress={() => onOpen(word)}
                    accessibilityRole="button"
                    accessibilityLabel={item.openLabel}
                    hitSlop={12}
                    style={styles.openButton}
                  >
                    <Feather name="arrow-up-right" size={17} color={colors.text} />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </Animated.View>

          {/* The foot of the card, hidden under the next one. */}
          <View style={styles.cardFoot} />
        </Pressable>
      </View>
    </>
  );
});

// `labelOpacity` is an Animated.Value: 1 while the scrubber is held, else 0.
// One card is open at a time (`expandedKey`), so each stack stays a stack;
// `quick` is set while the scrubber is opening cards as it passes them.
const WordStack = ({
  items,
  expandedKey,
  quick = false,
  labelOpacity,
  onToggle,
  onOpen,
  onLongPress,
  onLayout,
  noDefinitionLabel,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const handleToggle = onToggle;

  return (
    <View style={styles.stack} onLayout={onLayout}>
      {/* The timeline: one line the whole way down. */}
      <View pointerEvents="none" style={styles.timeLine} />
      {items.map((item, index) => (
        <StackCard
          key={item.key}
          item={item}
          isFirst={index === 0}
          expanded={expandedKey === item.key}
          quick={quick}
          labelOpacity={labelOpacity}
          onToggle={handleToggle}
          onOpen={onOpen}
          onLongPress={onLongPress}
          styles={styles}
          colors={colors}
          noDefinitionLabel={noDefinitionLabel}
        />
      ))}
    </View>
  );
};

const THUMB_HEIGHT = 46;
const THUMB_WIDTH = 7;

// The scrubber: a handle riding the timeline that follows the scroll position
// and can be dragged to run through the whole list.
// `progress` is an Animated.Value in 0..1; `onScrub(p, handleY)` is called while
// dragging and `onDragChange(held)` when the handle is taken or let go.
export const TimelineScrubber = ({ progress, top, bottom, onScrub, onDragChange }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [trackHeight, setTrackHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const travel = Math.max(1, trackHeight - THUMB_HEIGHT);
  const travelRef = useRef(travel);
  travelRef.current = travel;
  const startRef = useRef(0);
  const progressValueRef = useRef(0);

  useEffect(() => {
    const id = progress.addListener(({ value }) => { progressValueRef.current = value; });
    return () => progress.removeListener(id);
  }, [progress]);

  const panResponder = useMemo(() => {
    const setHeld = (held) => {
      setDragging(held);
      onDragChange?.(held);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startRef.current = progressValueRef.current * travelRef.current;
        setHeld(true);
      },
      onPanResponderMove: (_, gesture) => {
        const next = Math.min(1, Math.max(0, (startRef.current + gesture.dy) / travelRef.current));
        // Also where the middle of the handle now is, from the top of its track.
        onScrub(next, next * travelRef.current + THUMB_HEIGHT / 2);
      },
      onPanResponderRelease: () => setHeld(false),
      onPanResponderTerminate: () => setHeld(false),
    });
  }, [onDragChange, onScrub]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, travel],
    extrapolate: 'clamp',
  });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.scrubTrack, { top, bottom }]}
      onLayout={(event) => setTrackHeight(event.nativeEvent.layout.height)}
    >
      {trackHeight > 0 ? (
        <Animated.View
          style={[styles.scrubThumbWrap, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <View style={[styles.scrubThumb, dragging && styles.scrubThumbActive]} />
        </Animated.View>
      ) : null}
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  stack: {
    // No space above the first row: getStackOffsets counts from here.
    paddingLeft: 16,
    paddingRight: TIMELINE_WIDTH,
  },
  timeLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: TIMELINE_WIDTH / 2,
    width: 1,
    backgroundColor: colors.border,
  },
  sectionRule: {
    // The row before this one tucks under its successor; undo that here so
    // the last card of a day shows whole, then leave a gap either side.
    marginTop: OVERLAP + SECTION_GAP,
    marginBottom: SECTION_GAP,
    // Reaches across the timeline's room to the line itself.
    marginRight: -TIMELINE_WIDTH / 2,
    height: NODE_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionRuleFirst: {
    marginTop: 0,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  sectionNode: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    // Centred on the timeline, which sits at this row's right edge.
    marginRight: -NODE_SIZE / 2,
    backgroundColor: colors.text,
  },
  dayLabel: {
    position: 'absolute',
    right: NODE_SIZE + 4,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: colors.text,
  },
  dayLabelText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.bgPage,
  },
  cardRow: {
    // Each card tucks under the next, so only its strip shows.
    marginBottom: -OVERLAP,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardOpen: {
    borderColor: colors.textSubtle,
  },
  strip: {
    height: STRIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  word: {
    flexShrink: 1,
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  hanja: {
    flexShrink: 1,
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  body: {
    overflow: 'hidden',
  },
  bodyInner: {
    height: BODY_HEIGHT,
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 5,
  },
  definition: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  meta: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSubtle,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
  dotFilled: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  dotEmpty: {
    backgroundColor: 'transparent',
    borderColor: colors.textSubtle,
  },
  footerWhen: {
    flex: 1,
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  openButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  cardFoot: {
    height: OVERLAP,
  },
  scrubTrack: {
    position: 'absolute',
    right: 0,
    // A touch target wider than the handle, centred on the timeline.
    width: TIMELINE_WIDTH + 14,
  },
  scrubThumbWrap: {
    position: 'absolute',
    right: 0,
    width: TIMELINE_WIDTH + 14,
    height: THUMB_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  scrubThumb: {
    marginRight: (TIMELINE_WIDTH - THUMB_WIDTH) / 2,
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: THUMB_WIDTH / 2,
    backgroundColor: colors.text,
  },
  scrubThumbActive: {
    transform: [{ scaleX: 1.4 }],
  },
});

export default WordStack;
