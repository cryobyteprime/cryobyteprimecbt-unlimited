import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AlertTriangle, ShieldAlert, Trash2, X } from 'lucide-react';

export interface ConfirmActionOptions {
  /** Short, action-oriented title shown at the top of the modal. */
  title: string;
  /** One-line description of what will happen. */
  description?: string;
  /** Bullet items showing exactly what will be deleted / affected. */
  scope?: string[];
  /** Label for the confirm button. Defaults to "Delete". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual variant — "danger" for delete/wipe (default), "warning" for reversible destructive. */
  variant?: 'danger' | 'warning';
  /**
   * If set, the admin must type this exact string before confirm is enabled.
   * Recommended for wipes ("WIPE ALL") and irreversible bulk deletes.
   */
  requireTypedConfirm?: string;
  /** If true, prompt for a reason and resolve with `{ confirmed, reason }` instead of boolean. */
  requireReason?: boolean;
  /** Placeholder for the reason field. */
  reasonPlaceholder?: string;
}

export type ConfirmActionResult =
  | { confirmed: true; reason?: string }
  | { confirmed: false };

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let resolver: ((r: ConfirmActionResult) => void) | null = null;
let setStateExternal: ((opts: ConfirmActionOptions | null) => void) | null = null;

function ensureMounted() {
  if (host && root) return;
  host = document.createElement('div');
  host.setAttribute('data-confirm-action-host', '');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ConfirmActionMount />);
}

function ConfirmActionMount() {
  const [opts, setOpts] = useState<ConfirmActionOptions | null>(null);
  useEffect(() => { setStateExternal = setOpts; return () => { setStateExternal = null; }; }, []);
  if (!opts) return null;
  return (
    <ConfirmDialog
      opts={opts}
      onResolve={(r) => {
        setOpts(null);
        const fn = resolver;
        resolver = null;
        fn?.(r);
      }}
    />
  );
}

function ConfirmDialog({ opts, onResolve }: { opts: ConfirmActionOptions; onResolve: (r: ConfirmActionResult) => void }) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const variant = opts.variant ?? 'danger';
  const danger = variant === 'danger';
  const palette = danger
    ? {
        border: 'border-rose-200',
        bg: 'bg-rose-50',
        iconBg: 'bg-rose-100',
        iconBorder: 'border-rose-200',
        iconText: 'text-rose-600',
        scopeLabel: 'text-rose-700',
        scopeText: 'text-rose-900',
        typedText: 'text-rose-600',
        typedBorder: 'border-rose-200',
        typedFocus: 'focus:border-rose-500',
        btn: 'bg-rose-600 hover:bg-rose-700',
      }
    : {
        border: 'border-amber-200',
        bg: 'bg-amber-50',
        iconBg: 'bg-amber-100',
        iconBorder: 'border-amber-200',
        iconText: 'text-amber-600',
        scopeLabel: 'text-amber-700',
        scopeText: 'text-amber-900',
        typedText: 'text-amber-600',
        typedBorder: 'border-amber-200',
        typedFocus: 'focus:border-amber-500',
        btn: 'bg-amber-600 hover:bg-amber-700',
      };
  const typedOk = !opts.requireTypedConfirm || typed.trim() === opts.requireTypedConfirm;
  const reasonOk = !opts.requireReason || reason.trim().length >= 3;
  const canConfirm = typedOk && reasonOk;


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResolve({ confirmed: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResolve]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={opts.title}
      className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans"
      onClick={(e) => { if (e.target === e.currentTarget) onResolve({ confirmed: false }); }}
    >
      <div className={`bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border ${palette.border} space-y-5`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl ${palette.iconBg} border ${palette.iconBorder} shrink-0`}>
            {danger
              ? <ShieldAlert className={`w-5 h-5 ${palette.iconText}`} />
              : <AlertTriangle className={`w-5 h-5 ${palette.iconText}`} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-extrabold text-slate-900">{opts.title}</h3>
            {opts.description && (
              <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{opts.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onResolve({ confirmed: false })}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {opts.scope && opts.scope.length > 0 && (
          <div className={`rounded-xl border ${palette.border} ${palette.bg} p-3`}>
            <div className={`text-[10px] font-black font-mono uppercase tracking-wider ${palette.scopeLabel} mb-1.5`}>
              Affected scope
            </div>
            <ul className={`text-[12px] ${palette.scopeText} font-semibold space-y-1 list-disc list-inside`}>
              {opts.scope.map((s, i) => <li key={i} className="break-words">{s}</li>)}
            </ul>
          </div>
        )}

        {opts.requireReason && (
          <div>
            <label className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500 block mb-1.5">
              Reason <span className="text-rose-600">(required, logged to audit)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder={opts.reasonPlaceholder ?? 'Describe why this action is needed…'}
              className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:border-slate-400"
            />
          </div>
        )}

        {opts.requireTypedConfirm && (
          <div>
            <label className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500 block mb-1.5">
              Type <span className={palette.typedText}>{opts.requireTypedConfirm}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder={opts.requireTypedConfirm}
              className={`w-full bg-slate-50 border ${palette.typedBorder} p-2.5 rounded-xl text-sm font-bold tracking-widest text-center focus:bg-white focus:outline-none ${palette.typedFocus}`}
            />
          </div>
        )}


        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onResolve({ confirmed: false })}
            className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onResolve({ confirmed: true, reason: opts.requireReason ? reason.trim() : undefined })}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {opts.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Show a destructive-action confirmation modal. Returns a promise that resolves
 * with `{ confirmed, reason? }`. Safe to call from anywhere in the app.
 */
export function confirmAction(opts: ConfirmActionOptions): Promise<ConfirmActionResult> {
  ensureMounted();
  // If a previous dialog is still open, reject it as cancelled.
  if (resolver) {
    const prev = resolver;
    resolver = null;
    prev({ confirmed: false });
  }
  return new Promise<ConfirmActionResult>((resolve) => {
    resolver = resolve;
    setStateExternal?.(opts);
  });
}

/** Convenience helper that returns just a boolean. */
export async function confirmActionBool(opts: ConfirmActionOptions): Promise<boolean> {
  const r = await confirmAction(opts);
  return r.confirmed;
}
