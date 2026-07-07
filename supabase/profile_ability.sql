-- Per-profile ability estimate (Phase 2 of the personalized vocabulary model).
-- Mirrors the on-device `profile_ability` table: one row per
-- (user, profile, language) holding the latent ability `theta` the baseline
-- scorer reads as P(known) = sigmoid(theta - difficulty_word).
--
-- Theta is DEVICE-AUTHORITATIVE — the client recomputes it from local behavior
-- (Phase 3) and pushes the latest value here. This channel is push-only and
-- MUTABLE: the client upserts on (user_id, profile_id, language) and UPDATES the
-- row to the newest value (unlike the immutable interaction event log).
--
-- Apply this against your Supabase instance (SQL editor) once, the same way the
-- other files in this directory are applied.

create table if not exists public.profile_ability (
  user_id uuid not null references auth.users(id) on delete cascade,

  profile_id text not null default 'ko_default',
  language text not null default 'ko',

  theta double precision,
  self_report_rank integer,
  event_count integer default 0,

  seeded_at timestamptz,
  updated_at timestamptz default now(),
  inserted_at timestamptz default now(),

  primary key (user_id, profile_id, language)
);

alter table public.profile_ability enable row level security;

drop policy if exists "Users can read their own profile ability"
on public.profile_ability;

create policy "Users can read their own profile ability"
on public.profile_ability for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own profile ability"
on public.profile_ability;

create policy "Users can insert their own profile ability"
on public.profile_ability for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own profile ability"
on public.profile_ability;

create policy "Users can update their own profile ability"
on public.profile_ability for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Deliberately NO delete policy: profiles are long-lived; the client never
-- deletes ability rows, it only overwrites theta with newer values.
