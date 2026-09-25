import { createContext } from "react";

export const AuthContext = createContext({
  user: null,
  session: null,
  profile: null,
  loading: true,
  signUp: async () => { },
  signIn: async () => { },
  signOut: async () => { },
  updateProfile: async () => { },
  updatePassword: async () => { },
  savePreferences: async () => { },
  fetchProfile: async () => { },
});
