import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar, Plus, Play, RotateCw, Trash2, X, Upload
} from 'lucide-react';
import { AttSession, AdminRole, Student } from '../../types';
import { DB } from '../../lib/database';
import AttendanceCheckin from './AttendanceCheckin';
import AttendanceImport from '../../components/AttendanceImport';
import { confirmActionBool } from '../../components/confirmAction';

interface AttendanceProps {
  adminRole: AdminRole;
  adminEmail: string;
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
  protectionPasswordConfirm: (actionLabel: string, callback: () => void) => void;
}

export default function Attendance({
  adminRole,
  adminEmail,
  triggerAuditLog,
  protectionPasswordConfirm
}: AttendanceProps) {
  // --- STATE ---
  const [sessions, setSessions] = useState<AttSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [classFilter, setClassFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Active checkin overlay view trigger
  const [activeCheckinSession, setActiveCheckinSession] = useState<AttSession | null>(null);

  // Import overlay
  const [importSession, setImportSession] = useState<AttSession | null>(null);
  const [studentRoster, setStudentRoster] = useState<Student[]>([]);

  // New Session form triggers
  const [isNewPanelOpen, setIsNewPanelOpen] = useState(false);
  const [formClass, setFormClass] = useState<'Class A' | 'Class B' | 'Joint'>('Class A');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formTopic, setFormTopic] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState('');

  // Individual session record visualizer modal
  const [viewingRecordSession, setViewingRecordSession] = useState<AttSession | null>(null);
  const [sessionRecords, setSessionRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // Fetch rosters list
  const fetchSessionsList = async () => {
    setLoading(true);
    const data = await DB.getAttSessions();
    setSessions(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchSessionsList();
    DB.getStudents().then(setStudentRoster).catch(() => {});
  }, []);

  // --- FILTER & SORT ---
  const filteredSessions = useMemo(() => {
    let list = [...sessions];

    if (classFilter !== 'All') {
      list = list.filter(s => s.class === classFilter);
    }

    if (statusFilter !== 'All') {
      list = list.filter(s => s.status === statusFilter);
    }

    if (startDate) {
      list = list.filter(s => s.date >= startDate);
    }
    if (endDate) {
      list = list.filter(s => s.date <= endDate);
    }

    // Newest sessions first
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [sessions, classFilter, statusFilter, startDate, endDate]);

  // --- ACTIONS ---

  // Host new attendance sheet
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formTopic.trim()) {
      setFormError('Roster topic/subject is required');
      return;
    }

    try {
      const data = {
        class: formClass,
        date: formDate,
        topic: formTopic.trim(),
        notes: formNotes.trim() || undefined,
        status: 'open' as const,
        round1Serials: [],
        round2Serials: [],
        createdBy: adminEmail
      };

      const result = await DB.addAttSession(data);

      // Reset prior exam eligibility so the new session starts clean —
      // students become eligible again only as attendance is marked here.
      try {
        await DB.clearAllExamEligibility();
      } catch (clearErr) {
        console.warn('[Create Session] Could not reset prior exam eligibility:', clearErr);
      }

      await triggerAuditLog(
        `Created Attendance check-in session for ${result.class} on ${result.date}. Prior exam eligibility cleared so attendance in this session re-establishes who can sit the assessment.`,
        'Attendance Sessions',
        null,
        result,
        "Admin started classroom registration block"
      );

      setFormTopic('');
      setFormNotes('');
      setFormDate(new Date().toISOString().slice(0, 10));
      setIsNewPanelOpen(false);
      fetchSessionsList();
      
      // Auto open check-in gate right away for excellent flow
      setActiveCheckinSession(result);

    } catch (err) {
      setFormError('Error creating session: ' + err);
    }
  };

  // Re-open completed session (Requirement: Re-open requires protection password)
  const handleReopenSession = (session: AttSession) => {
    protectionPasswordConfirm(`RE-OPEN COMPLETED ROSTER (Date: ${session.date})`, async () => {
      const reason = prompt("Enter central audit log reason to reopen closed attendance:");
      if (!reason || !reason.trim()) {
        alert("Action aborted. A descriptive reason is required to log the security overrides.");
        return;
      }

      try {
        const originalStatus = session.status;
        
        // Sweep individual attendance records tied to this session ID to avoid duplicates on re-submission (Requirement F1)
        await DB.deleteRecordsBySession(session.id);

        const updated = await DB.updateAttSession(session.id, { status: 'open' });

        await triggerAuditLog(
          `Re-opened closed attendance session ${session.topic} (${session.id}) and purged previously saved records`,
          'Attendance Sessions',
          session,
          updated,
          reason
        );

        fetchSessionsList();
        
        // Auto navigate back to monitoring
        setActiveCheckinSession(updated);
      } catch (err) {
        alert("Error reopening session: " + err);
      }
    });
  };

  // Inspect completed records mini-table.
  // CLASS-ISOLATION SAFEGUARD: even though `getRecordsBySession` filters by
  // session id, we defensively re-filter by the session's class field so a
  // stray record with a wrong class can never leak into another class's view.
  const handleViewRecords = async (session: AttSession) => {
    setViewingRecordSession(session);
    setRecordsLoading(true);
    const recs = await DB.getRecordsBySession(session.id);
    const isolated = session.class === 'Joint'
      ? recs
      : recs.filter(r => r.class === session.class);
    setSessionRecords(isolated.sort((a, b) => a.classSN.localeCompare(b.classSN, undefined, { numeric: true })));
    setRecordsLoading(false);
  };

  const handleDeleteSession = (session: AttSession) => {
    protectionPasswordConfirm(`DELETE ATTENDANCE SESSION (${session.date})`, async () => {
      const ok = await confirmActionBool({
        title: 'Delete attendance session',
        description: 'Cascades the deletion to every attendance record and exam eligibility row linked to this session. This cannot be undone.',
        scope: [
          `Class: ${session.class}`,
          `Topic: ${session.topic}`,
          `Date: ${session.date}`,
          `Session ID: ${session.id}`,
          'All attendance records for this session will be removed',
          'All exam eligibility rows derived from this session will be removed',
        ],
        confirmLabel: 'Delete session',
        requireTypedConfirm: 'DELETE',
      });
      if (!ok) return;
      try {
        await DB.deleteRecordsBySession(session.id);
        await DB.deleteExamEligibilityBySession(session.id);
        await DB.deleteAttSession(session.id);

        await triggerAuditLog(
          `Deleted attendance session and cascaded linked records for ${session.class} (${session.date})`,
          'Attendance Sessions',
          session,
          null,
          "Manual administrative purge of attendance session block"
        );

        fetchSessionsList();
      } catch (err: any) {
        alert("Error deleting attendance session: " + err.message);
      }
    });
  };

  // --- RENDER ---
  return (
    <div id="attendance-module-root" className="space-y-6">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 font-sans">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Calendar className="w-6 h-6 text-cyan-600" />
            <span>Attendance Sessions Manager</span>
          </h2>
          <p className="text-xs text-slate-500">
            Open standard 2-round check-in dashboards, finalise rosters, and sync assessment gates.
          </p>
        </div>

        <button
          onClick={() => setIsNewPanelOpen(true)}
          className="px-4 py-2.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm flex items-center space-x-1.5 transition-all cursor-pointer shadow-cyan-600/15"
        >
          <Plus className="w-4 h-4" />
          <span>Host New Session</span>
        </button>
      </div>

      {/* FILTER CONTROL PANEL */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          {/* Class filter */}
          <div className="space-y-1">
            <label className="font-bold text-slate-500 font-mono text-[10px] uppercase">Roster Stream</label>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-250 py-2.5 px-3.5 rounded-xl focus:outline-none focus:bg-white text-slate-700 font-semibold cursor-pointer"
            >
              <option value="All">All Streams</option>
              <option value="Class A">Class A</option>
              <option value="Class B">Class B</option>
              <option value="Joint">Joint Meeting</option>
            </select>
          </div>

          {/* Status filter */}
          <div className="space-y-1">
            <label className="font-bold text-slate-500 font-mono text-[10px] uppercase">Roster State</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-250 py-2.5 px-3.5 rounded-xl focus:outline-none focus:bg-white text-slate-700 font-semibold cursor-pointer"
            >
              <option value="All">All States</option>
              <option value="open">Open (Enrolling)</option>
              <option value="closed">Closed (Saved)</option>
            </select>
          </div>

          {/* Start Date */}
          <div className="space-y-1">
            <label className="font-bold text-slate-500 font-mono text-[10px] uppercase">Sessions Since</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-250 py-2.5 px-3 rounded-xl focus:outline-none focus:bg-white"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1">
            <label className="font-bold text-slate-500 font-mono text-[10px] uppercase">Sessions Until</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-250 py-2.5 px-3 rounded-xl focus:outline-none focus:bg-white"
            />
          </div>
        </div>
      </div>

      {/* COMPACT SESSIONS TABLE/BAR VIEW (Requirement B2: Scroll-fix containment) */}
      <div id="attendance-session-list" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="max-h-[70vh] overflow-y-auto select-none">
          <table className="w-full border-collapse text-left relative">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] tracking-wider font-mono font-bold uppercase sticky top-0 z-15">
              <tr>
                <th className="p-4 bg-slate-50 w-28">Meeting Date</th>
                <th className="p-4 bg-slate-50 w-24">Class ID</th>
                <th className="p-4 bg-slate-50">Topic / Core subject</th>
                <th className="p-4 bg-slate-50 w-32">Roll Call State</th>
                <th className="p-4 bg-slate-50 w-28 text-center">Round Counts</th>
                <th className="p-4 bg-slate-50 text-right pr-6 w-52">Operational Gating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 text-xs font-sans text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center font-mono text-slate-400">
                    Loading attendance database sessions...
                  </td>
                </tr>
              ) : filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center text-slate-400 font-medium">
                    No learning rosters recorded for specified credentials.
                  </td>
                </tr>
              ) : (
                filteredSessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors group">
                    <td className="p-4 font-mono font-black text-slate-900 tracking-tight">
                      {s.date}
                    </td>
                    <td className="p-4">
                      {s.class === 'Class A' ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-100 font-mono">Class A</span>
                      ) : s.class === 'Class B' ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold bg-cyan-50 text-cyan-700 border border-cyan-150 font-mono">Class B</span>
                      ) : (
                        <span className="inline-flex px-2.5 py-0.5 rounded text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-100 font-mono">Joint</span>
                      )}
                    </td>
                    <td className="p-4 font-bold text-slate-900">
                      <div>
                        <p className="font-semibold text-slate-800">{s.topic}</p>
                        {s.notes && <p className="text-[10px] text-slate-400 font-normal truncate mt-0.5 max-w bg-slate-50 p-1 rounded border border-slate-100">{s.notes}</p>}
                      </div>
                    </td>
                    <td className="p-4">
                      {s.status === 'open' ? (
                        <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-green-50 text-green-700 border border-green-150">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                          <span>Open check-in</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          <span>Roster closed</span>
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-center font-mono text-[10px] text-slate-500">
                      R1: <strong className="text-cyan-600 font-bold">{s.round1Serials?.length || 0}</strong> · R2: <strong className="text-amber-600 font-bold">{s.round2Serials?.length || 0}</strong>
                    </td>
                    <td className="p-4 text-right pr-6">
                      <div className="flex items-center justify-end space-x-1.5">
                        {s.status === 'open' ? (
                          <>
                            <button
                              onClick={() => setImportSession(s)}
                              className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-cyan-700 text-[11px] font-bold border border-cyan-200 flex items-center space-x-1 transition-colors cursor-pointer"
                              title="Import attendance from CSV / Excel"
                            >
                              <Upload className="w-3 h-3" />
                              <span>Import</span>
                            </button>
                            <button
                              onClick={() => setActiveCheckinSession(s)}
                              className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[11px] font-extrabold flex items-center space-x-1 shadow-sm transition-colors cursor-pointer"
                            >
                              <Play className="w-3 h-3 text-white fill-white" />
                              <span>Manage Check-in</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleViewRecords(s)}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-205 text-slate-700 text-[11px] font-bold border border-slate-250 transition-colors cursor-pointer"
                            >
                              View Records
                            </button>
                            <button
                              onClick={() => handleReopenSession(s)}
                              className="p-1.5 text-slate-400 hover:text-cyan-500 hover:bg-slate-100 rounded-lg transition-all cursor-pointer"
                              title="Re-open Session"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDeleteSession(s)}
                          className="p-1.5 text-slate-400 hover:text-rose-550 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                          title="Purge Attendance Session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE NEW ROSTER PANEL (SLIDE-IN SIDE MODAL) */}
      {isNewPanelOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in select-none">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full overflow-hidden animate-zoom-in">
            <div className="bg-slate-50 border-b border-slate-150 px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                <Calendar className="w-4 h-4 text-cyan-600" />
                <span>Initialize Attendance Session</span>
              </h3>
              <button onClick={() => setIsNewPanelOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="p-5 space-y-4 text-xs select-none">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-100 text-rose-750 text-[10px] rounded-lg font-mono">
                  {formError}
                </div>
              )}

              {/* Class Target */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Class Stream</label>
                <div className="grid grid-cols-3 bg-slate-100 p-1 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setFormClass('Class A')}
                    className={`py-1.5 text-center text-[10px] font-bold rounded ${
                      formClass === 'Class A' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 font-semibold'
                    }`}
                  >
                    Class A
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormClass('Class B')}
                    className={`py-1.5 text-center text-[10px] font-bold rounded ${
                      formClass === 'Class B' ? 'bg-white text-cyan-600 shadow-sm font-bold' : 'text-slate-500 font-semibold'
                    }`}
                  >
                    Class B
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormClass('Joint')}
                    className={`py-1.5 text-center text-[10px] font-bold rounded ${
                      formClass === 'Joint' ? 'bg-white text-amber-705 shadow-sm' : 'text-slate-550 font-semibold'
                    }`}
                  >
                    Joint Stream
                  </button>
                </div>
              </div>

              {/* Date */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Meeting Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-250 p-2.5 rounded-xl focus:bg-white focus:outline-none"
                  required
                />
              </div>

              {/* Topic */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Topic / Focus (Required)</label>
                <input
                  type="text"
                  placeholder="e.g. Python Functions and Loops"
                  value={formTopic}
                  onChange={(e) => setFormTopic(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-250 p-2.5 rounded-xl focus:bg-white focus:outline-none"
                  required
                />
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Interactive notes</label>
                <textarea
                  placeholder="Details for roster summaries..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-250 p-2.5 rounded-xl focus:bg-white focus:outline-none h-18 resize-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewPanelOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold shadow-sm cursor-pointer"
                >
                  Initialize Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW COMPLETED ATTENDANCE RECORDS MODAL */}
      {viewingRecordSession && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in select-none">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-zoom-in">
            {/* Header */}
            <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Completed Attendance Sheet
                </h3>
                <p className="text-[10px] text-slate-500 font-semibold font-mono mt-0.5 uppercase">
                  {viewingRecordSession.topic} — {viewingRecordSession.class} ({viewingRecordSession.date})
                </p>
              </div>
              <button 
                onClick={() => setViewingRecordSession(null)} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Table */}
            <div className="overflow-y-auto grow p-4">
              {recordsLoading ? (
                <div className="py-20 text-center font-mono text-xs text-slate-500">
                  Retrieving session records compute...
                </div>
              ) : sessionRecords.length === 0 ? (
                <div className="py-20 text-center text-slate-400 text-xs font-medium">
                  Roster session closed but records empty or missing. Try reopening.
                </div>
              ) : (
                <table className="w-full text-xs text-left border-collapse font-sans">
                  <thead className="bg-slate-50 font-mono text-[9px] text-slate-500 uppercase border-b border-slate-150">
                    <tr>
                      <th className="p-2.5">Serial Code</th>
                      <th className="p-2.5">Name</th>
                      <th className="p-2.5">Class Stream</th>
                      <th className="p-2.5">Attendance Status</th>
                      <th className="p-2.5">Check-in Round</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 font-sans text-slate-600">
                    {sessionRecords.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono font-black">{r.classSN}</td>
                        <td className="p-2.5 font-bold text-slate-800">{r.name}</td>
                        <td className="p-2.5 font-mono">{r.class}</td>
                        <td className="p-2.5">
                          {r.status === 'present' ? (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-50 text-green-700 border border-green-100 font-mono">Present</span>
                          ) : r.status === 'late' ? (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-yellow-50 text-yellow-705 border border-yellow-105 font-mono">Late arrival</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-105 font-mono">Absent</span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono text-slate-500 font-bold">{r.round ? "Round " + r.round : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <div className="text-[10px] font-mono font-bold text-slate-500">
                RATIOS: {sessionRecords.filter(r => r.status === 'present').length}P · {sessionRecords.filter(r => r.status === 'late').length}L · {sessionRecords.filter(r => r.status === 'absent').length}A
              </div>
              <button
                onClick={() => setViewingRecordSession(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-950 text-white font-bold rounded-lg text-xs cursor-pointer"
              >
                Close Records
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING SUB ROUTE OVERLAYS */}
      {activeCheckinSession && (
        <AttendanceCheckin
          session={activeCheckinSession}
          onClose={() => {
            setActiveCheckinSession(null);
            fetchSessionsList(); // Refresh session records state
          }}
          adminEmail={adminEmail}
          triggerAuditLog={triggerAuditLog}
          protectionPasswordConfirm={protectionPasswordConfirm}
        />
      )}

      {importSession && (
        <AttendanceImport
          session={importSession}
          students={studentRoster}
          adminEmail={adminEmail}
          triggerAuditLog={triggerAuditLog}
          onClose={() => setImportSession(null)}
          onImported={() => { fetchSessionsList(); }}
        />
      )}
    </div>
  );
}
