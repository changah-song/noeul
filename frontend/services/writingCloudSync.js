import AsyncStorage from '@react-native-async-storage/async-storage';
import { USER_WRITING_ENTRIES_TABLE, supabase } from './supabase';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import { makeScopedStorageKey } from './localDataScope';

const FILE_TAG = '[writingCloudSync]';
const WRITING_CLOUD_CACHE_KEY = 'sync/writing-cloud-cache-v1';
const USER_WRITING_ENTRY_SELECT = `
  id,
  user_id,
  client_id,
  title,
  body,
  prompt,
  category,
  status,
  assessment,
  created_at,
  updated_at,
  deleted_at
`;

const getWritingCloudCacheKey = (userId) => makeScopedStorageKey(userId, WRITING_CLOUD_CACHE_KEY);

const safeString = (value, fallback = '') => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const trimmed = text.trim();
  return trimmed || fallback;
};

const assertCloudWriteAllowed = ({ user, ownerId, generation }) => {
  assertCanUploadForOwner({ ownerId, user });
  if (generation != null && !isCurrentSyncGeneration(generation)) {
    throw new Error('Refusing cloud upload for stale sync generation');
  }

  return user.id;
};

const toIsoString = (value, fallback = new Date().toISOString()) => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const isMissingRpcError = (error, functionName) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes(functionName.toLowerCase());
};

const sortWritingRows = (rows) => [...(rows ?? [])].sort((a, b) => (
  new Date(b.updated_at ?? b.created_at ?? 0) - new Date(a.updated_at ?? a.created_at ?? 0)
));

const normalizeCursorTimestamp = (value) => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const maxCursorValue = (...values) => {
  let maxTimestamp = 0;

  values.forEach((value) => {
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp) && timestamp > maxTimestamp) {
      maxTimestamp = timestamp;
    }
  });

  return maxTimestamp > 0 ? new Date(maxTimestamp).toISOString() : null;
};

const rowCursorValue = (row) => (
  row?.server_updated_at
  ?? row?.serverUpdatedAt
  ?? row?.updated_at
  ?? row?.updatedAt
  ?? null
);

const readWritingCloudCache = async (userId) => {
  try {
    const raw = await AsyncStorage.getItem(getWritingCloudCacheKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      cursor: normalizeCursorTimestamp(parsed?.cursor),
      rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
    };
  } catch (error) {
    console.warn(`${FILE_TAG} Failed to read writing sync cursor:`, error?.message ?? error);
    return { cursor: null, rows: [] };
  }
};

const writeWritingCloudCache = async (userId, { cursor, rows }) => {
  try {
    await AsyncStorage.setItem(
      getWritingCloudCacheKey(userId),
      JSON.stringify({
        cursor: normalizeCursorTimestamp(cursor),
        rows: rows ?? [],
      })
    );
  } catch (error) {
    console.warn(`${FILE_TAG} Failed to persist writing sync cursor:`, error?.message ?? error);
  }
};

const mergeCachedCloudRows = (cachedRows, deltaRows) => {
  const rowsByClientId = new Map();

  (cachedRows ?? []).forEach((row) => {
    if (row?.client_id) {
      rowsByClientId.set(row.client_id, row);
    }
  });

  (deltaRows ?? []).forEach((row) => {
    if (row?.client_id) {
      rowsByClientId.set(row.client_id, row);
    }
  });

  return [...rowsByClientId.values()];
};

const toUserWritingEntryRow = (userId, entry) => {
  const now = new Date().toISOString();

  return {
    user_id: userId,
    client_id: entry.id,
    title: safeString(entry.title, ''),
    body: typeof entry.body === 'string' ? entry.body : '',
    prompt: entry.prompt ?? '',
    category: entry.category ?? null,
    status: entry.status ?? 'draft',
    assessment: entry.assessment ?? null,
    created_at: toIsoString(entry.createdAt ?? entry.date, now),
    updated_at: toIsoString(entry.updatedAt, now),
    deleted_at: null,
  };
};

export const cloudWritingRowToEntry = (row) => ({
  id: row.client_id,
  title: safeString(row.title, ''),
  body: typeof row.body === 'string' ? row.body : '',
  prompt: row.prompt ?? '',
  category: row.category ?? null,
  date: row.created_at ?? row.updated_at,
  createdAt: row.created_at ?? row.updated_at,
  updatedAt: row.updated_at ?? row.created_at,
  status: row.status ?? (row.assessment ? 'reviewed' : 'draft'),
  ...(row.assessment ? { assessment: row.assessment } : {}),
});

export const fetchUserWritingEntries = async (userId, { includeDeleted = false } = {}) => {
  if (!userId) {
    return [];
  }

  try {
    const cache = await readWritingCloudCache(userId);
    const updatedAfter = cache.cursor && cache.rows.length > 0 ? cache.cursor : null;
    const { data, error } = await supabase.rpc('sync_user_writing_pull', {
      updated_after: updatedAfter,
    });

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data?.entries) ? data.entries : [];
    const nextRows = updatedAfter ? mergeCachedCloudRows(cache.rows, rows) : rows;
    const nextCursor = maxCursorValue(
      cache.cursor,
      data?.cursor,
      ...nextRows.map(rowCursorValue)
    );

    await writeWritingCloudCache(userId, {
      cursor: nextCursor,
      rows: nextRows,
    });

    return sortWritingRows(includeDeleted ? nextRows : nextRows.filter((row) => !row.deleted_at));
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_writing_pull')) {
      console.warn(`${FILE_TAG} fetchUserWritingEntries failed`, error);
      throw error;
    }
  }

  let query = supabase
    .from(USER_WRITING_ENTRIES_TABLE)
    .select(USER_WRITING_ENTRY_SELECT)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
    console.warn(`${FILE_TAG} fetchUserWritingEntries failed`, error);
    throw error;
  }

  return data ?? [];
};

export const upsertUserWritingEntry = async ({ user, ownerId, generation, entry } = {}) => {
  if (!entry?.id) {
    return null;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserWritingEntryRow(userId, entry);

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('sync_user_writing_push', {
      entries: [row],
    });

    if (error) {
      throw error;
    }

    return row;
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_writing_push')) {
      console.warn(`${FILE_TAG} upsertUserWritingEntry failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from(USER_WRITING_ENTRIES_TABLE)
    .upsert(row, {
      onConflict: 'user_id,client_id',
    })
    .select(USER_WRITING_ENTRY_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} upsertUserWritingEntry failed`, error);
    throw error;
  }

  return data;
};

export const upsertUserWritingEntries = async ({ user, ownerId, generation, entries } = {}) => {
  const validEntries = (entries || []).filter((entry) => entry?.id);
  if (validEntries.length === 0) {
    return [];
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const rows = validEntries.map((entry) => toUserWritingEntryRow(userId, entry));

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('sync_user_writing_push', {
      entries: rows,
    });

    if (error) {
      throw error;
    }

    return rows;
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_writing_push')) {
      console.warn(`${FILE_TAG} upsertUserWritingEntries failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from(USER_WRITING_ENTRIES_TABLE)
    .upsert(rows, {
      onConflict: 'user_id,client_id',
    })
    .select(USER_WRITING_ENTRY_SELECT);

  if (error) {
    console.warn(`${FILE_TAG} upsertUserWritingEntries failed`, error);
    throw error;
  }

  return data ?? [];
};

export const softDeleteUserWritingEntry = async ({ user, ownerId, generation, entryId } = {}) => {
  if (!entryId) {
    return;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('soft_delete_user_writing_entry', {
      client_id_value: entryId,
    });

    if (error) {
      throw error;
    }

    return;
  } catch (error) {
    if (!isMissingRpcError(error, 'soft_delete_user_writing_entry')) {
      console.warn(`${FILE_TAG} softDeleteUserWritingEntry failed`, error);
      throw error;
    }
  }

  const { error } = await supabase
    .from(USER_WRITING_ENTRIES_TABLE)
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('client_id', entryId);

  if (error) {
    console.warn(`${FILE_TAG} softDeleteUserWritingEntry failed`, error);
    throw error;
  }
};
