-- Add trip_id to swipes table for workspace-scoped swipe tracking
ALTER TABLE public.swipes ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE;

-- Add cards column to trips for shared deck persistence
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cards JSONB DEFAULT '[]'::jsonb;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_swipes_trip ON public.swipes(trip_id);
CREATE INDEX IF NOT EXISTS idx_swipes_trip_user ON public.swipes(trip_id, user_id);

-- Drop old combined policy
DROP POLICY IF EXISTS "Users manage own swipes" ON public.swipes;

-- Split policies: users manage their own swipes
CREATE POLICY "Users can insert own swipes"
  ON public.swipes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own swipes"
  ON public.swipes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own swipes"
  ON public.swipes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trip members can read each other's swipes for that trip
CREATE POLICY "Trip members can read trip swipes"
  ON public.swipes FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (
      trip_id IS NOT NULL AND
      EXISTS (
        SELECT 1 FROM public.trip_members
        WHERE trip_members.trip_id = swipes.trip_id
          AND trip_members.user_id = auth.uid()
      )
    )
  );

-- Realtime for live group dynamics
ALTER TABLE public.swipes REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.swipes;

-- Allow users and leaders to update trip_members (needed for upserts and management)
CREATE POLICY "Users and leaders can update trip members"
  ON public.trip_members FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.trips
      WHERE trips.id = trip_members.trip_id
        AND trips.leader_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.trips
      WHERE trips.id = trip_members.trip_id
        AND trips.leader_id = auth.uid()
    )
  );

-- Allow public preview of trip basics on join screen before login
CREATE POLICY "Anyone can view trip preview"
  ON public.trips FOR SELECT
  TO anon
  USING (true);

-- Allow public preview of host username on join screen before login
CREATE POLICY "Anyone can view profiles for trip preview"
  ON public.profiles FOR SELECT
  TO anon
  USING (true);

