/**
 * Tests for the Phase 4.2 training-dataset builder (see "personalization model
 * implementation plan.md" §4.2). Pure — no SQLite. These pin down that the
 * prequential replay emits leak-free (feature, label) rows and that the
 * reconstructable behavioral state (theta, prior counts, known-hanja) evolves
 * correctly across the stream, while SRS state is deliberately left absent
 * (pre-card framing, design doc §6).
 */

import { buildProfileRows, buildTrainingDataset } from '../featureDataset';

const rev = (o = {}) => ({
  ownerId: 'u1', profileId: 'ko_default', language: 'ko',
  word: o.stem ?? 'w', stem: o.stem ?? 'w',
  eventType: 'review', outcome: 1, levelRank: 2, hanja: null, pos: 'noun',
  createdAt: '2026-01-01T00:00:00Z', clientEventId: 'c', selfReportRank: 2,
  ...o,
});

describe('buildProfileRows — prequential feature/label rows', () => {
  it('emits one row per graded review, with label = outcome and a cold flag', () => {
    const rows = buildProfileRows({
      language: 'ko',
      selfReportRank: 2,
      events: [
        rev({ stem: 'a', clientEventId: 'a1', createdAt: '2026-01-01T00:00:00Z', outcome: 1 }),
        rev({ stem: 'a', clientEventId: 'a2', createdAt: '2026-01-01T01:00:00Z', outcome: 0 }),
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.label)).toEqual([1, 0]);
    expect(rows[0].cold).toBe(true); // first encounter of 'a'
    expect(rows[1].cold).toBe(false);
  });

  it('grows cross-word hanja overlap as earlier words teach shared hanja', () => {
    const rows = buildProfileRows({
      language: 'ko',
      selfReportRank: 2,
      events: [
        rev({ stem: '학교', hanja: '學校', clientEventId: 'e1', createdAt: '2026-01-01T00:00:00Z' }),
        rev({ stem: '학생', hanja: '學生', clientEventId: 'e2', createdAt: '2026-01-02T00:00:00Z' }),
      ],
    });
    // First word: nothing known yet → overlap 0. Second word shares 學 → 0.5.
    expect(rows[0].vector.item_cross_hanja_overlap).toBe(0);
    expect(rows[1].vector.item_cross_hanja_overlap).toBe(0.5);
    expect(rows[1].mask.item_cross_hanja_overlap).toBe(1);
  });

  it('evolves theta so a later correct-review prediction reflects a higher ability', () => {
    const rows = buildProfileRows({
      language: 'ko',
      selfReportRank: 2,
      events: [
        rev({ stem: 'a', clientEventId: 'a1', createdAt: '2026-01-01T00:00:00Z', outcome: 1 }),
        rev({ stem: 'b', clientEventId: 'b1', createdAt: '2026-01-02T00:00:00Z', outcome: 1 }),
      ],
    });
    // theta_0 for both is the same seed, but the second row is scored after a
    // correct review raised theta.
    expect(rows[1].vector.user_theta).toBeGreaterThan(rows[0].vector.user_theta);
  });

  it('counts prior lookups into the next review’s features but emits no lookup rows', () => {
    const rows = buildProfileRows({
      language: 'ko',
      selfReportRank: 2,
      events: [
        rev({ stem: 'a', eventType: 'lookup', outcome: null, clientEventId: 'l1', createdAt: '2026-01-01T00:00:00Z' }),
        rev({ stem: 'a', eventType: 'review', outcome: 1, clientEventId: 'r1', createdAt: '2026-01-02T00:00:00Z' }),
      ],
    });
    expect(rows).toHaveLength(1); // only the review
    expect(rows[0].vector.explicit_lookup_count).toBe(1); // the prior lookup is counted
  });

  it('leaves SRS features absent (mask 0) — pre-card framing', () => {
    const rows = buildProfileRows({ language: 'ko', selfReportRank: 2, events: [rev({ stem: 'a' })] });
    expect(rows[0].mask.srs_stability).toBe(0);
    expect(rows[0].mask.srs_difficulty).toBe(0);
    // srs_saved is a real fact (0 here — not a card at prediction time).
    expect(rows[0].vector.srs_saved).toBe(0);
    expect(rows[0].mask.srs_saved).toBe(1);
  });
});

describe('buildTrainingDataset', () => {
  it('summarizes profiles / rows and a stable sorted feature-key union', () => {
    const events = [
      rev({ ownerId: 'A', stem: 'a', clientEventId: 'a1' }),
      rev({ ownerId: 'B', stem: 'b', clientEventId: 'b1' }),
    ];
    const ds = buildTrainingDataset(events, { source: 'test' });
    expect(ds.meta.profiles).toBe(2);
    expect(ds.meta.rowCount).toBe(2);
    expect(ds.rows).toHaveLength(2);
    expect(ds.meta.featureKeys.length).toBeGreaterThan(0);
    // sorted union
    expect(ds.meta.featureKeys).toEqual([...ds.meta.featureKeys].sort());
    expect(ds.meta.categoricalKeys).toContain('item_pos');
    expect(ds.meta.source).toBe('test');
  });
});
