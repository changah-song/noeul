-- Friends: invite links, friendships, and the small card each reader shares
-- with their friends (name, streak, the book they're reading, books finished).
-- The app side is frontend/services/friends.js.
--
-- Nobody reads another person's own tables. Each reader's phone writes one
-- row about them into `friend_cards`, and only that row is visible to their
-- friends. A card exists only for someone who has invited or accepted
-- someone, so readers who never use friends share nothing.
--
-- Apply this against your Supabase instance (SQL editor) once, the same way
-- the other files in this directory are applied. Until it is, Profile's
-- Friends section shows that friends couldn't be loaded.

-- ─── Tables ──────────────────────────────────────────────────────────────────

-- One invite code per account; the invite link carries it.
create table if not exists public.friend_invites (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz default now()
);

-- A friendship is two rows, one each way, so "my friends" is a plain lookup
-- on user_id and removing either account takes both rows with it.
create table if not exists public.friendships (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.friend_cards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,

  -- The streak as of `streak_day`, the last day the goal was reached on the
  -- reader's own calendar. `utc_offset_minutes` is their clock's offset then,
  -- so a friend's phone can tell whether that streak is still running.
  day_streak integer not null default 0 check (day_streak >= 0),
  streak_day date,
  utc_offset_minutes integer not null default 0 check (utc_offset_minutes between -840 and 840),
  total_days integer not null default 0 check (total_days >= 0),

  books_finished integer not null default 0 check (books_finished >= 0),
  current_book_title text,
  current_book_author text,
  current_book_progress real check (current_book_progress is null or (current_book_progress >= 0 and current_book_progress <= 1)),

  updated_at timestamptz default now(),

  check (char_length(coalesce(display_name, '')) <= 80),
  check (char_length(coalesce(current_book_title, '')) <= 300),
  check (char_length(coalesce(current_book_author, '')) <= 300)
);

create or replace function public.set_friend_cards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists friend_cards_set_updated_at on public.friend_cards;
create trigger friend_cards_set_updated_at
before insert or update on public.friend_cards
for each row execute function public.set_friend_cards_updated_at();

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.friend_invites enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_cards enable row level security;

-- Invites and friendships are only ever written by the functions below.
drop policy if exists "Users can read their own invite" on public.friend_invites;
create policy "Users can read their own invite"
on public.friend_invites for select
using (auth.uid() = user_id);

drop policy if exists "Users can read their own friendships" on public.friendships;
create policy "Users can read their own friendships"
on public.friendships for select
using (auth.uid() = user_id);

drop policy if exists "Users and their friends can read a card" on public.friend_cards;
create policy "Users and their friends can read a card"
on public.friend_cards for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.friendships
    where friendships.user_id = auth.uid()
      and friendships.friend_id = friend_cards.user_id
  )
);

drop policy if exists "Users can insert their own card" on public.friend_cards;
create policy "Users can insert their own card"
on public.friend_cards for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own card" on public.friend_cards;
create policy "Users can update their own card"
on public.friend_cards for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Leaving friends altogether: deleting the card stops sharing.
drop policy if exists "Users can delete their own card" on public.friend_cards;
create policy "Users can delete their own card"
on public.friend_cards for delete
using (auth.uid() = user_id);

-- ─── Functions ───────────────────────────────────────────────────────────────

-- The signed-in account, refusing guests (anonymous sign-ins).
-- Asks the accounts table, not the sign-in token: a guest who has just signed
-- up keeps a token that still says "anonymous" until it is next refreshed.
create or replace function public.friends_require_account()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (
    select 1 from auth.users
    where id = me and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'friends_account_required';
  end if;
  return me;
end;
$$;

revoke all on function public.friends_require_account() from public, anon;
grant execute on function public.friends_require_account() to authenticated;

-- This account's invite code, made the first time it's asked for.
create or replace function public.get_friend_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.friends_require_account();
  found text;
begin
  select code into found from public.friend_invites where user_id = me;
  if found is not null then
    return found;
  end if;

  for attempt in 1..5 loop
    begin
      -- 12 hex characters: not guessable, short enough to paste.
      insert into public.friend_invites (user_id, code)
      values (me, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
      on conflict (user_id) do nothing;
      select code into found from public.friend_invites where user_id = me;
      return found;
    exception when unique_violation then
      -- The code is taken; try another.
      null;
    end;
  end loop;
  raise exception 'friends_invite_unavailable';
end;
$$;

-- Who an invite is from, shown before accepting it.
create or replace function public.preview_friend_invite(invite_code text)
returns table (inviter_id uuid, display_name text, is_self boolean, already_friends boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.friends_require_account();
begin
  return query
  select
    invites.user_id,
    cards.display_name,
    invites.user_id = me,
    exists (
      select 1 from public.friendships
      where friendships.user_id = me and friendships.friend_id = invites.user_id
    )
  from public.friend_invites invites
  left join public.friend_cards cards on cards.user_id = invites.user_id
  where invites.code = upper(btrim(invite_code));
end;
$$;

-- Accept an invite: the two accounts become friends, both ways, at once.
-- (Sending someone your link is your yes; opening it and confirming is theirs.)
create or replace function public.accept_friend_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.friends_require_account();
  inviter uuid;
begin
  select user_id into inviter
  from public.friend_invites
  where code = upper(btrim(invite_code));

  if inviter is null then
    raise exception 'friends_invite_not_found';
  end if;
  if inviter = me then
    raise exception 'friends_invite_own';
  end if;
  if (select count(*) from public.friendships where user_id = me) >= 200
     or (select count(*) from public.friendships where user_id = inviter) >= 200 then
    raise exception 'friends_limit_reached';
  end if;

  insert into public.friendships (user_id, friend_id)
  values (me, inviter), (inviter, me)
  on conflict do nothing;

  return inviter;
end;
$$;

create or replace function public.remove_friend(friend uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.friends_require_account();
begin
  delete from public.friendships
  where (user_id = me and friend_id = friend)
     or (user_id = friend and friend_id = me);
end;
$$;

revoke all on function public.get_friend_invite_code() from public, anon;
revoke all on function public.preview_friend_invite(text) from public, anon;
revoke all on function public.accept_friend_invite(text) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.get_friend_invite_code() to authenticated;
grant execute on function public.preview_friend_invite(text) to authenticated;
grant execute on function public.accept_friend_invite(text) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
