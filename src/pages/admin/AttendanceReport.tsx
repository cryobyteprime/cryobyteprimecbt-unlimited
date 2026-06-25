import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText, BarChart3, Users, ChevronDown, ChevronRight, Download,
  Flag, Trophy, X, Calendar
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { AttSession, AttRecord, Student, AdminRole, Result } from '../../types';
import { DB } from '../../lib/database';
import { naturalSort, getStanding, calculateStreak } from '../../lib/attendanceUtils';

interface AttendanceReportProps {
  adminRole: AdminRole;
  adminEmail: string;
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
}

export default function AttendanceReport({ adminRole, adminEmail, triggerAuditLog }: AttendanceReportProps) {
  const [sessions, setSessions] = useState<AttSession[]>([]);
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);

  const getDefaultFrom = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  };

  const [filterClass, setFilterClass] = useState<'All' | 'Class A' | 'Class B'>('All');
  const [filterDateFrom, setFilterDateFrom] = useState(getDefaultFrom);
  const [filterDateTo, setFilterDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'comparison'>('overview');

  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [sessionRecordsCache, setSessionRecordsCache] = useState<Record<string, AttRecord[]>>({});

  const [studentSort, setStudentSort] = useState<{ col: string; order: 'asc' | 'desc' }>({ col: 'classSN', order: 'asc' });
  const [flaggedEmails, setFlaggedEmails] = useState<Set<string>>(new Set());

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [sess, recs, studs, res] = await Promise.all([
        DB.getAttSessions(),
        DB.getAttRecords(),
        DB.getStudents(),
        DB.getResults()
      ]);
      setSessions(sess);
      setRecords(recs);
      setStudents(studs);
      setResults(res);
      setLoading(false);
    })();
  }, []);

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const matchClass = filterClass === 'All' || s.class === filterClass || s.class === 'Joint';
      const matchFrom = !filterDateFrom || s.date >= filterDateFrom;
      const matchTo = !filterDateTo || s.date <= filterDateTo;
      return matchClass && matchFrom && matchTo;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [sessions, filterClass, filterDateFrom, filterDateTo]);

  const summaryStats = useMemo(() => {
    const ids = new Set(filteredSessions.map(s => s.id));
    const filtRecs = records.filter(r => ids.has(r.sessionId));
    const n = filtRecs.length;
    const present = filtRecs.filter(r => r.status === 'present').length;
    const late = filtRecs.filter(r => r.status === 'late').length;
    const absent = filtRecs.filter(r => r.status === 'absent').length;
    return {
      total: filteredSessions.length,
      avgPresent: n > 0 ? Math.round((present / n) * 100) : 0,
      avgLate: n > 0 ? Math.round((late / n) * 100) : 0,
      avgAbsent: n > 0 ? Math.round((absent / n) * 100) : 0
    };
  }, [filteredSessions, records]);

  const toggleSession = useCallback((id: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!sessionRecordsCache[id]) {
          const recs = records
            .filter(r => r.sessionId === id)
            .sort((a, b) => naturalSort(a.classSN, b.classSN));
          setSessionRecordsCache(c => ({ ...c, [id]: recs }));
        }
      }
      return next;
    });
  }, [records, sessionRecordsCache]);

  const filteredStudents = useMemo(() => {
    if (filterClass === 'All') return students;
    return students.filter(s => s.class === filterClass);
  }, [students, filterClass]);

  const sessionIds = useMemo(() => new Set(filteredSessions.map(s => s.id)), [filteredSessions]);

  const studentStats = useMemo(() => {
    return filteredStudents.map(student => {
      const recs = records.filter(r =>
        r.email.toLowerCase() === student.email.toLowerCase() && sessionIds.has(r.sessionId)
      );
      const total = recs.length;
      const present = recs.filter(r => r.status === 'present').length;
      const late = recs.filter(r => r.status === 'late').length;
      const absent = recs.filter(r => r.status === 'absent').length;
      const presentPct = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
      const latePct = total > 0 ? Math.round((late / total) * 100) : 0;
      const absentPct = total > 0 ? Math.round((absent / total) * 100) : 0;
      const streak = calculateStreak(student.email, recs);
      const standing = getStanding(presentPct);
      return { student, total, present, late, absent, presentPct, latePct, absentPct, streak, standing, recs };
    });
  }, [filteredStudents, sessionIds, records]);

  const sortedStudentStats = useMemo(() => {
    return [...studentStats].sort((a, b) => {
      const mod = studentSort.order === 'asc' ? 1 : -1;
      switch (studentSort.col) {
        case 'classSN': return naturalSort(a.student.classSN, b.student.classSN) * mod;
        case 'name': return a.student.name.localeCompare(b.student.name) * mod;
        case 'class': return a.student.class.localeCompare(b.student.class) * mod;
        case 'total': return (a.total - b.total) * mod;
        case 'present': return (a.present - b.present) * mod;
        case 'late': return (a.late - b.late) * mod;
        case 'absent': return (a.absent - b.absent) * mod;
        case 'presentPct': return (a.presentPct - b.presentPct) * mod;
        case 'streak': return (a.streak - b.streak) * mod;
        default: return naturalSort(a.student.classSN, b.student.classSN) * mod;
      }
    });
  }, [studentStats, studentSort]);

  const triggerSort = (col: string) => {
    setStudentSort(prev => ({ col, order: prev.col === col ? (prev.order === 'asc' ? 'desc' : 'asc') : 'asc' }));
  };

  const classCompData = useMemo(() => {
    const makeData = (cls: 'Class A' | 'Class B') => {
      const classSessions = sessions
        .filter(s => s.class === cls || s.class === 'Joint')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .reverse();
      const classStudents = students.filter(s => s.class === cls);
      const totalStudents = classStudents.length;
      const trend = classSessions.map(sess => {
        const sessRecs = records.filter(r => r.sessionId === sess.id && r.class === cls);
        const attended = sessRecs.filter(r => r.status === 'present' || r.status === 'late').length;
        const pct = totalStudents > 0 ? Math.round((attended / totalStudents) * 100) : 0;
        return { date: sess.date.slice(5), pct };
      });
      const filtIds = new Set(filteredSessions.filter(s => s.class === cls || s.class === 'Joint').map(s => s.id));
      const filtRecs = records.filter(r => filtIds.has(r.sessionId) && r.class === cls);
      const n = filtRecs.length;
      const avgPresent = n > 0 ? Math.round((filtRecs.filter(r => r.status === 'present').length / n) * 100) : 0;
      const avgLate = n > 0 ? Math.round((filtRecs.filter(r => r.status === 'late').length / n) * 100) : 0;
      const avgAbsent = n > 0 ? Math.round((filtRecs.filter(r => r.status === 'absent').length / n) * 100) : 0;
      return { cls, trend, avgPresent, avgLate, avgAbsent, avgAttendance: avgPresent + avgLate, count: totalStudents };
    };
    const classA = makeData('Class A');
    const classB = makeData('Class B');
    const winner = classA.avgAttendance > classB.avgAttendance ? 'Class A'
      : classB.avgAttendance > classA.avgAttendance ? 'Class B' : 'Tied';
    return { classA, classB, winner };
  }, [sessions, students, records, filteredSessions]);

  const downloadSessionCSV = (session: AttSession) => {
    const recs = sessionRecordsCache[session.id] ||
      records.filter(r => r.sessionId === session.id).sort((a, b) => naturalSort(a.classSN, b.classSN));
    let csv = 'Serial No,Name,Class,Status,Round\n';
    recs.forEach(r => {
      csv += `"${r.classSN}","${r.name}","${r.class}","${r.status}","${r.round || ''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${session.class.replace(' ', '-')}-${session.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSummaryCSV = () => {
    let csv = 'Serial No,Name,Class,Total,Present,Late,Absent,Attendance %,Late %,Absent %,Streak,Standing,Flagged\n';
    sortedStudentStats.forEach(({ student, total, present, late, absent, presentPct, latePct, absentPct, streak, standing }) => {
      csv += `"${student.classSN}","${student.name}","${student.class}",${total},${present},${late},${absent},${presentPct}%,${latePct}%,${absentPct}%,${streak},${standing},${flaggedEmails.has(student.email) ? 'Yes' : 'No'}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `students-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    triggerAuditLog('Exported student summary CSV', 'Attendance Report', null, null, 'Admin exported attendance summary');
  };

  const downloadDetailedCSV = () => {
    let csv = 'Name,Email,Serial No,Class,Session Date,Session Topic,Status\n';
    sortedStudentStats.forEach(({ student, recs }) => {
      recs.forEach(rec => {
        const sess = sessions.find(s => s.id === rec.sessionId);
        csv += `"${student.name}","${student.email}","${student.classSN}","${student.class}","${rec.date}","${sess?.topic || ''}","${rec.status}"\n`;
      });
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `students-detailed-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    triggerAuditLog('Exported detailed per-session CSV', 'Attendance Report', null, null, 'Admin exported detailed attendance records');
  };

  const studentModalData = useMemo(() => {
    if (!selectedStudent) return null;
    const allRecs = records.filter(r => r.email.toLowerCase() === selectedStudent.email.toLowerCase());
    const total = allRecs.length;
    const present = allRecs.filter(r => r.status === 'present').length;
    const late = allRecs.filter(r => r.status === 'late').length;
    const absent = allRecs.filter(r => r.status === 'absent').length;
    const presentPct = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
    const standing = getStanding(presentPct);
    const streak = calculateStreak(selectedStudent.email, allRecs);
    const last20 = [...allRecs].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
    const history = [...allRecs].sort((a, b) => b.date.localeCompare(a.date));
    return { total, present, late, absent, presentPct, standing, streak, last20, history };
  }, [selectedStudent, records]);

  if (loading) {
    return <div className="py-24 text-center text-slate-400 font-mono text-xs animate-pulse">Loading attendance report data...</div>;
  }

  const SortTh = ({ col, label }: { col: string; label: string }) => (
    <th
      onClick={() => triggerSort(col)}
      className="p-3 font-mono text-[9px] text-slate-400 uppercase cursor-pointer hover:text-slate-600 select-none whitespace-nowrap"
    >
      {label} {studentSort.col === col ? (studentSort.order === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="space-y-5 animate-fade-in text-xs font-sans select-none">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
          <FileText className="w-6 h-6 text-cyan-600" />
          <span>Attendance Report</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Session breakdown, per-student standings, and class comparison charts.</p>
      </div>

      {/* FILTERS */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Class</label>
            <select
              value={filterClass}
              onChange={e => setFilterClass(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl focus:outline-none text-slate-700 font-semibold text-xs cursor-pointer"
            >
              <option value="All">All Classes</option>
              <option value="Class A">Class A</option>
              <option value="Class B">Class B</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Date From</label>
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl focus:outline-none text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Date To</label>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl focus:outline-none text-xs" />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilterClass('All');
                setFilterDateFrom(getDefaultFrom());
                setFilterDateTo(new Date().toISOString().slice(0, 10));
              }}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold text-xs cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Sessions', value: String(summaryStats.total), color: 'text-slate-900' },
          { label: 'Avg Present %', value: `${summaryStats.avgPresent}%`, color: 'text-green-600' },
          { label: 'Avg Late %', value: `${summaryStats.avgLate}%`, color: 'text-amber-600' },
          { label: 'Avg Absent %', value: `${summaryStats.avgAbsent}%`, color: 'text-rose-600' },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">{card.label}</p>
            <p className={`text-2xl font-black mt-1 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex border-b border-slate-200">
          {([
            { id: 'overview', label: 'Overview', icon: Calendar },
            { id: 'students', label: 'Per-Student', icon: Users },
            { id: 'comparison', label: 'Class Comparison', icon: BarChart3 },
          ] as const).map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-1.5 px-5 py-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-cyan-500 text-cyan-600 bg-cyan-50/40'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
            {filteredSessions.length === 0 ? (
              <div className="py-20 text-center text-slate-400">No sessions in selected range.</div>
            ) : filteredSessions.map(session => {
              const sessRecs = records.filter(r => r.sessionId === session.id);
              const total = sessRecs.length;
              const present = sessRecs.filter(r => r.status === 'present').length;
              const late = sessRecs.filter(r => r.status === 'late').length;
              const absent = sessRecs.filter(r => r.status === 'absent').length;
              const isExp = expandedSessions.has(session.id);
              const expRecs = sessionRecordsCache[session.id] || [];

              return (
                <div key={session.id}>
                  <div
                    className="p-4 hover:bg-slate-50/60 cursor-pointer"
                    onClick={() => toggleSession(session.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        {isExp
                          ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                        <span className="font-mono font-bold text-slate-600 shrink-0 text-[11px]">{session.date}</span>
                        {session.class === 'Class A'
                          ? <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-blue-50 text-blue-700 border border-blue-100 font-mono shrink-0">A</span>
                          : session.class === 'Class B'
                          ? <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-cyan-50 text-cyan-700 border border-cyan-100 font-mono shrink-0">B</span>
                          : <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-100 font-mono shrink-0">JT</span>}
                        <span className="font-semibold text-slate-800 truncate">{session.topic}</span>
                      </div>
                      <div className="flex items-center space-x-3 shrink-0">
                        <span className="hidden sm:flex items-center space-x-1 font-mono text-[10px]">
                          <span className="text-green-600 font-bold">{present}P</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-amber-600 font-bold">{late}L</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-rose-600 font-bold">{absent}A</span>
                        </span>
                        {total > 0 && (
                          <div className="hidden md:flex items-center space-x-1.5">
                            <div className="w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
                              <div className="bg-green-500 h-full" style={{ width: `${(present / total) * 100}%` }} />
                              <div className="bg-amber-400 h-full" style={{ width: `${(late / total) * 100}%` }} />
                              <div className="bg-rose-400 h-full" style={{ width: `${(absent / total) * 100}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 font-bold">
                              {Math.round(((present + late) / total) * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {isExp && (
                    <div className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                      {expRecs.length === 0 ? (
                        <p className="text-slate-400 text-center py-6 text-[11px]">No records saved for this session.</p>
                      ) : (
                        <>
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">{expRecs.length} records</span>
                            <button
                              onClick={e => { e.stopPropagation(); downloadSessionCSV(session); }}
                              className="flex items-center space-x-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              <span>Download CSV</span>
                            </button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-slate-200">
                                  <th className="p-2 text-left text-[10px] font-mono text-slate-400 uppercase">Serial</th>
                                  <th className="p-2 text-left text-[10px] font-mono text-slate-400 uppercase">Name</th>
                                  <th className="p-2 text-left text-[10px] font-mono text-slate-400 uppercase">Class</th>
                                  <th className="p-2 text-left text-[10px] font-mono text-slate-400 uppercase">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {expRecs.map(rec => (
                                  <tr key={rec.id} className="hover:bg-white">
                                    <td className="p-2 font-mono font-bold text-slate-700">{rec.classSN}</td>
                                    <td className="p-2 text-slate-800">{rec.name}</td>
                                    <td className="p-2 text-slate-500">{rec.class}</td>
                                    <td className="p-2">
                                      {rec.status === 'present' && <span className="px-1.5 py-0.5 bg-green-50 border border-green-100 text-green-700 font-bold text-[9px] rounded font-mono">Present</span>}
                                      {rec.status === 'late' && <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-100 text-amber-700 font-bold text-[9px] rounded font-mono">Late</span>}
                                      {rec.status === 'absent' && <span className="px-1.5 py-0.5 bg-rose-50 border border-rose-100 text-rose-700 font-bold text-[9px] rounded font-mono">Absent</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: PER-STUDENT */}
        {activeTab === 'students' && (
          <div>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs text-slate-500 font-semibold">{sortedStudentStats.length} students · click row to view history</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={downloadSummaryCSV}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Summary CSV</span>
                </button>
                <button
                  onClick={downloadDetailedCSV}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-50 border border-cyan-200 rounded-lg text-xs font-bold text-cyan-700 hover:bg-cyan-100 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Detailed CSV</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <SortTh col="classSN" label="Serial" />
                    <SortTh col="name" label="Name" />
                    <SortTh col="class" label="Class" />
                    <SortTh col="total" label="Total" />
                    <SortTh col="present" label="Present" />
                    <SortTh col="late" label="Late" />
                    <SortTh col="absent" label="Absent" />
                    <SortTh col="presentPct" label="Att %" />
                    <SortTh col="streak" label="Streak" />
                    <th className="p-3 font-mono text-[9px] text-slate-400 uppercase">Standing</th>
                    <th className="p-3 font-mono text-[9px] text-slate-400 uppercase">Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedStudentStats.length === 0 ? (
                    <tr><td colSpan={11} className="py-16 text-center text-slate-400">No student data.</td></tr>
                  ) : sortedStudentStats.map(({ student, total, present, late, absent, presentPct, streak, standing }) => (
                    <tr
                      key={student.id}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                      onClick={() => setSelectedStudent(student)}
                    >
                      <td className="p-3 font-mono font-black text-slate-900">{student.classSN}</td>
                      <td className="p-3 font-semibold text-slate-800 hover:text-cyan-600">{student.name}</td>
                      <td className="p-3">
                        {student.class === 'Class A'
                          ? <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-100 text-blue-700 rounded text-[9px] font-bold font-mono">A</span>
                          : <span className="px-1.5 py-0.5 bg-cyan-50 border border-cyan-100 text-cyan-700 rounded text-[9px] font-bold font-mono">B</span>}
                      </td>
                      <td className="p-3 font-mono text-slate-600">{total}</td>
                      <td className="p-3 font-mono text-green-600 font-bold">{present}</td>
                      <td className="p-3 font-mono text-amber-600 font-bold">{late}</td>
                      <td className="p-3 font-mono text-rose-600 font-bold">{absent}</td>
                      <td className="p-3">
                        <span className={`font-mono font-black ${presentPct >= 75 ? 'text-green-600' : presentPct >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {presentPct}%
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-cyan-600">
                        {streak > 0 ? `🔥${streak}` : '—'}
                      </td>
                      <td className="p-3">
                        {standing === 'good' && <span className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-100 text-emerald-700 font-bold text-[9px] rounded font-mono">Good</span>}
                        {standing === 'risk' && <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-100 text-amber-700 font-bold text-[9px] rounded font-mono">At Risk</span>}
                        {standing === 'poor' && <span className="px-1.5 py-0.5 bg-rose-50 border border-rose-100 text-rose-700 font-bold text-[9px] rounded font-mono">Poor</span>}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setFlaggedEmails(prev => {
                              const n = new Set(prev);
                              n.has(student.email) ? n.delete(student.email) : n.add(student.email);
                              return n;
                            });
                          }}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            flaggedEmails.has(student.email)
                              ? 'text-amber-500 bg-amber-50'
                              : 'text-slate-300 hover:text-amber-400'
                          }`}
                          title="Flag for Follow-up"
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: CLASS COMPARISON */}
        {activeTab === 'comparison' && (
          <div className="p-5 space-y-5">
            <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-100 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Head-to-Head (filtered period)</p>
                {classCompData.winner === 'Tied' ? (
                  <p className="font-black text-slate-800 text-sm mt-1">Both classes tied — equal attendance in this period.</p>
                ) : (
                  <p className="font-black text-slate-800 text-sm mt-1">
                    <span className="text-cyan-600">{classCompData.winner}</span> leads with{' '}
                    <span className="text-cyan-600 text-base">
                      {classCompData.winner === 'Class A' ? classCompData.classA.avgAttendance : classCompData.classB.avgAttendance}%
                    </span>{' '}
                    vs{' '}
                    <span className="text-slate-600">
                      {classCompData.winner === 'Class A' ? classCompData.classB.avgAttendance : classCompData.classA.avgAttendance}%
                    </span>{' '}
                    avg attendance
                  </p>
                )}
              </div>
              <Trophy className={`w-8 h-8 shrink-0 ${classCompData.winner !== 'Tied' ? 'text-amber-400' : 'text-slate-300'}`} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {[classCompData.classA, classCompData.classB].map(cls => (
                <div key={cls.cls} className="border border-slate-200 rounded-2xl overflow-hidden">
                  <div className={`p-3 border-b ${cls.cls === 'Class A' ? 'bg-blue-50 border-blue-100' : 'bg-cyan-50 border-cyan-100'}`}>
                    <h3 className={`font-black text-sm ${cls.cls === 'Class A' ? 'text-blue-700' : 'text-cyan-700'}`}>
                      {cls.cls} <span className="font-normal text-[10px] opacity-70">({cls.count} students)</span>
                    </h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { label: 'Present', val: cls.avgPresent, color: 'text-green-600' },
                        { label: 'Late', val: cls.avgLate, color: 'text-amber-600' },
                        { label: 'Absent', val: cls.avgAbsent, color: 'text-rose-600' },
                      ].map(s => (
                        <div key={s.label} className="bg-slate-50 border border-slate-100 rounded-xl py-2">
                          <p className="text-[9px] font-mono text-slate-400 uppercase">{s.label}</p>
                          <p className={`font-black text-lg mt-0.5 ${s.color}`}>{s.val}%</p>
                        </div>
                      ))}
                    </div>
                    {cls.trend.length > 0 ? (
                      <div>
                        <p className="text-[10px] font-mono text-slate-400 uppercase mb-2">Last {cls.trend.length} sessions — attendance %</p>
                        <ResponsiveContainer width="100%" height={130}>
                          <BarChart data={cls.trend} margin={{ top: 2, right: 2, left: -22, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#94a3b8' }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                            <Tooltip
                              contentStyle={{ fontSize: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '4px 8px' }}
                              formatter={(v: any) => [`${v}%`, 'Attendance']}
                            />
                            <Bar dataKey="pct" fill={cls.cls === 'Class A' ? '#3b82f6' : '#06b6d4'} radius={[3, 3, 0, 0]} maxBarSize={30} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-slate-400 text-center py-6 text-[10px]">No session data to chart yet.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* STUDENT DETAIL MODAL */}
      {selectedStudent && studentModalData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl border shadow-2xl max-w-lg w-full max-h-[88vh] overflow-hidden flex flex-col animate-zoom-in">
            <div className="bg-slate-50 border-b px-5 py-4 flex items-start justify-between shrink-0">
              <div className="space-y-1">
                <div className="flex items-center space-x-2 flex-wrap gap-1">
                  <span className="font-black text-slate-900 text-sm">{selectedStudent.name}</span>
                  {selectedStudent.class === 'Class A'
                    ? <span className="px-2 py-0.5 bg-blue-50 border border-blue-100 text-blue-700 text-[10px] font-bold rounded font-mono">Class A</span>
                    : <span className="px-2 py-0.5 bg-cyan-50 border border-cyan-100 text-cyan-700 text-[10px] font-bold rounded font-mono">Class B</span>}
                  <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-mono font-bold rounded">{selectedStudent.classSN}</span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">{selectedStudent.email}</p>
              </div>
              <button onClick={() => setSelectedStudent(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer mt-0.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto grow p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                {studentModalData.standing === 'good' && <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 font-black text-xs rounded-full font-mono">Good Standing (75%+)</span>}
                {studentModalData.standing === 'risk' && <span className="px-2.5 py-1 bg-amber-50 border border-amber-100 text-amber-700 font-black text-xs rounded-full font-mono">At Risk (50%+)</span>}
                {studentModalData.standing === 'poor' && <span className="px-2.5 py-1 bg-rose-50 border border-rose-100 text-rose-700 font-black text-xs rounded-full font-mono">Poor (&lt;50%)</span>}
                <span className="text-xs font-mono font-bold text-cyan-600">
                  {studentModalData.streak > 0 ? `🔥 ${studentModalData.streak} session streak` : 'No active streak'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Total', value: studentModalData.total, color: 'text-slate-900' },
                  { label: 'Present', value: studentModalData.present, color: 'text-green-600' },
                  { label: 'Late', value: studentModalData.late, color: 'text-amber-600' },
                  { label: 'Absent', value: studentModalData.absent, color: 'text-rose-600' },
                ].map(s => (
                  <div key={s.label} className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-center">
                    <p className="text-[9px] font-mono text-slate-400 uppercase">{s.label}</p>
                    <p className={`text-2xl font-black mt-0.5 ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-[10px] font-mono text-slate-400 uppercase mb-2">
                  Last {studentModalData.last20.length} Sessions (oldest → newest)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {studentModalData.last20.map((rec, i) => (
                    <div
                      key={rec.id || i}
                      className={`w-4 h-4 rounded-full ${
                        rec.status === 'present' ? 'bg-green-400' :
                        rec.status === 'late' ? 'bg-amber-400' : 'bg-rose-400'
                      }`}
                      title={`${rec.date}: ${rec.status}`}
                    />
                  ))}
                  {studentModalData.last20.length === 0 && <span className="text-slate-400 text-[11px]">No session records.</span>}
                </div>
                <div className="flex items-center space-x-3 mt-2 text-[9px] text-slate-400 font-mono">
                  <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /><span>Present</span></span>
                  <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /><span>Late</span></span>
                  <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /><span>Absent</span></span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center justify-between">
                <span className="font-semibold text-slate-600">Overall Attendance Rate</span>
                <span className={`font-black text-xl ${studentModalData.presentPct >= 75 ? 'text-green-600' : studentModalData.presentPct >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                  {studentModalData.presentPct}%
                </span>
              </div>

              <div>
                <p className="text-[10px] font-mono text-slate-400 uppercase mb-2">Session History</p>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {studentModalData.history.map(rec => {
                    const sess = sessions.find(s => s.id === rec.sessionId);
                    return (
                      <div key={rec.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                        <div>
                          <p className="font-semibold text-slate-800">{rec.date}</p>
                          <p className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]">{sess?.topic || '—'}</p>
                        </div>
                        <div>
                          {rec.status === 'present' && <span className="px-2 py-0.5 bg-green-50 border border-green-100 text-green-700 font-bold text-[9px] rounded-full font-mono">Present R1</span>}
                          {rec.status === 'late' && <span className="px-2 py-0.5 bg-amber-50 border border-amber-100 text-amber-700 font-bold text-[9px] rounded-full font-mono">Late R2</span>}
                          {rec.status === 'absent' && <span className="px-2 py-0.5 bg-rose-50 border border-rose-100 text-rose-700 font-bold text-[9px] rounded-full font-mono">Absent</span>}
                        </div>
                      </div>
                    );
                  })}
                  {studentModalData.history.length === 0 && (
                    <p className="text-slate-400 text-center py-6 text-xs">No records for this student.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border-t p-4 flex justify-end shrink-0">
              <button onClick={() => setSelectedStudent(null)} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold cursor-pointer">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
