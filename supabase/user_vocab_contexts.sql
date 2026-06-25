create or replace function public.ff_vocab_definition_key(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]]+', ' ', 'g'), '');
$$;

create table if not exists public.user_vocab_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  language text default 'ko',
  word text not null,
  hanja text,
  definition text,

  source_book_uri text,
  source_book_title text,
  sentence text not null,

  seen_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

alter table public.user_vocab_contexts
add column if not exists language text default 'ko',
add column if not exists word text,
add column if not exists hanja text,
add column if not exists definition text,
add column if not exists source_book_uri text,
add column if not exists source_book_title text,
add column if not exists sentence text,
add column if not exists seen_at timestamptz default now(),
add column if not exists updated_at timestamptz default now(),
add column if not exists deleted_at timestamptz;

update public.user_vocab_contexts
set language = 'ko'
where language is null or btrim(language) = '';

update public.user_vocab_contexts
set seen_at = now()
where seen_at is null;

update public.user_vocab_contexts
set updated_at = coalesce(seen_at, now())
where updated_at is null;

drop index if exists public.user_vocab_contexts_unique_context;

create unique index user_vocab_contexts_unique_context
on public.user_vocab_contexts (
  user_id,
  language,
  word,
  coalesce(hanja, ''),
  coalesce(public.ff_vocab_definition_key(definition), ''),
  coalesce(source_book_uri, ''),
  sentence
)
where deleted_at is null;

create index if not exists user_vocab_contexts_user_updated_idx
on public.user_vocab_contexts(user_id, updated_at desc);

alter table public.user_vocab_contexts enable row level security;

drop policy if exists "Users can read their own vocab contexts"
on public.user_vocab_contexts;

create policy "Users can read their own vocab contexts"
on public.user_vocab_contexts for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own vocab contexts"
on public.user_vocab_contexts;

create policy "Users can insert their own vocab contexts"
on public.user_vocab_contexts for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own vocab contexts"
on public.user_vocab_contexts;

create policy "Users can update their own vocab contexts"
on public.user_vocab_contexts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_vocab_contexts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_vocab_contexts_set_updated_at on public.user_vocab_contexts;
create trigger user_vocab_contexts_set_updated_at
before update on public.user_vocab_contexts
for each row
execute function public.set_user_vocab_contexts_updated_at();
