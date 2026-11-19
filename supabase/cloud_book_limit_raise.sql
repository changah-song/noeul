-- Accounts keep the file of every book in the cloud again (up to 1000, a
-- guard rather than a limit). It was the 3 most recently opened while storage
-- was on the free plan's 1 GB. Guests still keep none, and
-- users.cloud_book_limit still sets a different number for one reader.
--
-- This is the same function as in cloud_book_files.sql with the new default;
-- run it once on a database that already has cloud_book_files.sql applied.
-- Files released under the old limit go up again the next time a device that
-- has the book syncs.

create or replace function public.cloud_book_limit_for(target_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select au.is_anonymous from auth.users au where au.id = target_user), false) then 0
    else greatest(coalesce((select u.cloud_book_limit from public.users u where u.id = target_user), 1000), 0)
  end;
$$;
