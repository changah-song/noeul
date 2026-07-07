/**
 * Tests for the Phase 1 interaction event log (append-only history of every
 * word interaction). See "personalization model implementation plan.md" §1.
 *
 * HOW THESE TESTS WORK (worth reading if you're new to this setup):
 *
 * - `expo-sqlite` is swapped for an in-memory SQLite engine by jest.config.js
 *   (moduleNameMapper). So `createInteractionEventsTable` / `logInteractionEvent`
 *   run their REAL SQL against a REAL database — we're testing the actual schema,
 *   not a stand-in. The database lives in memory and vanishes when the test
 *   process exits; nothing touches a device or a file.
 *
 * - `hanjaDatabase` is mocked out below. Database.js imports it, and it in turn
 *   `require()`s a binary `.db` asset at load time, which Jest can't bundle. We
 *   don't exercise hanja logic here, so replacing it with an empty stub lets us
 *   import Database.js cleanly. This is the standard trick: mock the neighbor you
 *   don't care about so you can import the module you do.
 *
 * - Before each test we reset the in-memory DB and recreate the table, so every
 *   test starts from an identical, empty schema and can't leak state into the next.
 */

// Must be declared before importing Database.js so the mock is in place when
// Database.js resolves its `./hanjaDatabase` import.
jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createDictionaryCacheTable,
  createInteractionEventsTable,
  createProfileAbilityTable,
  createTable,
  getUnsyncedInteractionEvents,
  insertData,
  logInteractionEvent,
  markInteractionEventsSynced,
  migrateVocabTable,
  recordReviewOutcome,
} from '../Database';

// The mock exposes a reset helper that isn't part of the real expo-sqlite API.
const { __resetMockDatabases } = SQLite;

// A tiny read helper so tests can inspect what actually landed in the table.
// It talks to the same in-memory DB Database.js uses (same filename → same engine).
const queryAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          reject(error);
          return true;
        }
      );
    });
  });

beforeEach(async () => {
  __resetMockDatabases();
  await createTable();
  await migrateVocabTable();
  await createInteractionEventsTable();
  // recordReviewOutcome also fires the Phase 3.1 theta update (fire-and-forget),
  // which reads these two tables — create them so that side effect runs cleanly.
  await createProfileAbilityTable();
  await createDictionaryCacheTable();
});

describe('logInteractionEvent', () => {
  it('inserts an event and reads it back with the expected fields', async () => {
    const result = await logInteractionEvent({
      ownerId: 'user-123',
      profileId: 'ko_default',
      language: 'ko',
      word: '사과',
      hanja: null,
      eventType: 'review',
      grade: 3,
      outcome: 1,
      sourceBookUri: 'file://book.epub',
      sentence: '나는 사과를 먹었다.',
      vocabId: 42,
    });

    // The helper reports it inserted a fresh row and hands back the generated id.
    expect(result.inserted).toBe(true);
    expect(typeof result.clientEventId).toBe('string');
    expect(result.clientEventId.length).toBeGreaterThan(0);

    const rows = await queryAll('SELECT * FROM interaction_events');
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.owner_id).toBe('user-123');
    expect(row.profile_id).toBe('ko_default');
    expect(row.language).toBe('ko');
    expect(row.word).toBe('사과');
    expect(row.event_type).toBe('review');
    expect(row.grade).toBe(3);
    expect(row.outcome).toBe(1);
    expect(row.source_book_uri).toBe('file://book.epub');
    expect(row.sentence).toBe('나는 사과를 먹었다.');
    expect(row.vocab_id).toBe(42);
    expect(row.client_event_id).toBe(result.clientEventId);
    // Never synced yet, never deleted.
    expect(row.synced_at).toBeNull();
    expect(row.deleted_at).toBeNull();
  });

  it('is idempotent: re-inserting the same client_event_id is a no-op', async () => {
    const clientEventId = 'evt_fixed_id_for_test';

    const first = await logInteractionEvent({
      ownerId: 'user-123',
      eventType: 'lookup',
      word: '책',
      clientEventId,
    });
    const second = await logInteractionEvent({
      ownerId: 'user-123',
      eventType: 'lookup',
      word: '책',
      clientEventId,
    });

    // First insert takes; the duplicate is ignored (this is what makes retrying a
    // sync safe — the same event can be re-sent without creating duplicates).
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);

    const rows = await queryAll(
      'SELECT * FROM interaction_events WHERE client_event_id = ?',
      [clientEventId]
    );
    expect(rows).toHaveLength(1);
  });

  it('normalizes a truthy outcome to 1 and a falsy outcome to 0', async () => {
    await logInteractionEvent({ eventType: 'review', outcome: true, word: 'a' });
    await logInteractionEvent({ eventType: 'review', outcome: false, word: 'b' });

    const rows = await queryAll(
      'SELECT word, outcome FROM interaction_events ORDER BY id'
    );
    expect(rows.map((r) => r.outcome)).toEqual([1, 0]);
  });

  it('leaves outcome null when it is not provided', async () => {
    await logInteractionEvent({ eventType: 'save', word: '나무' });

    const rows = await queryAll('SELECT outcome FROM interaction_events');
    expect(rows[0].outcome).toBeNull();
  });

  it('rejects an unknown event_type without inserting anything', async () => {
    await expect(
      logInteractionEvent({ eventType: 'not_a_real_type', word: 'x' })
    ).rejects.toThrow(/invalid event_type/);

    const rows = await queryAll('SELECT COUNT(*) AS n FROM interaction_events');
    expect(rows[0].n).toBe(0);
  });

  it('generates unique client_event_ids across separate inserts', async () => {
    const a = await logInteractionEvent({ eventType: 'lookup', word: '하나' });
    const b = await logInteractionEvent({ eventType: 'lookup', word: '둘' });

    expect(a.clientEventId).not.toBe(b.clientEventId);

    const rows = await queryAll('SELECT COUNT(*) AS n FROM interaction_events');
    expect(rows[0].n).toBe(2);
  });

  it('derives def_key from a raw definition when defKey is not passed', async () => {
    await logInteractionEvent({
      eventType: 'save',
      word: '학교',
      def: '  A School  ', // messy casing/whitespace on purpose
    });

    const rows = await queryAll('SELECT def_key FROM interaction_events');
    // Normalized: lowercased, trimmed, collapsed whitespace.
    expect(rows[0].def_key).toBe('a school');
  });
});

// The review channel is the model's only unconfounded label, so grading a card
// MUST leave a review event behind. recordReviewOutcome logs it before mutating
// the vocab row's FSRS state; here we confirm the row lands with the right shape.
describe('recordReviewOutcome interaction logging', () => {
  const OWNER = 'user-review';

  const seedCard = () =>
    insertData('공부', null, 'study', {
      ownerId: OWNER,
      language: 'ko',
      level: 'unorganized',
    });

  it('logs a review event with grade 3 / outcome 1 for a "good" grade', async () => {
    await seedCard();

    await recordReviewOutcome('공부', null, 'study', 'unorganized', 'good', 'ko', {
      ownerId: OWNER,
      wordData: { last_reviewed_at: null },
    });

    const events = await queryAll(
      "SELECT * FROM interaction_events WHERE event_type = 'review'"
    );
    expect(events).toHaveLength(1);
    expect(events[0].word).toBe('공부');
    expect(events[0].grade).toBe(3);
    expect(events[0].outcome).toBe(1);
    expect(events[0].owner_id).toBe(OWNER);
  });

  it('logs outcome 0 with grade 1 for a "bad" grade (a lapse)', async () => {
    await seedCard();

    await recordReviewOutcome('공부', null, 'study', 'unorganized', 'bad', 'ko', {
      ownerId: OWNER,
      wordData: { last_reviewed_at: null },
    });

    const events = await queryAll(
      "SELECT grade, outcome FROM interaction_events WHERE event_type = 'review'"
    );
    expect(events).toHaveLength(1);
    expect(events[0].grade).toBe(1);
    expect(events[0].outcome).toBe(0);
  });
});

// These back the push-only cloud sync: find what hasn't been sent, then stamp it
// synced so it isn't sent again. (The network push itself is exercised separately;
// here we lock down the local bookkeeping.)
describe('interaction event sync bookkeeping', () => {
  const OWNER = 'user-sync';

  it('returns only unsynced, non-deleted events for the owner, oldest first', async () => {
    const older = await logInteractionEvent({
      ownerId: OWNER,
      eventType: 'lookup',
      word: 'first',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = await logInteractionEvent({
      ownerId: OWNER,
      eventType: 'lookup',
      word: 'second',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    // A different owner's event must not leak into this owner's push.
    await logInteractionEvent({ ownerId: 'someone-else', eventType: 'lookup', word: 'other' });

    const unsynced = await getUnsyncedInteractionEvents(OWNER);
    expect(unsynced.map((e) => e.word)).toEqual(['first', 'second']);
    expect(unsynced.map((e) => e.client_event_id)).toEqual([
      older.clientEventId,
      newer.clientEventId,
    ]);
  });

  it('stops returning events once they are marked synced', async () => {
    const a = await logInteractionEvent({ ownerId: OWNER, eventType: 'save', word: 'a' });
    await logInteractionEvent({ ownerId: OWNER, eventType: 'save', word: 'b' });

    const marked = await markInteractionEventsSynced([a.clientEventId]);
    expect(marked).toBe(1);

    const remaining = await getUnsyncedInteractionEvents(OWNER);
    expect(remaining.map((e) => e.word)).toEqual(['b']);
  });

  it('respects the limit option', async () => {
    for (const w of ['a', 'b', 'c']) {
      // eslint-disable-next-line no-await-in-loop
      await logInteractionEvent({ ownerId: OWNER, eventType: 'lookup', word: w });
    }

    const firstPage = await getUnsyncedInteractionEvents(OWNER, { limit: 2 });
    expect(firstPage).toHaveLength(2);
  });
});
