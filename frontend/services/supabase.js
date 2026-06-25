import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

const assertCloudWriteAllowed = ({ user, ownerId, generation }) => {
  assertCanUploadForOwner({ ownerId, user });
  if (generation != null && !isCurrentSyncGeneration(generation)) {
    throw new Error('Refusing cloud upload for stale sync generation');
  }

  return user.id;
};

const isStaleSyncGenerationError = (error) => (
  String(error?.message || error || '').includes('stale sync generation')
);

// SecureStore has a 2048-byte limit per key. Supabase session JWTs exceed this,
// so we chunk large values across multiple keys and reassemble on read.
const CHUNK_SIZE = 1900; // conservative margin under the 2048 limit
const chunkCountKey = (key) => `${key}_n`;
const chunkKey = (key, i) => `${key}_${i}`;

const secureStoreAdapter = {
  getItem: async (key) => {
    try {
      // Try direct (non-chunked) read first
      const direct = await SecureStore.getItemAsync(key);
      if (direct !== null) return direct;

      // Fall back to reassembling chunks
      const countStr = await SecureStore.getItemAsync(chunkCountKey(key));
      if (countStr === null) return null;

      const count = parseInt(countStr, 10);
      const chunks = await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i)))
      );
      return chunks.join('');
    } catch (error) {
      console.warn(`[supabase] Failed to read auth session for key "${key}"`, error);
      return null;
    }
  },

  setItem: async (key, value) => {
    try {
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        // Clean up any stale chunks from a previous oversized value
        await secureStoreAdapter._clearChunks(key);
      } else {
        // Remove any direct key that might exist from before
        await SecureStore.deleteItemAsync(key);

        const chunks = [];
        for (let i = 0; i < value.length; i += CHUNK_SIZE) {
          chunks.push(value.slice(i, i + CHUNK_SIZE));
        }
        await Promise.all([
          SecureStore.setItemAsync(chunkCountKey(key), String(chunks.length)),
          ...chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk)),
        ]);
      }
    } catch (error) {
      console.warn(`[supabase] Failed to persist auth session for key "${key}"`, error);
    }
  },

  removeItem: async (key) => {
    try {
      await SecureStore.deleteItemAsync(key);
      await secureStoreAdapter._clearChunks(key);
    } catch (error) {
      console.warn(`[supabase] Failed to clear auth session for key "${key}"`, error);
    }
  },

  // Internal helper — removes chunk count key + all chunk keys for a given base key
  _clearChunks: async (key) => {
    try {
      const countStr = await SecureStore.getItemAsync(chunkCountKey(key));
      if (countStr === null) return;
      const count = parseInt(countStr, 10);
      await Promise.all([
        SecureStore.deleteItemAsync(chunkCountKey(key)),
        ...Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))),
      ]);
    } catch {
      // best-effort cleanup
    }
  },
};

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

const FILE_TAG = '[supabase]';
export const USER_ACCOUNT_TABLE = 'users';
export const USER_PROFILES_TABLE = 'user_profiles';
export const USER_BOOKS_BUCKET = 'user-books';
export const USER_PREFERENCES_TABLE = 'user_preferences';
export const USER_WRITING_ENTRIES_TABLE = 'user_writing_entries';
export const USER_SONGS_TABLE = 'user_songs';
export const USER_VOCAB_TABLE = 'user_vocab';
export const USER_VOCAB_CONTEXTS_TABLE = 'user_vocab_contexts';
export const USER_VOCAB_RELATED_KNOWN_TABLE = 'user_vocab_related_known_words';

const USER_VOCAB_SELECT = `
  word,
  hanja,
  definition,
  status,
  source_book_uri,
  source_book_title,
  context_sentence,
  is_favorite,
  priority,
  created_at,
  last_reviewed_at,
  next_review_at,
  correct_count,
  wrong_count,
  stability,
  difficulty,
  updated_at,
  deleted_at,
  language,
  server_updated_at
`;

const USER_VOCAB_CONTEXT_SELECT = `
  language,
  word,
  hanja,
  definition,
  source_book_uri,
  source_book_title,
  sentence,
  seen_at,
  updated_at,
  deleted_at,
  server_updated_at
`;

const USER_VOCAB_RELATED_KNOWN_SELECT = `
  language,
  main_word,
  main_hanja,
  main_definition,
  related_word,
  related_hanja,
  related_definition,
  source_hanja,
  marked_at,
  updated_at,
  deleted_at,
  server_updated_at
`;

const withoutServerUpdatedAt = (select) => select.replace(/,\s*\n\s*server_updated_at/g, '');
const USER_VOCAB_SELECT_LEGACY = withoutServerUpdatedAt(USER_VOCAB_SELECT);
const USER_VOCAB_CONTEXT_SELECT_LEGACY = withoutServerUpdatedAt(USER_VOCAB_CONTEXT_SELECT);
const USER_VOCAB_RELATED_KNOWN_SELECT_LEGACY = withoutServerUpdatedAt(USER_VOCAB_RELATED_KNOWN_SELECT);

const normalizeVocabIdentityValue = (value) => (
  value == null ? '' : String(value).normalize('NFKC').replace(/\s+/g, ' ').trim()
);
const normalizeVocabDefinitionIdentityValue = (value) => normalizeVocabIdentityValue(value).toLowerCase();

export const makeUserVocabKey = (entry) => [
  entry.language ?? 'ko',
  normalizeVocabIdentityValue(entry.word),
  normalizeVocabIdentityValue(entry.hanja),
  normalizeVocabDefinitionIdentityValue(entry.definition ?? entry.def),
].join('::');

export const makeUserVocabContextKey = (context) => [
  context.language ?? 'ko',
  normalizeVocabIdentityValue(context.word),
  normalizeVocabIdentityValue(context.hanja),
  normalizeVocabDefinitionIdentityValue(context.definition ?? context.def),
  normalizeVocabIdentityValue(context.source_book_uri ?? context.sourceBookUri),
  normalizeVocabIdentityValue(context.sentence),
].join('::');

export const makeUserRelatedKnownWordKey = (relation) => [
  relation.language ?? 'ko',
  normalizeVocabIdentityValue(relation.main_word ?? relation.mainWord),
  normalizeVocabIdentityValue(relation.main_hanja ?? relation.mainHanja),
  normalizeVocabDefinitionIdentityValue(relation.main_definition ?? relation.mainDefinition),
  normalizeVocabIdentityValue(relation.related_word ?? relation.relatedWord ?? relation.korean),
  normalizeVocabIdentityValue(relation.related_hanja ?? relation.relatedHanja ?? relation.hanja),
].join('::');

const normalizeBoolean = (value) => value === true || value === 1;
const normalizeInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeNumber = (
  value,
  fallback,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
) => {
  if (value == null || value === '') {
    return fallback;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

const normalizeTimestamp = (value, fallback = null) => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};
const isDuplicateKeyError = (error) => error?.code === '23505';
const isMissingRpcError = (error, functionName) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes(functionName.toLowerCase());
};
const isMissingServerUpdatedAtError = (error) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === '42703'
    || error?.code === 'PGRST204'
    || message.includes('server_updated_at');
};

const toUserVocabRow = (userId, entry) => {
  const now = new Date().toISOString();
  const createdAt = normalizeTimestamp(entry.created_at ?? entry.createdAt, now);
  const updatedAt = normalizeTimestamp(entry.updated_at ?? entry.updatedAt, createdAt);
  const definition = normalizeVocabIdentityValue(entry.definition ?? entry.def) || null;
  const hanja = normalizeVocabIdentityValue(entry.hanja) || null;
  const word = normalizeVocabIdentityValue(entry.word);

  return {
    user_id: userId,
    word,
    hanja,
    definition,
    status: entry.status ?? entry.level ?? 'unorganized',
    source_book_uri: entry.source_book_uri ?? entry.sourceBookUri ?? null,
    source_book_title: entry.source_book_title ?? entry.sourceBookTitle ?? null,
    context_sentence: entry.context_sentence ?? entry.contextSentence ?? null,
    is_favorite: normalizeBoolean(entry.is_favorite ?? entry.isFavorite),
    priority: entry.priority ?? 'normal',
    created_at: createdAt,
    last_reviewed_at: normalizeTimestamp(entry.last_reviewed_at ?? entry.lastReviewedAt),
    next_review_at: normalizeTimestamp(entry.next_review_at ?? entry.nextReviewAt),
    correct_count: normalizeInteger(entry.correct_count ?? entry.correctCount),
    wrong_count: normalizeInteger(entry.wrong_count ?? entry.wrongCount),
    stability: normalizeNumber(entry.stability, 1.0, 0.01),
    difficulty: normalizeNumber(entry.difficulty, 5.0, 1, 10),
    updated_at: updatedAt,
    deleted_at: normalizeTimestamp(entry.deleted_at ?? entry.deletedAt),
    language: entry.language ?? 'ko',
  };
};

const applyVocabIdentityFilters = (query, entry) => {
  const definition = normalizeVocabIdentityValue(entry.definition ?? entry.def) || null;
  const hanja = normalizeVocabIdentityValue(entry.hanja) || null;
  const language = entry.language ?? 'ko';

  let nextQuery = query
    .eq('language', language)
    .eq('word', normalizeVocabIdentityValue(entry.word));

  nextQuery = hanja == null
    ? nextQuery.is('hanja', null)
    : nextQuery.eq('hanja', hanja);

  nextQuery = definition == null
    ? nextQuery.is('definition', null)
    : nextQuery.eq('definition', definition);

  return nextQuery;
};

const fetchExistingUserVocabEntry = async (userId, entry) => {
  const { data, error } = await applyVocabIdentityFilters(
    supabase
      .from(USER_VOCAB_TABLE)
      .select(USER_VOCAB_SELECT)
      .eq('user_id', userId),
    entry
  ).limit(1);

  if (error) {
    if (isMissingServerUpdatedAtError(error)) {
      const fallback = await applyVocabIdentityFilters(
        supabase
          .from(USER_VOCAB_TABLE)
          .select(USER_VOCAB_SELECT_LEGACY)
          .eq('user_id', userId),
        entry
      ).limit(1);

      if (!fallback.error) {
        return Array.isArray(fallback.data) ? fallback.data[0] ?? null : fallback.data ?? null;
      }
    }

    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data ?? null;
};

const normalizeRpcArray = (value) => (Array.isArray(value) ? value : []);

export const pullUserLearningSync = async ({
  vocabUpdatedAfter = null,
  contextsUpdatedAfter = null,
  relatedUpdatedAfter = null,
} = {}) => {
  const { data, error } = await supabase.rpc('sync_user_learning_pull', {
    vocab_updated_after: normalizeTimestamp(vocabUpdatedAfter),
    contexts_updated_after: normalizeTimestamp(contextsUpdatedAfter),
    related_updated_after: normalizeTimestamp(relatedUpdatedAfter),
  });

  if (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_pull')) {
      console.warn(`${FILE_TAG} pullUserLearningSync failed`, error);
    }
    throw error;
  }

  return {
    vocab: normalizeRpcArray(data?.vocab),
    contexts: normalizeRpcArray(data?.contexts),
    relatedKnownWords: normalizeRpcArray(data?.relatedKnownWords),
    cursors: data?.cursors ?? {},
  };
};

export const pushUserLearningSync = async ({
  vocabEntries = [],
  contexts = [],
  relatedKnownWords = [],
} = {}) => {
  if (vocabEntries.length === 0 && contexts.length === 0 && relatedKnownWords.length === 0) {
    return { vocab: 0, contexts: 0, relatedKnownWords: 0 };
  }

  const { data, error } = await supabase.rpc('sync_user_learning_push', {
    vocab_entries: vocabEntries,
    contexts,
    related_known_words: relatedKnownWords,
  });

  if (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      console.warn(`${FILE_TAG} pushUserLearningSync failed`, error);
    }
    throw error;
  }

  return data ?? { vocab: 0, contexts: 0, relatedKnownWords: 0 };
};

export const fetchUserVocab = async (userId, { includeDeleted = true, updatedAfter = null } = {}) => {
  const buildQuery = ({ select, cursorColumn }) => {
    let query = supabase
      .from(USER_VOCAB_TABLE)
      .select(select)
      .eq('user_id', userId);

    if (!includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const normalizedUpdatedAfter = normalizeTimestamp(updatedAfter);
    if (normalizedUpdatedAfter) {
      query = query.gt(cursorColumn, normalizedUpdatedAfter);
    }

    return query.order(cursorColumn, { ascending: true });
  };

  let query = supabase
    .from(USER_VOCAB_TABLE)
    .select(USER_VOCAB_SELECT)
    .eq('user_id', userId);

  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const normalizedUpdatedAfter = normalizeTimestamp(updatedAfter);
  if (normalizedUpdatedAfter) {
    query = query.gt('server_updated_at', normalizedUpdatedAfter);
  }

  query = query.order('server_updated_at', { ascending: true });

  const { data, error } = await query;

  if (error) {
    if (isMissingServerUpdatedAtError(error)) {
      const fallback = await buildQuery({
        select: USER_VOCAB_SELECT_LEGACY,
        cursorColumn: 'updated_at',
      });

      if (!fallback.error) {
        return fallback.data ?? [];
      }
    }

    console.warn(`${FILE_TAG} fetchUserVocab failed`, error);
    throw error;
  }

  return data ?? [];
};

const upsertUserVocabRowDirect = async ({ user, ownerId, generation, userId, row }) => {
  const updateExistingEntry = async () => {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await applyVocabIdentityFilters(
      supabase
        .from(USER_VOCAB_TABLE)
        .update(row)
        .eq('user_id', userId),
      row
    );

    if (error) {
      throw error;
    }
  };

  const existing = await fetchExistingUserVocabEntry(userId, row);
  if (existing) {
    await updateExistingEntry();
    return;
  }

  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await supabase
    .from(USER_VOCAB_TABLE)
    .insert(row);

  if (!error) {
    return;
  }

  if (isDuplicateKeyError(error)) {
    await updateExistingEntry();
    return;
  }

  throw error;
};

const softDeleteUserVocabEntryDirect = async ({ user, ownerId, generation, userId, entry }) => {
  const deletedAt = new Date().toISOString();
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await applyVocabIdentityFilters(
    supabase
      .from(USER_VOCAB_TABLE)
      .update({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      })
      .eq('user_id', userId)
      .is('deleted_at', null),
    entry
  );

  if (error) {
    throw error;
  }
};

export const upsertUserVocabEntry = async ({ user, ownerId, generation, entry } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserVocabRow(userId, entry);
  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({ vocabEntries: [row] });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    await upsertUserVocabRowDirect({ user, ownerId, generation, userId, row });
  }
};

export const upsertUserVocabEntries = async ({ user, ownerId, generation, entries } = {}) => {
  if (!entries || entries.length === 0) {
    return;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const rows = entries.map((entry) => toUserVocabRow(userId, entry));
  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({ vocabEntries: rows });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    for (const row of rows) {
      await upsertUserVocabRowDirect({ user, ownerId, generation, userId, row });
    }
  }
};

export const softDeleteUserVocabEntry = async ({ user, ownerId, generation, entry } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const deletedAt = new Date().toISOString();
  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({
      vocabEntries: [{
        ...toUserVocabRow(userId, entry),
        deleted_at: deletedAt,
        updated_at: deletedAt,
      }],
    });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    await softDeleteUserVocabEntryDirect({ user, ownerId, generation, userId, entry });
  }
};

export const deleteUserVocabEntry = softDeleteUserVocabEntry;

export const updateUserVocabFields = async ({ user, ownerId, generation, entry, patch } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const updatedAt = patch.updated_at ?? patch.updatedAt ?? new Date().toISOString();
  const rowPatch = {
    ...patch,
    updated_at: updatedAt,
  };
  delete rowPatch.updatedAt;

  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await applyVocabIdentityFilters(
    supabase
      .from(USER_VOCAB_TABLE)
      .update(rowPatch)
      .eq('user_id', userId),
    entry
  );

  if (error) {
    console.warn(`${FILE_TAG} updateUserVocabFields failed`, error);
    throw error;
  }
};

export const updateUserVocabStatus = async ({ user, ownerId, generation, entry, status } = {}) => {
  await updateUserVocabFields({
    user,
    ownerId,
    generation,
    entry,
    patch: { status },
  });
};

export const recordCloudVocabReview = async ({
  user,
  ownerId,
  generation,
  entry,
  review = {},
} = {}) => {
  assertCloudWriteAllowed({ user, ownerId, generation });
  const payload = {
    language: entry?.language ?? review.language ?? 'ko',
    word: entry?.word ?? review.word,
    hanja: entry?.hanja ?? review.hanja ?? null,
    definition: entry?.definition ?? entry?.def ?? review.definition ?? review.def ?? null,
    ...review,
  };

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { data, error } = await supabase.rpc('record_vocab_review', {
      review: payload,
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    if (!isMissingRpcError(error, 'record_vocab_review')) {
      console.warn(`${FILE_TAG} recordCloudVocabReview failed`, error);
      throw error;
    }
  }

  const fallbackPatch = Object.fromEntries(Object.entries({
    status: payload.next_status ?? payload.status,
    last_reviewed_at: payload.last_reviewed_at ?? payload.lastReviewedAt,
    next_review_at: payload.next_review_at ?? payload.nextReviewAt,
    stability: payload.stability,
    difficulty: payload.difficulty,
    correct_count: payload.correct_count ?? payload.correctCount,
    wrong_count: payload.wrong_count ?? payload.wrongCount,
    updated_at: payload.updated_at ?? payload.updatedAt ?? payload.reviewed_at ?? payload.reviewedAt,
  }).filter(([, value]) => value !== undefined));

  return updateUserVocabFields({
    user,
    ownerId,
    generation,
    entry,
    patch: fallbackPatch,
  });
};

const toUserVocabContextRow = (userId, context) => {
  const now = new Date().toISOString();
  const seenAt = normalizeTimestamp(context.seen_at ?? context.seenAt, now);
  const updatedAt = normalizeTimestamp(context.updated_at ?? context.updatedAt, seenAt);

  return {
    user_id: userId,
    language: context.language ?? 'ko',
    word: normalizeVocabIdentityValue(context.word),
    hanja: normalizeVocabIdentityValue(context.hanja) || null,
    definition: normalizeVocabIdentityValue(context.def ?? context.definition) || null,
    source_book_uri: normalizeVocabIdentityValue(context.source_book_uri ?? context.sourceBookUri) || null,
    source_book_title: context.source_book_title ?? context.sourceBookTitle ?? null,
    sentence: normalizeVocabIdentityValue(context.sentence),
    seen_at: seenAt,
    updated_at: updatedAt,
    deleted_at: normalizeTimestamp(context.deleted_at ?? context.deletedAt),
  };
};

const applyVocabContextIdentityFilters = (query, context) => {
  const row = toUserVocabContextRow('__identity__', context);

  let nextQuery = query
    .eq('language', row.language)
    .eq('word', row.word)
    .eq('sentence', row.sentence);

  nextQuery = row.hanja == null
    ? nextQuery.is('hanja', null)
    : nextQuery.eq('hanja', row.hanja);

  nextQuery = row.definition == null
    ? nextQuery.is('definition', null)
    : nextQuery.eq('definition', row.definition);

  nextQuery = row.source_book_uri == null
    ? nextQuery.is('source_book_uri', null)
    : nextQuery.eq('source_book_uri', row.source_book_uri);

  return nextQuery;
};

const fetchExistingUserVocabContext = async (userId, context) => {
  const { data, error } = await applyVocabContextIdentityFilters(
    supabase
      .from(USER_VOCAB_CONTEXTS_TABLE)
      .select(USER_VOCAB_CONTEXT_SELECT)
      .eq('user_id', userId)
      .is('deleted_at', null),
    context
  ).limit(1);

  if (error) {
    if (isMissingServerUpdatedAtError(error)) {
      const fallback = await applyVocabContextIdentityFilters(
        supabase
          .from(USER_VOCAB_CONTEXTS_TABLE)
          .select(USER_VOCAB_CONTEXT_SELECT_LEGACY)
          .eq('user_id', userId)
          .is('deleted_at', null),
        context
      ).limit(1);

      if (!fallback.error) {
        return Array.isArray(fallback.data) ? fallback.data[0] ?? null : fallback.data ?? null;
      }
    }

    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data ?? null;
};

export const fetchUserVocabContexts = async (userId, { includeDeleted = true, updatedAfter = null } = {}) => {
  const buildQuery = ({ select, cursorColumn }) => {
    let query = supabase
      .from(USER_VOCAB_CONTEXTS_TABLE)
      .select(select)
      .eq('user_id', userId);

    if (!includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const normalizedUpdatedAfter = normalizeTimestamp(updatedAfter);
    if (normalizedUpdatedAfter) {
      query = query.gt(cursorColumn, normalizedUpdatedAfter);
    }

    return query.order(cursorColumn, { ascending: true });
  };

  const query = buildQuery({
    select: USER_VOCAB_CONTEXT_SELECT,
    cursorColumn: 'server_updated_at',
  });
  const { data, error } = await query;

  if (error) {
    if (isMissingServerUpdatedAtError(error)) {
      const fallback = await buildQuery({
        select: USER_VOCAB_CONTEXT_SELECT_LEGACY,
        cursorColumn: 'updated_at',
      });

      if (!fallback.error) {
        return fallback.data ?? [];
      }
    }

    console.warn(`${FILE_TAG} fetchUserVocabContexts failed`, error);
    throw error;
  }

  return data ?? [];
};

export const upsertUserVocabContext = async ({ user, ownerId, generation, context } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserVocabContextRow(userId, context);
  if (!row.word || !row.sentence) {
    return;
  }

  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({ contexts: [row] });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    await upsertUserVocabContextDirect({ user, ownerId, generation, context });
  }
};

export const upsertUserVocabContextDirect = async ({ user, ownerId, generation, context } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserVocabContextRow(userId, context);
  if (!row.word || !row.sentence) {
    return;
  }

  const updateExistingContext = async () => {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await applyVocabContextIdentityFilters(
      supabase
        .from(USER_VOCAB_CONTEXTS_TABLE)
        .update(row)
        .eq('user_id', userId)
        .is('deleted_at', null),
      row
    );

    if (error) {
      throw error;
    }
  };

  const existing = await fetchExistingUserVocabContext(userId, row);
  if (existing) {
    try {
      await updateExistingContext();
    } catch (error) {
      if (!isStaleSyncGenerationError(error)) {
        console.warn(`${FILE_TAG} upsertUserVocabContext failed`, error);
      }
      throw error;
    }
    return;
  }

  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await supabase
    .from(USER_VOCAB_CONTEXTS_TABLE)
    .insert(row);

  if (!error) {
    return;
  }

  if (isDuplicateKeyError(error)) {
    try {
      await updateExistingContext();
      return;
    } catch (updateError) {
      if (!isStaleSyncGenerationError(updateError)) {
        console.warn(`${FILE_TAG} upsertUserVocabContext duplicate repair failed`, updateError);
      }
      throw updateError;
    }
  }

  if (!isStaleSyncGenerationError(error)) {
    console.warn(`${FILE_TAG} upsertUserVocabContext failed`, error);
  }
  throw error;
};

export const upsertUserVocabContexts = async ({ user, ownerId, generation, contexts } = {}) => {
  if (!contexts || contexts.length === 0) {
    return;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const rows = contexts
    .map((context) => toUserVocabContextRow(userId, context))
    .filter((row) => row.word && row.sentence);
  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({ contexts: rows });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    for (const context of contexts) {
      await upsertUserVocabContextDirect({ user, ownerId, generation, context });
    }
  }
};

export const softDeleteUserVocabContextsForWord = async ({ user, ownerId, generation, entry } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const deletedAt = new Date().toISOString();
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await applyVocabIdentityFilters(
    supabase
      .from(USER_VOCAB_CONTEXTS_TABLE)
      .update({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      })
      .eq('user_id', userId)
      .is('deleted_at', null),
    entry
  );

  if (error) {
    console.warn(`${FILE_TAG} softDeleteUserVocabContextsForWord failed`, error);
    throw error;
  }
};

const toUserRelatedKnownWordRow = (userId, relation) => {
  const now = new Date().toISOString();
  const markedAt = normalizeTimestamp(relation.marked_at ?? relation.markedAt, now);

  return {
    user_id: userId,
    language: relation.language ?? 'ko',
    main_word: normalizeVocabIdentityValue(relation.main_word ?? relation.mainWord),
    main_hanja: normalizeVocabIdentityValue(relation.main_hanja ?? relation.mainHanja) || null,
    main_definition: normalizeVocabIdentityValue(relation.main_definition ?? relation.mainDefinition) || null,
    related_word: normalizeVocabIdentityValue(
      relation.related_word ?? relation.relatedWord ?? relation.korean
    ),
    related_hanja: normalizeVocabIdentityValue(
      relation.related_hanja ?? relation.relatedHanja ?? relation.hanja
    ) || null,
    related_definition: relation.related_definition
      ?? relation.relatedDefinition
      ?? relation.meaning
      ?? null,
    source_hanja: relation.source_hanja ?? relation.sourceHanja ?? null,
    marked_at: markedAt,
    updated_at: normalizeTimestamp(relation.updated_at ?? relation.updatedAt, markedAt),
    deleted_at: normalizeTimestamp(relation.deleted_at ?? relation.deletedAt),
  };
};

const applyRelatedKnownIdentityFilters = (query, relation) => {
  const row = toUserRelatedKnownWordRow('__identity__', relation);

  let nextQuery = query
    .eq('language', row.language)
    .eq('main_word', row.main_word)
    .eq('related_word', row.related_word);

  nextQuery = row.main_hanja == null
    ? nextQuery.is('main_hanja', null)
    : nextQuery.eq('main_hanja', row.main_hanja);

  nextQuery = row.main_definition == null
    ? nextQuery.is('main_definition', null)
    : nextQuery.eq('main_definition', row.main_definition);

  nextQuery = row.related_hanja == null
    ? nextQuery.is('related_hanja', null)
    : nextQuery.eq('related_hanja', row.related_hanja);

  return nextQuery;
};

const applyRelatedKnownMainWordFilters = (query, entry) => {
  const language = entry.language ?? 'ko';
  const word = normalizeVocabIdentityValue(entry.word ?? entry.main_word ?? entry.mainWord);
  const hanja = normalizeVocabIdentityValue(entry.hanja ?? entry.main_hanja ?? entry.mainHanja) || null;
  const definition = normalizeVocabIdentityValue(
    entry.definition ?? entry.def ?? entry.main_definition ?? entry.mainDefinition
  ) || null;

  let nextQuery = query
    .eq('language', language)
    .eq('main_word', word);

  nextQuery = hanja == null
    ? nextQuery.is('main_hanja', null)
    : nextQuery.eq('main_hanja', hanja);

  nextQuery = definition == null
    ? nextQuery.is('main_definition', null)
    : nextQuery.eq('main_definition', definition);

  return nextQuery;
};

const fetchExistingUserRelatedKnownWord = async (userId, relation) => {
  const { data, error } = await applyRelatedKnownIdentityFilters(
    supabase
      .from(USER_VOCAB_RELATED_KNOWN_TABLE)
      .select(USER_VOCAB_RELATED_KNOWN_SELECT)
      .eq('user_id', userId)
      .is('deleted_at', null),
    relation
  ).limit(1);

  if (error) {
    if (isMissingServerUpdatedAtError(error)) {
      const fallback = await applyRelatedKnownIdentityFilters(
        supabase
          .from(USER_VOCAB_RELATED_KNOWN_TABLE)
          .select(USER_VOCAB_RELATED_KNOWN_SELECT_LEGACY)
          .eq('user_id', userId)
          .is('deleted_at', null),
        relation
      ).limit(1);

      if (!fallback.error) {
        return Array.isArray(fallback.data) ? fallback.data[0] ?? null : fallback.data ?? null;
      }
    }

    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data ?? null;
};

export const fetchUserRelatedKnownWords = async (userId, { includeDeleted = true, updatedAfter = null } = {}) => {
  const buildQuery = ({ select, cursorColumn }) => {
    let query = supabase
      .from(USER_VOCAB_RELATED_KNOWN_TABLE)
      .select(select)
      .eq('user_id', userId);

    if (!includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const normalizedUpdatedAfter = normalizeTimestamp(updatedAfter);
    if (normalizedUpdatedAfter) {
      query = query.gt(cursorColumn, normalizedUpdatedAfter);
    }

    return query.order(cursorColumn, { ascending: true });
  };

  const query = buildQuery({
    select: USER_VOCAB_RELATED_KNOWN_SELECT,
    cursorColumn: 'server_updated_at',
  });
  const { data, error } = await query;

  if (error) {
    if (isMissingServerUpdatedAtError(error)) {
      const fallback = await buildQuery({
        select: USER_VOCAB_RELATED_KNOWN_SELECT_LEGACY,
        cursorColumn: 'updated_at',
      });

      if (!fallback.error) {
        return fallback.data ?? [];
      }
    }

    console.warn(`${FILE_TAG} fetchUserRelatedKnownWords failed`, error);
    throw error;
  }

  return data ?? [];
};

const upsertUserRelatedKnownWordRowDirect = async ({ user, ownerId, generation, userId, row }) => {
  const updateExistingRelation = async () => {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await applyRelatedKnownIdentityFilters(
      supabase
        .from(USER_VOCAB_RELATED_KNOWN_TABLE)
        .update(row)
        .eq('user_id', userId),
      row
    );

    if (error) {
      throw error;
    }
  };

  const existing = await fetchExistingUserRelatedKnownWord(userId, row);
  if (existing) {
    await updateExistingRelation();
    return;
  }

  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await supabase
    .from(USER_VOCAB_RELATED_KNOWN_TABLE)
    .insert(row);

  if (!error) {
    return;
  }

  if (isDuplicateKeyError(error)) {
    await updateExistingRelation();
    return;
  }

  throw error;
};

const softDeleteUserRelatedKnownWordDirect = async ({ user, ownerId, generation, userId, relation }) => {
  const deletedAt = new Date().toISOString();
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await applyRelatedKnownIdentityFilters(
    supabase
      .from(USER_VOCAB_RELATED_KNOWN_TABLE)
      .update({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      })
      .eq('user_id', userId)
      .is('deleted_at', null),
    relation
  );

  if (error) {
    throw error;
  }
};

export const upsertUserRelatedKnownWord = async ({ user, ownerId, generation, relation } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserRelatedKnownWordRow(userId, relation);
  if (!row.main_word || !row.related_word) {
    return;
  }

  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({ relatedKnownWords: [row] });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    await upsertUserRelatedKnownWordRowDirect({ user, ownerId, generation, userId, row });
  }
};

export const upsertUserRelatedKnownWords = async ({ user, ownerId, generation, relations } = {}) => {
  if (!relations || relations.length === 0) {
    return;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const rows = relations
    .map((relation) => toUserRelatedKnownWordRow(userId, relation))
    .filter((row) => row.main_word && row.related_word);
  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({ relatedKnownWords: rows });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    for (const row of rows) {
      await upsertUserRelatedKnownWordRowDirect({ user, ownerId, generation, userId, row });
    }
  }
};

export const softDeleteUserRelatedKnownWord = async ({ user, ownerId, generation, relation } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const deletedAt = new Date().toISOString();
  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    await pushUserLearningSync({
      relatedKnownWords: [{
        ...toUserRelatedKnownWordRow(userId, relation),
        deleted_at: deletedAt,
        updated_at: deletedAt,
      }],
    });
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_learning_push')) {
      throw error;
    }

    await softDeleteUserRelatedKnownWordDirect({ user, ownerId, generation, userId, relation });
  }
};

export const softDeleteRelatedKnownWordsForMainWord = async ({ user, ownerId, generation, entry } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const deletedAt = new Date().toISOString();
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await applyRelatedKnownMainWordFilters(
    supabase
      .from(USER_VOCAB_RELATED_KNOWN_TABLE)
      .update({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      })
      .eq('user_id', userId)
      .is('deleted_at', null),
    entry
  );

  if (error) {
    console.warn(`${FILE_TAG} softDeleteRelatedKnownWordsForMainWord failed`, error);
    throw error;
  }
};

export const toggleCloudRelatedKnownWord = async ({
  user,
  ownerId,
  generation,
  entry,
  relation,
  known = false,
} = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const entryRow = toUserVocabRow(userId, entry ?? {});
  const relationRow = toUserRelatedKnownWordRow(userId, relation ?? {});

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { data, error } = await supabase.rpc('toggle_related_known_word', {
      entry: entryRow,
      relation: relationRow,
      known,
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    if (!isMissingRpcError(error, 'toggle_related_known_word')) {
      console.warn(`${FILE_TAG} toggleCloudRelatedKnownWord failed`, error);
      throw error;
    }
  }

  if (known) {
    return softDeleteUserRelatedKnownWord({ user, ownerId, generation, relation });
  }

  await upsertUserVocabEntry({ user, ownerId, generation, entry });
  return upsertUserRelatedKnownWord({ user, ownerId, generation, relation });
};

export default supabase;
