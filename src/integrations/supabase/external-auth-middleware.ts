// Validates a caller's external-Supabase bearer token inside server functions.
// Safe to import from client-reachable modules: the body only runs on the server.
import { createClient } from '@supabase/supabase-js';
import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import type { ExternalDatabase } from './external-types';
import { EXTERNAL_SUPABASE_ANON_KEY, EXTERNAL_SUPABASE_URL } from './external-config';

/** Validates the caller's bearer token against the external project. */
export const requireExternalAuth = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const request = getRequest();
  const authHeader = request?.headers?.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) throw new Error('Unauthorized: missing bearer token');
  const token = authHeader.slice(7).trim();
  if (token.split('.').length !== 3) throw new Error('Unauthorized: invalid token');

  const supabase = createClient<ExternalDatabase>((process.env['EXTERNAL_SUPABASE_URL'] || EXTERNAL_SUPABASE_URL), (process.env['EXTERNAL_SUPABASE_ANON_KEY'] || EXTERNAL_SUPABASE_ANON_KEY), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('Unauthorized: invalid session');

  return next({ context: { supabase, userId: data.user.id, user: data.user } });
});
