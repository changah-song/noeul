import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const USER_TABLES = [
  'user_vocab_related_known_words',
  'user_vocab_contexts',
  'user_vocab',
  'user_books',
  'user_songs',
  'user_writing_entries',
  'user_preferences',
];

const USER_BOOKS_BUCKET = 'user-books';
const STORAGE_PAGE_SIZE = 100;

const jsonResponse = (status: number, body: Record<string, unknown>) => (
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
);

const getRequiredEnv = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
};

const isMissingResourceError = (error: { code?: string; message?: string } | null | undefined) => {
  const message = String(error?.message ?? '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === '404'
    || message.includes('does not exist')
    || message.includes('not found');
};

const chunk = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const deleteOwnedRows = async (adminClient: ReturnType<typeof createClient>, userId: string) => {
  for (const table of USER_TABLES) {
    const { error } = await adminClient
      .from(table)
      .delete()
      .eq('user_id', userId);

    if (error && !isMissingResourceError(error)) {
      throw error;
    }
  }
};

const isStorageFolder = (item: { id?: string | null; metadata?: unknown }) => (
  item.id == null && item.metadata == null
);

const listStorageObjectPaths = async (
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  rootPath: string
) => {
  const objectPaths: string[] = [];
  const pendingFolders = [rootPath.replace(/\/+$/, '')];

  while (pendingFolders.length > 0) {
    const folderPath = pendingFolders.pop() ?? '';
    let offset = 0;

    while (true) {
      const { data, error } = await adminClient.storage
        .from(bucket)
        .list(folderPath, {
          limit: STORAGE_PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });

      if (error) {
        if (isMissingResourceError(error)) {
          return objectPaths;
        }
        throw error;
      }

      const items = data ?? [];
      for (const item of items) {
        const childPath = folderPath ? `${folderPath}/${item.name}` : item.name;
        if (isStorageFolder(item)) {
          pendingFolders.push(childPath);
        } else {
          objectPaths.push(childPath);
        }
      }

      if (items.length < STORAGE_PAGE_SIZE) {
        break;
      }

      offset += items.length;
    }
  }

  return objectPaths;
};

const removeStoragePrefix = async (
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  userId: string
) => {
  const objectPaths = await listStorageObjectPaths(adminClient, bucket, userId);

  for (const batch of chunk(objectPaths, STORAGE_PAGE_SIZE)) {
    const { error } = await adminClient.storage
      .from(bucket)
      .remove(batch);

    if (error && !isMissingResourceError(error)) {
      throw error;
    }
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  try {
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseAnonKey = getRequiredEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization') ?? '';

    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'Sign in before deleting your profile.' });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== 'DELETE_PROFILE') {
      return jsonResponse(400, { error: 'Deletion confirmation is required.' });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user?.id) {
      return jsonResponse(401, { error: 'Sign in again before deleting your profile.' });
    }

    await removeStoragePrefix(adminClient, USER_BOOKS_BUCKET, user.id);
    await deleteOwnedRows(adminClient, user.id);

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      throw deleteUserError;
    }

    return jsonResponse(200, { deleted: true });
  } catch (error) {
    console.error('[delete-profile] failed', error);
    return jsonResponse(500, { error: 'Could not delete profile. Please try again.' });
  }
});
