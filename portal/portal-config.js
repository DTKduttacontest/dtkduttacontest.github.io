/*
 * Public portal settings only. The Supabase anon key is intended to be public.
 * Never put a service-role key, Google OAuth secret, refresh token, or mail
 * provider key in this repository.
 */
export const PORTAL_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  functionsUrl: "",
  maxPdfBytes: 25 * 1024 * 1024,
  supportEmail: "dtkduttacontest@gmail.com",
});
