alter table public.users
drop constraint if exists users_interface_language_supported;

alter table public.users
add constraint users_interface_language_supported
check (interface_language in ('en', 'ko', 'fr', 'es', 'ar', 'mn', 'vi', 'th', 'id', 'ru', 'zh'));
