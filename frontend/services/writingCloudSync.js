import { USER_WRITING_ENTRIES_TABLE, supabase } from './supabase';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';

const FILE_TAG = '[writingCloudSync]';
const USER_WRITING_ENTRY_SELECT = `
  id,
  user_id,
  client_id,
  title,
  body,
  prompt,
  status,
  assessment,
  created_at,
  updated_at,
  deleted_at
`;

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

const toUserWritingEntryRow = (userId, entry) => {
  const now = new Date().toISOString();

  return {
    user_id: userId,
    client_id: entry.id,
    title: safeString(entry.title, '[Untitled]'),
    body: typeof entry.body === 'string' ? entry.body : '',
    prompt: entry.prompt ?? '',
    status: entry.status ?? 'draft',
    assessment: entry.assessment ?? null,
    created_at: toIsoString(entry.createdAt ?? entry.date, now),
    updated_at: toIsoString(entry.updatedAt, now),
    deleted_at: null,
  };
};

export const cloudWritingRowToEntry = (row) => ({
  id: row.client_id,
  title: safeString(row.title, '[Untitled]'),
  body: typeof row.body === 'string' ? row.body : '',
  prompt: row.prompt ?? '',
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
  const { data, error } = await supabase
    .from(USER_WRITING_ENTRIES_TABLE)
    .upsert(toUserWritingEntryRow(userId, entry), {
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
  const { data, error } = await supabase
    .from(USER_WRITING_ENTRIES_TABLE)
    .upsert(validEntries.map((entry) => toUserWritingEntryRow(userId, entry)), {
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
