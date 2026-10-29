-- A word can be saved without a definition (e.g. a word opened from a related-
-- word link, or a Chinese word the dictionary had nothing for). The sync RPC
-- reads an empty definition as null (ff_jsonb_text), so NOT NULL refused those
-- words and they never reached the account. The unique key already treats a
-- missing definition as '' (coalesce), so null is safe here.
--
-- Apply once in the Supabase SQL editor.

alter table public.user_vocab
  alter column definition drop not null;
