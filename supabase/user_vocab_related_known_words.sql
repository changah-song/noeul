create or replace function public.ff_vocab_definition_key(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]]+', ' ', 'g'), '');
$$;

create table if not exists public.user_vocab_related_known_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  language text default 'ko',

  main_word text not null,
  main_hanja text,
  main_definition text,

  related_word text not null,
  related_hanja text,
  related_definition text,
  source_hanja text,

  marked_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

alter table public.user_vocab_related_known_words
add column if not exists language text default 'ko',
add column if not exists main_word text,
add column if not exists main_hanja text,
add column if not exists main_definition text,
add column if not exists related_word text,
add column if not exists related_hanja text,
add column if not exists related_definition text,
add column if not exists source_hanja text,
add column if not exists marked_at timestamptz default now(),
add column if not exists updated_at timestamptz default now(),
add column if not exists deleted_at timestamptz;

update public.user_vocab_related_known_words
set language = 'ko'
where language is null or btrim(language) = '';

update public.user_vocab_related_known_words
set marked_at = now()
where marked_at is null;

update public.user_vocab_related_known_words
set updated_at = coalesce(marked_at, now())
where updated_at is null;

drop index if exists public.user_vocab_related_known_unique;

create unique index user_vocab_related_known_unique
on public.user_vocab_related_known_words (
  user_id,
  language,
  main_word,
  coalesce(main_hanja, ''),
  coalesce(public.ff_vocab_definition_key(main_definition), ''),
  related_word,
  coalesce(related_hanja, '')
)
where deleted_at is null;

create index if not exists user_vocab_related_known_user_updated_idx
on public.user_vocab_related_known_words(user_id, updated_at desc);

alter table public.user_vocab_related_known_words enable row level security;

drop policy if exists "Users can read their own related known words"
on public.user_vocab_related_known_words;

create policy "Users can read their own related known words"
on public.user_vocab_related_known_words for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own related known words"
on public.user_vocab_related_known_words;

create policy "Users can insert their own related known words"
on public.user_vocab_related_known_words for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own related known words"
on public.user_vocab_related_known_words;

create policy "Users can update their own related known words"
on public.user_vocab_related_known_words for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_vocab_related_known_words_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_vocab_related_known_words_set_updated_at
on public.user_vocab_related_known_words;

create trigger user_vocab_related_known_words_set_updated_at
before update on public.user_vocab_related_known_words
for each row
execute function public.set_user_vocab_related_known_words_updated_at();
