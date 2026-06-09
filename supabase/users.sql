create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  interface_language text default 'en',
  updated_at timestamptz default now()
);

alter table public.users
add column if not exists interface_language text default 'en',
add column if not exists updated_at timestamptz default now();

update public.users
set interface_language = 'en'
where interface_language is null
   or btrim(interface_language) = ''
   or interface_language not in ('en', 'fr', 'es', 'ar', 'mn', 'vi', 'th', 'id', 'ru', 'zh');

alter table public.users
alter column interface_language set default 'en',
alter column interface_language set not null;

alter table public.users
drop constraint if exists users_interface_language_supported;

alter table public.users
add constraint users_interface_language_supported
check (interface_language in ('en', 'fr', 'es', 'ar', 'mn', 'vi', 'th', 'id', 'ru', 'zh'));

do $$
begin
  if to_regclass('public.user_preferences') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'user_preferences'
         and column_name = 'interface_language'
     )
  then
    insert into public.users (id, interface_language, updated_at)
    select
      user_id,
      case
        when interface_language in ('en', 'fr', 'es', 'ar', 'mn', 'vi', 'th', 'id', 'ru', 'zh')
          then interface_language
        else 'en'
      end,
      coalesce(updated_at, now())
    from public.user_preferences
    where user_id is not null
    on conflict (id) do update
    set interface_language = excluded.interface_language,
        updated_at = greatest(coalesce(public.users.updated_at, excluded.updated_at), excluded.updated_at)
    where public.users.interface_language = 'en'
       or public.users.interface_language is null;
  end if;
end $$;

alter table public.users enable row level security;

drop policy if exists "Users can read their own account"
on public.users;

create policy "Users can read their own account"
on public.users for select
using (auth.uid() = id);

drop policy if exists "Users can insert their own account"
on public.users;

create policy "Users can insert their own account"
on public.users for insert
with check (auth.uid() = id);

drop policy if exists "Users can update their own account"
on public.users;

create policy "Users can update their own account"
on public.users for update
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.set_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at
on public.users;

create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_users_updated_at();
