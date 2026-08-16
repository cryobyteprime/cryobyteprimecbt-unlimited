// Server-only access to the external Supabase instance.
// SECURITY: the service-role key is read from process.env here and nowhere else.
import { createClient } from '@supabase/supabase-js';
import type { ExternalDatabase } from './external-types';
import { EXTERNAL_SUPABASE_URL } from './external-config';

function url() {
  return process.env['EXTERNAL_SUPABASE_URL'] || EXTERNAL_SUPABASE_URL;
}

function createAdminClient() {
  // EXTERNAL_SERVICE_ROLE_KEY is the authoritative service-role key for the
  // external project; SERVICE_ROLE_KEY is kept as a legacy fallback.
  const key =
    process.env['EXTERNAL_SERVICE_ROLE_KEY'] ||
    process.env['SERVICE_ROLE_KEY'] ||
    process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) throw new Error('Missing SERVICE_ROLE_KEY secret for the external Supabase project.');
  return createClient<ExternalDatabase>(url(), key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let _admin: ReturnType<typeof createAdminClient> | undefined;

/** Service-role client — bypasses RLS. Server-side use only. */
export const supabaseExternalAdmin = new Proxy({} as ReturnType<typeof createAdminClient>, {
  get(_target, prop, receiver) {
    if (!_admin) _admin = createAdminClient();
    return Reflect.get(_admin, prop, receiver);
  },
});

