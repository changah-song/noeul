-- The level engine's full state on profile_ability, so a new device or a
-- cleared phone gets the reader's level back as it was (not just the number):
-- its uncertainty, the learned lookup habit and the guess rate.
--
-- Apply once in the Supabase SQL editor. Until then the app uploads the level
-- alone (theta) and the pull restores just that.

alter table public.profile_ability
  add column if not exists theta_var double precision,
  add column if not exists lookup_model text,
  add column if not exists guess_yes double precision default 0,
  add column if not exists guess_total double precision default 0,
  add column if not exists last_event_at timestamptz;
