/**
 * Tests for the pure "before you go" candidate helpers (`wordCandidates.js`).
 * No database, no React — just selection logic and text matching.
 *
 * What we're pinning down:
 *  - the badge reason reflects the model's signals (rare-in-book beats low-P(known),
 *    which beats generic uncertainty);
 *  - the daily selection is deterministic within a day and rotates across days,
 *    never returns more than asked, and tolerates empty input;
 *  - example-sentence matching finds the containing sentence and degrades gracefully.
 */

import {
  deriveCandidateReason,
  dayNumber,
  selectDailyCandidates,
  pickExampleSentence,
} from '../wordCandidates';

describe('deriveCandidateReason', () => {
  test('rare-in-book wins even when P(known) is low', () => {
    expect(deriveCandidateReason({ remainingCount: 1, pKnown: 0.1 })).toBe('rare');
    expect(deriveCandidateReason({ remainingCount: 0, pKnown: 0.9 })).toBe('rare');
  });

  test('low P(known) with more exposures reads as "new here"', () => {
    expect(deriveCandidateReason({ remainingCount: 5, pKnown: 0.2 })).toBe('new');
  });

  test('mid P(known) and recurring is a closer look', () => {
    expect(deriveCandidateReason({ remainingCount: 5, pKnown: 0.55 })).toBe('closerLook');
  });

  test('missing signals fall back to closerLook', () => {
    expect(deriveCandidateReason({})).toBe('closerLook');
  });
});

describe('selectDailyCandidates', () => {
  const pool = Array.from({ length: 6 }, (_, i) => ({
    stem: `w${i}`,
    remainingCount: 5,
    pKnown: 0.5,
  }));

  test('returns at most `count` and attaches a reason', () => {
    const picks = selectDailyCandidates(pool, { date: new Date('2026-07-08'), count: 3 });
    expect(picks).toHaveLength(3);
    picks.forEach((p) => expect(typeof p.reason).toBe('string'));
  });

  test('is stable within the same day', () => {
    const a = selectDailyCandidates(pool, { date: new Date('2026-07-08T09:00:00'), count: 3 });
    const b = selectDailyCandidates(pool, { date: new Date('2026-07-08T21:00:00'), count: 3 });
    expect(a.map((p) => p.stem)).toEqual(b.map((p) => p.stem));
  });

  test('rotates across days', () => {
    const today = selectDailyCandidates(pool, { date: new Date('2026-07-08'), count: 3 });
    const tomorrow = selectDailyCandidates(pool, { date: new Date('2026-07-09'), count: 3 });
    expect(today.map((p) => p.stem)).not.toEqual(tomorrow.map((p) => p.stem));
  });

  test('handles empty input and count larger than pool', () => {
    expect(selectDailyCandidates([], { count: 3 })).toEqual([]);
    expect(selectDailyCandidates(pool.slice(0, 2), { count: 5 })).toHaveLength(2);
  });
});

describe('dayNumber', () => {
  test('same calendar day maps to the same number', () => {
    expect(dayNumber(new Date('2026-07-08T00:01:00'))).toBe(dayNumber(new Date('2026-07-08T23:59:00')));
  });

  test('consecutive days differ by one', () => {
    expect(dayNumber(new Date('2026-07-09')) - dayNumber(new Date('2026-07-08'))).toBe(1);
  });
});

describe('pickExampleSentence', () => {
  const text = '붉은 노을이 언덕 너머로 번졌다. 바람이 지나가며 잔물결을 남겼다.';

  test('returns the sentence containing the surface', () => {
    expect(pickExampleSentence(text, '노을')).toBe('붉은 노을이 언덕 너머로 번졌다.');
    expect(pickExampleSentence(text, '잔물결')).toBe('바람이 지나가며 잔물결을 남겼다.');
  });

  test('returns null when the word is absent or inputs are empty', () => {
    expect(pickExampleSentence(text, '없는단어')).toBeNull();
    expect(pickExampleSentence('', '노을')).toBeNull();
    expect(pickExampleSentence(text, '')).toBeNull();
  });

  test('falls back to a window when the containing sentence is too long', () => {
    const long = `앞부분 ${'가'.repeat(300)} 목표단어 뒷부분`;
    const result = pickExampleSentence(long, '목표단어', { maxLength: 40 });
    expect(result).toContain('목표단어');
    expect(result.length).toBeLessThanOrEqual(40);
  });
});
