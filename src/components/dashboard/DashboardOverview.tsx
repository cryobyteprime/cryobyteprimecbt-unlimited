import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, Calendar, CheckCircle2, Activity, Trophy, ShieldAlert,
  TrendingUp, BookOpen, ArrowUpRight,
} from 'lucide-react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
  RadialBarChart, RadialBar,
} from 'recharts';
import { DB } from '../../lib/database';
import { Student, AttSession, AttRecord, Result, SystemConfig, AuditLog } from '../../types';

interface Props {
  students: Student[];
  attSessions: AttSession[];
  attRecords: AttRecord[];
  examResults: Result[];
  sysConfig: SystemConfig | null;
  openSessions: AttSession[];
  onNavigate: (page: string) => void;
}

const CLASS_COLORS: Record<string, string> = {
  'Class A': '#06b6d4',
  'Class B': '#8b5cf6',
  Joint: '#f59e0b',
};

function pct(n: number, d: number) { return d > 0 ? Math.round((n / d) * 100) : 0; }

export default function DashboardOverview({
  students, attSessions, attRecords, examResults, sysConfig, openSessions, onNavigate,
}: Props) {
  const [violations, setViolations] = useState<AuditLog[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const logs = await DB.getAuditLogs();
        if (!alive) return;
        setViolations(logs.filter((l) => l.page === 'student-cbt' && /VIOLATION|MALPRACTICE|SCREENSHOT|FULLSCREEN|COPY|PASTE|RIGHT_CLICK|auto_submit|LOGIN_BLOCKED/i.test(l.action || '')));
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  // ── Attendance trend (last 14 sessions by date) ─────────────────────
  const attendanceTrend = useMemo(() => {
    const byDate = new Map<string, { date: string; present: number; late: number; absent: number }>();
    const dates = [...new Set(attSessions.map((s) => s.date))].sort().slice(-14);
    for (const d of dates) byDate.set(d, { date: d.slice(5), present: 0, late: 0, absent: 0 });
    for (const r of attRecords) {
      const key = r.date;
      const row = byDate.get(key);
      if (!row) continue;
      if (r.status === 'present') row.present += 1;
      else if (r.status === 'late') row.late += 1;
      else row.absent += 1;
    }
    return Array.from(byDate.values());
  }, [attSessions, attRecords]);

  // ── Class distribution ──────────────────────────────────────────────
  const classDist = useMemo(() => {
    const m = new Map<string, number>();
    students.forEach((s) => m.set(s.class, (m.get(s.class) || 0) + 1));
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [students]);

  // ── Score distribution buckets ──────────────────────────────────────
  const scoreBuckets = useMemo(() => {
    const buckets = [
      { range: '0-40', from: 0, to: 40, count: 0, color: '#ef4444' },
      { range: '40-60', from: 40, to: 60, count: 0, color: '#f97316' },
      { range: '60-75', from: 60, to: 75, count: 0, color: '#f59e0b' },
      { range: '75-90', from: 75, to: 90, count: 0, color: '#10b981' },
      { range: '90-100', from: 90, to: 101, count: 0, color: '#059669' },
    ];
    for (const r of examResults) {
      const p = r.percentage;
      const b = buckets.find((x) => p >= x.from && p < x.to);
      if (b) b.count += 1;
    }
    return buckets;
  }, [examResults]);

  // ── Avg score by class ──────────────────────────────────────────────
  const scoreByClass = useMemo(() => {
    const g = new Map<string, { sum: number; n: number }>();
    for (const r of examResults) {
      const k = r.class || 'Unassigned';
      const row = g.get(k) || { sum: 0, n: 0 };
      row.sum += r.percentage; row.n += 1;
      g.set(k, row);
    }
    return Array.from(g.entries()).map(([name, v]) => ({ name, avg: Math.round(v.sum / v.n), count: v.n }));
  }, [examResults]);

  // ── KPIs ────────────────────────────────────────────────────────────
  const totalMarked = attRecords.filter((r) => r.status === 'present' || r.status === 'late').length;
  const totalPossible = students.length * attSessions.length;
  const avgAttendance = pct(totalMarked, totalPossible);
  const passRate = pct(examResults.filter((r) => r.percentage >= 50).length, examResults.length);
  const avgScore = examResults.length ? Math.round(examResults.reduce((a, r) => a + r.percentage, 0) / examResults.length) : 0;

  const gaugeData = [
    { name: 'Attendance', value: avgAttendance, fill: '#06b6d4' },
    { name: 'Pass rate', value: passRate, fill: '#10b981' },
    { name: 'Avg score', value: avgScore, fill: '#8b5cf6' },
  ];

  const topPerformers = useMemo(
    () => [...examResults].sort((a, b) => b.percentage - a.percentage).slice(0, 5),
    [examResults],
  );

  const recentViolations = useMemo(() => violations.slice(0, 6), [violations]);

  return (
    <div className="space-y-6 animate-fade-in text-xs">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white p-6 shadow-xl">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_20%,#06b6d4_0%,transparent_40%),radial-gradient(circle_at_80%_80%,#8b5cf6_0%,transparent_40%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-cyan-300">Operations Dashboard</p>
            <h1 className="text-2xl font-black mt-1">Welcome back, Administrator</h1>
            <p className="text-slate-300 text-xs mt-1">Live view of attendance, assessments, and integrity signals.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold border ${sysConfig?.examActivated ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-slate-700/40 border-slate-600 text-slate-300'}`}>
              <span className={`w-2 h-2 rounded-full ${sysConfig?.examActivated ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              CBT Gate {sysConfig?.examActivated ? 'OPEN' : 'closed'}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Roster enrolled" value={students.length} icon={<Users className="w-4 h-4" />} tint="cyan" trend={`${classDist.length} classes`} onClick={() => onNavigate('students')} />
        <KpiCard label="Sessions held" value={attSessions.length} icon={<Calendar className="w-4 h-4" />} tint="violet" trend={`${openSessions.length} open now`} onClick={() => onNavigate('attendance')} />
        <KpiCard label="Attendance ratio" value={`${avgAttendance}%`} icon={<CheckCircle2 className="w-4 h-4" />} tint={avgAttendance >= 75 ? 'emerald' : 'amber'} trend={`${totalMarked} of ${totalPossible} slots`} onClick={() => onNavigate('report')} />
        <KpiCard label="Exam submissions" value={examResults.length} icon={<BookOpen className="w-4 h-4" />} tint="amber" trend={`Avg ${avgScore}% · Pass ${passRate}%`} onClick={() => onNavigate('results')} />
      </div>

      {/* Attendance trend + Class distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest">Attendance trend (last 14 sessions)</h3>
            <TrendingUp className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={attendanceTrend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gPresent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" fontSize={10} stroke="#64748b" />
                <YAxis fontSize={10} stroke="#64748b" allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Area type="monotone" dataKey="present" stroke="#10b981" fill="url(#gPresent)" strokeWidth={2} />
                <Area type="monotone" dataKey="late" stroke="#f59e0b" fill="url(#gLate)" strokeWidth={2} />
                <Area type="monotone" dataKey="absent" stroke="#ef4444" fill="none" strokeWidth={2} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest mb-3">Roster by class</h3>
          <div className="h-64">
            {classDist.length === 0 ? (
              <p className="h-full flex items-center justify-center text-slate-400">No students yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={classDist} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={3} label={(e) => `${e.name}: ${e.value}`}>
                    {classDist.map((d) => (<Cell key={d.name} fill={CLASS_COLORS[d.name] || '#64748b'} />))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Score buckets + gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border rounded-2xl p-4 shadow-sm">
          <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest mb-3">Exam score distribution</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreBuckets} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="range" fontSize={10} stroke="#64748b" />
                <YAxis fontSize={10} stroke="#64748b" allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {scoreBuckets.map((b) => (<Cell key={b.range} fill={b.color} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {scoreByClass.length > 0 && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
              {scoreByClass.map((c) => (
                <div key={c.name} className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{c.name}</p>
                  <p className="text-lg font-black text-slate-900 mt-1">{c.avg}<span className="text-xs text-slate-400 font-bold">% avg</span></p>
                  <p className="text-[10px] text-slate-500 font-mono">{c.count} submissions</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest mb-3">Performance gauges</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius="30%" outerRadius="100%" data={gaugeData} startAngle={90} endAngle={-270}>
                <RadialBar background dataKey="value" cornerRadius={8} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom row: Top performers, Recent violations, Open sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest">Top performers</h3>
            <button onClick={() => onNavigate('leaderboard')} className="text-[10px] text-cyan-600 hover:text-cyan-700 font-bold flex items-center gap-1 cursor-pointer">See all <ArrowUpRight className="w-3 h-3" /></button>
          </div>
          {topPerformers.length === 0 ? (
            <p className="text-slate-400 py-6 text-center">No results yet.</p>
          ) : (
            <ul className="space-y-2">
              {topPerformers.map((r, i) => (
                <li key={r.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
                      {i === 0 ? <Trophy className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{r.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{r.classSN} · {r.class}</p>
                    </div>
                  </div>
                  <span className="font-black text-cyan-600 text-sm">{r.percentage}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> Recent violations</h3>
            <button onClick={() => onNavigate('monitoring')} className="text-[10px] text-cyan-600 hover:text-cyan-700 font-bold flex items-center gap-1 cursor-pointer">Open monitor <ArrowUpRight className="w-3 h-3" /></button>
          </div>
          {recentViolations.length === 0 ? (
            <p className="text-slate-400 py-6 text-center">All clear. No integrity events. 🛡️</p>
          ) : (
            <ul className="space-y-2">
              {recentViolations.map((v) => (
                <li key={v.id} className="p-2.5 rounded-xl border border-rose-100 bg-rose-50/50">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800 truncate text-[11px]">{v.userName}</p>
                    <span className="text-[9px] text-slate-400 font-mono whitespace-nowrap">{v.timestamp.slice(5, 16).replace('T', ' ')}</span>
                  </div>
                  <p className="text-[10px] text-rose-700 mt-0.5 truncate">{v.action}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] uppercase font-mono font-bold text-slate-500 tracking-widest flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-emerald-500" /> Active check-ins</h3>
            <button onClick={() => onNavigate('attendance')} className="text-[10px] text-cyan-600 hover:text-cyan-700 font-bold flex items-center gap-1 cursor-pointer">Manage <ArrowUpRight className="w-3 h-3" /></button>
          </div>
          {openSessions.length === 0 ? (
            <p className="text-slate-400 py-6 text-center">No open sessions right now.</p>
          ) : (
            <ul className="space-y-2">
              {openSessions.slice(0, 4).map((s) => (
                <li key={s.id} className="p-2.5 rounded-xl border border-emerald-100 bg-emerald-50/40">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900 truncate">{s.topic}</p>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">Open</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">{s.class} · {s.date} · R1 {s.round1Serials?.length || 0} / R2 {s.round2Serials?.length || 0}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, tint, trend, onClick }: { label: string; value: React.ReactNode; icon: React.ReactNode; tint: 'cyan' | 'violet' | 'emerald' | 'amber'; trend?: string; onClick?: () => void }) {
  const tints: Record<string, { bg: string; text: string; ring: string }> = {
    cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600', ring: 'ring-cyan-100' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
  };
  const t = tints[tint];
  return (
    <button onClick={onClick} className="text-left bg-white p-4 border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-mono font-bold text-slate-400 tracking-widest">{label}</span>
        <div className={`w-7 h-7 rounded-xl ${t.bg} ${t.text} ring-1 ${t.ring} flex items-center justify-center`}>{icon}</div>
      </div>
      <strong className="text-2xl font-black block mt-2 text-slate-900">{value}</strong>
      {trend && <p className="text-[10px] text-slate-500 font-mono mt-1 truncate">{trend}</p>}
    </button>
  );
}