-- Create trips table
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination TEXT NOT NULL,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  leader_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Create trip_members table
CREATE TABLE IF NOT EXISTS public.trip_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'leader' or 'member'
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (trip_id, user_id)
);

-- Enable Row Level Security
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_trips_leader ON public.trips(leader_id);
CREATE INDEX IF NOT EXISTS idx_trip_members_trip ON public.trip_members(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_members_user ON public.trip_members(user_id);

-- RLS Policies for trips
-- Authenticated users can view trips (needed when accessing via shared invite link or as a member)
CREATE POLICY "Authenticated users can view trips"
  ON public.trips FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can create trips
CREATE POLICY "Authenticated users can create trips"
  ON public.trips FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = leader_id);

-- Trip leaders and members can update trip details
CREATE POLICY "Trip members or leaders can update trip"
  ON public.trips FOR UPDATE
  TO authenticated
  USING (
    leader_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id = trips.id
        AND trip_members.user_id = auth.uid()
    )
  );

-- RLS Policies for trip_members
-- Authenticated users can view trip members
CREATE POLICY "Authenticated users can view trip members"
  ON public.trip_members FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can join a trip as themselves
CREATE POLICY "Users can join a trip"
  ON public.trip_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Members or leaders can leave or remove members
CREATE POLICY "Users or leaders can remove membership"
  ON public.trip_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.trips
      WHERE trips.id = trip_members.trip_id
        AND trips.leader_id = auth.uid()
    )
  );

-- Trigger for trips updated_at
CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Enable Supabase Realtime for live workspace synchronization
ALTER TABLE public.trips REPLICA IDENTITY FULL;
ALTER TABLE public.trip_members REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_members;
