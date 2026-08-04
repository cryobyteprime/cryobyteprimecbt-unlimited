// Connection details for the project's external Supabase instance.
// The URL and publishable (anon) key are safe to ship to the browser; the
// service-role key is NEVER read here — see `external.server.ts`.
export const EXTERNAL_SUPABASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.['VITE_EXTERNAL_SUPABASE_URL']) ||
  'https://quvqjctlskmqeyhognvd.supabase.co';

export const EXTERNAL_SUPABASE_ANON_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.['VITE_EXTERNAL_SUPABASE_ANON_KEY']) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dnFqY3Rsc2ttcWV5aG9nbnZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MzgxOTIsImV4cCI6MjA5NzMxNDE5Mn0.EsgrNvsq0EJZpMRKpusboi4ECVD2PKrwxERJ_XiNLeo';
