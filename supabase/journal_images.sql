-- Journal image support for cloud-synced entries.
-- Run in Supabase SQL Editor.

-- 1) Add image_urls column for entry attachments.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

-- 2) Create a public bucket for journal images if missing.
INSERT INTO storage.buckets (id, name, public)
VALUES ('journal-images', 'journal-images', true)
ON CONFLICT (id) DO NOTHING;

-- 3) Storage policies: anyone can view, only owner folder can write/manage.
DROP POLICY IF EXISTS "journal images public read" ON storage.objects;
CREATE POLICY "journal images public read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'journal-images');

DROP POLICY IF EXISTS "journal images owner insert" ON storage.objects;
CREATE POLICY "journal images owner insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'journal-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "journal images owner update" ON storage.objects;
CREATE POLICY "journal images owner update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'journal-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'journal-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "journal images owner delete" ON storage.objects;
CREATE POLICY "journal images owner delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'journal-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
