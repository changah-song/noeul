-- Allow Traditional Chinese as an interface language. The app has offered
-- 'zh-Hant' for a while, and now picks it for phones set to Traditional
-- Chinese, but the old check rejected it, so those users' choice never synced.
alter table public.users
drop constraint if exists users_interface_language_supported;

alter table public.users
add constraint users_interface_language_supported
check (interface_language in ('en', 'ko', 'fr', 'es', 'ar', 'mn', 'vi', 'th', 'id', 'ru', 'zh', 'zh-Hant'));
