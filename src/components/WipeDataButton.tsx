import React, { useState } from 'react';
import { Trash2, AlertTriangle, Download, ShieldAlert, Check, Loader2 } from 'lucide-react';
import { DB } from '../lib/database';

interface WipeDataButtonProps {
  /** Where the action is being invoked from (used in audit). */
  page: string;
  /** Email of the admin clicking. */
  adminEmail: string;
  /** Compact button style for header use vs full button in-page. */
  variant?: 'compact' | 'full';
  /** Called after a successful wipe so parents can reload state. */
  onWiped?: () => void;
  /** Optional audit-log writer (re-uses AdminPortal's triggerAuditLog). */
  triggerAuditLog?: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
}

type Phase = 'idle' | 'confirm' | 'backing-up' | 'ready-to-wipe' | 'wiping' | 'done' | 'error';

function toCsv(rows: any[]): string {
  if (!rows || rows.length === 0) return '';
  const cols = Array.from(rows.reduce((s: Set<string>, r) => {
    Object.keys(r ?? {}).forEach((k) => s.add(k));
    return s;
  }, new Set<string>()));
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r?.[c])).join(',')).join('\n');
  return header + '\n' + body;
}

function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      URL.revokeObjectURL(url);
    }, 1500);
    return true;
  } catch (e) {
    console.error('downloadBlob failed', e);
    return false;
  }
}

export default function WipeDataButton({
  page,
  adminEmail,
  variant = 'compact',
  onWiped,
  triggerAuditLog,
}: WipeDataButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [backupSummary, setBackupSummary] = useState<{ counts: Record<string, number>; filename: string } | null>(null);

  const open = () => { setPhase('confirm'); setError(''); setPasscode(''); setBackupSummary(null); };
  const close = () => {
    if (phase === 'backing-up' || phase === 'wiping') return;
    setPhase('idle'); setError(''); setPasscode(''); setBackupSummary(null);
  };

  const runBackup = async () => {
    setError('');
    setPhase('backing-up');
    try {
      const backup = await DB.exportFullBackup();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let blob: Blob;
      let filename: string;

      if (format === 'json') {
        blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        filename = `cbt-backup-${stamp}.json`;
      } else {
        // Bundle each table as its own CSV inside a single .csv document with section headers.
        const sections: string[] = [
          `# CBT Backup — ${backup.generatedAt}`,
          `# Counts: ${JSON.stringify(backup.counts)}`,
          '',
        ];
        for (const [table, rows] of Object.entries(backup.data)) {
          sections.push(`### ${table} (${(rows as any[]).length})`);
          sections.push(toCsv(rows as any[]));
          sections.push('');
        }
        sections.push('### config');
        sections.push(toCsv([backup.config]));
        blob = new Blob([sections.join('\n')], { type: 'text/csv' });
        filename = `cbt-backup-${stamp}.csv`;
      }

      const ok = downloadBlob(blob, filename);
      if (!ok) throw new Error('Browser blocked the backup download. Allow downloads and try again.');

      setBackupSummary({ counts: backup.counts, filename });
      setPhase('ready-to-wipe');
    } catch (e: any) {
      console.error(e);
      setError(`Backup failed — wipe aborted. ${e?.message ?? e}`);
      setPhase('error');
    }
  };

  const runWipe = async () => {
    if (!backupSummary) {
      setError('No confirmed backup. Run the backup step first.');
      return;
    }
    if (passcode.trim().toUpperCase() !== 'WIPE') {
      setError('Type WIPE exactly to confirm.');
      return;
    }
    setError('');
    setPhase('wiping');
    try {
      const result = await DB.wipeAllData();
      try {
        await triggerAuditLog?.(
          `WIPE_ALL_DATA: Admin wiped all operational data after confirmed backup (${backupSummary.filename})`,
          page,
          { counts: backupSummary.counts },
          { wiped: result.wiped, backupFile: backupSummary.filename },
          'Admin-initiated full data wipe; backup file downloaded prior to deletion'
        );
      } catch {}
      setPhase('done');
      onWiped?.();
    } catch (e: any) {
      console.error(e);
      setError(`Wipe failed: ${e?.message ?? e}`);
      setPhase('error');
    }
  };

  const triggerClass = variant === 'compact'
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:bg-rose-950/50 transition-colors text-[11px] font-bold cursor-pointer'
    : 'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm cursor-pointer transition-colors shadow-md';

  return (
    <>
      <button type="button" onClick={open} className={triggerClass} title="Wipe all data (creates backup first)">
        <Trash2 className="w-3.5 h-3.5" />
        <span>Wipe Data</span>
      </button>

      {phase !== 'idle' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Wipe all data"
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-200 space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-100 border border-rose-200 shrink-0">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold text-slate-900">Wipe All Data</h3>
                <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                  Deletion will permanently remove every student, attendance record, question, and result. A full backup will be downloaded to your device <strong>before</strong> anything is deleted. If the backup fails, the wipe is aborted.
                </p>
              </div>
            </div>

            {phase === 'confirm' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800 font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>This action cannot be undone. Restore is only possible from the backup file you download.</span>
                </div>
                <div>
                  <label className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500 block mb-2">Backup file format</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['json', 'csv'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFormat(f)}
                        className={`px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                          format === f
                            ? 'bg-rose-50 border-rose-300 text-rose-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {f.toUpperCase()}{f === 'json' ? ' (recommended)' : ''}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5 font-mono">JSON preserves nested fields and is restorable. CSV is human-readable, one table per section.</p>
                </div>
                {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={close} className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer">Cancel</button>
                  <button
                    type="button"
                    onClick={runBackup}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Create &amp; Download Backup
                  </button>
                </div>
              </div>
            )}

            {phase === 'backing-up' && (
              <div className="flex items-center gap-3 py-6 justify-center text-slate-700">
                <Loader2 className="w-5 h-5 animate-spin text-cyan-600" />
                <span className="text-sm font-bold">Generating backup…</span>
              </div>
            )}

            {phase === 'ready-to-wipe' && backupSummary && (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-800 font-semibold flex items-start gap-2">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div>Backup downloaded: <code className="bg-white px-1 rounded font-mono">{backupSummary.filename}</code></div>
                    <div className="text-[10px] text-emerald-700 font-mono mt-1 break-all">
                      {Object.entries(backupSummary.counts).map(([k, n]) => `${k}=${n}`).join(' · ')}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500 block mb-1.5">
                    Type <span className="text-rose-600">WIPE</span> to confirm deletion
                  </label>
                  <input
                    type="text"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    autoFocus
                    placeholder="WIPE"
                    className="w-full bg-slate-50 border border-rose-200 p-2.5 rounded-xl text-sm font-bold tracking-widest text-center focus:bg-white focus:outline-none focus:border-rose-500"
                  />
                </div>
                {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={close} className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer">Cancel</button>
                  <button
                    type="button"
                    onClick={runWipe}
                    disabled={passcode.trim().toUpperCase() !== 'WIPE'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Yes, Wipe Everything
                  </button>
                </div>
              </div>
            )}

            {phase === 'wiping' && (
              <div className="flex items-center gap-3 py-6 justify-center text-slate-700">
                <Loader2 className="w-5 h-5 animate-spin text-rose-600" />
                <span className="text-sm font-bold">Wiping data…</span>
              </div>
            )}

            {phase === 'done' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 flex items-start gap-2">
                  <Check className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-extrabold">Wipe complete.</div>
                    <div className="text-[11px] font-mono mt-1">Backup file: {backupSummary?.filename}</div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={close} className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer">Close</button>
                </div>
              </div>
            )}

            {phase === 'error' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800 text-xs font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error || 'Something went wrong.'}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={close} className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer">Close</button>
                  <button type="button" onClick={() => setPhase('confirm')} className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer">Try Again</button>
                </div>
              </div>
            )}

            <p className="text-[10px] text-slate-400 text-center font-mono">
              Admin: {adminEmail} · Page: {page}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
