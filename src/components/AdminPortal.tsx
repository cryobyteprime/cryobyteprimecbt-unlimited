import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Layers, Lock, Download, Upload, Trash2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { DB } from '../lib/database';
import { Student, AttSession, AttRecord, AttEditRequest, Result, SystemConfig } from '../types';
import { useAuth, roleToLegacyAdminRole, permissions, type AppRole } from '../lib/auth';

import Students from '../pages/admin/Students';
import Attendance from '../pages/admin/Attendance';
import AttendanceReport from '../pages/admin/AttendanceReport';
import AttendanceEditRequests from '../pages/admin/AttendanceEditRequests';
import Exams from '../pages/admin/Exams';
import Approvals from '../pages/admin/Approvals';
import DriveSync from '../pages/admin/DriveSync';
import Users from '../pages/admin/Users';
import Leaderboard from '../pages/admin/Leaderboard';
import ExamMonitoring from '../pages/admin/ExamMonitoring';
import DashboardOverview from './dashboard/DashboardOverview';
import AdminHeader from './AdminHeader';
import WipeDataButton from './WipeDataButton';
import { confirmAction, confirmActionBool } from './confirmAction';

export default function AdminPortal() {
  const navigate = useNavigate();
  const { user, roles, loading: authLoading, signOut } = useAuth();

  const [currentAdminPage, setCurrentAdminPage] = useState<string>('dashboard');

  const [students, setStudents] = useState<Student[]>([]);
  const [attSessions, setAttSessions] = useState<AttSession[]>([]);
  const [attRecords, setAttRecords] = useState<AttRecord[]>([]);
  const [editRequests, setEditRequests] = useState<AttEditRequest[]>([]);
  const [examResults, setExamResults] = useState<Result[]>([]);
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);
  const [pendingDeletionsCount, setPendingDeletionsCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [resultsClassFilter, setResultsClassFilter] = useState<string>('all');
  const [importingResults, setImportingResults] = useState(false);
  const resultsImportInputRef = useRef<HTMLInputElement | null>(null);

  const filteredResults = useMemo(
    () =>
      resultsClassFilter === 'all'
        ? examResults
        : examResults.filter((r) => r.class === resultsClassFilter),
    [examResults, resultsClassFilter],
  );

  const resultClasses = useMemo(
    () => Array.from(new Set(examResults.map((r) => r.class).filter(Boolean))).sort(),
    [examResults],
  );

  const handleImportResultsFile = async (file: File) => {
    setImportingResults(true);
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      let rows: any[] = [];
      if (ext === 'json') {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : parsed?.results ?? [];
      } else if (ext === 'csv') {
        const res = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true });
        rows = res.data;
      } else {
        throw new Error('Unsupported file type. Use .csv or .json');
      }
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows found in file');

      const pick = (o: Record<string, any>, keys: string[]) => {
        for (const k of Object.keys(o)) {
          if (keys.includes(k.trim().toLowerCase())) return o[k];
        }
        return undefined;
      };

      let inserted = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as Record<string, any>;
        try {
          const email = String(pick(r, ['email']) ?? '').trim().toLowerCase();
          const classSN = String(pick(r, ['serial', 'classsn', 'class sn']) ?? '').trim().toUpperCase();
          const name = String(pick(r, ['name', 'candidate']) ?? '').trim();
          const cls = String(pick(r, ['class']) ?? '').trim();
          const score = Number(pick(r, ['score']) ?? 0);
          const total = Number(pick(r, ['total', 'totalquestions']) ?? 0);
          let pct = Number(pick(r, ['percentage', '%']) ?? NaN);
          if (!Number.isFinite(pct)) pct = total > 0 ? Math.round((score / total) * 100) : 0;
          const submittedAt = String(pick(r, ['submittedat', 'submitted']) ?? new Date().toISOString());
          const examSessionId = String(pick(r, ['examsessionid', 'sessionid']) ?? 'active-session');
          const answersRaw = pick(r, ['answers']);
          let answers: Record<string, string> = {};
          if (answersRaw) {
            try { answers = typeof answersRaw === 'string' ? JSON.parse(answersRaw) : answersRaw; }
            catch { answers = {}; }
          }
          if (!email || !classSN) { skipped++; continue; }
          const validClass = (cls === 'Class A' || cls === 'Class B') ? cls : 'Class A';
          await DB.addResult({
            email, name, class: validClass as any, classSN,
            examSessionId, score, percentage: pct, totalQuestions: total,
            answers, submittedAt,
            attemptId: 'imp_' + Math.random().toString(36).slice(2, 10),
          });
          inserted++;
        } catch (err: any) {
          errors.push(`Row ${i + 2}: ${err?.message ?? err}`);
        }
      }
      await triggerAuditLog(
        `Imported ${inserted} exam result(s) from "${file.name}"`,
        'results',
        undefined,
        { inserted, skipped, errors: errors.length, filename: file.name },
        'Bulk result import via CSV/JSON',
      );
      const fresh = await DB.getResults();
      setExamResults(fresh);
      alert(
        `Imported ${inserted} result(s).` +
          (skipped ? `\nSkipped ${skipped} row(s) with missing email/serial.` : '') +
          (errors.length ? `\n${errors.length} error(s):\n${errors.slice(0, 5).join('\n')}` : ''),
      );
    } catch (e: any) {
      alert(`Import failed: ${e?.message ?? e}`);
    } finally {
      setImportingResults(false);
      if (resultsImportInputRef.current) resultsImportInputRef.current.value = '';
    }
  };

  const buildResultsCsv = (rows: Result[]): string => {
    const headers = ['Serial', 'Name', 'Email', 'Class', 'Score', 'Total', 'Percentage', 'SubmittedAt', 'ExamSessionId', 'AttemptId'];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([r.classSN, r.name, r.email, r.class, r.score, r.totalQuestions, r.percentage, r.submittedAt, r.examSessionId, r.attemptId].map(esc).join(','));
    }
    return lines.join('\n');
  };

  const downloadResultsCsv = (rows: Result[], filename: string) => {
    if (!rows.length) return;
    const blob = new Blob([buildResultsCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 1000);
  };


  const adminEmail = user?.email || '';
  const adminRole = roleToLegacyAdminRole(roles);

  // Idle auto-logout (30 minutes)
  const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const lastActivityRef = useRef<number>(Date.now());
  useEffect(() => {
    const resetTimer = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);
    window.addEventListener('scroll', resetTimer);
    const idleCheck = setInterval(async () => {
      if (Date.now() - lastActivityRef.current >= ADMIN_IDLE_TIMEOUT_MS) {
        clearInterval(idleCheck);
        await signOut();
        navigate({ to: '/auth' });
      }
    }, 60_000);
    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('scroll', resetTimer);
      clearInterval(idleCheck);
    };
  }, [signOut, navigate]);

  const syncAdministrativeTables = async () => {
    setLoading(true);
    try {
      const studs = await DB.getStudents();
      const sess = await DB.getAttSessions();
      const recs = await DB.getAttRecords();
      const reqs = await DB.getAttEditReqs();
      const res = await DB.getResults();
      const conf = await DB.getConfig();
      const dels = await DB.getDeletionRequests();
      setStudents(studs);
      setAttSessions(sess);
      setAttRecords(recs);
      setEditRequests(reqs);
      setExamResults(res);
      setSysConfig(conf);
      setPendingDeletionsCount(dels.filter((r) => r.status === 'pending').length);
    } catch (e) {
      console.warn('Table synchronization exception:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncAdministrativeTables(); }, []);

  // Role-gated, no-PIN action runner — kept for sub-page compatibility.
  const triggerPasswordConfirm = (_actionLabel: string, callback: () => void) => {
    // Role is already enforced by route + UI gating; just run.
    callback();
  };

  const triggerAuditLog = async (
    action: string,
    page: string,
    originalValue?: any,
    newValue?: any,
    reason?: string,
  ) => {
    try {
      return await DB.addAuditLog({
        userName: adminEmail || 'unknown',
        userRole: adminRole,
        action,
        originalValue: originalValue ? JSON.stringify(originalValue) : undefined,
        newValue: newValue ? JSON.stringify(newValue) : undefined,
        reason: reason || 'Administrative dashboard action',
        page,
      });
    } catch (e) {
      console.warn('Audit logger exception bypass:', e);
    }
  };

  const handleAdminLogout = async () => {
    await triggerAuditLog('Administrator signed out', 'Administrative Logins');
    await signOut();
    navigate({ to: '/auth' });
  };

  const dashboardStats = useMemo(() => {
    const totalSCount = students.length;
    const totalSessCount = attSessions.length;
    let avgPct = 0;
    if (totalSCount > 0 && totalSessCount > 0) {
      const positiveCount = attRecords.filter((r) => r.status === 'present' || r.status === 'late').length;
      avgPct = Math.round((positiveCount / (totalSCount * totalSessCount)) * 100);
    }
    const openSessions = attSessions.filter((s) => s.status === 'open');
    const runningCBT = sysConfig?.examActivated || false;
    return { totalSCount, totalSessCount, avgPct, openSessions, runningCBT };
  }, [students, attSessions, attRecords, sysConfig]);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-mono text-xs">Loading…</div>;
  }

  // No role assigned → show contact-superadmin notice (auth is fine but user has no permissions).
  if (roles.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center space-y-4">
        <Lock className="w-12 h-12 text-amber-500" />
        <h1 className="text-xl font-bold text-slate-900">No role assigned</h1>
        <p className="text-sm text-slate-600 max-w-md">
          Your account exists but doesn't have a role yet. Ask a superadmin to assign you one.
        </p>
        <button onClick={handleAdminLogout} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold text-xs cursor-pointer">Sign out</button>
      </div>
    );
  }

  const canSeePage = (id: string): boolean => {
    switch (id) {
      case 'dashboard': return true;
      case 'attendance': return permissions.takeAttendance(roles);
      case 'report': return permissions.viewReports(roles);
      case 'edit-requests': return permissions.manageAttendance(roles);
      case 'students': return permissions.manageStudents(roles);
      case 'questionbank': return permissions.manageExams(roles);
      case 'results': return permissions.viewReports(roles);
      case 'leaderboard': return permissions.viewReports(roles);
      case 'monitoring': return permissions.viewReports(roles);
      case 'auditlog': return permissions.viewAuditLog(roles);
      case 'settings': return permissions.manageSettings(roles);
      case 'users': return permissions.manageUsers(roles);
      default: return false;
    }
  };

  // If somehow on a page the role can't see, fall back to dashboard
  const safePage = canSeePage(currentAdminPage) ? currentAdminPage : 'dashboard';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans select-none pb-12">
      <AdminHeader
        currentPage={safePage}
        onPageChange={setCurrentAdminPage}
        roles={roles as AppRole[]}
        pendingRequestsCount={editRequests.filter((r) => r.status === 'pending').length}
        pendingDeletionsCount={pendingDeletionsCount}
        adminEmail={adminEmail}
        onLogout={handleAdminLogout}
      />

      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {loading && (
          <div className="p-3 bg-zinc-900 text-white font-mono text-[10px] rounded-xl flex items-center space-x-1.5 shrink-0 max-w-xs mb-3 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
            <span>Evaluating central datatables sync...</span>
          </div>
        )}

        {safePage === 'dashboard' && (
          <DashboardOverview
            students={students}
            attSessions={attSessions}
            attRecords={attRecords}
            examResults={examResults}
            sysConfig={sysConfig}
            openSessions={dashboardStats.openSessions}
            onNavigate={setCurrentAdminPage}
          />
        )}
        {safePage === 'monitoring' && <ExamMonitoring />}

        {safePage === 'attendance' && (
          <Attendance adminRole={adminRole} adminEmail={adminEmail} triggerAuditLog={triggerAuditLog} protectionPasswordConfirm={triggerPasswordConfirm} />
        )}
        {safePage === 'report' && (
          <AttendanceReport adminRole={adminRole} adminEmail={adminEmail} triggerAuditLog={triggerAuditLog} />
        )}
        {safePage === 'edit-requests' && (
          <AttendanceEditRequests adminRole={adminRole} adminEmail={adminEmail} triggerAuditLog={triggerAuditLog} protectionPasswordConfirm={triggerPasswordConfirm} />
        )}
        {safePage === 'students' && (
          <Students adminRole={adminRole} adminEmail={adminEmail} triggerAuditLog={triggerAuditLog} onShowDeletionsPanel={() => setCurrentAdminPage('auditlog')} protectionPasswordConfirm={triggerPasswordConfirm} />
        )}
        {safePage === 'questionbank' && (
          <Exams adminRole={adminRole} adminEmail={adminEmail} triggerAuditLog={triggerAuditLog} protectionPasswordConfirm={triggerPasswordConfirm} />
        )}
        {safePage === 'results' && (
          <div className="space-y-6 animate-fade-in text-xs">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
                <Layers className="w-6 h-6 text-cyan-600" />
                <span>CBT exam results</span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {resultClasses.length > 0 && (
                  <select
                    value={resultsClassFilter}
                    onChange={(e) => { setResultsClassFilter(e.target.value); setSelectedResultIds(new Set()); }}
                    className="bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                    aria-label="Filter results by class"
                  >
                    <option value="all">All classes ({examResults.length})</option>
                    {resultClasses.map((c) => (
                      <option key={c} value={c}>{c} ({examResults.filter((r) => r.class === c).length})</option>
                    ))}
                  </select>
                )}
                <input
                  ref={resultsImportInputRef}
                  type="file"
                  accept=".csv,.json"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportResultsFile(f); }}
                />
                <button
                  type="button"
                  onClick={() => resultsImportInputRef.current?.click()}
                  disabled={importingResults}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer"
                  title="Import results from CSV or JSON"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {importingResults ? 'Importing…' : 'Import CSV/JSON'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (filteredResults.length === 0) return;
                    const headers = ['Serial', 'Name', 'Email', 'Class', 'Score', 'Total', 'Percentage', 'SubmittedAt', 'ExamSessionId'];
                    const esc = (v: any) => {
                      const s = v === null || v === undefined ? '' : String(v);
                      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                    };
                    const rows = filteredResults.map((r) => [r.classSN, r.name, r.email, r.class, r.score, r.totalQuestions, r.percentage, r.submittedAt, r.examSessionId].map(esc).join(','));
                    const csv = [headers.join(','), ...rows].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const scope = resultsClassFilter === 'all' ? 'all' : resultsClassFilter.replace(/\s+/g, '-');
                    a.download = `exam-results-${scope}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 1000);
                    triggerAuditLog('EXPORT_RESULTS_CSV', 'results', undefined, { count: filteredResults.length, classFilter: resultsClassFilter }, 'Admin exported exam results as CSV');
                  }}
                  disabled={filteredResults.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
                {roles.includes('superadmin') && (
                  <>
                    <button
                      type="button"
                      disabled={selectedResultIds.size === 0 || bulkDeleting}
                      onClick={async () => {
                        const rows = filteredResults.filter((r) => selectedResultIds.has(r.id));
                        if (!rows.length) return;
                        if (!window.confirm(`Delete ${rows.length} selected result(s)?\n\nA CSV backup of these rows will be downloaded automatically before deletion. This cannot be undone.`)) return;
                        setBulkDeleting(true);
                        try {
                          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                          downloadResultsCsv(rows, `exam-results-backup-${stamp}.csv`);
                          await DB.deleteResults(rows.map((r) => r.id));
                          await triggerAuditLog(
                            'BULK_DELETE_RESULTS',
                            'results',
                            rows.map((r) => ({ id: r.id, email: r.email, classSN: r.classSN, score: r.score })),
                            { count: rows.length, csvBackup: true },
                            `Superadmin bulk-deleted ${rows.length} result(s); CSV backup auto-downloaded.`,
                          );
                          setExamResults((prev) => prev.filter((x) => !selectedResultIds.has(x.id)));
                          setSelectedResultIds(new Set());
                        } catch (e: any) {
                          alert(`Bulk delete failed: ${e?.message ?? e}`);
                        } finally {
                          setBulkDeleting(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {bulkDeleting ? 'Deleting…' : `Bulk delete (${selectedResultIds.size})`}
                    </button>
                    <WipeDataButton
                      page="results"
                      adminEmail={adminEmail}
                      variant="full"
                      triggerAuditLog={triggerAuditLog}
                      onWiped={() => { try { window.location.reload(); } catch {} }}
                    />
                  </>
                )}
              </div>
            </div>
            {roles.includes('superadmin') && (
              <p className="text-[10px] text-slate-500 font-mono -mt-3">
                Bulk delete always downloads a CSV backup of the affected rows first.
              </p>
            )}

            {!roles.includes('superadmin') && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Only a Superadmin can permanently delete records. Your deletes are submitted as approval requests.</span>
              </div>
            )}
            <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
              <div className="max-h-[65vh] overflow-y-auto overflow-x-auto mobile-scroll-x">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[9px] text-slate-500 uppercase sticky top-0">
                    <tr>
                      {roles.includes('superadmin') && (
                        <th className="p-3 w-8">
                          <input
                            type="checkbox"
                            aria-label="Select all results"
                             checked={filteredResults.length > 0 && filteredResults.every((r) => selectedResultIds.has(r.id))}
                            onChange={() => {
                              setSelectedResultIds((prev) => {
                                const allSelected = filteredResults.length > 0 && filteredResults.every((r) => prev.has(r.id));
                                const next = new Set(prev);
                                if (allSelected) filteredResults.forEach((r) => next.delete(r.id));
                                else filteredResults.forEach((r) => next.add(r.id));
                                return next;
                              });
                            }}
                          />
                        </th>
                      )}
                      <th className="p-3 w-24">Serial</th>
                      <th className="p-3">Candidate</th>
                      <th className="p-3">Class</th>
                      <th className="p-3 text-center">Score</th>
                      <th className="p-3 text-center">%</th>
                      <th className="p-3">Submitted</th>
                      <th className="p-3 text-right w-28">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150">
                     {filteredResults.length === 0 ? (
                       <tr><td colSpan={roles.includes('superadmin') ? 8 : 7} className="py-20 text-center text-zinc-400">
                         {examResults.length === 0 ? 'No submissions yet.' : `No results for ${resultsClassFilter}.`}
                       </td></tr>
                     ) : filteredResults.map((r) => (
                      <tr key={r.id} className={`hover:bg-slate-50/70 ${selectedResultIds.has(r.id) ? 'bg-cyan-50/60' : ''}`}>
                        {roles.includes('superadmin') && (
                          <td className="p-3">
                            <input
                              type="checkbox"
                              aria-label={`Select result ${r.classSN}`}
                              checked={selectedResultIds.has(r.id)}
                              onChange={() => {
                                setSelectedResultIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                        )}
                        <td className="p-3 font-mono font-black text-slate-900 whitespace-nowrap">{r.classSN}</td>

                        <td className="p-3">
                          <p className="font-bold text-slate-900 leading-tight break-words">{r.name}</p>
                          <p className="text-[10px] text-slate-450 font-mono mt-0.5 break-all">{r.email}</p>
                        </td>
                        <td className="p-3 whitespace-nowrap">{r.class}</td>
                        <td className="p-3 text-center font-mono font-bold whitespace-nowrap">{r.score} / {r.totalQuestions}</td>
                        <td className="p-3 text-center font-mono font-black text-cyan-600 whitespace-nowrap">{r.percentage}%</td>
                        <td className="p-3 text-slate-450 font-mono text-[10px] whitespace-nowrap">{r.submittedAt.slice(0, 16).replace('T', ' ')}</td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {roles.includes('superadmin') ? (
                            <button

                              type="button"
                              onClick={async () => {
                                const ok = await confirmActionBool({
                                  title: 'Delete exam result',
                                  description: 'Permanently removes this submission from the results table and audit-linked storage. This cannot be undone.',
                                  scope: [
                                    `Student: ${r.name} (${r.classSN})`,
                                    `Email: ${r.email}`,
                                    `Class: ${r.class}`,
                                    `Score: ${r.score} / ${r.totalQuestions} (${r.percentage}%)`,
                                    `Submitted: ${r.submittedAt.slice(0, 16).replace('T', ' ')}`,
                                  ],
                                  confirmLabel: 'Delete result',
                                  requireTypedConfirm: 'DELETE',
                                });
                                if (!ok) return;
                                try {
                                  await DB.deleteResult(r.id);
                                  await triggerAuditLog('DELETE_RESULT', 'results', r, undefined, `Superadmin deleted result for ${r.email}`);
                                  setExamResults((prev) => prev.filter((x) => x.id !== r.id));
                                } catch (e: any) {
                                  alert(`Delete failed: ${e?.message ?? e}`);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          ) : permissions.viewReports(roles) ? (
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await confirmAction({
                                  title: 'Request result deletion',
                                  description: 'Submits a deletion request to a superadmin. No data is removed until approved.',
                                  scope: [
                                    `Student: ${r.name} (${r.classSN})`,
                                    `Email: ${r.email}`,
                                    `Score: ${r.score} / ${r.totalQuestions} (${r.percentage}%)`,
                                  ],
                                  variant: 'warning',
                                  confirmLabel: 'Submit request',
                                  requireReason: true,
                                  reasonPlaceholder: 'Why does this result need to be deleted?',
                                });
                                if (!res.confirmed) return;
                                const reason = res.reason!;
                                try {
                                  await DB.addDeletionRequest({
                                    requestedBy: adminEmail || 'unknown',
                                    role: adminRole,
                                    page: 'results',
                                    scope: `result:${r.id}`,
                                    reason,
                                  });
                                  await triggerAuditLog('REQUEST_DELETE_RESULT', 'results', r, undefined, reason);
                                  alert('Deletion request submitted for superadmin approval.');
                                } catch (e: any) {
                                  alert(`Request failed: ${e?.message ?? e}`);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800 text-[10px] font-bold cursor-pointer"
                            >
                              <AlertCircle className="w-3 h-3" /> Request Delete
                            </button>
                          ) : null}

                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {safePage === 'leaderboard' && (
          <Leaderboard
            students={students}
            attSessions={attSessions}
            attRecords={attRecords}
            examResults={examResults}
          />
        )}
        {safePage === 'auditlog' && (
          <Approvals adminRole={adminRole} adminEmail={adminEmail} triggerAuditLog={triggerAuditLog} protectionPasswordConfirm={triggerPasswordConfirm} />
        )}
        {safePage === 'settings' && (
          <div className="space-y-6">
            <DriveSync triggerAuditLog={triggerAuditLog} />
            <Approvals adminRole={adminRole} adminEmail={adminEmail} triggerAuditLog={triggerAuditLog} protectionPasswordConfirm={triggerPasswordConfirm} />
          </div>
        )}
        {safePage === 'users' && <Users />}
      </main>
    </div>
  );
}