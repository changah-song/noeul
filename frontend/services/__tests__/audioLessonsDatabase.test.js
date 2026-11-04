/**
 * Audio lesson episodes in SQLite (services/Database.js audio_lessons) and
 * the per-word topic / book lookup that plans them. Real in-memory SQLite
 * (see test/mocks/expoSqliteMock.js).
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../supabase', () => ({}));

import * as SQLite from 'expo-sqlite';
import {
  clearSqliteUserData,
  createAbilityLogTable,
  createAudioLessonsTable,
  createBookBookmarksTable,
  createBookIndexTable,
  createBookNotesTable,
  createBookPreprocessTables,
  createDictionaryCacheTable,
  createGrammarTables,
  createInteractionEventsTable,
  createProfileAbilityTable,
  createTable,
  createVocabContextTable,
  createWordScoresTable,
  getAudioLessons,
  getAudioLessonWordInfo,
  markAudioLessonPlayed,
  reassignSqliteUserData,
  saveAudioLesson,
} from '../Database';

const { __resetMockDatabases } = SQLite;
const scope = { ownerId: 'owner-a', profileId: 'ko_default', language: 'ko' };

const run = (sql, params = []) => new Promise((resolve, reject) => {
  SQLite.openDatabase('fluentfable.db').transaction((tx) => {
    tx.executeSql(sql, params, (_, r) => resolve(r), (_, e) => { reject(e); return true; });
  });
});

beforeEach(async () => {
  __resetMockDatabases();
  await createTable();
  await createVocabContextTable();
  await createInteractionEventsTable();
  await createProfileAbilityTable();
  await createAbilityLogTable();
  await createWordScoresTable();
  await createDictionaryCacheTable();
  await createBookIndexTable();
  await createBookNotesTable();
  await createBookBookmarksTable();
  await createGrammarTables();
  await createBookPreprocessTables();
  await createAudioLessonsTable();
});

describe('audio_lessons', () => {
  it('saves episodes per owner, profile and language, newest first', async () => {
    await saveAudioLesson({
      ...scope,
      theme: { kind: 'topic', key: 'food' },
      words: [{ word: '감자', hanja: null, def: 'potato', language: 'ko' }],
      now: '2026-11-01T10:00:00Z',
    });
    await saveAudioLesson({ ...scope, words: [{ word: '물', def: 'water' }], now: '2026-11-02T10:00:00Z' });
    await saveAudioLesson({ ...scope, language: 'en', words: [{ word: 'gate' }] });
    await saveAudioLesson({ ...scope, ownerId: 'owner-b', words: [{ word: '집' }] });

    const lessons = await getAudioLessons(scope);
    expect(lessons.map((lesson) => lesson.words[0].word)).toEqual(['물', '감자']);
    expect(lessons[1].theme).toEqual({ kind: 'topic', key: 'food' });
    expect(lessons[0].theme).toBeNull();
    expect(lessons[1].completedAt).toBeNull();
  });

  it('counts plays and records the first finish', async () => {
    const lesson = await saveAudioLesson({ ...scope, words: [{ word: '감자' }] });
    await markAudioLessonPlayed(lesson.id, { now: '2026-11-03T08:00:00Z' });
    await markAudioLessonPlayed(lesson.id, { completed: true, now: '2026-11-03T08:05:00Z' });
    await markAudioLessonPlayed(lesson.id, { now: '2026-11-04T08:00:00Z' });
    await markAudioLessonPlayed(lesson.id, { completed: true, now: '2026-11-04T08:05:00Z' });
    const [saved] = await getAudioLessons(scope);
    expect(saved.playCount).toBe(2);
    expect(saved.completedAt).toBe('2026-11-03T08:05:00.000Z');
    expect(saved.lastPlayedAt).toBe('2026-11-04T08:05:00.000Z');
  });

  it('moves with the owner on guest import and goes with a cleared owner', async () => {
    await saveAudioLesson({ ...scope, ownerId: 'guest', words: [{ word: '감자' }] });
    await reassignSqliteUserData('guest', 'owner-a');
    expect(await getAudioLessons(scope)).toHaveLength(1);
    await clearSqliteUserData('owner-a');
    expect(await getAudioLessons(scope)).toHaveLength(0);
  });
});

describe('getAudioLessonWordInfo', () => {
  it('reads the dictionary topic and the book the word was met in most', async () => {
    await run(
      `INSERT INTO dictionary_cache (stem, language, interface_language, definition, domain)
       VALUES ('감자', 'ko', 'en', 'potato', '음식 주문하기'), ('감자', 'ko', 'ja', 'じゃがいも', NULL),
              ('물', 'ko', 'en', 'water', NULL)`
    );
    const context = (word, book) => run(
      `INSERT INTO vocab_contexts (owner_id, profile_id, word, sentence, source_book_title, language)
       VALUES (?, ?, ?, 's', ?, 'ko')`,
      [scope.ownerId, scope.profileId, word, book]
    );
    await context('감자', '감자');
    await context('감자', '감자');
    await context('감자', '운수 좋은 날');
    await context('물', null);

    const info = await getAudioLessonWordInfo({ ...scope, words: ['감자', '물', '없음'] });
    expect(info['감자']).toEqual({ domain: '음식 주문하기', book: '감자' });
    expect(info['물']).toBeUndefined();
    expect(info['없음']).toBeUndefined();
  });
});
