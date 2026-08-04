import { createMiddleware } from '@tanstack/react-start';
import { supabase } from './external';

// Attaches the external Supabase session token to every server-function call.
export const attachExternalAuth = createMiddleware({ type: 'function' }).client(async ({ next }) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
