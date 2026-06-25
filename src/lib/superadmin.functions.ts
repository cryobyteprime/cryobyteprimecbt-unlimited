import { createServerFn } from '@tanstack/react-start';

// Public: ensure the superadmin account exists, using SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD secrets.
// Safe to call from /auth — never returns the credentials.
export const ensureSuperadmin = createServerFn({ method: 'POST' }).handler(async () => {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    return { ok: false, reason: 'missing_secrets' as const };
  }

  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

  // Already have any superadmin? Nothing to do.
  const { count } = await supabaseAdmin
    .from('user_roles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'superadmin');
  if ((count ?? 0) > 0) return { ok: true, created: false };

  // Try to find existing user by email
  const list = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (list.error) throw new Error(list.error.message);
  let user = list.data.users.find((u: any) => (u.email ?? '').toLowerCase() === email.toLowerCase());

  if (!user) {
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message || 'Failed to create superadmin');
    }
    user = created.data.user;
  } else {
    // Reset the password to match the current secret so rotation works.
    await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
  }

  // The DB trigger assigns superadmin to the first auth user; ensure role is set even if trigger didn't fire.
  await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id: user.id, role: 'superadmin' }, { onConflict: 'user_id,role' });

  return { ok: true, created: true };
});
