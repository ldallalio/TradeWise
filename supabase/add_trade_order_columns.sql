-- Migration: add order-level columns from Tradovate (and other brokers) to trades table
-- Run this in the Supabase Dashboard → SQL Editor

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS open_ts timestamptz,
  ADD COLUMN IF NOT EXISTS limit_price   numeric,
  ADD COLUMN IF NOT EXISTS stop_price    numeric,
  ADD COLUMN IF NOT EXISTS venue         text,
  ADD COLUMN IF NOT EXISTS notional_value numeric,
  ADD COLUMN IF NOT EXISTS currency      text;

-- Backfill from prior imports where open timestamp was only kept in raw_payload.
-- Some older schemas do not have raw_payload, so guard this step.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'raw_payload'
  ) THEN
    EXECUTE $sql$
      UPDATE public.trades
      SET open_ts = NULLIF(raw_payload::jsonb ->> '_matched_open_ts', '')::timestamptz
      WHERE open_ts IS NULL
        AND raw_payload IS NOT NULL
        AND raw_payload::jsonb ? '_matched_open_ts'
    $sql$;

    EXECUTE $sql$
      UPDATE public.trades
      SET raw_payload = COALESCE(raw_payload::jsonb, '{}'::jsonb) || '{"_pnl_includes_fees": true}'::jsonb
      WHERE source_broker = 'Tradovate'
        AND raw_payload IS NOT NULL
        AND raw_payload::jsonb ? '_matched_open_ts'
        AND NOT (raw_payload::jsonb ? '_pnl_includes_fees')
    $sql$;
  END IF;
END
$$;
