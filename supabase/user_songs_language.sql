alter table public.user_songs
add column if not exists language text default 'ko';

update public.user_songs
set language = 'ko'
where language is null
   or btrim(language) = ''
   or language not in ('ko', 'en');

alter table public.user_songs
alter column language set default 'ko',
alter column language set not null;

alter table public.user_songs
drop constraint if exists user_songs_language_supported;

alter table public.user_songs
add constraint user_songs_language_supported
check (language in ('ko', 'en'));

create index if not exists user_songs_user_language_updated_idx
on public.user_songs(user_id, language, updated_at desc);
