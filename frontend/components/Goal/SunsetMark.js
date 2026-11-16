import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// The sunset (노을) marks for reading past the goal. Stages come from
// services/readingGoal.js sunsetStage: 0 not reached yet, 1 golden hour (the
// goal), 2 sunset, 3 dusk, 4–6 one, two and three stars.

// star-four-points spans 22 of its 24-unit box.
const STAR_GLYPH_FILL = 22 / 24;

/** A four-pointed star centred on (cx, cy), `r` from centre to tip. */
export const Star = ({ cx, cy, r, color }) => {
  const size = (r * 2) / STAR_GLYPH_FILL;
  return (
    <MaterialCommunityIcons
      name="star-four-points"
      size={size}
      color={color}
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: cy - size / 2,
        width: size,
        height: size,
        lineHeight: size,
        textAlign: 'center',
      }}
    />
  );
};

// The mark: 28 wide; a sky of 7.5 above the sun, the sun's 7.5, the horizon,
// then two thinner rows of reflection. The horizon sits at SKY + SUN.
const WIDTH = 28;
const SKY = 7.5;
const SUN = 7.5;
const BAR = 2.6;
const ROW = 2;
const ROW_GAP = 2.2;
const HORIZON = SKY + SUN;
export const SUNSET_MARK_HEIGHT = HORIZON + BAR + 2 * (ROW_GAP + ROW);
// The empty sky above the horizon, so callers can line the horizon up.
export const SUNSET_MARK_SKY = SKY;

// How far the sun's centre sits below the horizon, by stage.
const SUN_DROP = { 1: 0, 2: 2.6, 3: 4.6 };
// The reflection's rows by stage, as widths from the horizon down. It narrows
// as the sun sets (long and short, long, short) and comes back the same way
// with the stars (short, long, long and short).
const LONG = 14;
const SHORT = 8;
const REFLECTION_ROWS = [[], [LONG, SHORT], [LONG], [SHORT], [SHORT], [LONG], [LONG, SHORT]];
// Where each star comes out, and stays: right, low left, then the biggest
// high in the middle.
const MARK_STARS = [
  { cx: 22.3, cy: SKY + 1, r: 3.6 },
  { cx: 5.4, cy: SKY + 2.4, r: 3.1 },
  { cx: 13.7, cy: SKY - 3, r: 4.5 },
];

/**
 * SunsetMark — Home's goal mark beside the streak. Before the goal, the sun's
 * outline on the horizon; at the goal, the filled half sun with two rows of
 * reflection; then every 15 minutes past it the sun sinks and the reflection
 * narrows, until it has set and stars come out (the reflection widening again
 * with each).
 */
export const SunsetMark = ({ stage = 0, color }) => {
  const bar = { position: 'absolute', height: BAR, borderRadius: BAR / 2, backgroundColor: color };
  const row = { position: 'absolute', height: ROW, borderRadius: ROW / 2, backgroundColor: color };
  const rows = REFLECTION_ROWS[stage] ?? [];
  const stars = Math.max(0, stage - 3);
  return (
    <View style={{ width: WIDTH, height: SUNSET_MARK_HEIGHT }}>
      {stage === 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 6.5,
            top: SKY,
            width: 15,
            height: SUN,
            borderTopLeftRadius: SUN,
            borderTopRightRadius: SUN,
            borderWidth: 2.2,
            borderBottomWidth: 0,
            borderColor: color,
          }}
        />
      ) : null}
      {SUN_DROP[stage] != null ? (
        // The sun, cut off at the horizon.
        <View style={{ position: 'absolute', left: 6.5, top: SKY, width: 15, height: SUN, overflow: 'hidden' }}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: SUN_DROP[stage],
              width: 15,
              height: 15,
              borderRadius: 7.5,
              backgroundColor: color,
            }}
          />
        </View>
      ) : null}
      {MARK_STARS.slice(0, stars).map((star, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <Star key={index} {...star} color={color} />
      ))}
      <View style={[bar, { left: 0, top: HORIZON, width: WIDTH }]} />
      {rows.map((width, index) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={`row-${index}`}
          style={[row, { left: (WIDTH - width) / 2, top: HORIZON + BAR + ROW_GAP + index * (ROW + ROW_GAP), width }]}
        />
      ))}
    </View>
  );
};

// The calendar's goal-day dot grows through the sunset, then turns to stars.
const CALENDAR_DOT = { 1: 8, 2: 10, 3: 12 };
const CALENDAR_STARS = {
  4: [{ cx: 0, cy: 0, r: 7 }],
  5: [{ cx: -6, cy: 4, r: 4.5 }, { cx: 6, cy: -3.5, r: 5 }],
  6: [{ cx: -10.5, cy: 5, r: 3.6 }, { cx: 0.5, cy: -4.5, r: 6.5 }, { cx: 10, cy: 2, r: 4.2 }],
};
const CALENDAR_GLYPH = { width: 32, height: 26 };

/** A goal day in the calendar: a dot of 8, 10 or 12, or one to three stars. */
export const CalendarSunsetGlyph = ({ stage, color }) => {
  const stars = CALENDAR_STARS[Math.min(stage, 6)];
  if (!stars) {
    const size = CALENDAR_DOT[stage] ?? CALENDAR_DOT[1];
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  }
  const midX = CALENDAR_GLYPH.width / 2;
  const midY = CALENDAR_GLYPH.height / 2;
  return (
    <View style={CALENDAR_GLYPH}>
      {stars.map((star, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <Star key={index} cx={midX + star.cx} cy={midY + star.cy} r={star.r} color={color} />
      ))}
    </View>
  );
};
