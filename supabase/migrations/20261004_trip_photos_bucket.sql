-- Storage bucket for card photos.
--
-- Public with unguessable paths (decks/{deck_id}/{place_id}-{random}.jpg): the
-- images are photos of public places, and a private bucket would mean minting a
-- signed URL per render. Do not put anything non-public in here.
--
-- The client never writes to this bucket -- only the generate-trip edge
-- function does, using the service role key. So no storage.objects policies are
-- created for the client: reads are public by virtue of the bucket being public.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trip-photos',
  'trip-photos',
  true,
  5242880, -- 5MB, generous for a thumbnail
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
