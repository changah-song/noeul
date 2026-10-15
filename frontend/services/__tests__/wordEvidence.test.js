import {
  EVIDENCE_EXPOSURE_CAP,
  EVIDENCE_LOOKUP_FLOOR,
  adjustedPKnown,
  evidenceLogit,
  summarizeEvidenceRows,
} from '../wordEvidence';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-15T00:00:00Z');

describe('summarizeEvidenceRows', () => {
  it('folds grouped rows into one record per stem', () => {
    const summary = summarizeEvidenceRows([
      { stem: '눕다', event_type: 'lookup', outcome: null, n: 3, last_at: '2026-10-10T00:00:00Z' },
      { stem: '눕다', event_type: 'exposure', outcome: null, n: 5, last_at: '2026-10-12T00:00:00Z' },
      { stem: '눕다', event_type: 'review', outcome: 1, n: 2, last_at: '2026-10-13T00:00:00Z' },
      { stem: '눕다', event_type: 'review', outcome: 0, n: 1, last_at: '2026-10-11T00:00:00Z' },
      { stem: '집', event_type: 'save', outcome: null, n: 1, last_at: '2026-10-01T00:00:00Z' },
      { stem: '', event_type: 'lookup', n: 9 },
    ]);
    expect(summary.get('눕다')).toEqual({
      lookups: 3, lastLookupAt: Date.parse('2026-10-10T00:00:00Z'), exposures: 5, reviewsGood: 2, reviewsBad: 1, saved: false,
    });
    expect(summary.get('집').saved).toBe(true);
    expect(summary.has('')).toBe(false);
  });

  it('an unsave after a save clears the saved flag', () => {
    const summary = summarizeEvidenceRows([
      { stem: '집', event_type: 'save', n: 1, last_at: '2026-10-01T00:00:00Z' },
      { stem: '집', event_type: 'unsave', n: 1, last_at: '2026-10-02T00:00:00Z' },
    ]);
    expect(summary.get('집').saved).toBe(false);
  });
});

describe('evidenceLogit', () => {
  it('is zero with no history', () => {
    expect(evidenceLogit(undefined, now)).toBe(0);
    expect(evidenceLogit({ lookups: 0, exposures: 0, reviewsGood: 0, reviewsBad: 0, saved: false }, now)).toBe(0);
  });

  it('a recent lookup pushes the word darker, and the push fades with age', () => {
    const fresh = evidenceLogit({ lookups: 1, lastLookupAt: now - DAY, exposures: 0, reviewsGood: 0, reviewsBad: 0 }, now);
    const old = evidenceLogit({ lookups: 1, lastLookupAt: now - 120 * DAY, exposures: 0, reviewsGood: 0, reviewsBad: 0 }, now);
    expect(fresh).toBeLessThan(0);
    expect(old).toBeLessThan(0);
    expect(Math.abs(old)).toBeLessThan(Math.abs(fresh) / 4);
  });

  it('repeated lookups add up with diminishing returns and a floor', () => {
    const one = evidenceLogit({ lookups: 1, lastLookupAt: now, exposures: 0, reviewsGood: 0, reviewsBad: 0 }, now);
    const five = evidenceLogit({ lookups: 5, lastLookupAt: now, exposures: 0, reviewsGood: 0, reviewsBad: 0 }, now);
    const fifty = evidenceLogit({ lookups: 50, lastLookupAt: now, exposures: 0, reviewsGood: 0, reviewsBad: 0 }, now);
    expect(five).toBeLessThan(one);
    expect(fifty).toBeGreaterThanOrEqual(EVIDENCE_LOOKUP_FLOOR);
  });

  it('exposures lighten up to a cap; reviews move the word strongly', () => {
    const some = evidenceLogit({ lookups: 0, exposures: 3, reviewsGood: 0, reviewsBad: 0 }, now);
    const many = evidenceLogit({ lookups: 0, exposures: 300, reviewsGood: 0, reviewsBad: 0 }, now);
    expect(some).toBeGreaterThan(0);
    expect(many).toBe(EVIDENCE_EXPOSURE_CAP);
    expect(evidenceLogit({ lookups: 0, exposures: 0, reviewsGood: 2, reviewsBad: 0 }, now)).toBeGreaterThan(1);
    expect(evidenceLogit({ lookups: 0, exposures: 0, reviewsGood: 0, reviewsBad: 2 }, now)).toBeLessThan(-1);
  });
});

describe('adjustedPKnown', () => {
  it('leaves the baseline alone without evidence and moves it with evidence', () => {
    expect(adjustedPKnown(0.6, undefined, now)).toBe(0.6);
    const lookedUp = adjustedPKnown(0.9, { lookups: 2, lastLookupAt: now, exposures: 0, reviewsGood: 0, reviewsBad: 0 }, now);
    expect(lookedUp).toBeLessThan(0.85); // a confident "known" word drops back under the mark ceiling
    const recalled = adjustedPKnown(0.4, { lookups: 0, exposures: 0, reviewsGood: 3, reviewsBad: 0 }, now);
    expect(recalled).toBeGreaterThan(0.85); // reviewed well: no longer marked
  });
});
