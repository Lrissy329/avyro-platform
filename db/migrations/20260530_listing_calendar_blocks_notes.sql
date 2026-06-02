-- Add optional notes column for manual calendar blocks.
-- Safe and idempotent: only runs if table exists and column is missing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'listing_calendar_blocks'
  ) THEN
    ALTER TABLE public.listing_calendar_blocks
      ADD COLUMN IF NOT EXISTS notes text;
  END IF;
END
$$;
