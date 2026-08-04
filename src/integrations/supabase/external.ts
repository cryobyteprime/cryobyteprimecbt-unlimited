// The single typed Supabase client for this app.
//
// It targets the project's external Supabase instance and is typed with the
// auto-generated `ExternalDatabase` schema (see scripts/gen-supabase-types.mjs),
// so table names, column names and RPC names are all type-checked.
import { createClient } from '@supabase/supabase-js';
import type { ExternalDatabase } from './external-types';
import { EXTERNAL_SUPABASE_ANON_KEY, EXTERNAL_SUPABASE_URL } from './external-config';

function createExternalClient() {
  return createClient<ExternalDatabase>(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      persistSession: typeof window !== 'undefined',
      autoRefreshToken: typeof window !== 'undefined',
    },
  });
}

export type ExternalClient = ReturnType<typeof createExternalClient>;

let _client: ExternalClient | undefined;

export const supabase = new Proxy({} as ExternalClient, {
  get(_target, prop, receiver) {
    if (!_client) _client = createExternalClient();
    return Reflect.get(_client, prop, receiver);
  },
});

export { supabase as supabaseExternal };
export type { ExternalDatabase };
