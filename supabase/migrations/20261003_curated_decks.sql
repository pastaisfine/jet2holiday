-- Curated deck cache, shared across trips by (destination + preferences).
--
-- Replaces the write-amplified `trips.cards` JSONB blob. Cards are inserted one
-- row at a time as enrichment resolves, so a client can render partial progress
-- and an interrupted generation keeps whatever landed.

-- Cache entry for one (destination, preferences) pair. The id is the client-
-- supplied hash, which doubles as the INSERT conflict target: whoever wins the
-- insert is the generator, everyone else just subscribes and watches.
CREATE TABLE IF NOT EXISTS public.curated_decks (
  id TEXT PRIMARY KEY,
  destination TEXT NOT NULL,
  preferences_hash TEXT,
  preferences_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed')),
  claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  location_count INTEGER NOT NULL DEFAULT 0,
  card_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curated_decks_destination ON public.curated_decks(destination);
CREATE INDEX IF NOT EXISTS idx_curated_decks_status ON public.curated_decks(status);
-- Lets a stale 'pending' claim (crashed generator) be found for takeover.
CREATE INDEX IF NOT EXISTS idx_curated_decks_claimed_at ON public.curated_decks(claimed_at);

DROP TRIGGER IF EXISTS curated_decks_updated_at ON public.curated_decks;
CREATE TRIGGER curated_decks_updated_at
  BEFORE UPDATE ON public.curated_decks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
-- One row per card. Written as each SerpApi search resolves.
CREATE TABLE IF NOT EXISTS public.trip_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id TEXT NOT NULL REFERENCES public.curated_decks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  style_hint TEXT,
  description TEXT,
  img_url TEXT,
  -- Set once the hotlinked thumbnail has been copied into storage. NULL means
  -- "still pointing at the remote CDN", which is valid, not broken.
  img_storage_path TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  place_id TEXT,
  rating DOUBLE PRECISION,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (deck_id, position)
);

CREATE INDEX IF NOT EXISTS idx_trip_cards_deck ON public.trip_cards(deck_id, position);
CREATE INDEX IF NOT EXISTS idx_trip_cards_storage_pending ON public.trip_cards(deck_id)
  WHERE img_storage_path IS NULL;

-- Which deck a trip is currently drawing from. A regenerate creates a new deck
-- row and repoints only the asking trip, so one user's dissatisfaction doesn't
-- silently swap everyone else's deck.
CREATE TABLE IF NOT EXISTS public.trip_deck_links (
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL REFERENCES public.curated_decks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (trip_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_deck_links_deck ON public.trip_deck_links(deck_id);

ALTER TABLE public.curated_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_deck_links ENABLE ROW LEVEL SECURITY;

-- Idempotent: safe to re-run if a partial application left a policy behind.
DROP POLICY IF EXISTS "Authenticated users can read decks" ON public.curated_decks;
DROP POLICY IF EXISTS "Authenticated users can read cards" ON public.trip_cards;
DROP POLICY IF EXISTS "Trip members can read deck links" ON public.trip_deck_links;
DROP POLICY IF EXISTS "Trip leaders and members can link decks" ON public.trip_deck_links;

-- Decks are shared by destination, so any authenticated user may read one --
-- there is no per-user data in here, and the client cannot read a deck it has
-- no trip for without already being a member of some trip.
CREATE POLICY "Authenticated users can read decks"
  ON public.curated_decks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read cards"
  ON public.trip_cards FOR SELECT
  TO authenticated
  USING (true);

-- Links are per-trip, so membership gates them. Matches the trips policy.
CREATE POLICY "Trip members can read deck links"
  ON public.trip_deck_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id = trip_deck_links.trip_id
        AND trip_members.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.trips
      WHERE trips.id = trip_deck_links.trip_id
        AND trips.leader_id = auth.uid()
    )
  );

-- No INSERT or UPDATE policy on purpose: the client is read-only against all
-- three deck tables. Claiming a deck, and linking a trip to one, are both the
-- edge function's job under the service role -- which also removes the ordering
-- hazard where a link could reference a deck row that did not exist yet.
-- The read policy above is therefore the only one this table needs.

ALTER TABLE public.trip_cards REPLICA IDENTITY FULL;
ALTER TABLE public.curated_decks REPLICA IDENTITY FULL;

-- Postgres has no "ADD TABLE IF NOT EXISTS" for publications, so membership is
-- checked first. Re-running the migration must not fail on a duplicate add.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trip_cards', 'curated_decks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
