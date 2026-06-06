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
  updated_at,
  deleted_at,
  language
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
  deleted_at
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
  deleted_at
`;

const normalizeVocabIdentityValue = (value) => (value == null ? '' : String(value).trim());

export const makeUserVocabKey = (entry) => [
  entry.language ?? 'ko',
  normalizeVocabIdentityValue(entry.word),
  normalizeVocabIdentityValue(entry.hanja),
  normalizeVocabIdentityValue(entry.definition ?? entry.def),
].join('::');

export const makeUserVocabContextKey = (context) => [
  context.language ?? 'ko',
  normalizeVocabIdentityValue(context.word),
  normalizeVocabIdentityValue(context.hanja),
  normalizeVocabIdentityValue(context.definition ?? context.def),
  normalizeVocabIdentityValue(context.source_book_uri ?? context.sourceBookUri),
  normalizeVocabIdentityValue(context.sentence),
].join('::');

export const makeUserRelatedKnownWordKey = (relation) => [
  relation.language ?? 'ko',
  normalizeVocabIdentityValue(relation.main_word ?? relation.mainWord),
  normalizeVocabIdentityValue(relation.main_hanja ?? relation.mainHanja),
  normalizeVocabIdentityValue(relation.main_definition ?? relation.mainDefinition),
  normalizeVocabIdentityValue(relation.related_word ?? relation.relatedWord ?? relation.korean),
  normalizeVocabIdentityValue(relation.related_hanja ?? relation.relatedHanja ?? relation.hanja),
].join('::');

const normalizeBoolean = (value) => value === true || value === 1;
const normalizeInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeTimestamp = (value, fallback = null) => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};
const isDuplicateKeyError = (error) => error?.code === '23505';

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
    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data ?? null;
};

export const fetchUserVocab = async (userId, { includeDeleted = true } = {}) => {
  let query = supabase
    .from(USER_VOCAB_TABLE)
    .select(USER_VOCAB_SELECT)
    .eq('user_id', userId);

  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
    console.warn(`${FILE_TAG} fetchUserVocab failed`, error);
    throw error;
  }

  return data ?? [];
};

export const upsertUserVocabEntry = async ({ user, ownerId, generation, entry } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserVocabRow(userId, entry);
  const existing = await fetchExistingUserVocabEntry(userId, row);
  const query = supabase.from(USER_VOCAB_TABLE);
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = existing
    ? await applyVocabIdentityFilters(
        query
          .update(row)
          .eq('user_id', userId),
        row
      )
    : await query.insert(row);

  if (error) {
    console.warn(`${FILE_TAG} upsertUserVocabEntry failed`, error);
    throw error;
  }
};

export const upsertUserVocabEntries = async ({ user, ownerId, generation, entries } = {}) => {
  if (!entries || entries.length === 0) {
    return;
  }

  for (const entry of entries) {
    await upsertUserVocabEntry({ user, ownerId, generation, entry });
  }
};

export const softDeleteUserVocabEntry = async ({ user, ownerId, generation, entry } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const deletedAt = new Date().toISOString();
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await applyVocabIdentityFilters(
    supabase
      .from(USER_VOCAB_TABLE)
      .update({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      })
      .eq('user_id', userId),
    entry
  );

  if (error) {
    console.warn(`${FILE_TAG} softDeleteUserVocabEntry failed`, error);
    throw error;
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
    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data ?? null;
};

export const fetchUserVocabContexts = async (userId, { includeDeleted = true } = {}) => {
  let query = supabase
    .from(USER_VOCAB_CONTEXTS_TABLE)
    .select(USER_VOCAB_CONTEXT_SELECT)
    .eq('user_id', userId);

  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
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

  for (const context of contexts) {
    await upsertUserVocabContext({ user, ownerId, generation, context });
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
    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data ?? null;
};

export const fetchUserRelatedKnownWords = async (userId, { includeDeleted = true } = {}) => {
  let query = supabase
    .from(USER_VOCAB_RELATED_KNOWN_TABLE)
    .select(USER_VOCAB_RELATED_KNOWN_SELECT)
    .eq('user_id', userId);

  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
    console.warn(`${FILE_TAG} fetchUserRelatedKnownWords failed`, error);
    throw error;
  }

  return data ?? [];
};

export const upsertUserRelatedKnownWord = async ({ user, ownerId, generation, relation } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserRelatedKnownWordRow(userId, relation);
  if (!row.main_word || !row.related_word) {
    return;
  }

  const existing = await fetchExistingUserRelatedKnownWord(userId, row);
  const query = supabase.from(USER_VOCAB_RELATED_KNOWN_TABLE);
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = existing
    ? await applyRelatedKnownIdentityFilters(
        query
          .update(row)
          .eq('user_id', userId)
          .is('deleted_at', null),
        row
      )
    : await query.insert(row);

  if (error) {
    console.warn(`${FILE_TAG} upsertUserRelatedKnownWord failed`, error);
    throw error;
  }
};

export const upsertUserRelatedKnownWords = async ({ user, ownerId, generation, relations } = {}) => {
  if (!relations || relations.length === 0) {
    return;
  }

  for (const relation of relations) {
    await upsertUserRelatedKnownWord({ user, ownerId, generation, relation });
  }
};

export const softDeleteUserRelatedKnownWord = async ({ user, ownerId, generation, relation } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
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
    console.warn(`${FILE_TAG} softDeleteUserRelatedKnownWord failed`, error);
    throw error;
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

export default supabase;
