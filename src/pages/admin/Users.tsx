import React, { useEffect, useState } from 'react';
import { UserPlus, Trash2, Users as UsersIcon, ShieldCheck, AlertCircle } from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import { listUsers, inviteUser, setUserRole, deleteUser } from '@/lib/users.functions';
import { useAuth, type AppRole } from '@/lib/auth';
import { confirmActionBool } from '@/components/confirmAction';

type UserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt?: string | null;
  roles: string[];
};

export default function Users() {
  const { user: currentUser } = useAuth();
  const list = useServerFn(listUsers);
  const invite = useServerFn(inviteUser);
  const setRole = useServerFn(setUserRole);
  const del = useServerFn(deleteUser);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('staff');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setError('');
    setLoading(true);
    try {
      const u = await list();
      setUsers(u as UserRow[]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await invite({ data: { email: inviteEmail.trim(), password: invitePassword, role: inviteRole } });
      setShowInvite(false);
      setInviteEmail(''); setInvitePassword(''); setInviteRole('staff');
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to invite user');
    } finally { setBusy(false); }
  };

  const handleChangeRole = async (id: string, role: AppRole) => {
    setError('');
    try { await setRole({ data: { userId: id, role } }); await refresh(); }
    catch (err: any) { setError(err?.message || 'Failed to change role'); }
  };

  const handleDelete = async (id: string, email: string) => {
    const ok = await confirmActionBool({
      title: 'Delete user account',
      description: 'Permanently removes this user from authentication and revokes all role assignments. This cannot be undone.',
      scope: [
        `Email: ${email}`,
        `User ID: ${id}`,
        'All role grants on this user will be removed',
      ],
      confirmLabel: 'Delete user',
      requireTypedConfirm: 'DELETE',
    });
    if (!ok) return;
    setError('');
    try { await del({ data: { userId: id } }); await refresh(); }
    catch (err: any) { setError(err?.message || 'Failed to delete user'); }
  };

  return (
    <div className="space-y-6 animate-fade-in text-xs">
      <div className="flex items-center justify-between font-sans">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <UsersIcon className="w-6 h-6 text-cyan-600" />
            <span>Users & Roles</span>
          </h2>
          <p className="text-xs text-slate-500">Invite admins and staff and assign their permission roles.</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="px-4 py-2.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm flex items-center space-x-1.5 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite user</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-mono uppercase text-slate-500">
            <tr>
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Created</th>
              <th className="p-3">Last sign-in</th>
              <th className="p-3 text-right pr-5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-150">
            {loading ? (
              <tr><td colSpan={5} className="py-14 text-center font-mono text-slate-400">Loading users…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="py-14 text-center text-slate-400">No users yet.</td></tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === currentUser?.id;
                const role = (u.roles[0] as AppRole) || 'staff';
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-800">
                      {u.email}
                      {isSelf && <span className="ml-2 text-[10px] font-mono text-cyan-600">(you)</span>}
                    </td>
                    <td className="p-3">
                      <select
                        value={role}
                        disabled={isSelf}
                        onChange={(e) => handleChangeRole(u.id, e.target.value as AppRole)}
                        className="bg-slate-50 border border-slate-250 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none disabled:opacity-50"
                      >
                        <option value="superadmin">Superadmin</option>
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                      </select>
                      {u.roles.length === 0 && <span className="ml-2 text-[10px] text-amber-600">no role assigned</span>}
                    </td>
                    <td className="p-3 font-mono text-[10px] text-slate-500">{u.createdAt?.slice(0, 10)}</td>
                    <td className="p-3 font-mono text-[10px] text-slate-500">{u.lastSignInAt?.slice(0, 16).replace('T', ' ') || '—'}</td>
                    <td className="p-3 text-right pr-5">
                      <button
                        onClick={() => handleDelete(u.id, u.email)}
                        disabled={isSelf}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        title={isSelf ? 'Cannot delete yourself' : 'Delete user'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full animate-zoom-in overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-cyan-600" />
              <h3 className="font-bold text-slate-900 text-sm">Invite new user</h3>
            </div>
            <form onSubmit={handleInvite} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="text-[10px] uppercase font-mono font-bold text-slate-500">Email</label>
                <input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-250 px-3 py-2.5 rounded-xl focus:bg-white focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono font-bold text-slate-500">Temporary password (min 8)</label>
                <input type="text" required minLength={8} value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-250 px-3 py-2.5 rounded-xl focus:bg-white focus:outline-none font-mono" />
                <p className="text-[10px] text-slate-400 mt-1">Share this with the user; they can change it after signing in.</p>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono font-bold text-slate-500">Role</label>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as AppRole)}
                  className="w-full mt-1 bg-slate-50 border border-slate-250 px-3 py-2.5 rounded-xl focus:bg-white focus:outline-none font-bold">
                  <option value="staff">Staff — attendance only</option>
                  <option value="admin">Admin — manage content</option>
                  <option value="superadmin">Superadmin — full access</option>
                </select>
              </div>
              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setShowInvite(false)} className="px-4 py-2 border border-slate-200 rounded-lg font-semibold text-slate-700 bg-white hover:bg-slate-50 cursor-pointer">Cancel</button>
                <button type="submit" disabled={busy} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 text-white font-bold rounded-lg cursor-pointer">
                  {busy ? 'Inviting…' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}