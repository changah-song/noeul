import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

import { normalizeBookLanguage } from '../constants/languages';
import { PUBLIC_DOMAIN_TEXTS } from '../assets/data/public-domain/catalog';

const PUBLIC_DOMAIN_URI_PREFIX = 'public-domain:';
const MAX_CHAPTER_CHARS = 9000;

const normalizeText = (value) => String(value || '')
  .replace(/^\uFEFF/, '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .replace(/\u00A0/g, ' ')
  .trim();

const normalizeDisplayText = (value) => String(value || '').normalize('NFC');

const publicDomainUriForId = (id) => `${PUBLIC_DOMAIN_URI_PREFIX}${id}`;

export const isPublicDomainBookUri = (uri) => (
  String(uri || '').startsWith(PUBLIC_DOMAIN_URI_PREFIX)
);

export const getPublicDomainBooks = (targetLanguage = null) => PUBLIC_DOMAIN_TEXTS.filter((book) => (
  targetLanguage == null
    || normalizeBookLanguage(book.language ?? 'ko') === normalizeBookLanguage(targetLanguage)
)).map((book) => ({
  id: `public-domain-${book.id}`,
  publicDomainId: book.id,
  uri: publicDomainUriForId(book.id),
  title: normalizeDisplayText(book.title),
  author: normalizeDisplayText(book.author),
  source: book.source,
  previewSource: book.previewSource,
  attributionCategory: book.attributionCategory,
  titleTranslation: book.titleTranslation,
  authorTranslation: book.authorTranslation,
  attribution: book.attribution,
  snippet: book.snippet,
  genre: book.genre,
  coverColor: book.coverColor,
  language: book.language ?? 'ko',
  script: book.script ?? null,
  wordCount: book.wordCount ?? null,
  publicDomain: true,
  format: 'txt',
  downloaded: true,
  progress: 0,
  location: null,
  nativePosition: null,
  preprocessed: false,
  preprocessing: false,
}));

export const getPublicDomainBookByUri = (uri) => {
  const id = String(uri || '').replace(PUBLIC_DOMAIN_URI_PREFIX, '');
  const catalogBook = PUBLIC_DOMAIN_TEXTS.find((book) => book.id === id);

  if (!catalogBook) {
    return null;
  }

  return {
    ...catalogBook,
    uri: publicDomainUriForId(catalogBook.id),
    title: normalizeDisplayText(catalogBook.title),
    author: normalizeDisplayText(catalogBook.author),
    language: catalogBook.language ?? 'ko',
    script: catalogBook.script ?? null,
    wordCount: catalogBook.wordCount ?? null,
  };
};

const readAssetText = async (assetModule) => {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();

  const localUri = asset.localUri || asset.uri;
  if (!localUri) {
    throw new Error('Public domain text asset is unavailable');
  }

  return FileSystem.readAsStringAsync(localUri);
};

const normalizeParagraphs = (text) => normalizeText(text)
  .split(/\n{2,}/)
  .map((paragraph) => paragraph
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim())
  .filter(Boolean);

const splitParagraphsIntoChapters = (paragraphs) => {
  const chapters = [];
  let current = [];
  let currentLength = 0;

  paragraphs.forEach((paragraph) => {
    const nextLength = currentLength + paragraph.length;

    if (current.length > 0 && nextLength > MAX_CHAPTER_CHARS) {
      chapters.push(current);
      current = [];
      currentLength = 0;
    }

    current.push(paragraph);
    currentLength += paragraph.length;
  });

  if (current.length > 0) {
    chapters.push(current);
  }

  return chapters.length > 0 ? chapters : [[]];
};

const textBlockForParagraph = (paragraph, chapterIndex, paragraphIndex) => ({
  id: `txt-${chapterIndex}-p-${paragraphIndex}`,
  type: 'text',
  tag: 'p',
  attrs: {},
  styleTokens: {},
  text: paragraph,
  spans: [{ text: paragraph }],
});

const headingBlockForChapter = (book, chapterIndex) => {
  if (chapterIndex > 0) {
    return null;
  }

  const title = normalizeDisplayText(book.title);
  const author = normalizeDisplayText(book.author);
  const text = author ? `${title}\n${author}` : title;

  return {
    id: `txt-${chapterIndex}-title`,
    type: 'text',
    tag: 'h1',
    attrs: {},
    styleTokens: {
      textAlign: 'center',
      marginBottom: 18,
    },
    text,
    spans: [{ text }],
  };
};

const buildChapterBlocks = (book, chapterParagraphs, chapterIndex) => [
  headingBlockForChapter(book, chapterIndex),
  ...chapterParagraphs.map((paragraph, paragraphIndex) => (
    textBlockForParagraph(paragraph, chapterIndex, paragraphIndex)
  )),
].filter(Boolean);

const spineItemForChapter = (book, chapterIndex) => ({
  index: chapterIndex,
  idref: `${book.id}-chapter-${chapterIndex}`,
  href: `chapter-${chapterIndex + 1}.txt`,
  path: `${book.id}/chapter-${chapterIndex + 1}.txt`,
  title: chapterIndex === 0 ? book.title : `${book.title} ${chapterIndex + 1}`,
  mediaType: 'text/plain',
  linear: 'yes',
});

export const readPublicDomainTextPackage = async (uri, options = {}) => {
  const book = getPublicDomainBookByUri(uri);
  if (!book) {
    throw new Error('Unknown public domain book');
  }

  const text = await readAssetText(book.textAsset);
  const paragraphs = normalizeParagraphs(text);
  const chapterParagraphs = splitParagraphsIntoChapters(paragraphs);
  const spine = chapterParagraphs.map((_, index) => spineItemForChapter(book, index));
  const requestedSpineIndex = Number.isInteger(options?.spineIndex)
    ? options.spineIndex
    : 0;
  const currentSpineIndex = Math.min(
    Math.max(requestedSpineIndex, 0),
    Math.max(spine.length - 1, 0)
  );
  const loadedSpineItem = spine[currentSpineIndex] ?? spine[0];
  const loadedChapterBlocks = buildChapterBlocks(
    book,
    chapterParagraphs[currentSpineIndex] ?? [],
    currentSpineIndex
  );

  const bookManifest = {
    sourceUri: uri,
    title: book.title,
    author: book.author,
    language: book.language,
    script: book.script ?? null,
    source: book.source,
    previewSource: book.previewSource,
    attributionCategory: book.attributionCategory,
    titleTranslation: book.titleTranslation,
    authorTranslation: book.authorTranslation,
    attribution: book.attribution,
    snippet: book.snippet,
    genre: book.genre,
    coverColor: book.coverColor,
    wordCount: book.wordCount ?? null,
    format: 'txt',
    totalSpineItems: spine.length,
    currentSpineIndex,
    currentSpineHref: loadedSpineItem?.href ?? '',
    currentSpinePath: loadedSpineItem?.path ?? '',
  };

  return {
    bookManifest,
    metadata: {
      title: book.title,
      author: book.author,
      language: book.language,
      script: book.script ?? null,
      wordCount: book.wordCount ?? null,
    },
    spine,
    toc: spine.map((item) => ({
      id: item.idref,
      label: item.title,
      title: item.title,
      href: item.href,
      path: item.path,
      spineIndex: item.index,
      level: 0,
    })),
    loadedSpineItem,
    loadedChapterBlocks,
    loadedChapterResources: [],
    firstChapterBlocks: loadedChapterBlocks,
    firstChapterResources: [],
  };
};
