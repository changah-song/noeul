// English chapters ask for multi-word expressions ("gave up"): the backend
// only sends them to builds that can tap a phrase.

jest.mock('../api/client', () => ({ api: { post: jest.fn(async () => ({ data: { results: [] } })) } }));
jest.mock('../interfaceLanguage', () => ({ getRuntimeChineseScript: () => 'simplified' }));

const { api } = require('../api/client');
const preprocessChapter = require('../api/preprocessChapter').default;

describe('preprocessChapter expressions flag', () => {
  beforeEach(() => api.post.mockClear());

  it('asks for expressions on English chapters', async () => {
    await preprocessChapter({ bookUri: 'b', spineIndex: 0, text: 'He gave up.', language: 'en', interfaceLanguage: 'ko' });
    const [endpoint, body] = api.post.mock.calls[0];
    expect(endpoint).toBe('/preprocess_chapter_en/');
    expect(body.expressions).toBe(true);
  });

  it('does not on other languages', async () => {
    await preprocessChapter({ bookUri: 'b', spineIndex: 0, text: '안녕', language: 'ko', interfaceLanguage: 'en' });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('expressions');
  });
});
