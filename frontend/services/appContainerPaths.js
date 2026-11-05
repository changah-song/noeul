import * as FileSystem from 'expo-file-system/legacy';

// iOS gives the app a new data container path when it is reinstalled or
// updated (…/Containers/Data/Application/<UUID>/…), while the files inside
// move along with it. A file:// URI saved under the old container then
// points nowhere: covers go blank and cached extractions miss. This maps
// such a URI onto the current container. Other URIs (Android paths,
// content://, http, bundled assets) come back unchanged.

const CONTAINER_PATTERN = /^(file:\/\/.*?\/Containers\/Data\/Application\/)([0-9A-Fa-f-]{36})(\/.*)$/;

const currentContainer = (documentDirectory = FileSystem.documentDirectory) => {
  const match = typeof documentDirectory === 'string' ? documentDirectory.match(CONTAINER_PATTERN) : null;
  return match ? { prefix: match[1], id: match[2] } : null;
};

export const rebaseAppContainerUri = (uri, documentDirectory = FileSystem.documentDirectory) => {
  if (typeof uri !== 'string') return uri;
  const match = uri.match(CONTAINER_PATTERN);
  if (!match) return uri;
  const current = currentContainer(documentDirectory);
  if (!current || match[2] === current.id) return uri;
  return `${current.prefix}${current.id}${match[3]}`;
};

// The book fields that are only file references (never used as keys).
const BOOK_FILE_FIELDS = ['cover', 'originalCover'];

export const rebaseBookFilePaths = (book, documentDirectory = FileSystem.documentDirectory) => {
  if (!book || typeof book !== 'object') return book;
  let next = book;
  BOOK_FILE_FIELDS.forEach((field) => {
    const value = book[field];
    const rebased = rebaseAppContainerUri(value, documentDirectory);
    if (rebased !== value) {
      if (next === book) next = { ...book };
      next[field] = rebased;
    }
  });
  return next;
};
