// Copy to config.js (gitignored) and fill in your Supabase project.
// Both values are the same public ones the app ships with
// (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY). Never put the
// service-role key here: the dashboard reads data through admin_dashboard(),
// which checks admin_users itself.
window.NOEUL_DASHBOARD_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
};
