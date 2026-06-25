import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Sparkles, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Reset password — CryoByte Prime Admin' },
      { name: 'description', content: 'Set a new password for your CryoByte Prime admin account.' },
    ],
  }),
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    // Supabase parses the recovery tokens from the URL hash and emits a PASSWORD_RECOVERY event.
    const { data: sub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    // Also handle the case where the session is already established when we land here.
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setInfo('Password updated. Redirecting…');
      setTimeout(() => navigate({ to: '/admin' }), 800);
    } catch (err: any) {
      setError(err?.message || 'Failed to update password');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
      <header className="px-6 py-5 border-b border-slate-900 flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <h1 className="text-sm font-black tracking-wider uppercase">CryoBytePrime</h1>
        </Link>
        <Link to="/auth" className="text-xs text-slate-400 hover:text-cyan-400">← Sign in</Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-3xl p-7 space-y-5">
          <div className="text-center space-y-1.5">
            <div className="inline-flex p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mb-2">
              <Lock className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-extrabold">Set a new password</h2>
            <p className="text-[11px] text-slate-400">
              {ready ? 'Choose a strong password of at least 8 characters.' : 'Validating reset link…'}
            </p>
          </div>
          {ready && (
            <form onSubmit={submit} className="space-y-3.5">
              {error && <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] rounded-xl">{error}</div>}
              {info && <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[11px] rounded-xl">{info}</div>}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold font-mono text-slate-400 tracking-wider">New password</label>
                <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 px-3 py-3 rounded-xl text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold font-mono text-slate-400 tracking-wider">Confirm password</label>
                <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full bg-slate-950 border border-slate-800 px-3 py-3 rounded-xl text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <button type="submit" disabled={busy} className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl">
                {busy ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
