import { supabase } from "../lib/supabase";

export async function analyzePreferences({
  profile,
  initialPreferences,
  destination,
  swipes,
}) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("User is not authenticated.");
  }

  const { data, error } = await supabase.functions.invoke("preference", {
    body: {
      profile,
      initialPreferences,
      destination,
      swipes,
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Preference Agent returned no data.");
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}