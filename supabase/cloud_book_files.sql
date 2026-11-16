-- Cloud book files: only each reader's most recently opened books keep their
-- file in storage.
--
-- Every book still has a user_books row (title, cover, progress), so the
-- shelf and reading position follow the reader to every device. The file
-- itself (book.epub / book.pdf) is kept for the newest `cloud_book_limit_for`
-- books by last_opened_at: 3 for an account, 0 for a guest (a guest can't
-- sign in on another device, so a cloud copy is of no use to them). When a
-- book drops out of that set its file is queued in storage_cleanup_jobs, and
-- the nightly job removes it. Opening it again uploads it again.
--
-- Run after user_books.sql and rpc_sync_optimizations.sql. Safe to re-run.

-- 1. Columns -----------------------------------------------------------------

alter table public.user_books
add column if not exists file_stored boolean not null default true,
add column if not exists last_opened_at timestamptz;

-- Until now the last progress update is the best record of when a book was read.
update public.user_books
set last_opened_at = coalesce(updated_at, uploaded_at, now())
where last_opened_at is null;

-- null = the default for the reader's plan (see cloud_book_limit_for).
alter table public.users
add column if not exists cloud_book_limit integer;

-- 2. Limits ------------------------------------------------------------------

-- How many books keep their file in the cloud for this reader.
create or replace function public.cloud_book_limit_for(target_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select au.is_anonymous from auth.users au where au.id = target_user), false) then 0
    else greatest(coalesce((select u.cloud_book_limit from public.users u where u.id = target_user), 3), 0)
  end;
$$;

-- Largest book file kept in the cloud: 50 MB. Bigger books stay on the device.
update storage.buckets
set file_size_limit = 52428800
where id = 'user-books';

-- Guests don't upload book files.
drop policy if exists "Users can upload their own book files" on storage.objects;
create policy "Users can upload their own book files"
on storage.objects for insert
with check (
  bucket_id = 'user-books'
  and auth.uid()::text = (storage.foldername(name))[1]
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
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
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

-- 3. Queue / un-queue files --------------------------------------------------

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
  elsif new.deleted_at is null and old.file_stored and not new.file_stored then
    -- Dropped out of the reader's recent books: the file goes, the cover stays.
    if new.file_path is not null then
      insert into public.storage_cleanup_jobs (bucket_id, object_path, reason)
      values ('user-books', new.file_path, 'user_book_file_released');
    end if;
  elsif new.file_stored and not old.file_stored then
    -- Uploaded again before the nightly cleanup ran: keep it.
    update public.storage_cleanup_jobs
    set processed_at = now(),
        reason = coalesce(reason, '') || ' (cancelled: uploaded again)'
    where bucket_id = 'user-books'
      and object_path = new.file_path
      and processed_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists user_books_queue_storage_cleanup on public.user_books;
create trigger user_books_queue_storage_cleanup
after update or delete on public.user_books
for each row execute function public.queue_user_book_storage_cleanup();

-- 4. Trim --------------------------------------------------------------------

-- Release the files of this reader's books outside their newest
-- cloud_book_limit_for books. Returns how many were released.
create or replace function public.trim_user_book_files(target_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  book_limit integer := public.cloud_book_limit_for(target_user);
  released integer;
begin
  with ranked as (
    select id,
           row_number() over (
             order by coalesce(last_opened_at, updated_at, uploaded_at) desc nulls last, id
           ) as position
    from public.user_books
    where user_id = target_user
      and deleted_at is null
  )
  update public.user_books b
  set file_stored = false
  from ranked r
  where b.id = r.id
    and r.position > book_limit
    and b.file_stored;

  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.trim_user_book_files(uuid) from public, anon, authenticated;

-- 5. Client RPCs -------------------------------------------------------------

-- The reader opened a book (at opened_at, on some device).
create or replace function public.mark_user_book_opened(book_id uuid, opened_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  opened timestamptz := least(coalesce(opened_at, now()), now());
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.user_books
  set last_opened_at = greatest(coalesce(last_opened_at, '-infinity'::timestamptz), opened)
  where id = book_id
    and user_id = current_user_id
    and (last_opened_at is null or last_opened_at < opened);
end;
$$;

-- Trim, then say which books should have their file in the cloud:
--   limit:  the reader's limit
--   keep:   ids of the newest `limit` books
--   stored: ids of books whose file is in the cloud
-- The app uploads the files of `keep` books that aren't `stored`.
create or replace function public.sync_user_book_files()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  book_limit integer;
  keep_ids jsonb;
  stored_ids jsonb;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.trim_user_book_files(current_user_id);
  book_limit := public.cloud_book_limit_for(current_user_id);

  select coalesce(jsonb_agg(id), '[]'::jsonb)
  into keep_ids
  from (
    select id
    from public.user_books
    where user_id = current_user_id
      and deleted_at is null
    order by coalesce(last_opened_at, updated_at, uploaded_at) desc nulls last, id
    limit book_limit
  ) t;

  select coalesce(jsonb_agg(id), '[]'::jsonb)
  into stored_ids
  from public.user_books
  where user_id = current_user_id
    and deleted_at is null
    and file_stored;

  return jsonb_build_object('limit', book_limit, 'keep', keep_ids, 'stored', stored_ids);
end;
$$;

grant execute on function public.mark_user_book_opened(uuid, timestamptz) to authenticated;
grant execute on function public.sync_user_book_files() to authenticated;

-- Pull: also return file_stored and last_opened_at.
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
           uploaded_at, updated_at, deleted_at, server_updated_at, file_stored, last_opened_at
    from public.user_books
    where user_id = current_user_id
      and (include_deleted or deleted_at is null)
      and (target_language is null or language = target_language)
      and (updated_after is null or server_updated_at > updated_after)
  ) t;

  return jsonb_build_object('books', rows, 'cursor', coalesce(cursor_value, updated_after));
end;
$$;

-- Upsert: file_stored and last_opened_at. A row written with a file_path and
-- no file_stored comes from an app version that uploads every book, right
-- after uploading it, so it counts as stored and just opened. Guests don't
-- keep books in the cloud.
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
  file_stored_value boolean := coalesce(public.ff_jsonb_boolean(book, 'file_stored', 'fileStored'), true);
  opened_value timestamptz := least(
    coalesce(public.ff_jsonb_timestamptz(book, 'last_opened_at', 'lastOpenedAt'), now()),
    now()
  );
  row_result public.user_books;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Guests do not keep books in the cloud';
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
    size_bytes, word_count, language, progress, location, native_position, updated_at, deleted_at,
    file_stored, last_opened_at
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
    public.ff_jsonb_timestamptz(book, 'deleted_at', 'deletedAt'),
    file_stored_value,
    opened_value
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
      deleted_at = excluded.deleted_at,
      -- Only an upload sets this to true; a row written without its file
      -- leaves the stored flag as it was.
      file_stored = case
        when excluded.file_stored then true
        else public.user_books.file_stored
      end,
      last_opened_at = greatest(
        coalesce(public.user_books.last_opened_at, '-infinity'::timestamptz),
        excluded.last_opened_at
      )
  returning * into row_result;

  return row_result;
end;
$$;

-- 6. Nightly job -------------------------------------------------------------
--
-- Needs pg_cron and pg_net, and two Vault secrets:
--   project_url             https://<project-ref>.supabase.co
--   storage_cleanup_secret  the same value as the process-storage-cleanup
--                           function's STORAGE_CLEANUP_SECRET

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.run_book_storage_cleanup()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reader record;
  project_url text;
  cleanup_secret text;
begin
  -- Every reader with more stored files than their limit (older app versions
  -- upload every book; guests from before this change).
  for reader in
    select b.user_id
    from public.user_books b
    where b.file_stored and b.deleted_at is null
    group by b.user_id
    having count(*) > public.cloud_book_limit_for(b.user_id)
  loop
    perform public.trim_user_book_files(reader.user_id);
  end loop;

  -- Never remove a file a live book still uses.
  update public.storage_cleanup_jobs j
  set processed_at = now(),
      reason = coalesce(j.reason, '') || ' (cancelled: in use)'
  where j.processed_at is null
    and j.bucket_id = 'user-books'
    and exists (
      select 1
      from public.user_books b
      where b.deleted_at is null
        and ((b.file_stored and b.file_path = j.object_path) or b.cover_path = j.object_path)
    );

  select decrypted_secret into project_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into cleanup_secret
  from vault.decrypted_secrets where name = 'storage_cleanup_secret';

  if project_url is null or cleanup_secret is null then
    raise warning 'run_book_storage_cleanup: Vault secrets project_url / storage_cleanup_secret are missing';
    return;
  end if;

  -- The function removes up to 500 files per call.
  perform net.http_post(
    url := project_url || '/functions/v1/process-storage-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', cleanup_secret
    ),
    body := jsonb_build_object('limit', 500)
  );
end;
$$;

revoke all on function public.run_book_storage_cleanup() from public, anon, authenticated;

-- 03:00 in Korea.
select cron.unschedule(jobid) from cron.job where jobname = 'book-storage-cleanup';
select cron.schedule('book-storage-cleanup', '0 18 * * *', $$select public.run_book_storage_cleanup()$$);
