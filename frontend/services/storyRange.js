// Where the story itself starts and ends in a book's spine, and progress
// through it. Readers were lost when an introduction, a prologue or a
// publisher's page took up the first stretch of the percentage: 0% is now the
// start of the story and 100% its end, whatever comes before or after (notes,
// an afterword, a licence). Those parts stay reachable from the contents;
// before the story reads 0%, after it 100%.
//
// The library's books come with measured bounds (library-story.generated.json,
// written by backend/scripts/generate_public_library_levels.py from the same
// rule that levels them on their main content only): the file the story
// starts in, the element it starts at and how far into that file it is, and
// likewise for its end. That's what finds a story that starts partway into a
// file, after the teachers' notes of an old school reader (Brooks's Readers)
// in the same file. Without bounds, each spine item is judged by its contents
// title and its file name.
//
// Progress within the range is weighted by each file's size, so one long file
// holding most of the book (Aesop's fables) counts for what it holds.

import { blockIdForAnchor, tocAnchorFromHref } from './tocAnchors';

// Bounds per public_library.id.
const LIBRARY_STORY = require('../assets/data/public-domain/library-story.generated.json');

// Keep in step with FRONT_WORDS / BACK_WORDS in backend/scripts/epub_story.py.
const FRONT_WORDS = [
  'cover', 'coverpage', 'title', 'titlepage', 'halftitle', 'half-title', 'halftitlepage', 'imprint', 'copyright',
  'public-domain', 'public domain', 'dedication', 'epigraph', 'contents', 'table of contents', 'toc', 'preface',
  'foreword', 'introduction', 'intro', 'prologue', 'prolog', 'frontmatter', 'front matter', 'loi',
  'list of illustrations', 'illustrations', "translator's note", 'translators note', "editor's note",
  'editors note', "publisher's note", 'publishers note', "author's preface", 'note on the text', 'a note on',
  'transcriber', "transcriber's note", 'about this edition', 'acknowledgments', 'acknowledgements', 'praise',
  'also by', 'dramatis personae', 'persons of the play', 'scenes of the play', 'the scenes', 'frontispiece',
  'note to the', 'etymology', 'extracts', 'notice', 'explanatory', 'bibliography', 'to the teacher',
  'to teachers', 'suggestions to teachers', 'note to teachers', 'notes to teachers', "teachers' notes",
  'for the teacher', 'to parents', 'a word to', 'how to use this book',
];

const BACK_WORDS = [
  'endnotes', 'notes', 'footnotes', 'colophon', 'uncopyright', 'donate', 'acknowledgments', 'acknowledgements',
  'afterword', 'appendix', 'glossary', 'index', 'about the author', 'biography', 'bibliography', "author's note",
  'authors note', 'backmatter', 'back matter', 'license', 'licence', 'gutenberg', 'pg-footer', 'footer',
  'further reading', 'chronology', 'credits', 'imprint', 'loi', 'word list', 'list of words', 'vocabulary list',
  'transcriber', "transcriber's note", 'phonetic key', 'pronouncing vocabulary',
];

// "Chapter 1", "Book One", "I", "12", "I. The Monkey", "IV: Energy". A bare
// number is a chapter; a year on a title page ("1908") isn't.
const CHAPTER_RE = /^(chapter|book|part|act|scene|canto|stave|letter|volume|fable|story|tale|lesson)\b|^[ivxlc]+\.?$|^\d{1,3}\.?$|^[ivxlc]+[.:]\s+\S|^\d+[.:]\s+\S/i;

// Front matter only counts near the start of a book with no chapters to go by.
const LEADING_SHARE = 0.5;
// Files between the last front matter and the first chapter smaller than this
// (in bytes) are title-page leftovers (a half-title), not the story.
const TITLE_LEFTOVER_BYTES = 3000;

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/\.(x?html?|xml|txt)$/i, '')
  .replace(/’/g, "'")
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

const itemWeight = (item) => {
  const size = Number(item?.size);
  // Unknown sizes (text and PDF books) count alike.
  return Number.isFinite(size) && size > 0 ? size : 1;
};

const clamp01 = (value) => Math.min(Math.max(Number(value) || 0, 0), 1);

const pathKey = (value) => {
  const path = String(value || '').split('#')[0].replace(/\\/g, '/');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const samePath = (a, b) => {
  const left = pathKey(a);
  const right = pathKey(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
};

const spineIndexForHref = (spine, href) => spine.findIndex((item) => (
  samePath(item?.path, href) || samePath(item?.href, href)
));

/** The measured story bounds for a library book, or null. */
export const storyBoundsForBook = (book) => {
  const id = book?.publicLibraryId ?? book?.public_library_id ?? null;
  return (id && LIBRARY_STORY[id]) || null;
};

// The range from measured bounds, when they fit this spine.
const rangeFromBounds = (spine, bounds) => {
  if (!bounds?.start?.href) return null;
  const start = spineIndexForHref(spine, bounds.start.href);
  const end = bounds.end?.href ? spineIndexForHref(spine, bounds.end.href) : spine.length - 1;
  if (start < 0 || end < start) return null;
  const startFraction = clamp01(bounds.start.fraction);
  const endFraction = bounds.end?.href ? clamp01(bounds.end.fraction ?? 1) : 1;
  if (start === end && endFraction <= startFraction) return null;
  return {
    start,
    end,
    startFraction,
    endFraction: endFraction > 0 ? endFraction : 1,
    startAnchors: Array.isArray(bounds.start.anchors) ? bounds.start.anchors.filter(Boolean) : [],
  };
};

/**
 * storyRange — `{ start, end }` spine indexes of the story (inclusive), or
 * the whole spine when nothing can be told apart. With measured `bounds`
 * (storyBoundsForBook) it also carries `startFraction` / `endFraction` (how
 * far into the first file the story starts, and into the last it runs) and
 * `startAnchors` (element ids at the story's first block).
 */
export const storyRange = (spine = [], toc = [], bounds = null) => {
  const count = Array.isArray(spine) ? spine.length : 0;
  if (count === 0) return { start: 0, end: 0 };
  const measured = rangeFromBounds(spine, bounds);
  if (measured) return measured;

  const titles = tocTitlesBySpine(toc);
  const label = (index) => [titles[index] || spine[index]?.title || '', fileStem(spine[index]), spine[index]?.idref || ''];
  // Chapters ("Chapter 1", "I.", "Book One") are the story even when their
  // file name says something else.
  const isChapter = (index) => CHAPTER_RE.test(String(titles[index] || '').trim());
  const isFront = (index) => !isChapter(index) && matches(FRONT_WORDS, ...label(index));
  const isBack = (index) => !isChapter(index) && matches(BACK_WORDS, ...label(index));

  const weights = spine.map(itemWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let firstChapter = -1;
  for (let index = 0; index < count; index += 1) {
    if (isChapter(index)) {
      firstChapter = index;
      break;
    }
  }
  // The last front matter before the first chapter (or, with no chapters,
  // in the first half of the book): the story starts after it. Untitled
  // files before it (a title page, a Gutenberg cover wrapper) go with it.
  let lastFront = -1;
  let before = 0;
  for (let index = 0; index < count; index += 1) {
    if (firstChapter >= 0 ? index >= firstChapter : before / Math.max(total, 1) >= LEADING_SHARE) break;
    if (isFront(index)) lastFront = index;
    before += weights[index];
  }
  let start = lastFront >= 0 ? Math.min(lastFront + 1, count - 1) : Math.max(firstChapter, 0);
  if (firstChapter > start) {
    const leftover = weights.slice(start, firstChapter).reduce((sum, weight) => sum + weight, 0);
    if (leftover < TITLE_LEFTOVER_BYTES) start = firstChapter;
  }
  let end = count - 1;
  while (end > start && isBack(end)) end -= 1;
  return { start, end };
};

// The part of spine item `index` inside the range, as [from, to] (0..1).
const spanFor = (range, index) => {
  const from = index === range.start ? clamp01(range.startFraction ?? 0) : 0;
  const to = index === range.end ? clamp01(range.endFraction ?? 1) : 1;
  return [from, Math.max(to, from)];
};

/**
 * storyProgress — 0..1 through the story for a position (spine index, and
 * the page within that chapter when known). Null without a position.
 */
export const storyProgress = (spine, range, spineIndex, pageIndex = null, pagesInChapter = null) => {
  const within = (
    Number.isInteger(pageIndex) && Number.isInteger(pagesInChapter) && pagesInChapter > 0
  )
    ? clamp01((pageIndex + 1) / pagesInChapter)
    : 0;
  return storyProgressAt(spine, range, spineIndex, within);
};

/**
 * storyProgressAt — 0..1 through the story for a point `chapterFraction`
 * (0..1) of the way into spine item `spineIndex`. Null without a position.
 */
export const storyProgressAt = (spine, range, spineIndex, chapterFraction = 0) => {
  if (!Number.isInteger(spineIndex) || !Array.isArray(spine) || spine.length === 0) return null;
  const bounds = range || { start: 0, end: spine.length - 1 };
  const { start, end } = bounds;
  if (spineIndex < start) return 0;
  if (spineIndex > end) return 1;
  let total = 0;
  let before = 0;
  for (let index = start; index <= end; index += 1) {
    const [from, to] = spanFor(bounds, index);
    const weight = itemWeight(spine[index]) * (to - from);
    if (index < spineIndex) before += weight;
    total += weight;
  }
  const within = clamp01(chapterFraction);
  const [from, to] = spanFor(bounds, spineIndex);
  const inside = Math.min(Math.max(within, from), to) - from;
  if (total <= 0) return within >= to ? 1 : 0;
  const value = (before + inside * itemWeight(spine[spineIndex])) / total;
  return clamp01(value);
};

/**
 * positionForStoryProgress — the inverse of storyProgress: for a point on the
 * scrubber (0..1), the chapter and how far into it (0..1).
 */
export const positionForStoryProgress = (spine, range, fraction) => {
  if (!Array.isArray(spine) || spine.length === 0) return null;
  const bounds = range || { start: 0, end: spine.length - 1 };
  const { start, end } = bounds;
  const value = clamp01(fraction);
  let total = 0;
  for (let index = start; index <= end; index += 1) {
    const [from, to] = spanFor(bounds, index);
    total += itemWeight(spine[index]) * (to - from);
  }
  let target = value * total;
  for (let index = start; index <= end; index += 1) {
    const [from, to] = spanFor(bounds, index);
    const size = itemWeight(spine[index]);
    const weight = size * (to - from);
    if (target < weight || index === end) {
      const chapterFraction = from + (weight > 0 ? Math.min(target, weight) / size : 0);
      return { spineIndex: index, chapterFraction: Math.min(Math.max(chapterFraction, from), to) };
    }
    target -= weight;
  }
  return { spineIndex: end, chapterFraction: spanFor(bounds, end)[1] };
};

/**
 * storyStartBlockId — the block the story starts at in its first file's
 * blocks (from the measured bounds), or null when it starts at the top of
 * the file or the bounds don't say.
 */
export const storyStartBlockId = (blocks, range) => {
  if (!range || !(range.startFraction > 0) || !Array.isArray(range.startAnchors)) return null;
  for (const anchor of range.startAnchors) {
    const blockId = blockIdForAnchor(blocks, anchor);
    if (blockId) return blockId;
  }
  return null;
};

/**
 * anchorFraction — how far into a chapter file (0..1, by text) the block an
 * element id starts at sits, from that file's parsed blocks; null when the
 * id isn't among them.
 */
export const anchorFraction = (blocks, anchor) => {
  const id = blockIdForAnchor(blocks, anchor);
  if (!id) return null;
  let before = 0;
  let total = 0;
  let reached = false;
  blocks.forEach((block) => {
    const length = typeof block?.text === 'string' ? block.text.length : 0;
    if (block?.id === id) reached = true;
    if (!reached) before += length;
    total += length;
  });
  return total > 0 ? before / total : 0;
};

// The contents entries, flattened, with their depth (0 = top level).
const tocEntries = (toc = []) => {
  const out = [];
  const visit = (items, depth) => (items || []).forEach((item) => {
    if (Number.isInteger(item?.spineIndex)) {
      out.push({
        spineIndex: item.spineIndex,
        anchor: tocAnchorFromHref(item.href),
        title: String(item.title || item.label || '').trim(),
        depth,
      });
    }
    visit(item?.subitems, depth + 1);
  });
  visit(toc, 0);
  return out;
};

// Marks nearer than this (as a share of the story) are one mark.
const SAME_MARK = 0.001;

/**
 * chapterMarks — where each chapter after the first starts on the scrubber,
 * with its contents title: one per contents entry in the story, so the marks
 * match the contents whether a book keeps one chapter per file, splits a
 * chapter over several files, or holds every chapter in one file (an entry
 * pointing into a file is placed by `fractionFor(spineIndex, anchor)`, the
 * share of that file before it, when the file has been read in; else at the
 * file's start). A book without contents gets one mark per file.
 */
export const chapterMarks = (spine, range, toc = [], { fractionFor } = {}) => {
  if (!Array.isArray(spine) || spine.length === 0) return [];
  const { start, end } = range || { start: 0, end: spine.length - 1 };
  const entries = tocEntries(toc).filter((entry) => entry.spineIndex >= start && entry.spineIndex <= end);
  if (entries.length === 0) {
    const titles = tocTitlesBySpine(toc);
    const marks = [];
    for (let index = start + 1; index <= end; index += 1) {
      marks.push({ key: `spine:${index}`, spineIndex: index, at: storyProgress(spine, range, index), title: titles[index] || '' });
    }
    return marks;
  }
  const placed = entries.map((entry) => {
    const fraction = entry.anchor && typeof fractionFor === 'function'
      ? fractionFor(entry.spineIndex, entry.anchor)
      : null;
    return {
      key: `toc:${entry.spineIndex}:${entry.anchor || ''}`,
      spineIndex: entry.spineIndex,
      at: storyProgressAt(spine, range, entry.spineIndex, fraction ?? 0),
      title: entry.title,
      depth: entry.depth,
    };
  });
  // The story's first chapter is where the line starts; front and back
  // matter before or after the story get no mark.
  const inStory = (mark) => Number.isFinite(mark.at) && mark.at > SAME_MARK && mark.at < 1 - SAME_MARK;
  const tidy = (marks) => {
    const sorted = marks.filter(inStory).sort((a, b) => a.at - b.at);
    return sorted
      .filter((mark, index) => index === 0 || mark.at - sorted[index - 1].at > SAME_MARK)
      .map(({ depth, ...mark }) => mark);
  };
  // The chapters are the top level of the contents, unless the top level is
  // only wrappers and front matter (a "Contents" entry holding the lessons):
  // then every level.
  const top = tidy(placed.filter((mark) => mark.depth === 0));
  return top.length >= 2 ? top : tidy(placed);
};
