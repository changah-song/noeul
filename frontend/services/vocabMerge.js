// Bringing a guest's saved words into an account that already has some: the
// same word (language, word, hanja, definition) saved on both sides becomes
// one row that keeps the most progress from either.

const time = (value) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
};

const later = (a, b) => (time(a) >= time(b) ? a : b) || a || b || null;
const earlier = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  return time(a) <= time(b) ? a : b;
};

export const vocabMergeKey = (row) => [
  row?.language || 'ko',
  row?.word || '',
  row?.hanja || '',
  row?.def_key || row?.def || '',
].join('\u0000');

/**
 * The fields to write on `target` so it carries `source`'s progress too:
 * - learned on either side stays learned;
 * - review counts: the larger of each (both sides may hold the same history,
 *   so adding them could double-count);
 * - the review schedule (stability, difficulty, next review) comes from
 *   whichever side was reviewed last;
 * - first saved = the earlier date; favourite on either side stays;
 * - the fade (read past without tapping) follows the more recent sighting;
 * - deleted only if the deletion is newer than the other side's last change.
 */
export const mergeVocabRows = (target, source, now = new Date().toISOString()) => {
  const sourceReviewedLater = time(source.last_reviewed_at) > time(target.last_reviewed_at);
  const scheduled = sourceReviewedLater ? source : target;
  const sourceSeenLater = time(source.fade_seen_at) > time(target.fade_seen_at);
  const faded = sourceSeenLater ? source : target;

  const targetDeleted = Boolean(target.deleted_at);
  const sourceDeleted = Boolean(source.deleted_at);
  let deletedAt = null;
  if (targetDeleted && sourceDeleted) {
    deletedAt = later(target.deleted_at, source.deleted_at);
  } else if (targetDeleted && time(target.deleted_at) > time(source.updated_at)) {
    deletedAt = target.deleted_at;
  } else if (sourceDeleted && time(source.deleted_at) > time(target.updated_at)) {
    deletedAt = source.deleted_at;
  }

  return {
    level: target.level === 'learned' || source.level === 'learned'
      ? 'learned'
      : (target.level || source.level || 'unorganized'),
    correct_count: Math.max(Number(target.correct_count) || 0, Number(source.correct_count) || 0),
    wrong_count: Math.max(Number(target.wrong_count) || 0, Number(source.wrong_count) || 0),
    last_reviewed_at: later(target.last_reviewed_at, source.last_reviewed_at),
    next_review_at: scheduled.next_review_at ?? null,
    stability: scheduled.stability ?? target.stability ?? null,
    difficulty: scheduled.difficulty ?? target.difficulty ?? null,
    created_at: earlier(target.created_at, source.created_at),
    is_favorite: Number(target.is_favorite) || Number(source.is_favorite) ? 1 : 0,
    fade_seen: Number(faded.fade_seen) || 0,
    fade_seen_at: faded.fade_seen_at ?? null,
    source_book_uri: target.source_book_uri || source.source_book_uri || null,
    source_book_title: target.source_book_title || source.source_book_title || null,
    deleted_at: deletedAt,
    // Changed, so the next sync pushes the combined row.
    updated_at: now,
  };
};
