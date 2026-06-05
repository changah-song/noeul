create extension if not exists pgcrypto;

create table if not exists public.user_writing_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  client_id text not null,
  title text not null,
  body text not null,
  prompt text,
  status text default 'draft',

  assessment jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,

  unique(user_id, client_id)
);

create or replace function public.set_user_writing_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_writing_entries_set_updated_at on public.user_writing_entries;
create trigger user_writing_entries_set_updated_at
before update on public.user_writing_entries
for each row
execute function public.set_user_writing_entries_updated_at();

alter table public.user_writing_entries enable row level security;

drop policy if exists "Users can read their own writing entries" on public.user_writing_entries;
create policy "Users can read their own writing entries"
on public.user_writing_entries for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own writing entries" on public.user_writing_entries;
create policy "Users can insert their own writing entries"
on public.user_writing_entries for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own writing entries" on public.user_writing_entries;
create policy "Users can update their own writing entries"
on public.user_writing_entries for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
