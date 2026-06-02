ALTER TABLE public.user_vocab
  ADD COLUMN IF NOT EXISTS encounter_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_encountered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_encounter_source_uri TEXT,
  ADD COLUMN IF NOT EXISTS last_encounter_source_title TEXT,
  ADD COLUMN IF NOT EXISTS maturity TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS implicit_review_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correct_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wrong_count INTEGER DEFAULT 0;

UPDATE public.user_vocab
SET
  encounter_count = COALESCE(encounter_count, 0),
  maturity = COALESCE(maturity, 'new'),
  implicit_review_count = COALESCE(implicit_review_count, 0),
  correct_count = COALESCE(correct_count, 0),
  wrong_count = COALESCE(wrong_count, 0);
