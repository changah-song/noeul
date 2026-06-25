create or replace function public.ff_vocab_definition_key(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]]+', ' ', 'g'), '');
$$;

alter table public.user_vocab
add column if not exists source_book_uri text,
add column if not exists source_book_title text,
add column if not exists context_sentence text,
add column if not exists is_favorite boolean default false,
add column if not exists priority text default 'normal',
add column if not exists created_at timestamptz default now(),
add column if not exists last_reviewed_at timestamptz,
add column if not exists next_review_at timestamptz,
add column if not exists correct_count integer default 0,
add column if not exists wrong_count integer default 0,
add column if not exists stability double precision default 1.0,
add column if not exists difficulty double precision default 5.0,
add column if not exists updated_at timestamptz default now(),
add column if not exists deleted_at timestamptz,
add column if not exists language text default 'ko';

update public.user_vocab
set language = 'ko'
where language is null or btrim(language) = '';

update public.user_vocab
set priority = 'normal'
where priority is null or btrim(priority) = '';

update public.user_vocab
set created_at = now()
where created_at is null;

update public.user_vocab
set updated_at = coalesce(created_at, now())
where updated_at is null;

update public.user_vocab
set correct_count = 0
where correct_count is null;

update public.user_vocab
set wrong_count = 0
where wrong_count is null;

update public.user_vocab
set stability = 1.0
where stability is null;

update public.user_vocab
set difficulty = 5.0
where difficulty is null;

alter table public.user_vocab
drop constraint if exists user_vocab_user_word_definition_idx;

drop index if exists public.user_vocab_user_word_definition_idx;
drop index if exists public.user_vocab_unique_entry;

create unique index user_vocab_unique_entry
on public.user_vocab (
  user_id,
  language,
  word,
  coalesce(hanja, ''),
  coalesce(public.ff_vocab_definition_key(definition), '')
)
where deleted_at is null;

create index if not exists user_vocab_user_updated_idx
on public.user_vocab(user_id, updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_vocab'::regclass
      and conname = 'user_vocab_user_id_fkey'
  ) then
    alter table public.user_vocab
    add constraint user_vocab_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

alter table public.user_vocab enable row level security;

drop policy if exists "Users can read their own vocab"
on public.user_vocab;

create policy "Users can read their own vocab"
on public.user_vocab for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own vocab"
on public.user_vocab;

create policy "Users can insert their own vocab"
on public.user_vocab for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own vocab"
on public.user_vocab;

create policy "Users can update their own vocab"
on public.user_vocab for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_vocab_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_vocab_set_updated_at on public.user_vocab;
create trigger user_vocab_set_updated_at
before update on public.user_vocab
for each row
execute function public.set_user_vocab_updated_at();
