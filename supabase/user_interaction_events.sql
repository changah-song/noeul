-- Append-only interaction event log (Phase 1 of the personalized vocabulary
-- model). Mirrors the on-device `interaction_events` table. Push-only: the client
-- only ever INSERTs here; rows are immutable once written. Dedupe is by
-- (user_id, client_event_id) so re-pushing the same event is a harmless no-op.
--
-- Apply this against your Supabase instance (SQL editor) once, the same way the
-- other files in this directory are applied.

create table if not exists public.user_interaction_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  client_event_id text not null,

  profile_id text,
  language text default 'ko',
  word text,
  stem text,
  def_key text,
  hanja text,

  event_type text not null,
  grade integer,
  outcome integer,
  value_num double precision,

  source_book_uri text,
  sentence text,
  vocab_id bigint,

  created_at timestamptz default now(),
  inserted_at timestamptz default now()
);

-- Idempotency backbone: one row per (user, client_event_id). The client upserts
-- with on_conflict = (user_id, client_event_id) and ignore_duplicates, so retries
-- and offline re-sends never create duplicates.
create unique index if not exists user_interaction_events_client_event_id_key
on public.user_interaction_events (user_id, client_event_id);

-- Query pattern for any later analysis job: a user's events for a word over time.
create index if not exists user_interaction_events_user_word_created_idx
on public.user_interaction_events (user_id, language, word, created_at);

alter table public.user_interaction_events enable row level security;

drop policy if exists "Users can read their own interaction events"
on public.user_interaction_events;

create policy "Users can read their own interaction events"
on public.user_interaction_events for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own interaction events"
on public.user_interaction_events;

create policy "Users can insert their own interaction events"
on public.user_interaction_events for insert
with check (auth.uid() = user_id);

-- Deliberately NO update or delete policy: events are immutable and append-only.
