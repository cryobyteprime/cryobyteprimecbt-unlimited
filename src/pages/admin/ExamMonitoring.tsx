import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert, Search, Download, RefreshCw, AlertTriangle, Ban, Eye,
  Activity, Users as UsersIcon, Clock, Filter,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { DB } from '../../lib/database';
import { AuditLog } from '../../types';

// Categories mined out of action strings written by StudentCBT + server auto-submit.
const VIOLATION_PATTERNS: { key: string; label: string; test: (a: string) => boolean; color: string }[] = [
  { key: 'TAB_SWITCH',    label: 'Tab / window switch',   test: (a) => /TAB_SWITCH/i.test(a),          color: '#f59e0b' },
  { key: 'FULLSCREEN',    label: 'Fullscreen exit',       test: (a) => /FULLSCREEN/i.test(a),          color: '#f97316' },
  { key: 'COPY_PASTE',    label: 'Copy / paste',          test: (a) => /COPY|PASTE|CUT/i.test(a),      color: '#ef4444' },
  { key: 'RIGHT_CLICK',   label: 'Right-click / devtools',test: (a) => /RIGHT_CLICK|DEVTOOLS/i.test(a),color: '#ec4899' },
  { key: 'SCREENSHOT',    label: 'Screenshot attempt',    test: (a) => /SCREENSHOT/i.test(a),          color: '#a855f7' },
  { key: 'SCREEN_CAPTURE',label: 'Screen capture',        test: (a) => /SCREEN_CAPTURE|DISPLAY_MEDIA/i.test(a), color: '#8b5cf6' },
  { key: 'FOCUS_LOST',    label: 'Focus lost / blur',     test: (a) => /FOCUS|BLUR/i.test(a),          color: '#0ea5e9' },
  { key: 'PRINT',         label: 'Print attempt',         test: (a) => /PRINT/i.test(a),               color: '#14b8a6' },
  { key: 'MULTI_DEVICE',  label: 'Multi-device / IP',     test: (a) => /MULTI_DEVICE|DUPLICATE_DEVICE|IP_MISMATCH/i.test(a), color: '#22c55e' },
  { key: 'MALPRACTICE',   label: 'Malpractice penalty',   test: (a) => /MALPRACTICE/i.test(a),         color: '#dc2626' },
  { key: 'AUTO_SUBMIT',   label: 'Forced auto-submit',    test: (a) => /auto_submit|scheduled_window_ended|tab_violation_auto_submit|malpractice_exhausted/i.test(a), color: '#0891b2' },
];

function classify(action: string): string {
  for (const p of VIOLATION_PATTERNS) if (p.test(action)) return p.key;
  return 'OTHER';
}

function isViolation(log: AuditLog): boolean {
  if (log.page !== 'student-cbt') return false;
  const a = log.action || '';
  return /VIOLATION|MALPRACTICE|SCREENSHOT|SCREEN_CAPTURE|FULLSCREEN|COPY|PASTE|CUT|RIGHT_CLICK|DEVTOOLS|PRINT|FOCUS|BLUR|MULTI_DEVICE|DUPLICATE_DEVICE|IP_MISMATCH|tab_violation_auto_submit|malpractice_exhausted|scheduled_window_ended|LOGIN_BLOCKED/i.test(a);
}

function severityOf(key: string): 'low' | 'medium' | 'high' {
  if (['MALPRACTICE', 'AUTO_SUBMIT', 'MULTI_DEVICE', 'SCREEN_CAPTURE'].includes(key)) return 'high';
  if (['TAB_SWITCH', 'FULLSCREEN', 'SCREENSHOT', 'COPY_PASTE'].includes(key)) return 'medium';
  return 'low';
}

const sevBadge: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  high: 'bg-rose-100 text-rose-800 border-rose-200',
};

export default function ExamMonitoring() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [rangeHours, setRangeHours] = useState<number>(24);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const all = await DB.getAuditLogs();
      setLogs(all.filter(isViolation));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const now = Date.now();
  const scoped = useMemo(() => {
    const cutoff = now - rangeHours * 3600_000;
    return logs.filter((l) => {
      const ts = new Date(l.timestamp).getTime();
      if (isFinite(ts) && ts < cutoff) return false;
      const cat = classify(l.action);
      if (categoryFilter !== 'all' && cat !== categoryFilter) return false;
      if (severityFilter !== 'all' && severityOf(cat) !== severityFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!(l.userName?.toLowerCase().includes(q) || l.action?.toLowerCase().includes(q) || l.reason?.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [logs, categoryFilter, severityFilter, query, rangeHours, now]);

  // ── Aggregates ────────────────────────────────────────────────────────
  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of scoped) {
      const k = classify(l.action);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return VIOLATION_PATTERNS
      .map((p) => ({ name: p.label, key: p.key, value: counts.get(p.key) || 0, color: p.color }))
      .filter((r) => r.value > 0);
  }, [scoped]);

  const byCandidate = useMemo(() => {
    const map = new Map<string, { email: string; total: number; high: number; last: string; cats: Record<string, number> }>();
    for (const l of scoped) {
      const email = (l.userName || 'unknown').toLowerCase();
      const cat = classify(l.action);
      const sev = severityOf(cat);
      const row = map.get(email) || { email, total: 0, high: 0, last: l.timestamp, cats: {} };
      row.total += 1;
      if (sev === 'high') row.high += 1;
      row.cats[cat] = (row.cats[cat] || 0) + 1;
      if (new Date(l.timestamp).getTime() > new Date(row.last).getTime()) row.last = l.timestamp;
      map.set(email, row);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [scoped]);

  const timeline = useMemo(() => {
    // bucket by hour if <=48h else by day
    const useHour = rangeHours <= 48;
    const buckets = new Map<string, number>();
    for (const l of scoped) {
      const d = new Date(l.timestamp);
      const key = useHour
        ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`
        : `${d.getMonth() + 1}/${d.getDate()}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return Array.from(buckets.entries()).map(([time, count]) => ({ time, count }));
  }, [scoped, rangeHours]);

  const totals = {
    all: scoped.length,
    high: scoped.filter((l) => severityOf(classify(l.action)) === 'high').length,
    candidates: byCandidate.length,
    autoSubmits: scoped.filter((l) => classify(l.action) === 'AUTO_SUBMIT').length,
  };

  const exportCsv = () => {
    const headers = ['timestamp', 'candidate', 'category', 'severity', 'action', 'reason'];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = scoped.map((l) => {
      const cat = classify(l.action);
      return [l.timestamp, l.userName, cat, severityOf(cat), l.action, l.reason].map(esc).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exam-violations-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 800);
  };

  return (
    <div className="space-y-6 animate-fade-in text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-rose-600" />
          Exam Monitoring &amp; Violations
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold cursor-pointer">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={exportCsv} disabled={!scoped.length} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold cursor-pointer">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total events" value={totals.all} icon={<Activity className="w-4 h-4 text-cyan-500" />} accent="text-slate-900" />
        <Kpi label="High severity" value={totals.high} icon={<AlertTriangle className="w-4 h-4 text-rose-500" />} accent="text-rose-600" />
        <Kpi label="Candidates flagged" value={totals.candidates} icon={<UsersIcon className="w-4 h-4 text-amber-500" />} accent="text-amber-600" />
        <Kpi label="Forced auto-submits" value={totals.autoSubmits} icon={<Ban className="w-4 h-4 text-purple-500" />} accent="text-purple-600" />
      </div>

      {/* Filter bar */}
      <div className="bg-white border rounded-2xl p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search candidate email, action, reason…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-cyan-400 outline-none text-xs"
          />
        </div>
        <SelectPill icon={<Filter className="w-3 h-3" />} value={categoryFilter} onChange={setCategoryFilter}
          options={[{ v: 'all', l: 'All categories' }, ...VIOLATION_PATTERNS.map((p) => ({ v: p.key, l: p.label }))]} />
        <SelectPill icon={<AlertTriangle className="w-3 h-3" />} value={severityFilter} onChange={setSeverityFilter}
          options={[{ v: 'all', l: 'All severities' }, { v: 'high', l: 'High' }, { v: 'medium', l: 'Medium' }, { v: 'low', l: 'Low' }]} />
        <SelectPill icon={<Clock className="w-3 h-3" />} value={String(rangeHours)} onChange={(v) => setRangeHours(Number(v))}
          options={[{ v: '1', l: 'Last 1h' }, { v: '24', l: 'Last 24h' }, { v: '168', l: 'Last 7d' }, { v: '720', l: 'Last 30d' }, { v: '99999', l: 'All time' }]} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border rounded-2xl p-4 shadow-sm">
          <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest mb-3">Violation timeline</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeline} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" fontSize={10} stroke="#64748b" />
                <YAxis fontSize={10} stroke="#64748b" allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Line type="monotone" dataKey="count" stroke="#e11d48" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest mb-3">By category</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={80} label={(e) => e.value}>
                  {byCategory.map((r) => (<Cell key={r.key} fill={r.color} />))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top offenders */}
      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest mb-3">Top flagged candidates</h3>
        {byCandidate.length === 0 ? (
          <p className="text-center text-slate-400 py-6">No violations in this window. 🎉</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCandidate.slice(0, 10)} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" fontSize={10} stroke="#64748b" allowDecimals={false} />
                <YAxis type="category" dataKey="email" fontSize={9} stroke="#64748b" width={140} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="total" fill="#0891b2" name="Events" radius={[0, 4, 4, 0]} />
                <Bar dataKey="high" fill="#e11d48" name="High-sev" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Events table */}
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <h3 className="font-extrabold text-slate-900 text-sm">Event log ({scoped.length})</h3>
        </div>
        <div className="max-h-[60vh] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[9px] text-slate-500 uppercase sticky top-0">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Candidate</th>
                <th className="p-3">Category</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Detail</th>
                <th className="p-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150">
              {scoped.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">{loading ? 'Loading…' : 'No matching events.'}</td></tr>
              ) : scoped.map((l) => {
                const cat = classify(l.action);
                const sev = severityOf(cat);
                const pat = VIOLATION_PATTERNS.find((p) => p.key === cat);
                const isOpen = expanded === l.id;
                return (
                  <React.Fragment key={l.id}>
                    <tr className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setExpanded(isOpen ? null : l.id)}>
                      <td className="p-3 font-mono text-[10px] text-slate-500 whitespace-nowrap">{l.timestamp.slice(0, 16).replace('T', ' ')}</td>
                      <td className="p-3 break-all font-semibold text-slate-800">{l.userName}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border" style={{ borderColor: `${pat?.color}40`, background: `${pat?.color}14`, color: pat?.color }}>
                          {pat?.label || 'Other'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border uppercase ${sevBadge[sev]}`}>{sev}</span>
                      </td>
                      <td className="p-3 text-slate-600 break-words max-w-md">{l.action}</td>
                      <td className="p-3"><Eye className={`w-3.5 h-3.5 ${isOpen ? 'text-cyan-600' : 'text-slate-300'}`} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={6} className="p-3 font-mono text-[10px] text-slate-600 whitespace-pre-wrap break-all">
                          <div><span className="text-slate-400">reason:</span> {l.reason || '—'}</div>
                          {l.newValue && <div className="mt-1"><span className="text-slate-400">payload:</span> {l.newValue}</div>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white p-4 border border-slate-200 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-mono font-bold text-slate-400 tracking-widest">{label}</span>
        {icon}
      </div>
      <strong className={`text-2xl font-black block mt-2 ${accent}`}>{value}</strong>
    </div>
  );
}

function SelectPill({ icon, value, onChange, options }: { icon: React.ReactNode; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer">
      {icon}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none cursor-pointer text-xs">
        {options.map((o) => (<option key={o.v} value={o.v}>{o.l}</option>))}
      </select>
    </label>
  );
}