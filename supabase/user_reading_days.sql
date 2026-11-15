-- The reading goal's day log, one row per user per day: how long they read
-- and whether (and when) they reached that day's goal. Mirrors the on-device
-- `reading-days` log (frontend/services/readingGoal.js); streaks are worked
-- out from these days, so keeping them here is what lets a streak survive a
-- reinstall or a new phone (frontend/services/readingDaysCloudSync.js).
--
-- A day only ever grows. The trigger below enforces that on the server too:
-- an update can raise `ms` and set `met_at`, never lower or clear them, so two
-- phones sending the same day in either order end with the same row.
--
-- Apply this against your Supabase instance (SQL editor) once, the same way
-- the other files in this directory are applied. Until it is, the app's sync
-- of reading days fails quietly and the log stays on the device as before.

create table if not exists public.user_reading_days (
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The reader's local calendar day.
  day date not null,

  ms bigint not null default 0 check (ms >= 0 and ms <= 86400000),
  goal_ms bigint,
  met_at timestamptz,

  inserted_at timestamptz default now(),
  server_updated_at timestamptz default now(),

  primary key (user_id, day)
);

create index if not exists user_reading_days_user_server_updated_idx
on public.user_reading_days(user_id, server_updated_at);

create or replace function public.user_reading_days_merge()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- greatest/least skip nulls: the longer time, the earlier goal.
    new.ms = greatest(old.ms, new.ms);
    new.met_at = least(old.met_at, new.met_at);
    new.goal_ms = coalesce(new.goal_ms, old.goal_ms);
    if new.ms = old.ms
      and new.met_at is not distinct from old.met_at
      and new.goal_ms is not distinct from old.goal_ms then
      -- Nothing changed: other phones needn't fetch the row again.
      new.server_updated_at = old.server_updated_at;
      return new;
    end if;
  end if;
  new.server_updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_reading_days_merge on public.user_reading_days;
create trigger user_reading_days_merge
before insert or update on public.user_reading_days
for each row execute function public.user_reading_days_merge();

alter table public.user_reading_days enable row level security;

drop policy if exists "Users can read their own reading days"
on public.user_reading_days;

create policy "Users can read their own reading days"
on public.user_reading_days for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own reading days"
on public.user_reading_days;

create policy "Users can insert their own reading days"
on public.user_reading_days for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own reading days"
on public.user_reading_days;

create policy "Users can update their own reading days"
on public.user_reading_days for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Deliberately NO delete policy: the client never deletes a day. The rows go
-- with the account (on delete cascade).
