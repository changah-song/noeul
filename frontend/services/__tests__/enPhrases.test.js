import { annotationsBySurface, isPhraseSurface, withPhraseTapTerms } from '../readerAnnotations';
import { buildLevelUnderlineTerms, phraseDifficultyFromParts, PHRASE_EXTRA, rowDifficulty } from '../levelUnderlineTerms';
import { difficultyFromLevelRank, pKnown, underlineCategory, ABILITY_THETA_MAX } from '../abilityModel';
import { groupKeys } from '../levelEngine';

// English multi-word expressions ("gave up" -> give up), see
// backend/data/en_expressions.tsv.

describe('English phrases: annotations', () => {
  it('recognizes a phrase surface', () => {
    expect(isPhraseSurface('gave up')).toBe(true);
    expect(isPhraseSurface('made up her mind')).toBe(true);
    expect(isPhraseSurface('gave')).toBe(false);
    expect(isPhraseSurface(' gave ')).toBe(false);
  });

  it('gives a phrase its own gloss, never its words\' glosses joined', () => {
    // The surface row of the phrase, plus (as could happen) rows of the words
    // indexed under the same surface: still 포기하다, not 주다 · 위로.
    const rows = [
      { surface: 'gave up', stem: 'give up', gloss: '포기하다', interface_language: 'ko', language: 'en' },
      { surface: 'gave up', stem: 'gave', gloss: '주다', interface_language: 'ko', language: 'en' },
      { surface: 'gave up', stem: 'up', gloss: '위로', interface_language: 'ko', language: 'en' },
    ];
    expect(annotationsBySurface(rows, 'ko').get('gave up').gloss).toBe('포기하다');
  });

  it('shows a phrase\'s own gloss in the interface language, and nothing when it has none', () => {
    const rows = [
      { surface: 'gave up', stem: 'give up', gloss: 'あきらめる', interface_language: 'ja', language: 'en' },
      // No gloss in this language: the English definition stays on the card,
      // never under the phrase.
      { surface: 'at once', stem: 'at once', gloss: null, definition: 'Immediately.', interface_language: 'en', language: 'en' },
    ];
    const annotations = annotationsBySurface(rows, 'ja');
    expect(annotations.get('gave up').gloss).toBe('あきらめる');
    expect(annotations.get('at once').gloss).toBe('');
  });

  it('adds every untold phrase as an annotation-only term, so a tap finds it', () => {
    const levelTerms = [{ text: 'gave up', weight: 0.8, stem: 'give up' }, { text: 'lantern', weight: 0.6 }];
    const out = withPhraseTapTerms(levelTerms, ['gave up', 'of course', 'Of course', 'lantern']);
    expect(out).toEqual([
      ...levelTerms,
      { text: 'of course', weight: 0, annotationOnly: true },
      { text: 'Of course', weight: 0, annotationOnly: true },
    ]);
    expect(withPhraseTapTerms(levelTerms, [])).toBe(levelTerms);
  });
});

describe('English phrases: difficulty', () => {
  it('grades a phrase by its own CEFR level (level_rank)', () => {
    const theta = -1;
    const [term] = buildLevelUnderlineTerms(
      [{ surface: 'put up with', stem: 'put up with', level_rank: 4, stem_count: 1 }],
      'en',
      theta
    );
    const expected = underlineCategory(pKnown(theta, difficultyFromLevelRank('en', 4)), 1);
    expect(term).toEqual({ text: 'put up with', stem: 'put up with', weight: expected.weight, category: expected.category });
  });

  it('a phrase at the reader\'s level or below is not underlined, like a word', () => {
    expect(buildLevelUnderlineTerms(
      [{ surface: 'of course', stem: 'of course', level_rank: 1, stem_count: 30 }],
      'en',
      3
    )).toEqual([]);
  });

  it('falls back to the harder word plus a little when a phrase has no level', () => {
    const rows = [
      { surface: 'gave', stem: 'give', level_rank: 1, stem_count: 3 },
      { surface: 'up', stem: 'up', level_rank: 2, stem_count: 3 },
      { surface: 'gave up', stem: 'give up', stem_count: 1 },
    ];
    const harder = rowDifficulty(rows[1], 'en');
    const theta = harder;
    const terms = buildLevelUnderlineTerms(rows, 'en', theta);
    const phrase = terms.find((term) => term.text === 'gave up');
    const expected = underlineCategory(pKnown(theta, harder + PHRASE_EXTRA), 1);
    expect(phrase).toEqual({ text: 'gave up', stem: 'give up', weight: expected.weight, category: expected.category });
  });

  it('caps the fallback at the top of the scale', () => {
    expect(phraseDifficultyFromParts([2.8, 1])).toBe(ABILITY_THETA_MAX);
    expect(phraseDifficultyFromParts([0.5, null])).toBeCloseTo(0.5 + PHRASE_EXTRA);
    expect(phraseDifficultyFromParts([undefined])).toBeNull();
  });

  it('shares no knowledge between a phrase and its words', () => {
    expect(groupKeys('en', 'give up')).toEqual([]);
    expect(groupKeys('en', 'give')).toEqual([]);
  });
});
