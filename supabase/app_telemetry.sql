-- App health telemetry + admin dashboard.
--
-- 1. `app_events`: crash, error, UI-freeze and startup-time events recorded by
--    the app (services/appTelemetry.js). Push-only, like
--    user_interaction_events: clients may INSERT their own rows and can never
--    read them back. Dedupe is by (user_id, client_event_id), so offline
--    re-sends are harmless.
-- 2. `admin_users`: who may open the dashboard. Clients have no access to this
--    table at all; add rows from the SQL editor.
-- 3. `admin_dashboard(p_days, p_environment)`: one SECURITY DEFINER call that
--    returns every number the dashboard (dashboard/index.html) shows, and
--    refuses anyone who is not in admin_users. This is how the dashboard reads
--    data without a service-role key in the browser.
--
-- Apply this file once in the Supabase SQL editor, then grant yourself access:
--
--   -- Authentication > Users > Add user (email + password, auto-confirm), then:
--   insert into public.admin_users (user_id)
--   select id from auth.users where email = 'you@example.com';

-- ─── 1. app_events ───────────────────────────────────────────────────────────

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  client_event_id text not null,
  session_id text not null,

  -- app_start: one per launch; duration_ms = JS start -> first screen ready.
  -- crash:     fatal JS error (the app was about to die).
  -- error:     non-fatal error reported to the global handler.
  -- js_stall:  JS thread blocked; duration_ms = how long the UI was frozen.
  event_type text not null,

  message text,
  stack text,
  screen text,
  duration_ms integer,
  is_fatal boolean,

  environment text not null default 'production',
  app_version text,
  build_number text,
  platform text,
  os_version text,
  device_model text,
  metadata jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null,
  inserted_at timestamptz not null default now(),

  constraint app_events_event_type_check
    check (event_type in ('app_start', 'crash', 'error', 'js_stall')),
  constraint app_events_environment_check
    check (environment in ('production', 'development')),
  -- Bound what a single client can push.
  constraint app_events_size_check check (
    char_length(client_event_id) <= 100
    and char_length(session_id) <= 100
    and coalesce(char_length(message), 0) <= 2000
    and coalesce(char_length(stack), 0) <= 8000
    and coalesce(char_length(screen), 0) <= 200
    and pg_column_size(metadata) <= 4000
  )
);

create unique index if not exists app_events_client_event_id_key
on public.app_events (user_id, client_event_id);

create index if not exists app_events_type_occurred_idx
on public.app_events (event_type, occurred_at desc);

create index if not exists app_events_user_occurred_idx
on public.app_events (user_id, occurred_at desc);

alter table public.app_events enable row level security;

drop policy if exists "Users can insert their own app events" on public.app_events;

create policy "Users can insert their own app events"
on public.app_events for insert
with check (auth.uid() = user_id);

-- Deliberately no select / update / delete policy: telemetry is write-only for
-- clients. The dashboard reads it through admin_dashboard() below.

-- ─── 2. admin_users ──────────────────────────────────────────────────────────

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- RLS on with no policies: invisible to every client role.
alter table public.admin_users enable row level security;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

-- ─── 3. admin_dashboard ──────────────────────────────────────────────────────
--
-- "Active" means the user produced an app_events row or a
-- user_interaction_events row (lookup, review, save...) that day, so activity
-- shows up even for app versions that predate telemetry.

create or replace function public.admin_dashboard(
  p_days integer default 30,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_env text := coalesce(p_environment, 'production');
  v_today date := (now() at time zone 'utc')::date;
  v_since date := v_today - (least(greatest(coalesce(p_days, 30), 1), 365) - 1);
  v_since_ts timestamptz := (v_today - (least(greatest(coalesce(p_days, 30), 1), 365) - 1))::timestamp at time zone 'utc';
  v_result jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'Not authorized: this account is not in admin_users'
      using errcode = '42501';
  end if;

  with
  ev as (
    select *
    from public.app_events
    where occurred_at >= v_since_ts
      and (v_env = 'all' or environment = v_env)
  ),
  activity as (
    select user_id, (occurred_at at time zone 'utc')::date as day
    from public.app_events
    where occurred_at >= v_today - 29
      and (v_env = 'all' or environment = v_env)
    union
    select user_id, (created_at at time zone 'utc')::date
    from public.user_interaction_events
    where created_at >= v_today - 29
  ),
  activity_range as (
    select user_id, (occurred_at at time zone 'utc')::date as day
    from ev
    union
    select user_id, (created_at at time zone 'utc')::date
    from public.user_interaction_events
    where created_at >= v_since_ts
  ),
  days as (
    select generate_series(v_since, v_today, interval '1 day')::date as day
  ),
  daily as (
    select
      d.day,
      (select count(*) from auth.users u
        where (u.created_at at time zone 'utc')::date = d.day) as new_users,
      (select count(*) from auth.users u
        where (u.created_at at time zone 'utc')::date = d.day
          and not coalesce(u.is_anonymous, false)) as new_registered,
      (select count(distinct a.user_id) from activity_range a where a.day = d.day) as active_users,
      (select count(*) from ev e
        where e.event_type = 'app_start' and (e.occurred_at at time zone 'utc')::date = d.day) as sessions,
      (select count(*) from ev e
        where e.event_type = 'crash' and (e.occurred_at at time zone 'utc')::date = d.day) as crashes,
      (select count(*) from ev e
        where e.event_type = 'error' and (e.occurred_at at time zone 'utc')::date = d.day) as errors,
      (select count(*) from ev e
        where e.event_type = 'js_stall' and (e.occurred_at at time zone 'utc')::date = d.day) as stalls,
      (select percentile_cont(0.5) within group (order by e.duration_ms) from ev e
        where e.event_type = 'app_start' and e.duration_ms is not null
          and (e.occurred_at at time zone 'utc')::date = d.day) as startup_p50_ms,
      (select percentile_cont(0.95) within group (order by e.duration_ms) from ev e
        where e.event_type = 'app_start' and e.duration_ms is not null
          and (e.occurred_at at time zone 'utc')::date = d.day) as startup_p95_ms,
      (select count(*) from public.user_interaction_events i
        where i.event_type = 'lookup' and (i.created_at at time zone 'utc')::date = d.day) as lookups,
      (select count(*) from public.user_interaction_events i
        where i.event_type = 'review' and (i.created_at at time zone 'utc')::date = d.day) as reviews,
      (select count(*) from public.user_interaction_events i
        where i.event_type = 'save' and (i.created_at at time zone 'utc')::date = d.day) as saves
    from days d
  ),
  session_health as (
    select
      count(distinct session_id) filter (where event_type = 'app_start') as sessions,
      count(distinct session_id) filter (where event_type = 'crash') as crashed_sessions
    from ev
  ),
  crash_groups as (
    select
      event_type,
      coalesce(nullif(left(message, 300), ''), '(no message)') as message,
      count(*) as occurrences,
      count(distinct user_id) as users,
      max(occurred_at) as last_seen,
      min(occurred_at) as first_seen,
      (array_agg(app_version order by occurred_at desc))[1] as latest_version,
      (array_agg(screen order by occurred_at desc))[1] as latest_screen,
      (array_agg(stack order by occurred_at desc))[1] as latest_stack
    from ev
    where event_type in ('crash', 'error')
    group by event_type, coalesce(nullif(left(message, 300), ''), '(no message)')
    order by (event_type = 'crash') desc, count(*) desc
    limit 25
  ),
  stall_screens as (
    select
      coalesce(screen, '(unknown)') as screen,
      count(*) as stalls,
      count(distinct user_id) as users,
      percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
      max(duration_ms) as max_ms
    from ev
    where event_type = 'js_stall'
    group by coalesce(screen, '(unknown)')
    order by count(*) desc
    limit 15
  ),
  versions as (
    select
      coalesce(app_version, '(unknown)') as app_version,
      count(distinct session_id) filter (where event_type = 'app_start') as sessions,
      count(distinct session_id) filter (where event_type = 'crash') as crashed_sessions,
      count(*) filter (where event_type = 'crash') as crashes,
      count(*) filter (where event_type = 'js_stall') as stalls,
      count(distinct user_id) as users,
      percentile_cont(0.95) within group (order by duration_ms)
        filter (where event_type = 'app_start') as startup_p95_ms,
      max(occurred_at) as last_seen
    from ev
    group by coalesce(app_version, '(unknown)')
    order by max(occurred_at) desc
    limit 10
  ),
  latest_device as (
    select distinct on (user_id)
      user_id, platform, app_version, os_version, device_model
    from public.app_events
    where event_type = 'app_start'
    order by user_id, occurred_at desc
  ),
  last_seen as (
    select user_id, max(at) as last_seen
    from (
      select user_id, max(occurred_at) as at from public.app_events group by user_id
      union all
      select user_id, max(created_at) from public.user_interaction_events group by user_id
    ) s
    group by user_id
  ),
  user_rows as (
    select
      u.id,
      u.email,
      coalesce(u.is_anonymous, false) as is_anonymous,
      u.created_at,
      ls.last_seen,
      ld.platform,
      ld.app_version,
      ld.device_model,
      p.target_language,
      (select count(*) from public.user_books b
        where b.user_id = u.id and b.deleted_at is null) as books,
      (select count(*) from public.user_vocab v
        where v.user_id = u.id and v.deleted_at is null) as vocab,
      (select count(*) from ev e
        where e.user_id = u.id and e.event_type = 'crash') as crashes,
      (select count(*) from ev e
        where e.user_id = u.id and e.event_type = 'js_stall') as stalls
    from auth.users u
    left join last_seen ls on ls.user_id = u.id
    left join latest_device ld on ld.user_id = u.id
    left join public.user_preferences p on p.user_id = u.id
    order by ls.last_seen desc nulls last, u.created_at desc
    limit 500
  ),
  recent as (
    select occurred_at, event_type, message, screen, duration_ms, user_id,
           app_version, platform, device_model
    from ev
    where event_type in ('crash', 'error', 'js_stall')
    order by occurred_at desc
    limit 50
  )
  select jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object('days', v_days, 'since', v_since, 'until', v_today, 'environment', v_env),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'anonymous', (select count(*) from auth.users where coalesce(is_anonymous, false)),
      'registered', (select count(*) from auth.users where not coalesce(is_anonymous, false)),
      'new_in_range', (select count(*) from auth.users where created_at >= v_since_ts),
      'active_1d', (select count(distinct user_id) from activity where day = v_today),
      'active_7d', (select count(distinct user_id) from activity where day > v_today - 7),
      'active_30d', (select count(distinct user_id) from activity),
      'active_in_range', (select count(distinct user_id) from activity_range)
    ),
    'content', jsonb_build_object(
      'books', (select count(*) from public.user_books where deleted_at is null),
      'vocab', (select count(*) from public.user_vocab where deleted_at is null),
      'interaction_events_in_range',
        (select count(*) from public.user_interaction_events where created_at >= v_since_ts)
    ),
    'health', jsonb_build_object(
      'sessions', (select sessions from session_health),
      'crashed_sessions', (select crashed_sessions from session_health),
      'crash_free_rate', (
        select case when sessions = 0 then null
                    else 1 - crashed_sessions::numeric / sessions end
        from session_health
      ),
      'crashes', (select count(*) from ev where event_type = 'crash'),
      'errors', (select count(*) from ev where event_type = 'error'),
      'stalls', (select count(*) from ev where event_type = 'js_stall'),
      'startup_p50_ms', (select percentile_cont(0.5) within group (order by duration_ms)
                         from ev where event_type = 'app_start' and duration_ms is not null),
      'startup_p95_ms', (select percentile_cont(0.95) within group (order by duration_ms)
                         from ev where event_type = 'app_start' and duration_ms is not null),
      'last_event_at', (select max(occurred_at) from public.app_events)
    ),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from daily d), '[]'::jsonb),
    'target_languages', coalesce((
      select jsonb_agg(jsonb_build_object('language', language, 'users', users) order by users desc)
      from (
        select coalesce(target_language, '(unset)') as language, count(*) as users
        from public.user_preferences
        group by coalesce(target_language, '(unset)')
      ) t
    ), '[]'::jsonb),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('platform', platform, 'users', users) order by users desc)
      from (
        select coalesce(platform, '(unknown)') as platform, count(distinct user_id) as users
        from ev where event_type = 'app_start'
        group by coalesce(platform, '(unknown)')
      ) p
    ), '[]'::jsonb),
    'crash_groups', coalesce((select jsonb_agg(to_jsonb(c)) from crash_groups c), '[]'::jsonb),
    'stall_screens', coalesce((select jsonb_agg(to_jsonb(s)) from stall_screens s), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(to_jsonb(v)) from versions v), '[]'::jsonb),
    'user_list', coalesce((select jsonb_agg(to_jsonb(r)) from user_rows r), '[]'::jsonb),
    'recent_events', coalesce((select jsonb_agg(to_jsonb(r)) from recent r), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_dashboard(integer, text) from public;
grant execute on function public.admin_dashboard(integer, text) to authenticated;
