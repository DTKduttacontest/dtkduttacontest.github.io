/*
 * Public portal settings only. The Supabase anon key is intended to be public.
 * Never put a service-role key, Google OAuth secret, refresh token, or mail
 * provider key in this repository.
 */
export const PORTAL_CONFIG = Object.freeze({
  supabaseUrl: "https://nkxfrjmutoqlcqxubctr.supabase.co",
  supabaseAnonKey: "sb_publishable_8Ap-vCGc_AfWPVQ3q6de5Q_D2EE-Wh4",
  functionsUrl: "https://nkxfrjmutoqlcqxubctr.supabase.co/functions/v1",
  maxPdfBytes: 25 * 1024 * 1024,
  supportEmail: "dtkduttacontest@gmail.com",
});
