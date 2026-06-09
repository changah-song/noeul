create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_language text not null,
  display_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, target_language)
);

alter table public.user_profiles enable row level security;

drop policy if exists "Users can manage their own profiles"
on public.user_profiles;

create policy "Users can manage their own profiles"
on public.user_profiles for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into public.user_profiles (user_id, target_language, display_name)
select id, 'ko', 'Korean'
from auth.users
on conflict (user_id, target_language) do nothing;

do $$
begin
  if to_regclass('public.user_preferences') is not null then
    alter table public.user_preferences
    add column if not exists active_profile_id uuid;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'user_preferences_active_profile_id_fkey'
        and conrelid = 'public.user_preferences'::regclass
    ) then
      alter table public.user_preferences
      add constraint user_preferences_active_profile_id_fkey
      foreign key (active_profile_id) references public.user_profiles(id);
    end if;

    update public.user_preferences preferences
    set active_profile_id = profiles.id
    from public.user_profiles profiles
    where preferences.user_id = profiles.user_id
      and profiles.target_language = coalesce(nullif(btrim(preferences.target_language), ''), 'ko')
      and preferences.active_profile_id is null;
  end if;
end;
$$;

create or replace function public.set_user_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_set_updated_at
on public.user_profiles;

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row
execute function public.set_user_profiles_updated_at();
