// Where the story itself starts and ends in a book's spine, and progress
// through it. Readers were lost when an introduction, a prologue or a
// publisher's page took up the first stretch of the percentage: 0% is now the
// first chapter and 100% the end of the story, whatever comes before or after
// (notes, an afterword, a licence). Those parts stay reachable from the
// contents; before the story reads 0%, after it 100%.
//
// Each spine item is judged by its contents title and its file name. Progress
// within the range is weighted by each file's size, so one long file holding
// most of the book (Aesop's fables) counts for what it holds.

const FRONT_WORDS = [
  'cover', 'title', 'titlepage', 'halftitle', 'half-title', 'halftitlepage', 'imprint', 'copyright',
  'public-domain', 'public domain', 'dedication', 'epigraph', 'contents', 'toc', 'preface', 'foreword',
  'introduction', 'intro', 'prologue', 'prolog', 'frontmatter', 'front matter', 'loi',
  'list of illustrations', 'illustrations', "translator's note", 'translators note', "editor's note",
  'note on the text', 'a note on', 'transcriber', 'about this edition', 'acknowledgments', 'acknowledgements',
  'praise', 'also by', 'dramatis personae', 'persons of the play', 'scenes of the play', 'the scenes',
  'frontispiece', 'note to the', 'etymology', 'extracts', 'notice', 'explanatory', 'bibliography',
];

const BACK_WORDS = [
  'endnotes', 'notes', 'footnotes', 'colophon', 'uncopyright', 'donate', 'acknowledgments', 'acknowledgements',
  'afterword', 'epilogue', 'appendix', 'glossary', 'index', 'about the author', 'biography',
  'bibliography', "author's note", 'authors note', 'backmatter', 'back matter', 'license', 'licence',
  'gutenberg', 'pg-footer', 'footer', 'further reading', 'chronology', 'credits', 'imprint', 'loi',
];

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/\.(x?html?|xml|txt)$/i, '')
  .replace(/[_\s]+/g, ' ')
  .trim();

const fileStem = (item = {}) => {
  const path = String(item.path || item.href || '');
  const name = path.split('/').pop() || '';
  return normalize(name.replace(/[-_]/g, ' ')).replace(/\s*\d+$/, '');
};

// Whole-word match of any phrase against the title or the file name.
const matches = (words, ...labels) => labels.some((label) => {
  const text = normalize(label);
  if (!text) return false;
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(text);
  });
});

/** The contents title for each spine index (the first entry that points there). */
export const tocTitlesBySpine = (toc = []) => {
  const titles = {};
  const visit = (items) => (items || []).forEach((item) => {
    const index = item?.spineIndex;
    const title = String(item?.title || item?.label || '').trim();
    if (Number.isInteger(index) && title && !(index in titles)) titles[index] = title;
    visit(item?.subitems);
  });
  visit(toc);
  return titles;
};

/**
 * storyRange — `{ start, end }` spine indexes of the story (inclusive), or
 * the whole spine when nothing can be told apart.
 */
export const storyRange = (spine = [], toc = []) => {
  const count = Array.isArray(spine) ? spine.length : 0;
  if (count === 0) return { start: 0, end: 0 };
  const titles = tocTitlesBySpine(toc);
  const label = (index) => [titles[index] || spine[index]?.title || '', fileStem(spine[index])];
  const isFront = (index) => matches(FRONT_WORDS, ...label(index));
  const isBack = (index) => matches(BACK_WORDS, ...label(index));
  // Chapters ("Chapter 1", "I.", "Book One") are the story even when their
  // file name says something else.
  const isChapter = (index) => /^(chapter|book|part|act|scene|canto|stave|letter)\b|^[ivxlc]+\.?$|^\d+\.?$/i
    .test(String(titles[index] || '').trim());

  let start = 0;
  while (start < count - 1 && !isChapter(start) && isFront(start)) start += 1;
  let end = count - 1;
  while (end > start && !isChapter(end) && isBack(end)) end -= 1;
  return { start, end };
};

const itemWeight = (item) => {
  const size = Number(item?.size);
  // Unknown sizes (text and PDF books) count alike.
  return Number.isFinite(size) && size > 0 ? size : 1;
};

/**
 * storyProgress — 0..1 through the story for a position (spine index, and
 * the page within that chapter when known). Null without a position.
 */
export const storyProgress = (spine, range, spineIndex, pageIndex = null, pagesInChapter = null) => {
  if (!Number.isInteger(spineIndex) || !Array.isArray(spine) || spine.length === 0) return null;
  const { start, end } = range || { start: 0, end: spine.length - 1 };
  if (spineIndex < start) return 0;
  if (spineIndex > end) return 1;
  let total = 0;
  let before = 0;
  for (let index = start; index <= end; index += 1) {
    const weight = itemWeight(spine[index]);
    if (index < spineIndex) before += weight;
    total += weight;
  }
  const within = (
    Number.isInteger(pageIndex) && Number.isInteger(pagesInChapter) && pagesInChapter > 0
  )
    ? Math.min(Math.max((pageIndex + 1) / pagesInChapter, 0), 1)
    : 0;
  const value = (before + within * itemWeight(spine[spineIndex])) / Math.max(total, 1);
  return Math.min(Math.max(value, 0), 1);
};
