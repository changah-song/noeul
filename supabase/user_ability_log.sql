-- Ability log: every change to a reader's level and what caused it.
--
-- Mirrors the on-device `ability_log` table (frontend/services/Database.js),
-- written by the level engine (frontend/services/levelEngine.js): one row per
-- signal (a lookup of 厮杀, a word read past, a word-check answer, a review,
-- the vocabulary picker) with the level and its uncertainty before and after.
-- Push-only and append-only, like user_interaction_events; dedupe is by
-- (user_id, client_log_id).
--
-- The admin dashboard's Level model page (dashboard/level.html) reads it
-- through admin_level_model(), which refuses anyone not in admin_users
-- (see app_telemetry.sql).
--
-- Apply once in the Supabase SQL editor, after app_telemetry.sql.

create table if not exists public.user_ability_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_log_id text not null,

  profile_id text,
  language text default 'ko',

  -- lookup | pass | review | check | pseudo | seed | check_start
  signal text not null,
  word text,
  stem text,
  -- What was observed: 1 = looked up / said "know" / recalled.
  outcome integer,

  difficulty double precision,
  -- P(known) before this signal, and the predicted chance of the observation.
  p_known double precision,
  p_observed double precision,

  theta_before double precision,
  theta_after double precision,
  var_before double precision,
  var_after double precision,
  -- The reader's learned lookup rate (P(look up | unknown)) and guess rate.
  lookup_rate double precision,
  guess_rate double precision,

  source_book_uri text,
  details jsonb,

  created_at timestamptz default now(),
  inserted_at timestamptz default now()
);

create unique index if not exists user_ability_log_client_log_id_key
on public.user_ability_log (user_id, client_log_id);

create index if not exists user_ability_log_user_lang_created_idx
on public.user_ability_log (user_id, language, created_at);

alter table public.user_ability_log enable row level security;

drop policy if exists "Users can read their own ability log" on public.user_ability_log;
create policy "Users can read their own ability log"
on public.user_ability_log for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own ability log" on public.user_ability_log;
create policy "Users can insert their own ability log"
on public.user_ability_log for insert
with check (auth.uid() = user_id);

-- No update or delete policy: the log is append-only.

-- ─── admin_level_model ───────────────────────────────────────────────────────
--
-- Everything the Level model page shows:
--   users        every (user, language) with a level: current level and how
--                sure, signal counts in the range, last activity
--   calibration  across all users in the range, per signal: predicted chance
--                vs what happened, in tenths (the model's main health check)
--   log          for the selected user and language, the newest log rows in
--                the range (up to 5,000), oldest first; the page builds the
--                timeline, the word drill-down and the per-signal totals from it

create or replace function public.admin_level_model(
  p_user uuid default null,
  p_language text default null,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_result jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorized: this account is not in admin_users'
      using errcode = '42501';
  end if;

  with
  latest as (
    select distinct on (user_id, language)
      user_id, language, theta_after as theta, var_after as variance,
      lookup_rate, guess_rate, created_at as last_at
    from public.user_ability_log
    where theta_after is not null
    order by user_id, language, created_at desc
  ),
  counts as (
    select user_id, language,
      count(*) as signals,
      count(*) filter (where signal = 'lookup') as lookups,
      count(*) filter (where signal = 'pass') as passes,
      count(*) filter (where signal = 'review') as reviews,
      count(*) filter (where signal in ('check', 'pseudo')) as checks,
      sum(theta_after - theta_before) filter (where signal not in ('seed', 'check_start')) as drift
    from public.user_ability_log
    where created_at >= v_since
    group by user_id, language
  ),
  user_rows as (
    select
      coalesce(l.user_id, pa.user_id) as user_id,
      u.email,
      coalesce(u.is_anonymous, false) as is_anonymous,
      coalesce(l.language, pa.language) as language,
      coalesce(l.theta, pa.theta) as theta,
      l.variance,
      l.lookup_rate,
      l.guess_rate,
      greatest(l.last_at, pa.updated_at) as last_at,
      coalesce(c.signals, 0) as signals,
      coalesce(c.lookups, 0) as lookups,
      coalesce(c.passes, 0) as passes,
      coalesce(c.reviews, 0) as reviews,
      coalesce(c.checks, 0) as checks,
      c.drift
    from latest l
    full join (
      select distinct on (user_id, language) user_id, language, theta, updated_at
      from public.profile_ability
      order by user_id, language, updated_at desc
    ) pa on pa.user_id = l.user_id and pa.language = l.language
    left join counts c
      on c.user_id = coalesce(l.user_id, pa.user_id) and c.language = coalesce(l.language, pa.language)
    left join auth.users u on u.id = coalesce(l.user_id, pa.user_id)
    order by greatest(l.last_at, pa.updated_at) desc nulls last
    limit 500
  ),
  calibration as (
    select
      signal,
      least(9, floor(coalesce(case when signal in ('lookup', 'pass') then p_observed else p_known end, 0) * 10))::int as bin,
      count(*) as n,
      avg(case when signal in ('lookup', 'pass') then p_observed else p_known end) as predicted,
      avg(outcome) as observed
    from public.user_ability_log
    where created_at >= v_since
      and signal in ('lookup', 'pass', 'review', 'check')
      and (p_language is null or language = p_language)
    group by 1, 2
  ),
  selected_log as (
    select *
    from (
      select created_at, signal, word, stem, outcome, difficulty, p_known, p_observed,
             theta_before, theta_after, var_before, var_after, lookup_rate, guess_rate,
             source_book_uri, details
      from public.user_ability_log
      where p_user is not null
        and user_id = p_user
        and (p_language is null or language = p_language)
        and created_at >= v_since
      order by created_at desc
      limit 5000
    ) s
    order by created_at asc
  )
  select jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object('days', v_days, 'since', v_since),
    'users', coalesce((select jsonb_agg(to_jsonb(r)) from user_rows r), '[]'::jsonb),
    'calibration', coalesce((select jsonb_agg(to_jsonb(c) order by c.signal, c.bin) from calibration c), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(to_jsonb(s)) from selected_log s), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_level_model(uuid, text, integer) from public;
grant execute on function public.admin_level_model(uuid, text, integer) to authenticated;
