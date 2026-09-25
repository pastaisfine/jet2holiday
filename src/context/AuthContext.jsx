import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { AuthContext } from "./auth-state";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [dbProfile, setDbProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn("Auth getSession notice:", error.message);
        }
        if (mounted) {
          setSession(data?.session ?? null);
          setUser(data?.session?.user ?? null);
          setLoading(false);
        }
      } catch (err) {
        console.warn("Error initializing auth session:", err);
        if (mounted) setLoading(false);
      }
    }

    initSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  // Fetch the DB profile whenever the user changes
  useEffect(() => {
    if (!user) {
      setDbProfile(null);
      return;
    }

    let mounted = true;

    async function loadProfile() {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();

        if (data && mounted) {
          setDbProfile(data);
        } else if (!data && user && mounted) {
          const meta = user.user_metadata || {};
          const fallbackUsername = meta.username || meta.full_name || user.email?.split("@")[0] || "Traveler";
          const { data: created } = await supabase
            .from("profiles")
            .upsert({
              id: user.id,
              username: fallbackUsername,
              avatar_url: meta.avatar_url || "",
              avatar_color: "#F19A6A",
            })
            .select()
            .single();

          if (created && mounted) {
            setDbProfile(created);
          }
        }
      } catch (err) {
        console.warn("Error loading or creating profile:", err);
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [user]);

  const fetchProfile = useCallback(async () => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (!error && data) {
      setDbProfile(data);
    }
    return data;
  }, [user]);

  const signUp = useCallback(async ({ email, password, username, avatarUrl }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username?.trim() || email.split("@")[0],
          avatar_url: avatarUrl || "",
        },
      },
    });
    if (error) throw error;
    return data;
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setUser(null);
    setDbProfile(null);
  }, []);

  const updateProfile = useCallback(async ({ username, avatarUrl }) => {
    const authUpdates = {};
    if (username !== undefined) authUpdates.username = username.trim();
    if (avatarUrl !== undefined) authUpdates.avatar_url = avatarUrl.trim();

    // Update auth user metadata
    const { data, error } = await supabase.auth.updateUser({
      data: authUpdates,
    });
    if (error) throw error;
    if (data?.user) {
      setUser(data.user);
    }

    // Also update the profiles table
    if (user) {
      const dbUpdates = {};
      if (username !== undefined) dbUpdates.username = username.trim();
      if (avatarUrl !== undefined) dbUpdates.avatar_url = avatarUrl.trim();

      const { error: dbError } = await supabase
        .from("profiles")
        .update(dbUpdates)
        .eq("id", user.id);
      if (dbError) console.warn("Profile DB update failed:", dbError);
      else await fetchProfile();
    }

    return data;
  }, [user, fetchProfile]);

  const savePreferences = useCallback(async (preferences) => {
    if (!user) return;

    const updates = {
      rhythm: preferences.rhythm || "",
      density: preferences.density || "",
      dining: preferences.dining || "",
      food_budget: preferences.foodBudget || "",
      dietary: preferences.dietary || [],
      preference_note: preferences.note || "",
      preferences_completed: preferences.completed ?? false,
    };

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id);

    if (error) throw error;
    await fetchProfile();
  }, [user, fetchProfile]);

  const sendPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (newPassword) => {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    return data;
  }, []);

  const profile = useMemo(() => {
    if (!user) return null;
    const meta = user.user_metadata || {};
    const username = dbProfile?.username || meta.username || meta.full_name || (user.email ? user.email.split("@")[0] : "Traveler");
    return {
      id: user.id,
      email: user.email,
      username,
      avatarUrl: dbProfile?.avatar_url || meta.avatar_url || "",
      avatarColor: dbProfile?.avatar_color || "#F19A6A",
      isEmailVerified: !!user.email_confirmed_at,
      // Preferences from DB
      rhythm: dbProfile?.rhythm || "",
      density: dbProfile?.density || "",
      dining: dbProfile?.dining || "",
      foodBudget: dbProfile?.food_budget || "",
      dietary: dbProfile?.dietary || [],
      preferenceNote: dbProfile?.preference_note || "",
      preferencesCompleted: dbProfile?.preferences_completed || false,
      travelStyle: dbProfile?.travel_style || "",
    };
  }, [user, dbProfile]);

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      loading,
      signUp,
      signIn,
      signOut,
      updateProfile,
      updatePassword,
      sendPasswordReset,
      savePreferences,
      fetchProfile,
    }),
    [user, session, profile, loading, signUp, signIn, signOut, updateProfile, updatePassword, sendPasswordReset, savePreferences, fetchProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
