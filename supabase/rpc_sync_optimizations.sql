create extension if not exists pgcrypto;

create or replace function public.ff_jsonb_text(payload jsonb, variadic keys text[])
returns text
language plpgsql
immutable
as $$
declare
  key text;
  value text;
begin
  foreach key in array keys loop
    value := nullif(btrim(payload ->> key), '');
    if value is not null then
      return value;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.ff_jsonb_timestamptz(payload jsonb, variadic keys text[])
returns timestamptz
language plpgsql
immutable
as $$
declare
  key text;
  value text;
begin
  foreach key in array keys loop
    value := nullif(btrim(payload ->> key), '');
    if value is not null then
      begin
        return value::timestamptz;
      exception when others then
        return null;
      end;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.ff_jsonb_boolean(payload jsonb, variadic keys text[])
returns boolean
language plpgsql
immutable
as $$
declare
  key text;
  value text;
begin
  foreach key in array keys loop
    value := lower(nullif(btrim(payload ->> key), ''));
    if value in ('true', '1', 'yes') then
      return true;
    elsif value in ('false', '0', 'no') then
      return false;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.ff_jsonb_integer(payload jsonb, variadic keys text[])
returns integer
language plpgsql
immutable
as $$
declare
  key text;
  value text;
begin
  foreach key in array keys loop
    value := nullif(btrim(payload ->> key), '');
    if value is not null then
      begin
        return round(value::numeric)::integer;
      exception when others then
        return null;
      end;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.ff_jsonb_bigint(payload jsonb, variadic keys text[])
returns bigint
language plpgsql
immutable
as $$
declare
  key text;
  value text;
begin
  foreach key in array keys loop
    value := nullif(btrim(payload ->> key), '');
    if value is not null then
      begin
        return round(value::numeric)::bigint;
      exception when others then
        return null;
      end;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.ff_jsonb_double(payload jsonb, variadic keys text[])
returns double precision
language plpgsql
immutable
as $$
declare
  key text;
  value text;
begin
  foreach key in array keys loop
    value := nullif(btrim(payload ->> key), '');
    if value is not null then
      begin
        return value::double precision;
      exception when others then
        return null;
      end;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.ff_vocab_definition_key(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]]+', ' ', 'g'), '');
$$;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as keep_id,
    count(*) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
    ) as duplicate_count,
    sum(coalesce(correct_count, 0)) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
    ) as merged_correct_count,
    sum(coalesce(wrong_count, 0)) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
    ) as merged_wrong_count,
    min(created_at) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
    ) as merged_created_at,
    max(last_reviewed_at) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
    ) as merged_last_reviewed_at
  from public.user_vocab
  where deleted_at is null
),
keepers as (
  select distinct keep_id, merged_correct_count, merged_wrong_count, merged_created_at, merged_last_reviewed_at
  from ranked
  where duplicate_count > 1
)
update public.user_vocab vocab
set correct_count = greatest(coalesce(vocab.correct_count, 0), keepers.merged_correct_count),
    wrong_count = greatest(coalesce(vocab.wrong_count, 0), keepers.merged_wrong_count),
    created_at = coalesce(keepers.merged_created_at, vocab.created_at),
    last_reviewed_at = coalesce(greatest(vocab.last_reviewed_at, keepers.merged_last_reviewed_at), vocab.last_reviewed_at, keepers.merged_last_reviewed_at),
    updated_at = now()
from keepers
where vocab.id = keepers.keep_id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as keep_id,
    count(*) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')
    ) as duplicate_count
  from public.user_vocab
  where deleted_at is null
)
update public.user_vocab vocab
set deleted_at = now(),
    updated_at = now()
from ranked
where vocab.id = ranked.id
  and ranked.duplicate_count > 1
  and ranked.id <> ranked.keep_id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence
      order by updated_at desc nulls last, seen_at desc nulls last, id desc
    ) as keep_id,
    count(*) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence
    ) as duplicate_count,
    max(seen_at) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence
    ) as merged_seen_at
  from public.user_vocab_contexts
  where deleted_at is null
),
keepers as (
  select distinct keep_id, merged_seen_at
  from ranked
  where duplicate_count > 1
)
update public.user_vocab_contexts contexts
set seen_at = coalesce(keepers.merged_seen_at, contexts.seen_at),
    updated_at = now()
from keepers
where contexts.id = keepers.keep_id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence
      order by updated_at desc nulls last, seen_at desc nulls last, id desc
    ) as keep_id,
    count(*) over (
      partition by user_id, language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence
    ) as duplicate_count
  from public.user_vocab_contexts
  where deleted_at is null
)
update public.user_vocab_contexts contexts
set deleted_at = now(),
    updated_at = now()
from ranked
where contexts.id = ranked.id
  and ranked.duplicate_count > 1
  and ranked.id <> ranked.keep_id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by user_id, language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')
      order by updated_at desc nulls last, marked_at desc nulls last, id desc
    ) as keep_id,
    count(*) over (
      partition by user_id, language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')
    ) as duplicate_count,
    max(marked_at) over (
      partition by user_id, language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')
    ) as merged_marked_at
  from public.user_vocab_related_known_words
  where deleted_at is null
),
keepers as (
  select distinct keep_id, merged_marked_at
  from ranked
  where duplicate_count > 1
)
update public.user_vocab_related_known_words related
set marked_at = coalesce(keepers.merged_marked_at, related.marked_at),
    updated_at = now()
from keepers
where related.id = keepers.keep_id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by user_id, language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')
      order by updated_at desc nulls last, marked_at desc nulls last, id desc
    ) as keep_id,
    count(*) over (
      partition by user_id, language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')
    ) as duplicate_count
  from public.user_vocab_related_known_words
  where deleted_at is null
)
update public.user_vocab_related_known_words related
set deleted_at = now(),
    updated_at = now()
from ranked
where related.id = ranked.id
  and ranked.duplicate_count > 1
  and ranked.id <> ranked.keep_id;

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

create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at = now();
  return new;
end;
$$;

alter table public.user_vocab add column if not exists server_updated_at timestamptz default now();
alter table public.user_vocab_contexts add column if not exists server_updated_at timestamptz default now();
alter table public.user_vocab_related_known_words add column if not exists server_updated_at timestamptz default now();
alter table public.user_writing_entries add column if not exists server_updated_at timestamptz default now();
alter table public.user_songs add column if not exists server_updated_at timestamptz default now();
alter table public.user_books add column if not exists server_updated_at timestamptz default now();
alter table public.user_preferences add column if not exists server_updated_at timestamptz default now();
alter table public.user_profiles add column if not exists server_updated_at timestamptz default now();
alter table public.users add column if not exists server_updated_at timestamptz default now();

update public.user_vocab set server_updated_at = coalesce(server_updated_at, updated_at, created_at, now());
update public.user_vocab_contexts set server_updated_at = coalesce(server_updated_at, updated_at, seen_at, now());
update public.user_vocab_related_known_words set server_updated_at = coalesce(server_updated_at, updated_at, marked_at, now());
update public.user_writing_entries set server_updated_at = coalesce(server_updated_at, updated_at, created_at, now());
update public.user_songs set server_updated_at = coalesce(server_updated_at, updated_at, created_at, now());
update public.user_books set server_updated_at = coalesce(server_updated_at, updated_at, uploaded_at, now());
update public.user_preferences set server_updated_at = coalesce(server_updated_at, updated_at, now());
update public.user_profiles set server_updated_at = coalesce(server_updated_at, updated_at, created_at, now());
update public.users set server_updated_at = coalesce(server_updated_at, updated_at, now());

create index if not exists user_vocab_user_server_updated_idx
on public.user_vocab(user_id, server_updated_at desc);

create index if not exists user_vocab_contexts_user_server_updated_idx
on public.user_vocab_contexts(user_id, server_updated_at desc);

create index if not exists user_vocab_related_known_user_server_updated_idx
on public.user_vocab_related_known_words(user_id, server_updated_at desc);

create index if not exists user_writing_entries_user_server_updated_idx
on public.user_writing_entries(user_id, server_updated_at desc);

create index if not exists user_songs_user_language_server_updated_idx
on public.user_songs(user_id, language, server_updated_at desc);

create index if not exists user_books_user_server_updated_idx
on public.user_books(user_id, server_updated_at desc);

drop trigger if exists user_vocab_set_server_updated_at on public.user_vocab;
create trigger user_vocab_set_server_updated_at
before insert or update on public.user_vocab
for each row execute function public.set_server_updated_at();

drop trigger if exists user_vocab_contexts_set_server_updated_at on public.user_vocab_contexts;
create trigger user_vocab_contexts_set_server_updated_at
before insert or update on public.user_vocab_contexts
for each row execute function public.set_server_updated_at();

drop trigger if exists user_vocab_related_known_words_set_server_updated_at on public.user_vocab_related_known_words;
create trigger user_vocab_related_known_words_set_server_updated_at
before insert or update on public.user_vocab_related_known_words
for each row execute function public.set_server_updated_at();

drop trigger if exists user_writing_entries_set_server_updated_at on public.user_writing_entries;
create trigger user_writing_entries_set_server_updated_at
before insert or update on public.user_writing_entries
for each row execute function public.set_server_updated_at();

drop trigger if exists user_songs_set_server_updated_at on public.user_songs;
create trigger user_songs_set_server_updated_at
before insert or update on public.user_songs
for each row execute function public.set_server_updated_at();

drop trigger if exists user_books_set_server_updated_at on public.user_books;
create trigger user_books_set_server_updated_at
before insert or update on public.user_books
for each row execute function public.set_server_updated_at();

drop trigger if exists user_preferences_set_server_updated_at on public.user_preferences;
create trigger user_preferences_set_server_updated_at
before insert or update on public.user_preferences
for each row execute function public.set_server_updated_at();

drop trigger if exists user_profiles_set_server_updated_at on public.user_profiles;
create trigger user_profiles_set_server_updated_at
before insert or update on public.user_profiles
for each row execute function public.set_server_updated_at();

drop trigger if exists users_set_server_updated_at on public.users;
create trigger users_set_server_updated_at
before insert or update on public.users
for each row execute function public.set_server_updated_at();

create or replace function public.handle_auth_user_insert()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  default_profile_id uuid;
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.user_profiles (user_id, target_language, display_name)
  values (new.id, 'ko', 'Korean')
  on conflict (user_id, target_language) do update
  set display_name = coalesce(public.user_profiles.display_name, excluded.display_name)
  returning id into default_profile_id;

  insert into public.user_preferences (user_id, active_profile_id, native_language, target_language)
  values (new.id, default_profile_id, 'en', 'ko')
  on conflict (user_id) do update
  set active_profile_id = coalesce(public.user_preferences.active_profile_id, excluded.active_profile_id),
      native_language = coalesce(nullif(public.user_preferences.native_language, ''), excluded.native_language),
      target_language = coalesce(nullif(public.user_preferences.target_language, ''), excluded.target_language);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_bootstrap_profile on auth.users;
create trigger on_auth_user_created_bootstrap_profile
after insert on auth.users
for each row execute function public.handle_auth_user_insert();

create or replace function public.sync_user_learning_pull(
  vocab_updated_after timestamptz default null,
  contexts_updated_after timestamptz default null,
  related_updated_after timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  vocab_rows jsonb;
  context_rows jsonb;
  related_rows jsonb;
  vocab_cursor timestamptz;
  contexts_cursor timestamptz;
  related_cursor timestamptz;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.server_updated_at), '[]'::jsonb),
         max(rows.server_updated_at)
  into vocab_rows, vocab_cursor
  from (
    select word, hanja, definition, status, source_book_uri, source_book_title, context_sentence,
           is_favorite, priority, created_at, last_reviewed_at, next_review_at, correct_count,
           wrong_count, stability, difficulty, updated_at, deleted_at, language, server_updated_at
    from public.user_vocab
    where user_id = current_user_id
      and (vocab_updated_after is null or server_updated_at > vocab_updated_after)
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.server_updated_at), '[]'::jsonb),
         max(rows.server_updated_at)
  into context_rows, contexts_cursor
  from (
    select language, word, hanja, definition, source_book_uri, source_book_title, sentence,
           seen_at, updated_at, deleted_at, server_updated_at
    from public.user_vocab_contexts
    where user_id = current_user_id
      and (contexts_updated_after is null or server_updated_at > contexts_updated_after)
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.server_updated_at), '[]'::jsonb),
         max(rows.server_updated_at)
  into related_rows, related_cursor
  from (
    select language, main_word, main_hanja, main_definition, related_word, related_hanja,
           related_definition, source_hanja, marked_at, updated_at, deleted_at, server_updated_at
    from public.user_vocab_related_known_words
    where user_id = current_user_id
      and (related_updated_after is null or server_updated_at > related_updated_after)
  ) rows;

  return jsonb_build_object(
    'vocab', vocab_rows,
    'contexts', context_rows,
    'relatedKnownWords', related_rows,
    'cursors', jsonb_build_object(
      'vocab', coalesce(vocab_cursor, vocab_updated_after),
      'vocabContexts', coalesce(contexts_cursor, contexts_updated_after),
      'relatedKnownWords', coalesce(related_cursor, related_updated_after)
    )
  );
end;
$$;

create or replace function public.sync_user_learning_push(
  vocab_entries jsonb default '[]'::jsonb,
  contexts jsonb default '[]'::jsonb,
  related_known_words jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  affected_vocab integer := 0;
  affected_contexts integer := 0;
  affected_related integer := 0;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(vocab_entries, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'word') as word,
      public.ff_jsonb_text(item, 'hanja') as hanja,
      public.ff_jsonb_text(item, 'definition', 'def') as definition,
      coalesce(public.ff_jsonb_text(item, 'status', 'level'), 'unorganized') as status,
      public.ff_jsonb_text(item, 'source_book_uri', 'sourceBookUri') as source_book_uri,
      public.ff_jsonb_text(item, 'source_book_title', 'sourceBookTitle') as source_book_title,
      public.ff_jsonb_text(item, 'context_sentence', 'contextSentence') as context_sentence,
      coalesce(public.ff_jsonb_boolean(item, 'is_favorite', 'isFavorite'), false) as is_favorite,
      coalesce(public.ff_jsonb_text(item, 'priority'), 'normal') as priority,
      coalesce(public.ff_jsonb_timestamptz(item, 'created_at', 'createdAt'), now()) as created_at,
      public.ff_jsonb_timestamptz(item, 'last_reviewed_at', 'lastReviewedAt') as last_reviewed_at,
      public.ff_jsonb_timestamptz(item, 'next_review_at', 'nextReviewAt') as next_review_at,
      coalesce(public.ff_jsonb_integer(item, 'correct_count', 'correctCount'), 0) as correct_count,
      coalesce(public.ff_jsonb_integer(item, 'wrong_count', 'wrongCount'), 0) as wrong_count,
      coalesce(public.ff_jsonb_double(item, 'stability'), 1.0) as stability,
      coalesce(public.ff_jsonb_double(item, 'difficulty'), 5.0) as difficulty,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')) *
    from parsed
    where word is not null
    order by language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), updated_at desc, ordinality desc
  )
  select count(*) into affected_vocab
  from incoming;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(vocab_entries, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'word') as word,
      public.ff_jsonb_text(item, 'hanja') as hanja,
      public.ff_jsonb_text(item, 'definition', 'def') as definition,
      coalesce(public.ff_jsonb_text(item, 'status', 'level'), 'unorganized') as status,
      public.ff_jsonb_text(item, 'source_book_uri', 'sourceBookUri') as source_book_uri,
      public.ff_jsonb_text(item, 'source_book_title', 'sourceBookTitle') as source_book_title,
      public.ff_jsonb_text(item, 'context_sentence', 'contextSentence') as context_sentence,
      coalesce(public.ff_jsonb_boolean(item, 'is_favorite', 'isFavorite'), false) as is_favorite,
      coalesce(public.ff_jsonb_text(item, 'priority'), 'normal') as priority,
      coalesce(public.ff_jsonb_timestamptz(item, 'created_at', 'createdAt'), now()) as created_at,
      public.ff_jsonb_timestamptz(item, 'last_reviewed_at', 'lastReviewedAt') as last_reviewed_at,
      public.ff_jsonb_timestamptz(item, 'next_review_at', 'nextReviewAt') as next_review_at,
      coalesce(public.ff_jsonb_integer(item, 'correct_count', 'correctCount'), 0) as correct_count,
      coalesce(public.ff_jsonb_integer(item, 'wrong_count', 'wrongCount'), 0) as wrong_count,
      coalesce(public.ff_jsonb_double(item, 'stability'), 1.0) as stability,
      coalesce(public.ff_jsonb_double(item, 'difficulty'), 5.0) as difficulty,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')) *
    from parsed
    where word is not null
    order by language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), updated_at desc, ordinality desc
  ),
  target as (
    select incoming.*, existing.id as existing_id
    from incoming
    left join lateral (
      select id
      from public.user_vocab
      where user_id = current_user_id
        and language = incoming.language
        and word = incoming.word
        and coalesce(hanja, '') = coalesce(incoming.hanja, '')
        and coalesce(public.ff_vocab_definition_key(definition), '') = coalesce(public.ff_vocab_definition_key(incoming.definition), '')
      order by deleted_at nulls first, id
      limit 1
    ) existing on true
  )
  update public.user_vocab existing
  set status = target.status,
      source_book_uri = target.source_book_uri,
      source_book_title = target.source_book_title,
      context_sentence = target.context_sentence,
      is_favorite = target.is_favorite,
      priority = target.priority,
      created_at = coalesce(target.created_at, existing.created_at),
      last_reviewed_at = target.last_reviewed_at,
      next_review_at = target.next_review_at,
      correct_count = target.correct_count,
      wrong_count = target.wrong_count,
      stability = target.stability,
      difficulty = target.difficulty,
      updated_at = target.updated_at,
      deleted_at = target.deleted_at
  from target
  where existing.id = target.existing_id
    and existing.user_id = current_user_id;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(vocab_entries, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'word') as word,
      public.ff_jsonb_text(item, 'hanja') as hanja,
      public.ff_jsonb_text(item, 'definition', 'def') as definition,
      coalesce(public.ff_jsonb_text(item, 'status', 'level'), 'unorganized') as status,
      public.ff_jsonb_text(item, 'source_book_uri', 'sourceBookUri') as source_book_uri,
      public.ff_jsonb_text(item, 'source_book_title', 'sourceBookTitle') as source_book_title,
      public.ff_jsonb_text(item, 'context_sentence', 'contextSentence') as context_sentence,
      coalesce(public.ff_jsonb_boolean(item, 'is_favorite', 'isFavorite'), false) as is_favorite,
      coalesce(public.ff_jsonb_text(item, 'priority'), 'normal') as priority,
      coalesce(public.ff_jsonb_timestamptz(item, 'created_at', 'createdAt'), now()) as created_at,
      public.ff_jsonb_timestamptz(item, 'last_reviewed_at', 'lastReviewedAt') as last_reviewed_at,
      public.ff_jsonb_timestamptz(item, 'next_review_at', 'nextReviewAt') as next_review_at,
      coalesce(public.ff_jsonb_integer(item, 'correct_count', 'correctCount'), 0) as correct_count,
      coalesce(public.ff_jsonb_integer(item, 'wrong_count', 'wrongCount'), 0) as wrong_count,
      coalesce(public.ff_jsonb_double(item, 'stability'), 1.0) as stability,
      coalesce(public.ff_jsonb_double(item, 'difficulty'), 5.0) as difficulty,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), '')) *
    from parsed
    where word is not null
    order by language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), updated_at desc, ordinality desc
  ),
  target as (
    select incoming.*, existing.id as existing_id
    from incoming
    left join lateral (
      select id
      from public.user_vocab
      where user_id = current_user_id
        and language = incoming.language
        and word = incoming.word
        and coalesce(hanja, '') = coalesce(incoming.hanja, '')
        and coalesce(public.ff_vocab_definition_key(definition), '') = coalesce(public.ff_vocab_definition_key(incoming.definition), '')
      order by deleted_at nulls first, id
      limit 1
    ) existing on true
  )
  insert into public.user_vocab (
    user_id, language, word, hanja, definition, status, source_book_uri, source_book_title,
    context_sentence, is_favorite, priority, created_at, last_reviewed_at, next_review_at,
    correct_count, wrong_count, stability, difficulty, updated_at, deleted_at
  )
  select
    current_user_id, language, word, hanja, definition, status, source_book_uri, source_book_title,
    context_sentence, is_favorite, priority, created_at, last_reviewed_at, next_review_at,
    correct_count, wrong_count, stability, difficulty, updated_at, deleted_at
  from target
  where existing_id is null
  on conflict (
    user_id,
    language,
    word,
    (coalesce(hanja, '')),
    (coalesce(public.ff_vocab_definition_key(definition), ''))
  )
  where deleted_at is null
  do update
  set status = excluded.status,
      source_book_uri = excluded.source_book_uri,
      source_book_title = excluded.source_book_title,
      context_sentence = excluded.context_sentence,
      is_favorite = excluded.is_favorite,
      priority = excluded.priority,
      created_at = coalesce(excluded.created_at, public.user_vocab.created_at),
      last_reviewed_at = excluded.last_reviewed_at,
      next_review_at = excluded.next_review_at,
      correct_count = excluded.correct_count,
      wrong_count = excluded.wrong_count,
      stability = excluded.stability,
      difficulty = excluded.difficulty,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(contexts, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'word') as word,
      public.ff_jsonb_text(item, 'hanja') as hanja,
      public.ff_jsonb_text(item, 'definition', 'def') as definition,
      public.ff_jsonb_text(item, 'source_book_uri', 'sourceBookUri') as source_book_uri,
      public.ff_jsonb_text(item, 'source_book_title', 'sourceBookTitle') as source_book_title,
      public.ff_jsonb_text(item, 'sentence') as sentence,
      coalesce(public.ff_jsonb_timestamptz(item, 'seen_at', 'seenAt'), now()) as seen_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence) *
    from parsed
    where word is not null
      and sentence is not null
    order by language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence, updated_at desc, ordinality desc
  )
  select count(*) into affected_contexts
  from incoming;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(contexts, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'word') as word,
      public.ff_jsonb_text(item, 'hanja') as hanja,
      public.ff_jsonb_text(item, 'definition', 'def') as definition,
      public.ff_jsonb_text(item, 'source_book_uri', 'sourceBookUri') as source_book_uri,
      public.ff_jsonb_text(item, 'source_book_title', 'sourceBookTitle') as source_book_title,
      public.ff_jsonb_text(item, 'sentence') as sentence,
      coalesce(public.ff_jsonb_timestamptz(item, 'seen_at', 'seenAt'), now()) as seen_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence) *
    from parsed
    where word is not null
      and sentence is not null
    order by language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence, updated_at desc, ordinality desc
  ),
  target as (
    select incoming.*, existing.id as existing_id
    from incoming
    left join lateral (
      select id
      from public.user_vocab_contexts
      where user_id = current_user_id
        and language = incoming.language
        and word = incoming.word
        and coalesce(hanja, '') = coalesce(incoming.hanja, '')
        and coalesce(public.ff_vocab_definition_key(definition), '') = coalesce(public.ff_vocab_definition_key(incoming.definition), '')
        and coalesce(source_book_uri, '') = coalesce(incoming.source_book_uri, '')
        and sentence = incoming.sentence
      order by deleted_at nulls first, id
      limit 1
    ) existing on true
  )
  update public.user_vocab_contexts existing
  set source_book_title = target.source_book_title,
      seen_at = target.seen_at,
      updated_at = target.updated_at,
      deleted_at = target.deleted_at
  from target
  where existing.id = target.existing_id
    and existing.user_id = current_user_id;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(contexts, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'word') as word,
      public.ff_jsonb_text(item, 'hanja') as hanja,
      public.ff_jsonb_text(item, 'definition', 'def') as definition,
      public.ff_jsonb_text(item, 'source_book_uri', 'sourceBookUri') as source_book_uri,
      public.ff_jsonb_text(item, 'source_book_title', 'sourceBookTitle') as source_book_title,
      public.ff_jsonb_text(item, 'sentence') as sentence,
      coalesce(public.ff_jsonb_timestamptz(item, 'seen_at', 'seenAt'), now()) as seen_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence) *
    from parsed
    where word is not null
      and sentence is not null
    order by language, word, coalesce(hanja, ''), coalesce(public.ff_vocab_definition_key(definition), ''), coalesce(source_book_uri, ''), sentence, updated_at desc, ordinality desc
  ),
  target as (
    select incoming.*, existing.id as existing_id
    from incoming
    left join lateral (
      select id
      from public.user_vocab_contexts
      where user_id = current_user_id
        and language = incoming.language
        and word = incoming.word
        and coalesce(hanja, '') = coalesce(incoming.hanja, '')
        and coalesce(public.ff_vocab_definition_key(definition), '') = coalesce(public.ff_vocab_definition_key(incoming.definition), '')
        and coalesce(source_book_uri, '') = coalesce(incoming.source_book_uri, '')
        and sentence = incoming.sentence
      order by deleted_at nulls first, id
      limit 1
    ) existing on true
  )
  insert into public.user_vocab_contexts (
    user_id, language, word, hanja, definition, source_book_uri, source_book_title,
    sentence, seen_at, updated_at, deleted_at
  )
  select
    current_user_id, language, word, hanja, definition, source_book_uri, source_book_title,
    sentence, seen_at, updated_at, deleted_at
  from target
  where existing_id is null
  on conflict (
    user_id,
    language,
    word,
    (coalesce(hanja, '')),
    (coalesce(public.ff_vocab_definition_key(definition), '')),
    (coalesce(source_book_uri, '')),
    sentence
  )
  where deleted_at is null
  do update
  set source_book_title = excluded.source_book_title,
      seen_at = excluded.seen_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(related_known_words, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'main_word', 'mainWord') as main_word,
      public.ff_jsonb_text(item, 'main_hanja', 'mainHanja') as main_hanja,
      public.ff_jsonb_text(item, 'main_definition', 'mainDefinition') as main_definition,
      public.ff_jsonb_text(item, 'related_word', 'relatedWord', 'korean') as related_word,
      public.ff_jsonb_text(item, 'related_hanja', 'relatedHanja', 'hanja') as related_hanja,
      public.ff_jsonb_text(item, 'related_definition', 'relatedDefinition', 'meaning') as related_definition,
      public.ff_jsonb_text(item, 'source_hanja', 'sourceHanja') as source_hanja,
      coalesce(public.ff_jsonb_timestamptz(item, 'marked_at', 'markedAt'), now()) as marked_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')) *
    from parsed
    where main_word is not null
      and related_word is not null
    order by language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, ''), updated_at desc, ordinality desc
  )
  select count(*) into affected_related
  from incoming;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(related_known_words, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'main_word', 'mainWord') as main_word,
      public.ff_jsonb_text(item, 'main_hanja', 'mainHanja') as main_hanja,
      public.ff_jsonb_text(item, 'main_definition', 'mainDefinition') as main_definition,
      public.ff_jsonb_text(item, 'related_word', 'relatedWord', 'korean') as related_word,
      public.ff_jsonb_text(item, 'related_hanja', 'relatedHanja', 'hanja') as related_hanja,
      public.ff_jsonb_text(item, 'related_definition', 'relatedDefinition', 'meaning') as related_definition,
      public.ff_jsonb_text(item, 'source_hanja', 'sourceHanja') as source_hanja,
      coalesce(public.ff_jsonb_timestamptz(item, 'marked_at', 'markedAt'), now()) as marked_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')) *
    from parsed
    where main_word is not null
      and related_word is not null
    order by language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, ''), updated_at desc, ordinality desc
  ),
  target as (
    select incoming.*, existing.id as existing_id
    from incoming
    left join lateral (
      select id
      from public.user_vocab_related_known_words
      where user_id = current_user_id
        and language = incoming.language
        and main_word = incoming.main_word
        and coalesce(main_hanja, '') = coalesce(incoming.main_hanja, '')
        and coalesce(public.ff_vocab_definition_key(main_definition), '') = coalesce(public.ff_vocab_definition_key(incoming.main_definition), '')
        and related_word = incoming.related_word
        and coalesce(related_hanja, '') = coalesce(incoming.related_hanja, '')
      order by deleted_at nulls first, id
      limit 1
    ) existing on true
  )
  update public.user_vocab_related_known_words existing
  set related_definition = target.related_definition,
      source_hanja = target.source_hanja,
      marked_at = target.marked_at,
      updated_at = target.updated_at,
      deleted_at = target.deleted_at
  from target
  where existing.id = target.existing_id
    and existing.user_id = current_user_id;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(related_known_words, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      coalesce(public.ff_jsonb_text(item, 'language'), 'ko') as language,
      public.ff_jsonb_text(item, 'main_word', 'mainWord') as main_word,
      public.ff_jsonb_text(item, 'main_hanja', 'mainHanja') as main_hanja,
      public.ff_jsonb_text(item, 'main_definition', 'mainDefinition') as main_definition,
      public.ff_jsonb_text(item, 'related_word', 'relatedWord', 'korean') as related_word,
      public.ff_jsonb_text(item, 'related_hanja', 'relatedHanja', 'hanja') as related_hanja,
      public.ff_jsonb_text(item, 'related_definition', 'relatedDefinition', 'meaning') as related_definition,
      public.ff_jsonb_text(item, 'source_hanja', 'sourceHanja') as source_hanja,
      coalesce(public.ff_jsonb_timestamptz(item, 'marked_at', 'markedAt'), now()) as marked_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, '')) *
    from parsed
    where main_word is not null
      and related_word is not null
    order by language, main_word, coalesce(main_hanja, ''), coalesce(public.ff_vocab_definition_key(main_definition), ''), related_word, coalesce(related_hanja, ''), updated_at desc, ordinality desc
  ),
  target as (
    select incoming.*, existing.id as existing_id
    from incoming
    left join lateral (
      select id
      from public.user_vocab_related_known_words
      where user_id = current_user_id
        and language = incoming.language
        and main_word = incoming.main_word
        and coalesce(main_hanja, '') = coalesce(incoming.main_hanja, '')
        and coalesce(public.ff_vocab_definition_key(main_definition), '') = coalesce(public.ff_vocab_definition_key(incoming.main_definition), '')
        and related_word = incoming.related_word
        and coalesce(related_hanja, '') = coalesce(incoming.related_hanja, '')
      order by deleted_at nulls first, id
      limit 1
    ) existing on true
  )
  insert into public.user_vocab_related_known_words (
    user_id, language, main_word, main_hanja, main_definition, related_word, related_hanja,
    related_definition, source_hanja, marked_at, updated_at, deleted_at
  )
  select
    current_user_id, language, main_word, main_hanja, main_definition, related_word, related_hanja,
    related_definition, source_hanja, marked_at, updated_at, deleted_at
  from target
  where existing_id is null
  on conflict (
    user_id,
    language,
    main_word,
    (coalesce(main_hanja, '')),
    (coalesce(public.ff_vocab_definition_key(main_definition), '')),
    related_word,
    (coalesce(related_hanja, ''))
  )
  where deleted_at is null
  do update
  set related_definition = excluded.related_definition,
      source_hanja = excluded.source_hanja,
      marked_at = excluded.marked_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;

  return jsonb_build_object(
    'vocab', affected_vocab,
    'contexts', affected_contexts,
    'relatedKnownWords', affected_related
  );
end;
$$;

create or replace function public.record_vocab_review(review jsonb)
returns public.user_vocab
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  language_value text := coalesce(public.ff_jsonb_text(review, 'language'), 'ko');
  word_value text := public.ff_jsonb_text(review, 'word');
  hanja_value text := public.ff_jsonb_text(review, 'hanja');
  definition_value text := public.ff_jsonb_text(review, 'definition', 'def');
  outcome_value text := coalesce(public.ff_jsonb_text(review, 'outcome', 'status'), 'good');
  reviewed_at_value timestamptz := coalesce(public.ff_jsonb_timestamptz(review, 'reviewed_at', 'reviewedAt'), now());
  row_result public.user_vocab;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if word_value is null then
    raise exception 'word is required';
  end if;

  update public.user_vocab
  set status = coalesce(public.ff_jsonb_text(review, 'next_status', 'status'), outcome_value),
      last_reviewed_at = reviewed_at_value,
      next_review_at = public.ff_jsonb_timestamptz(review, 'next_review_at', 'nextReviewAt'),
      stability = coalesce(public.ff_jsonb_double(review, 'stability'), stability),
      difficulty = coalesce(public.ff_jsonb_double(review, 'difficulty'), difficulty),
      correct_count = coalesce(correct_count, 0) + case when outcome_value <> 'bad' then 1 else 0 end,
      wrong_count = coalesce(wrong_count, 0) + case when outcome_value = 'bad' then 1 else 0 end,
      updated_at = reviewed_at_value,
      deleted_at = null
  where user_id = current_user_id
    and language = language_value
    and word = word_value
    and coalesce(hanja, '') = coalesce(hanja_value, '')
    and coalesce(public.ff_vocab_definition_key(definition), '') = coalesce(public.ff_vocab_definition_key(definition_value), '')
  returning * into row_result;

  if row_result.id is null then
    insert into public.user_vocab (
      user_id, language, word, hanja, definition, status, last_reviewed_at, next_review_at,
      correct_count, wrong_count, stability, difficulty, updated_at
    )
    values (
      current_user_id, language_value, word_value, hanja_value, definition_value,
      coalesce(public.ff_jsonb_text(review, 'next_status', 'status'), outcome_value),
      reviewed_at_value,
      public.ff_jsonb_timestamptz(review, 'next_review_at', 'nextReviewAt'),
      case when outcome_value <> 'bad' then 1 else 0 end,
      case when outcome_value = 'bad' then 1 else 0 end,
      coalesce(public.ff_jsonb_double(review, 'stability'), 1.0),
      coalesce(public.ff_jsonb_double(review, 'difficulty'), 5.0),
      reviewed_at_value
    )
    returning * into row_result;
  end if;

  return row_result;
end;
$$;

create or replace function public.toggle_related_known_word(entry jsonb, relation jsonb, known boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if known then
    update public.user_vocab_related_known_words
    set deleted_at = now(),
        updated_at = now()
    where user_id = current_user_id
      and language = coalesce(public.ff_jsonb_text(relation, 'language'), 'ko')
      and main_word = public.ff_jsonb_text(relation, 'main_word', 'mainWord')
      and related_word = public.ff_jsonb_text(relation, 'related_word', 'relatedWord', 'korean')
      and coalesce(main_hanja, '') = coalesce(public.ff_jsonb_text(relation, 'main_hanja', 'mainHanja'), '')
      and coalesce(public.ff_vocab_definition_key(main_definition), '') = coalesce(public.ff_vocab_definition_key(public.ff_jsonb_text(relation, 'main_definition', 'mainDefinition')), '')
      and coalesce(related_hanja, '') = coalesce(public.ff_jsonb_text(relation, 'related_hanja', 'relatedHanja', 'hanja'), '')
      and deleted_at is null;

    return jsonb_build_object('deleted', true);
  end if;

  payload := public.sync_user_learning_push(
    jsonb_build_array(entry),
    '[]'::jsonb,
    jsonb_build_array(relation)
  );

  return payload || jsonb_build_object('deleted', false);
end;
$$;

create or replace function public.upsert_user_preferences_patch(patch jsonb)
returns public.user_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  row_result public.user_preferences;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_preferences (
    user_id, active_profile_id, native_language, target_language, current_book_cloud_id,
    current_book_uri, reader_settings, flashcard_settings, ocr_settings, updated_at
  )
  values (
    current_user_id,
    nullif(public.ff_jsonb_text(patch, 'active_profile_id', 'activeProfileId'), '')::uuid,
    public.ff_jsonb_text(patch, 'native_language', 'nativeLanguage'),
    public.ff_jsonb_text(patch, 'target_language', 'targetLanguage'),
    nullif(public.ff_jsonb_text(patch, 'current_book_cloud_id', 'currentBookCloudId'), '')::uuid,
    public.ff_jsonb_text(patch, 'current_book_uri', 'currentBookUri'),
    coalesce(patch -> 'reader_settings', patch -> 'readerSettings'),
    coalesce(patch -> 'flashcard_settings', patch -> 'flashcardSettings'),
    coalesce(patch -> 'ocr_settings', patch -> 'ocrSettings'),
    coalesce(public.ff_jsonb_timestamptz(patch, 'updated_at', 'updatedAt'), now())
  )
  on conflict (user_id) do update
  set active_profile_id = case
        when patch ? 'active_profile_id' or patch ? 'activeProfileId' then excluded.active_profile_id
        else public.user_preferences.active_profile_id
      end,
      native_language = case
        when patch ? 'native_language' or patch ? 'nativeLanguage' then excluded.native_language
        else public.user_preferences.native_language
      end,
      target_language = case
        when patch ? 'target_language' or patch ? 'targetLanguage' then excluded.target_language
        else public.user_preferences.target_language
      end,
      current_book_cloud_id = case
        when patch ? 'current_book_cloud_id' or patch ? 'currentBookCloudId' then excluded.current_book_cloud_id
        else public.user_preferences.current_book_cloud_id
      end,
      current_book_uri = case
        when patch ? 'current_book_uri' or patch ? 'currentBookUri' then excluded.current_book_uri
        else public.user_preferences.current_book_uri
      end,
      reader_settings = case
        when patch ? 'reader_settings' or patch ? 'readerSettings' then excluded.reader_settings
        else public.user_preferences.reader_settings
      end,
      flashcard_settings = case
        when patch ? 'flashcard_settings' or patch ? 'flashcardSettings' then excluded.flashcard_settings
        else public.user_preferences.flashcard_settings
      end,
      ocr_settings = case
        when patch ? 'ocr_settings' or patch ? 'ocrSettings' then excluded.ocr_settings
        else public.user_preferences.ocr_settings
      end,
      updated_at = excluded.updated_at
  returning * into row_result;

  return row_result;
end;
$$;

create or replace function public.upsert_user_account_settings_patch(patch jsonb)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  interface_language_value text := public.ff_jsonb_text(patch, 'interface_language', 'interfaceLanguage');
  row_result public.users;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.users (id, interface_language, updated_at)
  values (
    current_user_id,
    coalesce(interface_language_value, 'en'),
    coalesce(public.ff_jsonb_timestamptz(patch, 'updated_at', 'updatedAt'), now())
  )
  on conflict (id) do update
  set interface_language = coalesce(interface_language_value, public.users.interface_language),
      updated_at = excluded.updated_at
  returning * into row_result;

  return row_result;
end;
$$;

create or replace function public.ensure_user_profile(
  target_language text,
  script text default null,
  display_name text default null,
  make_active boolean default false
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  row_result public.user_profiles;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id, target_language, script, display_name)
  values (
    current_user_id,
    coalesce(nullif(btrim(ensure_user_profile.target_language), ''), 'ko'),
    nullif(btrim(ensure_user_profile.script), ''),
    coalesce(
      nullif(btrim(ensure_user_profile.display_name), ''),
      coalesce(nullif(btrim(ensure_user_profile.target_language), ''), 'ko')
    )
  )
  on conflict (user_id, target_language) do update
  set script = coalesce(excluded.script, public.user_profiles.script),
      display_name = coalesce(excluded.display_name, public.user_profiles.display_name)
  returning * into row_result;

  if ensure_user_profile.make_active then
    insert into public.user_preferences (user_id, active_profile_id, target_language)
    values (current_user_id, row_result.id, row_result.target_language)
    on conflict (user_id) do update
    set active_profile_id = excluded.active_profile_id,
        target_language = excluded.target_language,
        updated_at = now();
  end if;

  return row_result;
end;
$$;

create or replace function public.sync_user_writing_pull(updated_after timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  rows jsonb;
  cursor_value timestamptz;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.server_updated_at), '[]'::jsonb),
         max(t.server_updated_at)
  into rows, cursor_value
  from (
    select id, user_id, client_id, title, body, prompt, status, assessment,
           created_at, updated_at, deleted_at, server_updated_at
    from public.user_writing_entries
    where user_id = current_user_id
      and (updated_after is null or server_updated_at > updated_after)
  ) t;

  return jsonb_build_object('entries', rows, 'cursor', coalesce(cursor_value, updated_after));
end;
$$;

create or replace function public.sync_user_writing_push(entries jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  affected integer := 0;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(entries, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      public.ff_jsonb_text(item, 'client_id', 'id') as client_id,
      coalesce(public.ff_jsonb_text(item, 'title'), '[Untitled]') as title,
      coalesce(public.ff_jsonb_text(item, 'body'), '') as body,
      coalesce(public.ff_jsonb_text(item, 'prompt'), '') as prompt,
      coalesce(public.ff_jsonb_text(item, 'status'), 'draft') as status,
      item -> 'assessment' as assessment,
      coalesce(public.ff_jsonb_timestamptz(item, 'created_at', 'createdAt', 'date'), now()) as created_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (client_id) *
    from parsed
    where client_id is not null
    order by client_id, updated_at desc, ordinality desc
  )
  select count(*) into affected
  from incoming;

  with raw_items as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(entries, '[]'::jsonb)) with ordinality
  ),
  parsed as (
    select
      ordinality,
      public.ff_jsonb_text(item, 'client_id', 'id') as client_id,
      coalesce(public.ff_jsonb_text(item, 'title'), '[Untitled]') as title,
      coalesce(public.ff_jsonb_text(item, 'body'), '') as body,
      coalesce(public.ff_jsonb_text(item, 'prompt'), '') as prompt,
      coalesce(public.ff_jsonb_text(item, 'status'), 'draft') as status,
      item -> 'assessment' as assessment,
      coalesce(public.ff_jsonb_timestamptz(item, 'created_at', 'createdAt', 'date'), now()) as created_at,
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()) as updated_at,
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt') as deleted_at
    from raw_items
  ),
  incoming as (
    select distinct on (client_id) *
    from parsed
    where client_id is not null
    order by client_id, updated_at desc, ordinality desc
  )
  insert into public.user_writing_entries (
    user_id, client_id, title, body, prompt, status, assessment, created_at, updated_at, deleted_at
  )
  select
    current_user_id, client_id, title, body, prompt, status, assessment, created_at, updated_at, deleted_at
  from incoming
  on conflict (user_id, client_id) do update
  set title = excluded.title,
      body = excluded.body,
      prompt = excluded.prompt,
      status = excluded.status,
      assessment = excluded.assessment,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at;

  return jsonb_build_object('entries', affected);
end;
$$;

create or replace function public.soft_delete_user_writing_entry(client_id_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.user_writing_entries
  set deleted_at = now(),
      updated_at = now()
  where user_id = current_user_id
    and client_id = client_id_value;
end;
$$;

create or replace function public.sync_user_songs_pull(
  target_language text default null,
  updated_after timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  rows jsonb;
  cursor_value timestamptz;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.server_updated_at), '[]'::jsonb),
         max(t.server_updated_at)
  into rows, cursor_value
  from (
    select id, user_id, client_id, title, artist, lyrics, source, external_id, language,
           font_size, lines, created_at, updated_at, deleted_at, server_updated_at
    from public.user_songs
    where user_id = current_user_id
      and (target_language is null or language = target_language)
      and (updated_after is null or server_updated_at > updated_after)
  ) t;

  return jsonb_build_object('songs', rows, 'cursor', coalesce(cursor_value, updated_after));
end;
$$;

create or replace function public.sync_user_songs_push(songs jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  item jsonb;
  affected integer := 0;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  for item in select value from jsonb_array_elements(coalesce(songs, '[]'::jsonb)) loop
    if public.ff_jsonb_text(item, 'client_id', 'id') is null then
      continue;
    end if;

    insert into public.user_songs (
      user_id, client_id, title, artist, lyrics, source, external_id, language,
      font_size, lines, created_at, updated_at, deleted_at
    )
    values (
      current_user_id,
      public.ff_jsonb_text(item, 'client_id', 'id'),
      coalesce(public.ff_jsonb_text(item, 'title'), 'Untitled song'),
      public.ff_jsonb_text(item, 'artist'),
      coalesce(public.ff_jsonb_text(item, 'lyrics'), ''),
      public.ff_jsonb_text(item, 'source', 'provider'),
      public.ff_jsonb_text(item, 'external_id', 'externalId', 'providerId'),
      coalesce(public.ff_jsonb_text(item, 'language', 'targetLanguage', 'target_language'), 'ko'),
      public.ff_jsonb_integer(item, 'font_size', 'fontSize'),
      public.ff_jsonb_integer(item, 'lines'),
      coalesce(public.ff_jsonb_timestamptz(item, 'created_at', 'createdAt'), now()),
      coalesce(public.ff_jsonb_timestamptz(item, 'updated_at', 'updatedAt'), now()),
      public.ff_jsonb_timestamptz(item, 'deleted_at', 'deletedAt')
    )
    on conflict (user_id, client_id) do update
    set title = excluded.title,
        artist = excluded.artist,
        lyrics = excluded.lyrics,
        source = excluded.source,
        external_id = excluded.external_id,
        language = excluded.language,
        font_size = excluded.font_size,
        lines = excluded.lines,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    affected := affected + 1;
  end loop;

  return jsonb_build_object('songs', affected);
end;
$$;

create or replace function public.soft_delete_user_song(
  client_id_value text,
  target_language text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.user_songs
  set deleted_at = now(),
      updated_at = now()
  where user_id = current_user_id
    and client_id = client_id_value
    and (target_language is null or language = target_language);
end;
$$;

create or replace function public.sync_user_books_pull(
  target_language text default null,
  include_deleted boolean default false,
  updated_after timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  rows jsonb;
  cursor_value timestamptz;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.server_updated_at), '[]'::jsonb),
         max(t.server_updated_at)
  into rows, cursor_value
  from (
    select id, user_id, title, author, original_filename, file_path, file_url, cover_path,
           size_bytes, word_count, language, progress, location, native_position,
           uploaded_at, updated_at, deleted_at, server_updated_at
    from public.user_books
    where user_id = current_user_id
      and (include_deleted or deleted_at is null)
      and (target_language is null or language = target_language)
      and (updated_after is null or server_updated_at > updated_after)
  ) t;

  return jsonb_build_object('books', rows, 'cursor', coalesce(cursor_value, updated_after));
end;
$$;

create or replace function public.update_user_book_progress(
  book_id uuid,
  progress_value real,
  location_value text default null,
  native_position_value jsonb default null,
  word_count_value bigint default null
)
returns public.user_books
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  row_result public.user_books;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.user_books
  set progress = least(greatest(coalesce(progress_value, 0), 0), 1),
      location = location_value,
      native_position = native_position_value,
      word_count = coalesce(word_count_value, word_count),
      updated_at = now()
  where id = book_id
    and user_id = current_user_id
  returning * into row_result;

  return row_result;
end;
$$;

create or replace function public.soft_delete_user_book(book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.user_books
  set deleted_at = now(),
      updated_at = now()
  where id = book_id
    and user_id = current_user_id;
end;
$$;

create or replace function public.upsert_user_book_metadata(book jsonb)
returns public.user_books
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  book_id uuid := coalesce(nullif(book ->> 'id', '')::uuid, gen_random_uuid());
  file_path_value text := public.ff_jsonb_text(book, 'file_path', 'filePath', 'file_url', 'fileUrl');
  row_result public.user_books;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if file_path_value is null then
    update public.user_books
    set title = coalesce(public.ff_jsonb_text(book, 'title'), title),
        author = coalesce(public.ff_jsonb_text(book, 'author'), author),
        original_filename = coalesce(
          public.ff_jsonb_text(book, 'original_filename', 'originalFilename'),
          original_filename
        ),
        cover_path = case
          when book ? 'cover_path' or book ? 'coverPath' then public.ff_jsonb_text(book, 'cover_path', 'coverPath')
          else cover_path
        end,
        size_bytes = coalesce(public.ff_jsonb_bigint(book, 'size_bytes', 'size'), size_bytes),
        word_count = coalesce(public.ff_jsonb_bigint(book, 'word_count', 'wordCount'), word_count),
        language = coalesce(public.ff_jsonb_text(book, 'language'), language),
        progress = case
          when book ? 'progress' then least(greatest(coalesce(public.ff_jsonb_double(book, 'progress'), progress), 0), 1)
          else progress
        end,
        location = case
          when book ? 'location' then public.ff_jsonb_text(book, 'location')
          else location
        end,
        native_position = case
          when book ? 'native_position' or book ? 'nativePosition' then coalesce(book -> 'native_position', book -> 'nativePosition')
          else native_position
        end,
        updated_at = coalesce(public.ff_jsonb_timestamptz(book, 'updated_at', 'updatedAt'), now()),
        deleted_at = case
          when book ? 'deleted_at' or book ? 'deletedAt' then public.ff_jsonb_timestamptz(book, 'deleted_at', 'deletedAt')
          else deleted_at
        end
    where id = book_id
      and user_id = current_user_id
    returning * into row_result;

    return row_result;
  end if;

  insert into public.user_books (
    id, user_id, title, author, original_filename, file_path, file_url, cover_path,
    size_bytes, word_count, language, progress, location, native_position, updated_at, deleted_at
  )
  values (
    book_id,
    current_user_id,
    coalesce(public.ff_jsonb_text(book, 'title'), 'Untitled'),
    public.ff_jsonb_text(book, 'author'),
    public.ff_jsonb_text(book, 'original_filename', 'originalFilename'),
    file_path_value,
    public.ff_jsonb_text(book, 'file_url', 'fileUrl', 'file_path', 'filePath'),
    public.ff_jsonb_text(book, 'cover_path', 'coverPath'),
    public.ff_jsonb_bigint(book, 'size_bytes', 'size'),
    public.ff_jsonb_bigint(book, 'word_count', 'wordCount'),
    public.ff_jsonb_text(book, 'language'),
    least(greatest(coalesce(public.ff_jsonb_double(book, 'progress'), 0), 0), 1),
    public.ff_jsonb_text(book, 'location'),
    coalesce(book -> 'native_position', book -> 'nativePosition'),
    coalesce(public.ff_jsonb_timestamptz(book, 'updated_at', 'updatedAt'), now()),
    public.ff_jsonb_timestamptz(book, 'deleted_at', 'deletedAt')
  )
  on conflict (user_id, file_path) do update
  set title = excluded.title,
      author = excluded.author,
      original_filename = excluded.original_filename,
      file_url = excluded.file_url,
      cover_path = excluded.cover_path,
      size_bytes = excluded.size_bytes,
      word_count = excluded.word_count,
      language = excluded.language,
      progress = case
        when book ? 'progress' then excluded.progress
        else public.user_books.progress
      end,
      location = case
        when book ? 'location' then excluded.location
        else public.user_books.location
      end,
      native_position = case
        when book ? 'native_position' or book ? 'nativePosition' then excluded.native_position
        else public.user_books.native_position
      end,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  returning * into row_result;

  return row_result;
end;
$$;

create table if not exists public.storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  object_path text not null,
  reason text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

alter table public.storage_cleanup_jobs enable row level security;

create or replace function public.queue_user_book_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.file_path is not null then
      insert into public.storage_cleanup_jobs (bucket_id, object_path, reason)
      values ('user-books', old.file_path, 'user_book_delete');
    end if;

    if old.cover_path is not null then
      insert into public.storage_cleanup_jobs (bucket_id, object_path, reason)
      values ('user-books', old.cover_path, 'user_book_delete');
    end if;

    return old;
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    if new.file_path is not null then
      insert into public.storage_cleanup_jobs (bucket_id, object_path, reason)
      values ('user-books', new.file_path, 'user_book_soft_delete');
    end if;

    if new.cover_path is not null then
      insert into public.storage_cleanup_jobs (bucket_id, object_path, reason)
      values ('user-books', new.cover_path, 'user_book_soft_delete');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists user_books_queue_storage_cleanup on public.user_books;
create trigger user_books_queue_storage_cleanup
after update or delete on public.user_books
for each row execute function public.queue_user_book_storage_cleanup();

create or replace function public.delete_current_user_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.user_vocab_related_known_words where user_id = current_user_id;
  delete from public.user_vocab_contexts where user_id = current_user_id;
  delete from public.user_vocab where user_id = current_user_id;
  delete from public.user_books where user_id = current_user_id;
  delete from public.user_songs where user_id = current_user_id;
  delete from public.user_writing_entries where user_id = current_user_id;
  delete from public.user_preferences where user_id = current_user_id;
  delete from public.user_profiles where user_id = current_user_id;
  delete from public.users where id = current_user_id;
end;
$$;

create or replace function public.get_public_library(target_language_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rows jsonb;
begin
  if to_regclass('public.public_library') is null then
    return '[]'::jsonb;
  end if;

  execute
    'select coalesce(jsonb_agg(to_jsonb(t) order by t.is_featured desc, t.title asc), ''[]''::jsonb)
     from (
       select *
       from public.public_library
       where target_language = $1
     ) t'
  into rows
  using coalesce(nullif(btrim(target_language_value), ''), 'en');

  return rows;
end;
$$;

create or replace function public.get_featured_public_library(target_language_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rows jsonb;
begin
  if to_regclass('public.public_library') is null then
    return '[]'::jsonb;
  end if;

  execute
    'select coalesce(jsonb_agg(to_jsonb(t) order by t.title asc), ''[]''::jsonb)
     from (
       select *
       from public.public_library
       where target_language = $1
         and is_featured = true
     ) t'
  into rows
  using coalesce(nullif(btrim(target_language_value), ''), 'en');

  return rows;
end;
$$;

grant execute on function public.sync_user_learning_pull(timestamptz, timestamptz, timestamptz) to authenticated;
grant execute on function public.sync_user_learning_push(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.record_vocab_review(jsonb) to authenticated;
grant execute on function public.toggle_related_known_word(jsonb, jsonb, boolean) to authenticated;
grant execute on function public.upsert_user_preferences_patch(jsonb) to authenticated;
grant execute on function public.upsert_user_account_settings_patch(jsonb) to authenticated;
grant execute on function public.ensure_user_profile(text, text, text, boolean) to authenticated;
grant execute on function public.sync_user_writing_pull(timestamptz) to authenticated;
grant execute on function public.sync_user_writing_push(jsonb) to authenticated;
grant execute on function public.soft_delete_user_writing_entry(text) to authenticated;
grant execute on function public.sync_user_songs_pull(text, timestamptz) to authenticated;
grant execute on function public.sync_user_songs_push(jsonb) to authenticated;
grant execute on function public.soft_delete_user_song(text, text) to authenticated;
grant execute on function public.sync_user_books_pull(text, boolean, timestamptz) to authenticated;
grant execute on function public.update_user_book_progress(uuid, real, text, jsonb, bigint) to authenticated;
grant execute on function public.soft_delete_user_book(uuid) to authenticated;
grant execute on function public.upsert_user_book_metadata(jsonb) to authenticated;
grant execute on function public.delete_current_user_data() to authenticated;
grant execute on function public.get_public_library(text) to anon, authenticated;
grant execute on function public.get_featured_public_library(text) to anon, authenticated;
