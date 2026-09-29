-- Create swipes table for DB-backed swipe persistence
CREATE TABLE IF NOT EXISTS public.swipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('like','skip')),
  reasons TEXT[] DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  swiped_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swipes_user ON public.swipes(user_id);
CREATE INDEX IF NOT EXISTS idx_swipes_destination ON public.swipes(destination);

ALTER TABLE public.swipes ENABLE ROW LEVEL SECURITY;

-- Owner-only RLS (Q31): users manage only their own swipes
CREATE POLICY "Users manage own swipes"
  ON public.swipes FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
