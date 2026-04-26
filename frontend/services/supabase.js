import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

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

const toUserVocabRow = (userId, entry) => ({
  user_id: userId,
  word: entry.word,
  hanja: entry.hanja ?? null,
  definition: entry.definition ?? entry.def ?? null,
  status: entry.status ?? entry.level ?? 'unorganized',
});

export const fetchUserVocab = async (userId) => {
  const { data, error } = await supabase
    .from('user_vocab')
    .select('word, hanja, definition, status')
    .eq('user_id', userId);

  if (error) {
    console.warn(`${FILE_TAG} fetchUserVocab failed`, error);
    throw error;
  }

  return data ?? [];
};

export const upsertUserVocabEntry = async (userId, entry) => {
  const { error } = await supabase
    .from('user_vocab')
    .upsert(toUserVocabRow(userId, entry), {
      onConflict: 'user_id,word,definition',
    });

  if (error) {
    console.warn(`${FILE_TAG} upsertUserVocabEntry failed`, error);
    throw error;
  }
};

export const upsertUserVocabEntries = async (userId, entries) => {
  if (!entries || entries.length === 0) {
    return;
  }

  const { error } = await supabase
    .from('user_vocab')
    .upsert(entries.map((entry) => toUserVocabRow(userId, entry)), {
      onConflict: 'user_id,word,definition',
    });

  if (error) {
    console.warn(`${FILE_TAG} upsertUserVocabEntries failed`, error);
    throw error;
  }
};

export const deleteUserVocabEntry = async (userId, entry) => {
  let query = supabase
    .from('user_vocab')
    .delete()
    .eq('user_id', userId)
    .eq('word', entry.word)
    .eq('definition', entry.definition ?? entry.def ?? null);

  query = entry.hanja == null
    ? query.is('hanja', null)
    : query.eq('hanja', entry.hanja);

  const { error } = await query;

  if (error) {
    console.warn(`${FILE_TAG} deleteUserVocabEntry failed`, error);
    throw error;
  }
};

export const updateUserVocabStatus = async (userId, entry, status) => {
  let query = supabase
    .from('user_vocab')
    .update({ status })
    .eq('user_id', userId)
    .eq('word', entry.word)
    .eq('definition', entry.definition ?? entry.def ?? null);

  query = entry.hanja == null
    ? query.is('hanja', null)
    : query.eq('hanja', entry.hanja);

  const { error } = await query;

  if (error) {
    console.warn(`${FILE_TAG} updateUserVocabStatus failed`, error);
    throw error;
  }
};

export default supabase;
