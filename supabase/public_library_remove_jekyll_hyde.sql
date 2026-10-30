-- Removes The Strange Case of Dr. Jekyll and Mr. Hyde from the public library.
-- Its file in the bucket can't be downloaded (HTTP 400 on
-- "en/The Strange Case of Dr Jekyll and Mr Hyde.epub"); the app already hides
-- the row (HIDDEN_LIBRARY_IDS in frontend/services/publicLibraryService.js).
-- Run in the Supabase SQL editor. The file itself, if it's there, can be
-- deleted from Storage > public-library > en.

delete from public.public_library
where id = 'd0005a28-4eac-46e1-89f7-d540e532f298';
