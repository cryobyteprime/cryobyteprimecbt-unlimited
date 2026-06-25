import React, { useMemo, useState } from 'react';
import { Trophy, Medal, Award } from 'lucide-react';
import { Student, AttSession, AttRecord, Result } from '../../types';

interface Props {
  students: Student[];
  attSessions: AttSession[];
  attRecords: AttRecord[];
  examResults: Result[];
}

interface Row {
  email: string;
  name: string;
  class: string;
  classSN: string;
  attendancePct: number;
  attendedSessions: number;
  totalSessions: number;
  avgExamPct: number;
  examsTaken: number;
  composite: number; // 0-100
}

export default function Leaderboard({ students, attSessions, attRecords, examResults }: Props) {
  const [classFilter, setClassFilter] = useState<string>('all');
  // 60% exams, 40% attendance (tweakable)
  const [examWeight, setExamWeight] = useState(60);

  const classes = useMemo(
    () => Array.from(new Set(students.map((s) => s.class))).sort(),
    [students],
  );

  const rows: Row[] = useMemo(() => {
    const attWeight = 100 - examWeight;
    return students
      .filter((s) => classFilter === 'all' || s.class === classFilter)
      .map((s): Row => {
        const classSessions = attSessions.filter((sess) => sess.class === s.class);
        const totalSessions = classSessions.length;
        const sessionIds = new Set(classSessions.map((c) => c.id));
        const present = attRecords.filter(
          (r) => r.email === s.email && sessionIds.has(r.sessionId) && r.status === 'present',
        );
        // Count distinct sessions where student was marked present
        const attendedSessions = new Set(present.map((r) => r.sessionId)).size;
        const attendancePct = totalSessions > 0 ? Math.round((attendedSessions / totalSessions) * 100) : 0;

        const myResults = examResults.filter((r) => r.email === s.email);
        const examsTaken = myResults.length;
        const avgExamPct = examsTaken > 0
          ? Math.round(myResults.reduce((sum, r) => sum + (r.percentage || 0), 0) / examsTaken)
          : 0;

        const composite = Math.round((avgExamPct * examWeight + attendancePct * attWeight) / 100);

        return {
          email: s.email,
          name: s.name,
          class: s.class,
          classSN: s.classSN,
          attendancePct,
          attendedSessions,
          totalSessions,
          avgExamPct,
          examsTaken,
          composite,
        };
      })
      .sort((a, b) => b.composite - a.composite || b.avgExamPct - a.avgExamPct || b.attendancePct - a.attendancePct);
  }, [students, attSessions, attRecords, examResults, classFilter, examWeight]);

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  const rankIcon = (i: number) => {
    if (i === 0) return <Trophy className="w-5 h-5 text-amber-500" />;
    if (i === 1) return <Medal className="w-5 h-5 text-slate-400" />;
    if (i === 2) return <Award className="w-5 h-5 text-amber-700" />;
    return <span className="text-slate-500 font-mono text-xs">#{i + 1}</span>;
  };

  return (
    <div className="space-y-6 animate-fade-in text-xs">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            <span>Top Performers</span>
          </h2>
          <p className="text-slate-500 mt-1">Ranked by a blend of attendance and exam scores.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs font-semibold"
          >
            <option value="all">All classes</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <label className="flex items-center justify-between text-[10px] uppercase font-mono font-bold text-slate-500 tracking-wider">
          <span>Score weighting · Exams {examWeight}% · Attendance {100 - examWeight}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={examWeight}
          onChange={(e) => setExamWeight(Number(e.target.value))}
          className="w-full mt-2 accent-cyan-600"
        />
      </div>

      {/* Podium */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {top3.map((r, i) => (
          <div
            key={r.email}
            className={`p-4 rounded-2xl border shadow-sm ${
              i === 0 ? 'bg-amber-50 border-amber-200'
              : i === 1 ? 'bg-slate-50 border-slate-200'
              : 'bg-orange-50/50 border-orange-200'
            }`}
          >
            <div className="flex items-center justify-between">
              {rankIcon(i)}
              <span className="text-[10px] font-mono text-slate-500">{r.class} · {r.classSN}</span>
            </div>
            <h3 className="font-extrabold text-slate-900 mt-2 text-sm break-words">{r.name}</h3>
            <p className="text-[10px] text-slate-500 font-mono break-all">{r.email}</p>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-3xl font-black text-cyan-600 font-mono">{r.composite}</span>
              <div className="text-right text-[10px] text-slate-500 font-mono leading-tight">
                <div>Exams: <strong className="text-slate-900">{r.avgExamPct}%</strong> ({r.examsTaken})</div>
                <div>Attend: <strong className="text-slate-900">{r.attendancePct}%</strong> ({r.attendedSessions}/{r.totalSessions})</div>
              </div>
            </div>
          </div>
        ))}
        {top3.length === 0 && (
          <div className="md:col-span-3 py-12 text-center text-slate-400 bg-white border rounded-2xl">
            No students match the current filter.
          </div>
        )}
      </div>

      {/* Full ranking */}
      {rest.length > 0 && (
        <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
          <div className="max-h-[55vh] overflow-y-auto overflow-x-auto mobile-scroll-x">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[9px] text-slate-500 uppercase sticky top-0">
                <tr>
                  <th className="p-3 w-14">Rank</th>
                  <th className="p-3">Student</th>
                  <th className="p-3">Class</th>
                  <th className="p-3 text-center">Attendance</th>
                  <th className="p-3 text-center">Exam Avg</th>
                  <th className="p-3 text-center">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150">
                {rest.map((r, idx) => (
                  <tr key={r.email} className="hover:bg-slate-50/70">
                    <td className="p-3 font-mono text-slate-500">#{idx + 4}</td>
                    <td className="p-3">
                      <p className="font-bold text-slate-900 leading-tight break-words">{r.name}</p>
                      <p className="text-[10px] text-slate-450 font-mono mt-0.5 break-all">{r.email}</p>
                    </td>
                    <td className="p-3 whitespace-nowrap">{r.class} · {r.classSN}</td>
                    <td className="p-3 text-center font-mono whitespace-nowrap">
                      <span className={r.attendancePct >= 75 ? 'text-green-600 font-bold' : 'text-amber-600'}>
                        {r.attendancePct}%
                      </span>
                      <span className="text-slate-400 text-[10px]"> ({r.attendedSessions}/{r.totalSessions})</span>
                    </td>
                    <td className="p-3 text-center font-mono whitespace-nowrap">
                      <span className={r.avgExamPct >= 50 ? 'text-green-600 font-bold' : 'text-rose-600'}>
                        {r.avgExamPct}%
                      </span>
                      <span className="text-slate-400 text-[10px]"> ({r.examsTaken})</span>
                    </td>
                    <td className="p-3 text-center font-mono font-black text-cyan-600 whitespace-nowrap">{r.composite}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
