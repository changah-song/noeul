import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type CleanupJob = {
  id: string;
  bucket_id: string;
  object_path: string;
};

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
  return error?.code === '404'
    || message.includes('does not exist')
    || message.includes('not found');
};

const getLimit = async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const requested = Number(body?.limit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.round(requested), MAX_LIMIT);
};

const assertCleanupAuthorized = (req: Request) => {
  const cleanupSecret = getRequiredEnv('STORAGE_CLEANUP_SECRET');
  const bearerToken = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const headerSecret = req.headers.get('x-cleanup-secret') ?? '';
  if (bearerToken !== cleanupSecret && headerSecret !== cleanupSecret) {
    throw new Response(JSON.stringify({ error: 'Unauthorized.' }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
    });
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
    assertCleanupAuthorized(req);

    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseServiceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const limit = await getLimit(req);
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: jobs, error: jobsError } = await adminClient
      .from('storage_cleanup_jobs')
      .select('id, bucket_id, object_path')
      .is('processed_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (jobsError) {
      throw jobsError;
    }

    const processed: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const job of (jobs ?? []) as CleanupJob[]) {
      const { error: removeError } = await adminClient.storage
        .from(job.bucket_id)
        .remove([job.object_path]);

      if (removeError && !isMissingResourceError(removeError)) {
        failed.push({ id: job.id, error: removeError.message ?? 'Storage removal failed' });
        continue;
      }

      const { error: updateError } = await adminClient
        .from('storage_cleanup_jobs')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', job.id);

      if (updateError) {
        failed.push({ id: job.id, error: updateError.message ?? 'Cleanup job update failed' });
        continue;
      }

      processed.push(job.id);
    }

    return jsonResponse(200, {
      processed: processed.length,
      failed,
      remainingBatch: Math.max(0, (jobs ?? []).length - processed.length),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error('[process-storage-cleanup] failed', error);
    return jsonResponse(500, { error: 'Could not process storage cleanup jobs.' });
  }
});
