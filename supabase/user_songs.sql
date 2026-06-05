create table if not exists public.user_songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  client_id text not null,
  title text not null,
  artist text,
  lyrics text not null,
  source text,
  external_id text,

  font_size integer,
  lines integer,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,

  unique(user_id, client_id)
);

alter table public.user_songs
add column if not exists client_id text,
add column if not exists title text,
add column if not exists artist text,
add column if not exists lyrics text,
add column if not exists source text,
add column if not exists external_id text,
add column if not exists font_size integer,
add column if not exists lines integer,
add column if not exists created_at timestamptz default now(),
add column if not exists updated_at timestamptz default now(),
add column if not exists deleted_at timestamptz;

update public.user_songs
set created_at = now()
where created_at is null;

update public.user_songs
set updated_at = coalesce(created_at, now())
where updated_at is null;

create unique index if not exists user_songs_user_client_id_uidx
on public.user_songs(user_id, client_id);

alter table public.user_songs enable row level security;

drop policy if exists "Users can read their own songs"
on public.user_songs;

create policy "Users can read their own songs"
on public.user_songs for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own songs"
on public.user_songs;

create policy "Users can insert their own songs"
on public.user_songs for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own songs"
on public.user_songs;

create policy "Users can update their own songs"
on public.user_songs for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_songs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_songs_set_updated_at on public.user_songs;
create trigger user_songs_set_updated_at
before update on public.user_songs
for each row
execute function public.set_user_songs_updated_at();
