import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Sparkles, Lock, Mail, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { hasBootstrapSuperadmin } from '@/lib/users.functions';
import { ensureSuperadmin } from '@/lib/superadmin.functions';

export const Route = createFileRoute('/auth')({
  component: AuthPage,
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Sign in — CryoByte Prime Admin' },
      { name: 'description', content: 'Admin sign-in for the CryoByte Prime CBT and attendance portal.' },
    ],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [bootstrapAllowed, setBootstrapAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    // Redirect if already signed in
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (data.session) navigate({ to: '/admin' });
    });
    // Try to provision superadmin from server-side secrets, then re-check bootstrap state.
    ensureSuperadmin()
      .catch(() => undefined)
      .then(() => hasBootstrapSuperadmin())
      .then((r) => {
        setBootstrapAllowed(!r.hasSuperadmin);
        if (!r.hasSuperadmin) setMode('signup');
      })
      .catch(() => setBootstrapAllowed(false))
      .finally(() => setChecking(false));
  }, [navigate]);

  if (!mounted) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setInfo('If an account exists for that email, a reset link has been sent.');
        setBusy(false);
        return;
      }
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/admin` },
        });
        if (error) throw error;
        setInfo('Account created. Signing you in…');
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          setInfo('Check your email to confirm the account, then return to sign in.');
          setBusy(false);
          return;
        }
        navigate({ to: '/admin' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: '/admin' });
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col font-sans">
      <header className="px-6 py-5 flex items-center justify-between border-b border-slate-900">
        <Link to="/" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-wider uppercase">CryoBytePrime</h1>
            <p className="text-[10px] text-slate-400 font-mono tracking-wider mt-0.5">ADMIN CONSOLE ACCESS</p>
          </div>
        </Link>
        <Link to="/" className="text-xs text-slate-400 hover:text-cyan-400">← Back to portal</Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-5">
          <div className="text-center space-y-1.5">
            <div className="inline-flex p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mb-2">
              <Lock className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-extrabold">
              {mode === 'signup' ? 'Create admin account' : mode === 'forgot' ? 'Reset your password' : 'Sign in to admin'}
            </h2>
            <p className="text-[11px] text-slate-400 font-normal">
              {mode === 'signup'
                ? bootstrapAllowed
                  ? 'The first account created becomes the superadmin.'
                  : 'Sign-ups are disabled. Ask a superadmin to invite you.'
                : mode === 'forgot'
                  ? "Enter your email and we'll send you a reset link."
                  : 'Use your admin email and password to continue.'}
            </p>
          </div>

          {checking ? (
            <div className="py-10 text-center text-xs text-slate-500 font-mono">Checking system state…</div>
          ) : (
            <form onSubmit={submit} className="space-y-3.5">
              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] rounded-xl flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {info && (
                <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[11px] rounded-xl">{info}</div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold font-mono text-slate-400 tracking-wider">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 pl-10 pr-3 py-3 rounded-xl text-sm focus:outline-none focus:border-cyan-500/50"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              {mode !== 'forgot' && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold font-mono text-slate-400 tracking-wider">Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="password"
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 pl-10 pr-3 py-3 rounded-xl text-sm focus:outline-none focus:border-cyan-500/50"
                      placeholder="At least 8 characters"
                    />
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={busy || (mode === 'signup' && !bootstrapAllowed)}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-cyan-600/20 transition-all"
              >
                {busy ? 'Working…' : mode === 'signup' ? 'Create superadmin account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
              </button>

              <div className="flex flex-col items-center gap-1.5 pt-1">
                {mode === 'signin' && (
                  <button type="button" onClick={() => { setMode('forgot'); setError(''); setInfo(''); }} className="text-[11px] text-slate-400 hover:text-cyan-400">
                    Forgot password?
                  </button>
                )}
                {mode === 'forgot' && (
                  <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo(''); }} className="text-[11px] text-slate-400 hover:text-cyan-400">
                    ← Back to sign in
                  </button>
                )}
                {bootstrapAllowed && mode !== 'forgot' && (
                  <button
                    type="button"
                    onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo(''); }}
                    className="text-[11px] text-slate-400 hover:text-cyan-400"
                  >
                    {mode === 'signin' ? 'No superadmin yet? Create the first account →' : '← Back to sign in'}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}