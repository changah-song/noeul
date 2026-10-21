-- Allow Japanese ('ja') and Brazilian Portuguese ('pt') as interface languages.
-- The app now offers both and picks them for phones set to Japanese or
-- Portuguese; without this the users.interface_language sync is rejected.
alter table public.users
drop constraint if exists users_interface_language_supported;

alter table public.users
add constraint users_interface_language_supported
check (interface_language in ('en', 'ko', 'fr', 'es', 'ar', 'mn', 'vi', 'th', 'id', 'ru', 'zh', 'zh-Hant', 'ja', 'pt'));
