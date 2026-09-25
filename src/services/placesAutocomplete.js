const PROXY_URL = import.meta.env.VITE_PLACES_PROXY_URL || "/api/places-autocomplete";

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let abortCtrl = null;

export async function searchPlaces(query) {
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();

  const headers = { "Content-Type": "application/json" };
  if (SUPABASE_ANON_KEY) {
    headers.apikey = SUPABASE_ANON_KEY;
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ q: query }),
    signal: abortCtrl.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Search failed");
  }

  const data = await res.json();
  return data.predictions || [];
}

