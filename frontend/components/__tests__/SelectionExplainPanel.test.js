import { explanationParts } from '../Read/SelectionExplainPanel';

jest.mock('../../services/api/explainInContext', () => ({ streamExplainInContext: jest.fn() }));
jest.mock('../Read/GrammarView', () => () => null);
jest.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key) => key }) }));
jest.mock('../../i18n/userFacing', () => ({ getUserFacingErrorMessage: () => '' }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }), { virtual: true });

describe('explanationParts', () => {
  it('splits a chunk walkthrough into rows and keeps other lines as paragraphs', () => {
    expect(explanationParts('너를 사랑해 — "I love you"\n\n그리움이 — the longing (subject)\nA soft, wistful tone.'))
      .toEqual([
        { chunk: '너를 사랑해', note: '"I love you"' },
        { chunk: '그리움이', note: 'the longing (subject)' },
        { paragraph: 'A soft, wistful tone.' },
      ]);
  });

  it('leaves hyphenated words and a line still streaming in as paragraphs', () => {
    expect(explanationParts('A well-known idiom.\n너를 사랑')).toEqual([
      { paragraph: 'A well-known idiom.' },
      { paragraph: '너를 사랑' },
    ]);
  });

  it('is empty before anything arrives', () => {
    expect(explanationParts('')).toEqual([]);
  });
});
