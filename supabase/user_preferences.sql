create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,

  native_language text default 'en',
  target_language text default 'ko',
  interface_language text default 'en',

  current_book_cloud_id uuid,
  current_book_uri text,

  reader_settings jsonb default '{}'::jsonb,
  flashcard_settings jsonb default '{}'::jsonb,
  ocr_settings jsonb default '{}'::jsonb,

  updated_at timestamptz default now()
);

alter table public.user_preferences
add column if not exists native_language text default 'en',
add column if not exists target_language text default 'ko',
add column if not exists interface_language text default 'en',
add column if not exists current_book_cloud_id uuid,
add column if not exists current_book_uri text,
add column if not exists reader_settings jsonb default '{}'::jsonb,
add column if not exists flashcard_settings jsonb default '{}'::jsonb,
add column if not exists ocr_settings jsonb default '{}'::jsonb,
add column if not exists updated_at timestamptz default now();

update public.user_preferences
set native_language = 'en'
where native_language is null or btrim(native_language) = '';

update public.user_preferences
set target_language = 'ko'
where target_language is null or btrim(target_language) = '';

update public.user_preferences
set interface_language = 'en'
where interface_language is null or btrim(interface_language) = '';

update public.user_preferences
set reader_settings = '{}'::jsonb
where reader_settings is null;

update public.user_preferences
set flashcard_settings = '{}'::jsonb
where flashcard_settings is null;

update public.user_preferences
set ocr_settings = '{}'::jsonb
where ocr_settings is null;

update public.user_preferences
set updated_at = now()
where updated_at is null;

alter table public.user_preferences enable row level security;

drop policy if exists "Users can read their own preferences"
on public.user_preferences;

create policy "Users can read their own preferences"
on public.user_preferences for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own preferences"
on public.user_preferences;

create policy "Users can insert their own preferences"
on public.user_preferences for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own preferences"
on public.user_preferences;

create policy "Users can update their own preferences"
on public.user_preferences for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_user_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_preferences_set_updated_at
on public.user_preferences;

create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row
execute function public.set_user_preferences_updated_at();
