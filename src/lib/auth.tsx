import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'superadmin' | 'admin' | 'staff';

interface AuthState {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

async function fetchRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  if (error || !data) return [];
  return data.map((r: any) => r.role as AppRole);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRoles = useCallback(async (u: User | null) => {
    if (!u) { setRoles([]); return; }
    setRoles(await fetchRoles(u.id));
  }, []);

  const refresh = useCallback(async () => {
    await loadRoles(user);
  }, [user, loadRoles]);

  useEffect(() => {
    let mounted = true;

    // Subscribe FIRST to avoid races
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, sess: Session | null) => {
      if (!mounted) return;
      setSession(sess);
      setUser(sess?.user ?? null);
      // Defer DB call to avoid deadlock inside the callback
      setTimeout(() => { loadRoles(sess?.user ?? null); }, 0);
    });

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      loadRoles(data.session?.user ?? null).finally(() => setLoading(false));
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [loadRoles]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null); setSession(null); setRoles([]);
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, roles, loading, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useHasRole(...required: AppRole[]) {
  const { roles } = useAuth();
  return required.some((r) => roles.includes(r));
}

// Permission helpers — single source of truth for UI gating.
export const permissions = {
  manageUsers: (roles: AppRole[]) => roles.includes('superadmin'),
  manageStudents: (roles: AppRole[]) => roles.includes('superadmin') || roles.includes('admin'),
  manageExams: (roles: AppRole[]) => roles.includes('superadmin') || roles.includes('admin'),
  manageAttendance: (roles: AppRole[]) => roles.includes('superadmin') || roles.includes('admin'),
  takeAttendance: (roles: AppRole[]) => roles.length > 0, // any signed-in role
  viewReports: (roles: AppRole[]) => roles.length > 0,
  approveDeletions: (roles: AppRole[]) => roles.includes('superadmin'),
  manageSettings: (roles: AppRole[]) => roles.includes('superadmin'),
  viewAuditLog: (roles: AppRole[]) => roles.includes('superadmin') || roles.includes('admin'),
};

// Map app_role → legacy AdminRole used by sub-pages.
export function roleToLegacyAdminRole(roles: AppRole[]): 'Superadmin' | 'Admin' | 'Tutor' {
  if (roles.includes('superadmin')) return 'Superadmin';
  if (roles.includes('admin')) return 'Admin';
  return 'Tutor';
}