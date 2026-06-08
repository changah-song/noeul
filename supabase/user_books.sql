create extension if not exists pgcrypto;

create table if not exists public.user_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  author text,
  original_filename text,
  file_path text not null,
  file_url text,
  cover_path text,

  size_bytes bigint,
  word_count bigint,
  language text,

  progress real default 0,
  location text,
  native_position jsonb,

  uploaded_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,

  unique(user_id, file_path)
);

alter table public.user_books
add column if not exists title text,
add column if not exists author text,
add column if not exists original_filename text,
add column if not exists file_path text,
add column if not exists file_url text,
add column if not exists cover_path text,
add column if not exists size_bytes bigint,
add column if not exists word_count bigint,
add column if not exists language text,
add column if not exists progress real default 0,
add column if not exists location text,
add column if not exists native_position jsonb,
add column if not exists uploaded_at timestamptz default now(),
add column if not exists updated_at timestamptz default now(),
add column if not exists deleted_at timestamptz;

update public.user_books
set title = 'Untitled'
where title is null or btrim(title) = '';

update public.user_books
set uploaded_at = now()
where uploaded_at is null;

update public.user_books
set updated_at = coalesce(uploaded_at, now())
where updated_at is null;

update public.user_books
set progress = 0
where progress is null;

update public.user_books
set file_path = file_url
where (file_path is null or btrim(file_path) = '')
  and file_url is not null
  and btrim(file_url) <> '';

update public.user_books
set file_url = file_path
where (file_url is null or btrim(file_url) = '')
  and file_path is not null
  and btrim(file_path) <> '';

alter table public.user_books
alter column file_url drop not null;

create unique index if not exists user_books_user_file_path_uidx
on public.user_books(user_id, file_path);

create or replace function public.set_user_books_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_books_set_updated_at on public.user_books;
create trigger user_books_set_updated_at
before update on public.user_books
for each row
execute function public.set_user_books_updated_at();

alter table public.user_books enable row level security;

drop policy if exists "Users can read their own books" on public.user_books;
create policy "Users can read their own books"
on public.user_books for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own books" on public.user_books;
create policy "Users can insert their own books"
on public.user_books for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own books" on public.user_books;
create policy "Users can update their own books"
on public.user_books for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'user-books',
  'user-books',
  false,
  array[
    'application/epub+zip',
    'application/octet-stream',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set public = false,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own book files" on storage.objects;
create policy "Users can read their own book files"
on storage.objects for select
using (
  bucket_id = 'user-books'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can upload their own book files" on storage.objects;
create policy "Users can upload their own book files"
on storage.objects for insert
with check (
  bucket_id = 'user-books'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update their own book files" on storage.objects;
create policy "Users can update their own book files"
on storage.objects for update
using (
  bucket_id = 'user-books'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'user-books'
  and auth.uid()::text = (storage.foldername(name))[1]
);
