jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

const { rebaseAppContainerUri, rebaseBookFilePaths } = require('../appContainerPaths');

const OLD = 'file:///var/mobile/Containers/Data/Application/249E296F-98B4-49C0-9D7F-8A0583E5576C';
const NEW = 'file:///var/mobile/Containers/Data/Application/436D83D6-04F5-45A3-8910-9B20C5FF6AC1';
const DOCS = `${NEW}/Documents/`;

describe('rebaseAppContainerUri', () => {
  it('moves a path from an old iOS container into the current one', () => {
    expect(rebaseAppContainerUri(`${OLD}/Documents/pdf-covers/a/cover-page-1.png`, DOCS))
      .toBe(`${NEW}/Documents/pdf-covers/a/cover-page-1.png`);
  });

  it('leaves paths already in the current container alone', () => {
    const uri = `${NEW}/Library/Caches/DocumentPicker/x.pdf`;
    expect(rebaseAppContainerUri(uri, DOCS)).toBe(uri);
  });

  it('leaves non-container URIs alone', () => {
    const android = 'file:///data/user/0/com.noeulapp.Noeul/files/book.epub';
    expect(rebaseAppContainerUri(android, DOCS)).toBe(android);
    expect(rebaseAppContainerUri('content://com.android/x', DOCS)).toBe('content://com.android/x');
    expect(rebaseAppContainerUri('https://example.com/a.png', DOCS)).toBe('https://example.com/a.png');
    expect(rebaseAppContainerUri(null, DOCS)).toBe(null);
  });

  it('does nothing when the current container is unknown', () => {
    const uri = `${OLD}/Documents/a.png`;
    expect(rebaseAppContainerUri(uri, 'file:///data/user/0/app/files/')).toBe(uri);
    expect(rebaseAppContainerUri(uri, null)).toBe(uri);
  });
});

describe('rebaseBookFilePaths', () => {
  it('rebases covers but keeps the book uri (it is a key)', () => {
    const book = {
      uri: `${OLD}/Library/Caches/DocumentPicker/x.pdf`,
      cover: `${OLD}/Documents/pdf-covers/a/cover-page-1.png`,
      originalCover: `${OLD}/Documents/pdf-covers/a/cover-page-1.png`,
      title: '토끼와 거북이',
    };
    const next = rebaseBookFilePaths(book, DOCS);
    expect(next.uri).toBe(book.uri);
    expect(next.cover).toBe(`${NEW}/Documents/pdf-covers/a/cover-page-1.png`);
    expect(next.originalCover).toBe(`${NEW}/Documents/pdf-covers/a/cover-page-1.png`);
    expect(next.title).toBe('토끼와 거북이');
  });

  it('returns the same object when nothing changes', () => {
    const book = { uri: 'x', cover: 'data:image/png;base64,AA' };
    expect(rebaseBookFilePaths(book, DOCS)).toBe(book);
  });
});
