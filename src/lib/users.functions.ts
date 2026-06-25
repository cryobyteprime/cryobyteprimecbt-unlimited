import { createServerFn } from '@tanstack/react-start';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const RoleEnum = z.enum(['superadmin', 'admin', 'staff']);

// Public: tells the /auth page whether the bootstrap superadmin exists yet.
export const hasBootstrapSuperadmin = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { count } = await supabaseAdmin
      .from('user_roles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'superadmin');
    return { hasSuperadmin: (count ?? 0) > 0 };
  } catch (e) {
    // Service role not configured — assume bootstrap is already done so the auth page still renders.
    console.warn('[hasBootstrapSuperadmin] falling back:', (e as Error)?.message);
    return { hasSuperadmin: true };
  }
});


// Superadmin only: create a user + assign role.
export const inviteUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      email: z.string().email().max(255),
      password: z.string().min(8).max(128),
      role: RoleEnum,
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Authorize caller
    const { data: isSuper, error: roleErr } = await context.supabase
      .rpc('has_role', { _user_id: context.userId, _role: 'superadmin' as any });
    if (roleErr) throw new Error(roleErr.message);
    if (!isSuper) throw new Error('Forbidden: superadmin only');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message || 'Failed to create user');
    }

    const { error: roleInsertErr } = await supabaseAdmin
      .from('user_roles')
      .insert({ user_id: created.data.user.id, role: data.role });
    if (roleInsertErr) {
      // best effort cleanup
      await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
      throw new Error(roleInsertErr.message);
    }

    return { userId: created.data.user.id, email: created.data.user.email };
  });

// Superadmin only: list all users with roles.
export const listUsers = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isSuper } = await context.supabase
      .rpc('has_role', { _user_id: context.userId, _role: 'superadmin' as any });
    if (!isSuper) throw new Error('Forbidden: superadmin only');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from('user_roles').select('user_id, role');
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    return list.users.map((u: any) => ({
      id: u.id,
      email: u.email ?? '',
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      roles: roleMap.get(u.id) ?? [],
    }));
  });

// Superadmin only: change a user's role (replace existing).
export const setUserRole = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ userId: z.string().uuid(), role: RoleEnum }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isSuper } = await context.supabase
      .rpc('has_role', { _user_id: context.userId, _role: 'superadmin' as any });
    if (!isSuper) throw new Error('Forbidden: superadmin only');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await supabaseAdmin.from('user_roles').delete().eq('user_id', data.userId);
    const { error } = await supabaseAdmin.from('user_roles').insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Superadmin only: delete a user.
export const deleteUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: isSuper } = await context.supabase
      .rpc('has_role', { _user_id: context.userId, _role: 'superadmin' as any });
    if (!isSuper) throw new Error('Forbidden: superadmin only');
    if (data.userId === context.userId) throw new Error('Cannot delete your own account');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });