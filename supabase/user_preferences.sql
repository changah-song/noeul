create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,

  active_profile_id uuid,
  native_language text default 'en',
  target_language text default 'ko',

  current_book_cloud_id uuid,
  current_book_uri text,

  reader_settings jsonb default '{}'::jsonb,
  flashcard_settings jsonb default '{}'::jsonb,
  ocr_settings jsonb default '{}'::jsonb,

  updated_at timestamptz default now()
);

alter table public.user_preferences
add column if not exists active_profile_id uuid,
add column if not exists native_language text default 'en',
add column if not exists target_language text default 'ko',
add column if not exists current_book_cloud_id uuid,
add column if not exists current_book_uri text,
add column if not exists reader_settings jsonb default '{}'::jsonb,
add column if not exists flashcard_settings jsonb default '{}'::jsonb,
add column if not exists ocr_settings jsonb default '{}'::jsonb,
add column if not exists updated_at timestamptz default now();

do $$
begin
  if to_regclass('public.user_profiles') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'user_preferences_active_profile_id_fkey'
         and conrelid = 'public.user_preferences'::regclass
     ) then
    alter table public.user_preferences
    add constraint user_preferences_active_profile_id_fkey
    foreign key (active_profile_id) references public.user_profiles(id);
  end if;
end;
$$;

update public.user_preferences
set native_language = 'en'
where native_language is null or btrim(native_language) = '';

update public.user_preferences
set target_language = 'ko'
where target_language is null or btrim(target_language) = '';

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    update public.user_preferences preferences
    set active_profile_id = profiles.id
    from public.user_profiles profiles
    where preferences.user_id = profiles.user_id
      and profiles.target_language = preferences.target_language
      and preferences.active_profile_id is null;
  end if;
end;
$$;

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
