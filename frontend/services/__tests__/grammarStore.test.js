/**
 * Grammar mode's local store: patterns met (once per sentence), kept for
 * review, and review answers moving a pattern from practising to known.
 * Real in-memory SQLite (see test/mocks/expoSqliteMock.js).
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../supabase', () => ({}));

import * as SQLite from 'expo-sqlite';
import {
  createGrammarTables,
  getGrammarPatternExamples,
  getGrammarPatterns,
  getGrammarReviewItems,
  recordGrammarEncounter,
  recordGrammarReview,
  setGrammarPatternKept,
} from '../Database';

const { __resetMockDatabases } = SQLite;
const scope = { ownerId: 'reader-1', profileId: 'en_default', language: 'en' };
const result = {
  pattern_id: 'en.relative_extra',
  title: 'who로 덧붙이는 설명',
  form: ', who … , / , which … ,',
  level: 'B1',
  rule: '쉼표 사이의 who 부분은 앞사람을 설명해요.',
  chunks: [
    { text: 'Scrooge,', label: '누가', pattern: false },
    { text: 'who had never been afraid of anything,', label: '어떤 사람', pattern: true },
  ],
  blank: 'who',
  options: ['which', 'what', 'whose'],
};

beforeEach(async () => {
  __resetMockDatabases();
  await createGrammarTables();
});

describe('grammar patterns', () => {
  it('counts each sentence once and keeps the books it came from', async () => {
    const sentence = 'Scrooge, who had never been afraid of anything, felt a strange chill.';
    await recordGrammarEncounter({ ...scope, result, sentence, bookTitle: 'A Christmas Carol' });
    await recordGrammarEncounter({ ...scope, result, sentence, bookTitle: 'A Christmas Carol' });
    const row = await recordGrammarEncounter({
      ...scope, result, sentence: 'Peter, who was very naughty, ran away.', bookTitle: 'Peter Rabbit',
    });
    expect(row).toEqual({ patternId: 'en.relative_extra', encounters: 2, kept: false });

    const [pattern] = await getGrammarPatterns(scope);
    expect(pattern).toMatchObject({ patternId: 'en.relative_extra', level: 'B1', state: 'new', encounters: 2 });
    expect(pattern.bookTitles.sort()).toEqual(['A Christmas Carol', 'Peter Rabbit']);
    const examples = await getGrammarPatternExamples({ ...scope, patternId: 'en.relative_extra' });
    expect(examples).toHaveLength(2);
    expect(examples[0].options).toEqual(['which', 'what', 'whose']);
  });

  it('ignores a sentence with no tracked pattern', async () => {
    expect(await recordGrammarEncounter({ ...scope, result: { pattern_id: 'none' }, sentence: 'Hi.' })).toBeNull();
    expect(await getGrammarPatterns(scope)).toEqual([]);
  });

  it('reviews kept patterns; three right answers in a row make one known', async () => {
    await recordGrammarEncounter({ ...scope, result, sentence: 'Scrooge, who had never been afraid, felt cold.' });
    expect(await getGrammarReviewItems(scope)).toEqual([]);
    await setGrammarPatternKept({ ...scope, patternId: 'en.relative_extra', kept: true });
    const items = await getGrammarReviewItems(scope);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ blank: 'who', options: ['which', 'what', 'whose'] });

    expect(await recordGrammarReview({ ...scope, patternId: 'en.relative_extra', correct: true }))
      .toEqual({ streak: 1, state: 'practising' });
    // Not due again until tomorrow.
    expect(await getGrammarReviewItems(scope)).toEqual([]);
    await recordGrammarReview({ ...scope, patternId: 'en.relative_extra', correct: true });
    expect(await recordGrammarReview({ ...scope, patternId: 'en.relative_extra', correct: true }))
      .toEqual({ streak: 3, state: 'known' });
    expect(await recordGrammarReview({ ...scope, patternId: 'en.relative_extra', correct: false }))
      .toEqual({ streak: 0, state: 'practising' });
  });
});
