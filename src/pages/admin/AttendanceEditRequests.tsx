import React, { useState, useEffect, useMemo } from 'react';
import { FileEdit, Check, X } from 'lucide-react';
import { AttEditRequest, AttSession, AttRecord, AdminRole } from '../../types';
import { DB } from '../../lib/database';

interface AttendanceEditRequestsProps {
  adminRole: AdminRole;
  adminEmail: string;
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
  protectionPasswordConfirm: (actionLabel: string, callback: () => void) => void;
}

export default function AttendanceEditRequests({
  adminRole,
  adminEmail,
  triggerAuditLog,
  protectionPasswordConfirm
}: AttendanceEditRequestsProps) {
  const [requests, setRequests] = useState<AttEditRequest[]>([]);
  const [sessions, setSessions] = useState<AttSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    const [reqs, sess] = await Promise.all([DB.getAttEditReqs(), DB.getAttSessions()]);
    setRequests(reqs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setSessions(sess);
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const filteredRequests = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter(r => r.status === filter);
  }, [requests, filter]);

  const pendingCount = useMemo(() => requests.filter(r => r.status === 'pending').length, [requests]);

  const handleApprove = (req: AttEditRequest) => {
    protectionPasswordConfirm(`Approve correction for ${req.name} (${req.classSN})`, async () => {
      setBusy(true);
      try {
        await DB.updateAttEditReq(req.id, {
          status: 'approved',
          resolvedBy: adminEmail,
          resolvedAt: new Date().toISOString()
        });

        const allRecords = await DB.getAttRecords();
        const existing = allRecords.find(
          r => r.sessionId === req.sessionId && r.email.toLowerCase() === req.email.toLowerCase()
        );

        if (existing) {
          await DB.updateAttRecord(existing.id, {
            status: req.requestedStatus,
            round: req.requestedStatus === 'present' ? '1' : '2'
          });
        } else {
          const sess = sessions.find(s => s.id === req.sessionId);
          const guessedClass = req.classSN.toUpperCase().startsWith('A') ? 'Class A' : 'Class B';
          await DB.addAttRecord({
            sessionId: req.sessionId,
            email: req.email,
            name: req.name,
            class: guessedClass,
            classSN: req.classSN,
            date: sess?.date || new Date().toISOString().slice(0, 10),
            status: req.requestedStatus,
            round: req.requestedStatus === 'present' ? '1' : '2',
            timestamp: new Date().toISOString()
          });
        }

        // Sync exam eligibility gate so the student's CBT access reflects the corrected status
        const isNowEligible = req.requestedStatus === 'present' || req.requestedStatus === 'late';
        await DB.updateExamEligibility(req.sessionId, req.email, {
          status: isNowEligible ? 'eligible' : 'locked',
          reason: req.requestedStatus as any,
          overrideBy: adminEmail,
          overrideReason: `Attendance correction approved by ${adminEmail}`
        });

        await triggerAuditLog(
          `Approved attendance correction: ${req.name} (${req.classSN}) → ${req.requestedStatus}`,
          'Attendance Edit Requests',
          { status: req.status },
          { status: 'approved', requestedStatus: req.requestedStatus },
          'Admin approved attendance correction ticket'
        );

        reload();
      } catch (err) {
        alert('Error approving request: ' + err);
      } finally {
        setBusy(false);
      }
    });
  };

  const openRejectPanel = (req: AttEditRequest) => {
    setRejectingId(req.id);
    setRejectionNote('');
  };

  const confirmReject = (req: AttEditRequest) => {
    protectionPasswordConfirm(`Reject correction for ${req.name} (${req.classSN})`, async () => {
      setBusy(true);
      try {
        const patch: Partial<AttEditRequest> & { rejectionNote?: string } = {
          status: 'rejected',
          resolvedBy: adminEmail,
          resolvedAt: new Date().toISOString()
        };
        if (rejectionNote.trim()) patch.rejectionNote = rejectionNote.trim();

        await DB.updateAttEditReq(req.id, patch);

        await triggerAuditLog(
          `Rejected attendance correction: ${req.name} (${req.classSN})`,
          'Attendance Edit Requests',
          { status: req.status },
          { status: 'rejected', rejectionNote: rejectionNote.trim() || null },
          rejectionNote.trim() || 'Admin rejected attendance correction ticket'
        );

        setRejectingId(null);
        setRejectionNote('');
        reload();
      } catch (err) {
        alert('Error rejecting request: ' + err);
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="space-y-5 animate-fade-in text-xs font-sans select-none">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
          <FileEdit className="w-6 h-6 text-cyan-600" />
          <span>Attendance Edit Requests</span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 font-black text-[10px] rounded-full font-mono animate-pulse">
              {pendingCount} pending
            </span>
          )}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Review and act on student attendance correction submissions.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex space-x-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all cursor-pointer ${
              filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 bg-amber-500 text-white text-[9px] font-black rounded-full leading-none">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 font-mono animate-pulse">Loading edit requests...</div>
      ) : filteredRequests.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-20 text-center space-y-1">
          <p className="text-slate-400">No {filter === 'all' ? '' : filter} requests found.</p>
          {filter === 'pending' && <p className="text-[10px] text-slate-300 font-mono">All caught up!</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map(req => {
            const session = sessions.find(s => s.id === req.sessionId);
            const isPending = req.status === 'pending';
            const isRejectingThis = rejectingId === req.id;
            const note = (req as any).rejectionNote as string | undefined;

            return (
              <div
                key={req.id}
                className={`bg-white border rounded-2xl p-4 shadow-sm ${
                  isPending ? 'border-amber-100' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2.5">
                    {/* Header row */}
                    <div className="flex items-center flex-wrap gap-1.5">
                      {req.status === 'pending' && (
                        <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-black rounded font-mono animate-pulse">
                          PENDING
                        </span>
                      )}
                      {req.status === 'approved' && (
                        <span className="px-1.5 py-0.5 bg-green-50 border border-green-200 text-green-700 text-[9px] font-black rounded font-mono">
                          APPROVED
                        </span>
                      )}
                      {req.status === 'rejected' && (
                        <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-500 text-[9px] font-black rounded font-mono">
                          REJECTED
                        </span>
                      )}
                      <span className="font-black text-slate-900">{req.name}</span>
                      <span className="font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded text-[10px]">
                        {req.classSN}
                      </span>
                    </div>

                    {/* Details grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[10px] text-slate-500 font-mono">
                      <div>
                        <span className="text-slate-400">Session: </span>
                        <span className="font-bold text-slate-700">{session?.date || '—'}</span>
                      </div>
                      <div className="col-span-1 md:col-span-2 truncate">
                        <span className="text-slate-400">Topic: </span>
                        <span className="font-bold text-slate-700">{session?.topic || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Requested: </span>
                        <span className={`font-black uppercase ${req.requestedStatus === 'present' ? 'text-green-600' : 'text-amber-600'}`}>
                          {req.requestedStatus}
                        </span>
                      </div>
                    </div>

                    {/* Submitted date */}
                    <p className="text-[10px] text-slate-400 font-mono">
                      Submitted: {req.createdAt.slice(0, 10)}
                      {req.resolvedBy && (
                        <> · Resolved by <span className="text-slate-600">{req.resolvedBy}</span> on {req.resolvedAt?.slice(0, 10)}</>
                      )}
                    </p>

                    {/* Reason */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 italic text-slate-600 text-[11px] leading-relaxed">
                      "{req.reason}"
                    </div>

                    {/* Rejection note (if present) */}
                    {note && (
                      <div className="bg-rose-50 border border-rose-100 rounded-xl p-2 text-[10px] text-rose-700 font-mono">
                        <span className="font-black not-italic">Rejection note: </span>
                        {note}
                      </div>
                    )}

                    {/* Inline rejection form */}
                    {isRejectingThis && (
                      <div className="space-y-2 pt-1">
                        <input
                          type="text"
                          placeholder="Rejection note (optional)..."
                          value={rejectionNote}
                          onChange={e => setRejectionNote(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && confirmReject(req)}
                          className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs focus:outline-none focus:bg-white focus:border-rose-300"
                          autoFocus
                          disabled={busy}
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={() => confirmReject(req)}
                            disabled={busy}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            Confirm Reject
                          </button>
                          <button
                            onClick={() => { setRejectingId(null); setRejectionNote(''); }}
                            disabled={busy}
                            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  {isPending && !isRejectingThis && (
                    <div className="flex md:flex-col space-x-2 md:space-x-0 md:space-y-2 shrink-0">
                      <button
                        onClick={() => handleApprove(req)}
                        disabled={busy}
                        className="flex items-center space-x-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => openRejectPanel(req)}
                        disabled={busy}
                        className="flex items-center space-x-1 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
