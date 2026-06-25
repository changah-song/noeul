import { USER_SONGS_TABLE, supabase } from './supabase';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import { normalizeBookLanguage } from '../constants/languages';

const FILE_TAG = '[songCloudSync]';
const USER_SONG_SELECT = `
  id,
  user_id,
  client_id,
  title,
  artist,
  lyrics,
  source,
  external_id,
  language,
  font_size,
  lines,
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

const normalizeInteger = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
};

const isMissingRpcError = (error, functionName) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes(functionName.toLowerCase());
};

const sortSongRows = (rows) => [...(rows ?? [])].sort((a, b) => (
  new Date(b.updated_at ?? b.created_at ?? 0) - new Date(a.updated_at ?? a.created_at ?? 0)
));

const toUserSongRow = (userId, song) => {
  const now = new Date().toISOString();

  return {
    user_id: userId,
    client_id: song.id,
    title: safeString(song.title, 'Untitled song'),
    artist: safeString(song.artist, null),
    lyrics: typeof song.lyrics === 'string' ? song.lyrics : '',
    source: song.source ?? song.provider ?? null,
    external_id: song.externalId ?? song.external_id ?? song.providerId ?? null,
    language: normalizeBookLanguage(song.language ?? song.targetLanguage ?? song.target_language ?? 'ko'),
    font_size: normalizeInteger(song.fontSize),
    lines: normalizeInteger(song.lines),
    created_at: toIsoString(song.createdAt, now),
    updated_at: toIsoString(song.updatedAt, now),
    deleted_at: song.deletedAt ?? song.deleted_at ?? null,
  };
};

export const cloudSongToLocalSong = (row) => ({
  id: row.client_id,
  cloudId: row.id,
  cloudOwnerId: row.user_id,
  title: safeString(row.title, 'Untitled song'),
  artist: safeString(row.artist, 'Unknown artist'),
  lyrics: typeof row.lyrics === 'string' ? row.lyrics : '',
  source: row.source ?? null,
  provider: row.source ?? null,
  externalId: row.external_id ?? null,
  providerId: row.external_id ?? null,
  language: normalizeBookLanguage(row.language ?? 'ko'),
  fontSize: normalizeInteger(row.font_size, undefined),
  lines: normalizeInteger(row.lines, undefined),
  createdAt: row.created_at ?? row.updated_at,
  updatedAt: row.updated_at ?? row.created_at,
  deletedAt: row.deleted_at ?? null,
  savedTerms: [],
});

export const fetchUserSongs = async (userId, {
  includeDeleted = true,
  targetLanguage = null,
  language = targetLanguage,
} = {}) => {
  if (!userId) {
    return [];
  }

  const normalizedLanguage = language != null ? normalizeBookLanguage(language) : null;
  try {
    const { data, error } = await supabase.rpc('sync_user_songs_pull', {
      target_language: normalizedLanguage,
      updated_after: null,
    });

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data?.songs) ? data.songs : [];
    return sortSongRows(includeDeleted ? rows : rows.filter((row) => !row.deleted_at));
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_songs_pull')) {
      console.warn(`${FILE_TAG} fetchUserSongs failed`, error);
      throw error;
    }
  }

  let query = supabase
    .from(USER_SONGS_TABLE)
    .select(USER_SONG_SELECT)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (normalizedLanguage != null) {
    query = query.eq('language', normalizedLanguage);
  }

  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
    console.warn(`${FILE_TAG} fetchUserSongs failed`, error);
    throw error;
  }

  return data ?? [];
};

export const upsertUserSong = async ({ user, ownerId, generation, song } = {}) => {
  if (!song?.id) {
    return null;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toUserSongRow(userId, song);

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('sync_user_songs_push', {
      songs: [row],
    });

    if (error) {
      throw error;
    }

    return row;
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_songs_push')) {
      console.warn(`${FILE_TAG} upsertUserSong failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from(USER_SONGS_TABLE)
    .upsert(row, {
      onConflict: 'user_id,client_id',
    })
    .select(USER_SONG_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} upsertUserSong failed`, error);
    throw error;
  }

  return data;
};

export const upsertUserSongs = async ({ user, ownerId, generation, songs } = {}) => {
  const validSongs = (songs || []).filter((song) => song?.id);
  if (validSongs.length === 0) {
    return [];
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const rows = validSongs.map((song) => toUserSongRow(userId, song));

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('sync_user_songs_push', {
      songs: rows,
    });

    if (error) {
      throw error;
    }

    return rows;
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_songs_push')) {
      console.warn(`${FILE_TAG} upsertUserSongs failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from(USER_SONGS_TABLE)
    .upsert(rows, {
      onConflict: 'user_id,client_id',
    })
    .select(USER_SONG_SELECT);

  if (error) {
    console.warn(`${FILE_TAG} upsertUserSongs failed`, error);
    throw error;
  }

  return data ?? [];
};

export const softDeleteUserSong = async ({
  user,
  ownerId,
  generation,
  songId,
  targetLanguage = null,
  language = targetLanguage,
} = {}) => {
  if (!songId) {
    return;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const normalizedLanguage = language != null ? normalizeBookLanguage(language) : null;
  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('soft_delete_user_song', {
      client_id_value: songId,
      target_language: normalizedLanguage,
    });

    if (error) {
      throw error;
    }

    return;
  } catch (error) {
    if (!isMissingRpcError(error, 'soft_delete_user_song')) {
      console.warn(`${FILE_TAG} softDeleteUserSong failed`, error);
      throw error;
    }
  }

  let query = supabase
    .from(USER_SONGS_TABLE)
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('client_id', songId);

  if (normalizedLanguage != null) {
    query = query.eq('language', normalizedLanguage);
  }

  const { error } = await query;

  if (error) {
    console.warn(`${FILE_TAG} softDeleteUserSong failed`, error);
    throw error;
  }
};
