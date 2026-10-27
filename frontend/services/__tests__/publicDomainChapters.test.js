/**
 * A bundled collection marks each piece with a "# Title" paragraph; the reader
 * gives every piece its own chapter under that title.
 */
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn() } }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn() }));
jest.mock('../../assets/data/public-domain/catalog', () => ({ PUBLIC_DOMAIN_TEXTS: [] }));

const fs = require('fs');
const path = require('path');
const { splitTextIntoChapters } = require('../publicDomainBooks');

const read = (file) => fs.readFileSync(
  path.join(__dirname, '../../assets/data/public-domain/books', file),
  'utf8'
);

describe('splitTextIntoChapters', () => {
  it('starts a titled chapter at each "# " paragraph', () => {
    const chapters = splitTextIntoChapters('# One\n\nfirst.\n\nmore.\n\n# Two\n\nsecond.');
    expect(chapters).toEqual([
      { title: 'One', paragraphs: ['first.', 'more.'] },
      { title: 'Two', paragraphs: ['second.'] },
    ]);
  });

  it('leaves text without markers as untitled chapters', () => {
    expect(splitTextIntoChapters('a.\n\nb.')).toEqual([{ title: null, paragraphs: ['a.', 'b.'] }]);
  });

  it('gives each 방정환 story its own chapter', () => {
    expect(splitTextIntoChapters(read('bang_jeonghwan_stories.txt')).map((chapter) => chapter.title)).toEqual([
      '금도끼', '엉터리 병정', '제일 짧은 동화', '까치의 옷', '호랑이 형님', '욕심쟁이 땅차지',
    ]);
  });

  it('gives each of the four Chinese essays its own chapter', () => {
    expect(splitTextIntoChapters(read('xiandai_duanwen.txt'))).toHaveLength(4);
  });
});
