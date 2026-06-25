import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldAlert, Scroll, ToggleLeft, CheckCircle2, XCircle, Trash2, Key, Info, 
  Trash, UserMinus, Search, RefreshCw, Lock, Unlock, AlertCircle, FileText
} from 'lucide-react';
import { AuditLog, DeletionRequest, AdminRole, SystemConfig } from '../../types';
import { DB } from '../../lib/database';
import { confirmAction } from '../../components/confirmAction';

interface ApprovalsProps {
  adminRole: AdminRole;
  adminEmail: string;
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
  protectionPasswordConfirm: (actionLabel: string, callback: () => void) => void;
}

export default function Approvals({
  adminRole,
  adminEmail,
  triggerAuditLog,
  protectionPasswordConfirm
}: ApprovalsProps) {
  // --- STATE ---
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);

  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<'audit' | 'deletions' | 'config'>('audit');

  // Search/Filters
  const [auditSearch, setAuditSearch] = useState('');
  const [deletionFilter, setDeletionFilter] = useState<'pending' | 'all'>('pending');

  const [pwProtect, setPwProtect] = useState('');
  const [pwSuper, setPwSuper] = useState('');
  const [configMessage, setConfigMessage] = useState('');

  // Fetch queues
  const reloadData = async () => {
    setLoading(true);
    try {
      const logs = await DB.getAuditLogs();
      const delReqs = await DB.getDeletionRequests();
      const conf = await DB.getConfig();

      setAuditLogs(logs);
      setDeletionRequests(delReqs);
      setSysConfig(conf);

      setPwProtect(conf.protectionPassword || 'admin');
      setPwSuper(conf.superadminPassword || 'super');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, []);

  // --- LOG FILTERING ---
  const filteredLogs = useMemo(() => {
    const term = auditSearch.toLowerCase().trim();
    if (!term) return auditLogs;
    return auditLogs.filter(log => 
      log.action.toLowerCase().includes(term) ||
      log.userName.toLowerCase().includes(term) ||
      log.page.toLowerCase().includes(term) ||
      (log.reason && log.reason.toLowerCase().includes(term))
    );
  }, [auditLogs, auditSearch]);

  const filteredDeletions = useMemo(() => {
    let list = [...deletionRequests];
    if (deletionFilter === 'pending') {
      list = list.filter(r => r.status === 'pending');
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [deletionRequests, deletionFilter]);


  // --- DELETION RESOLUTION ACTIONS ---
  const handleResolveDeletion = (req: DeletionRequest, status: 'approved' | 'rejected') => {
    const targetLabel = status === 'approved' ? "APPROVE DATA PERMANENT ERASURE" : "REJECT DATA PERMANENT ERASURE";

    // Deletion approves STRICTLY need password verify
    protectionPasswordConfirm(targetLabel, async () => {
      const approving = status === 'approved';
      const res = await confirmAction({
        title: approving ? 'Approve deletion request' : 'Reject deletion request',
        description: approving
          ? 'Approving runs an irreversible cascade purge against the linked records below.'
          : 'Rejecting closes this request without deleting anything. The requester will see the rejection note.',
        scope: [
          `Scope: ${req.scope}`,
          `Requested by: ${req.requestedBy} (${req.role})`,
          `Original reason: ${req.reason}`,
          ...(approving ? ['Linked attendance records, eligibility rows, or student profile will be permanently removed.'] : []),
        ],
        variant: approving ? 'danger' : 'warning',
        confirmLabel: approving ? 'Approve & purge' : 'Reject request',
        requireReason: true,
        reasonPlaceholder: approving
          ? 'Authorisation note for the audit registry…'
          : 'Why is this request being rejected?',
        requireTypedConfirm: approving ? 'APPROVE' : undefined,
      });
      if (!res.confirmed) return;
      const resolutionReason = res.reason ?? '';

      try {
        setLoading(true);

        // Update the deletion queue record status
        const updated = await DB.updateDeletionRequest(req.id, {
          status,
          resolvedBy: adminEmail,
          resolvedAt: new Date().toISOString(),
          resolutionReason: resolutionReason.trim() || undefined
        });

        // 2. Actually execute cascade purge if approved!
        if (status === 'approved') {
          const [scopeType, scopeId] = req.scope.split(':');
          if (scopeType === 'student') {
            await DB.deleteStudent(scopeId);
          } else if (scopeType === 'session') {
            await DB.deleteAttSession(scopeId);
            await DB.deleteRecordsBySession(scopeId);
          }
        }

        // 3. Commit Audit log trail
        await triggerAuditLog(
          `${status.toUpperCase()} DELETION REQUEST [Scope: ${req.scope}]. Executed cascading table purge.`,
          'Audit and Deletions',
          req,
          updated,
          resolutionReason.trim() || "Approved deletion request gate"
        );

        reloadData();
      } catch (err) {
        alert("Action executing failed: " + err);
        setLoading(false);
      }
    });
  };

  // --- PASSWORD SECURITY MODIFIERS ---
  const handleUpdatePasswords = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigMessage('');

    if (!pwProtect.trim() || !pwSuper.trim()) {
      setConfigMessage('Passwords cannot be empty strings.');
      return;
    }

    // Requires protection confirmation to run
    protectionPasswordConfirm("RE-CONFIGURE SYSTEMS SECURITY ENGINES PIN", async () => {
      try {
        const nextConf = await DB.updateConfig({
          protectionPassword: pwProtect.trim(),
          superadminPassword: pwSuper.trim()
        });

        await triggerAuditLog(
          `Modified System Administrators Credentials Protection PIN setups`,
          'Security Setup',
          null,
          { protectionPassword: '***', superadminPassword: '***' },
          "Admin updated security portal tokens"
        );

        setSysConfig(nextConf);
        setConfigMessage('✅ Passwords modified successfully in local credentials bank.');
      } catch (err) {
        setConfigMessage('❌ Save exception: ' + err);
      }
    });
  };


  // --- RENDER ---
  return (
    <div id="approvals-module-root" className="space-y-6">
      
      {/* HEADER CONTROLS */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
          <ShieldAlert className="w-6 h-6 text-indigo-650" />
          <span>Security & Auditor Controls Console</span>
        </h2>
        <p className="text-xs text-slate-500">
          Supervise centralized audit logs, manage deletion requests with cascading purges, and set admin passwords.
        </p>
      </div>

      {/* HORIZONTAL PAGE CHOOSER */}
      <div className="flex border-b border-slate-200 text-xs">
        <button
          onClick={() => setCurrentTab('audit')}
          className={`py-3 px-5 font-bold border-b-2 transition-all cursor-pointer ${
            currentTab === 'audit' 
              ? 'border-indigo-650 text-slate-900 bg-indigo-50/10' 
              : 'border-transparent text-slate-500 hover:text-slate-950'
          }`}
        >
          Audit Logs Logbook ({auditLogs.length})
        </button>
        <button
          onClick={() => setCurrentTab('deletions')}
          className={`py-3 px-5 font-bold border-b-2 transition-all cursor-pointer ${
            currentTab === 'deletions' 
              ? 'border-indigo-650 text-slate-900 bg-indigo-50/10' 
              : 'border-transparent text-slate-500 hover:text-slate-950'
          }`}
        >
          Deletion Approvals Queue ({deletionRequests.filter(r => r.status === 'pending').length})
        </button>
        <button
          onClick={() => setCurrentTab('config')}
          className={`py-3 px-5 font-bold border-b-2 transition-all cursor-pointer ${
            currentTab === 'config' 
              ? 'border-indigo-650 text-slate-900 bg-indigo-50/10' 
              : 'border-transparent text-slate-500 hover:text-slate-950'
          }`}
        >
          Security & Credentials Manager
        </button>
      </div>

      {/* RENDER PAGES CONTENT */}
      {currentTab === 'audit' && (
        <div className="space-y-4 animate-fade-in select-none">
          {/* SEARCH TRAIL */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 border border-slate-200 rounded-2xl">
            <div className="relative grow max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search actions, names, pages, or reasons..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-205 rounded-xl focus:outline-none focus:bg-white text-xs text-slate-700 placeholder:text-slate-400 font-medium"
              />
            </div>

            <button
              onClick={reloadData}
              disabled={loading}
              className="px-4 py-2 border rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Logbook</span>
            </button>
          </div>

          {/* AUDIT LOG BOOK TABLE */}
          <div className="bg-white border rounded-2xl overflow-hidden shadow-sm flex flex-col">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse font-sans">
                <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[9px] text-slate-500 uppercase sticky top-0 z-15">
                  <tr>
                    <th className="p-3 bg-slate-50 w-44">Log Timestamp</th>
                    <th className="p-3 bg-slate-50 w-40">User Roster Info</th>
                    <th className="p-3 bg-slate-55">Section page</th>
                    <th className="p-3 bg-slate-50">Authorized Action / System delta</th>
                    <th className="p-3 bg-slate-50 w-48">Mandatory action reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150 text-slate-700">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="py-20 text-center font-mono text-slate-400">Loading audit registries...</td>
                    </tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-20 text-center text-slate-400 font-medium font-mono">No logged operations matching audit credentials.</td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 font-mono font-bold text-slate-500">{log.timestamp}</td>
                        <td className="p-3">
                          <div>
                            <p className="font-bold text-slate-900 leading-tight">{log.userName}</p>
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold font-mono tracking-tight bg-slate-100 border text-slate-500 mt-0.5 uppercase">{log.userRole}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded font-mono uppercase shrink-0">{log.page}</span>
                        </td>
                        <td className="p-3 font-semibold text-slate-850 py-3.5 leading-relaxed">
                          <div>
                            {log.action}
                            {log.newValue && (
                              <div className="mt-1.5 bg-slate-50 border border-slate-100 rounded-xl p-2 font-mono text-[10px] text-zinc-600 max-h-24 overflow-y-auto whitespace-pre-wrap select-text">
                                delta: {log.newValue}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-3 italic text-indigo-850 font-medium py-3.5 leading-relaxed bg-indigo-50/15">
                          {log.reason}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {currentTab === 'deletions' && (
        <div className="space-y-4 animate-fade-in select-none">
          {/* FILTER BAR QUEUES */}
          <div className="flex items-center justify-between bg-white p-3 border border-slate-201 rounded-2xl">
            <span className="text-[10px] tracking-wider uppercase font-mono font-bold text-slate-500">Approvals Ledger Queue</span>
            
            <div className="flex space-x-1 bg-slate-100 p-0.5 rounded-lg border">
              <button
                onClick={() => setDeletionFilter('pending')}
                className={`px-3 py-1 text-[10px] font-bold rounded cursor-pointer ${deletionFilter === 'pending' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`}
              >
                Pending Requests Only
              </button>
              <button
                onClick={() => setDeletionFilter('all')}
                className={`px-3 py-1 text-[10px] font-bold rounded cursor-pointer ${deletionFilter === 'all' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`}
              >
                All Histories
              </button>
            </div>
          </div>

          {/* DELETION LIST VIEW */}
          {filteredDeletions.length === 0 ? (
            <div className="bg-white border rounded-2xl p-16 text-center text-slate-450 font-sans text-xs">
              Excellent! No pending deletion requests waiting in the approvals registry.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDeletions.map((req) => {
                const isPending = req.status === 'pending';
                const isApproved = req.status === 'approved';
                return (
                  <div key={req.id} className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm relative flex flex-col md:flex-row justify-between gap-4">
                    <div className="space-y-3 shrink-1">
                      <div className="flex items-center space-x-2">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 border border-rose-100 text-rose-700 font-mono uppercase">PURGE REQUEST</span>
                        {isPending ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black tracking-tight bg-yellow-50 border border-yellow-200 text-yellow-705 uppercase font-mono animate-pulse">PENDING REVIEW</span>
                        ) : isApproved ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black tracking-tight bg-green-50 border border-green-200 text-green-700 uppercase font-mono">APPROVED</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black tracking-tight bg-slate-100 border border-slate-200 text-slate-505 uppercase font-mono">DENIED</span>
                        )}
                      </div>

                      <h4 className="font-extrabold text-slate-900 text-sm">
                        Request ID: <span className="font-mono text-xs text-indigo-705">{req.id}</span> — Scope: <span className="font-mono text-xs text-rose-600 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded">{req.scope}</span>
                      </h4>

                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-slate-500 pt-0.5 font-sans leading-relaxed">
                        <p>Opened by: <strong className="text-slate-800">{req.requestedBy}</strong> ({req.role})</p>
                        <p>Target panel: <strong className="text-slate-800 font-mono uppercase text-[10px]">{req.page}</strong></p>
                        <p className="col-span-2 py-1 bg-slate-50 border border-slate-100 p-2.5 rounded-xl mt-1 leading-relaxed">
                          Purge Reason Statement: <strong className="text-slate-800 block italic leading-relaxed mt-1">"{req.reason}"</strong>
                        </p>
                      </div>

                      {/* Resolution logs if resolved */}
                      {!isPending && (
                        <div className="bg-slate-50 p-2 rounded border border-slate-150 text-[10px] mt-2 font-mono">
                          <p>Resolved by: <strong className="text-slate-800">{req.resolvedBy}</strong> at {req.resolvedAt}</p>
                          {req.resolutionReason && <p>Audit Note: <strong className="text-slate-700">"{req.resolutionReason}"</strong></p>}
                        </div>
                      )}
                    </div>

                    {/* Operational controls if pending */}
                    {isPending && (
                      <div className="flex md:flex-col items-center justify-end md:justify-center shrink-0 min-w-[130px] gap-2 pt-2 border-t md:border-t-0 md:border-l border-slate-100 md:pl-5 select-none font-sans text-xs">
                        <button
                          onClick={() => handleResolveDeletion(req, 'approved')}
                          className="w-full py-2.5 px-3 bg-red-650 hover:bg-red-700 text-white rounded-xl font-bold text-xs shadow-sm flex items-center justify-center space-x-1 transition-all cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Approve Delete</span>
                        </button>
                        <button
                          onClick={() => handleResolveDeletion(req, 'rejected')}
                          className="w-full py-2 px-3 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl font-semibold text-xs flex items-center justify-center space-x-1 transition-all cursor-pointer"
                        >
                          <XCircle className="w-4 h-4 shrink-0 text-slate-400" />
                          <span>Reject Dismiss</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {currentTab === 'config' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-fade-in select-none">
          {/* PASSWORD MODIFIERS */}
          <div className="bg-white border rounded-3xl p-6 shadow-sm font-sans text-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-2 pb-2 border-b">
              <Key className="w-5 h-5 text-indigo-650" />
              <span>Modify System Authorization PIN Keys</span>
            </h3>

            {configMessage && (
              <div className="p-3 font-semibold text-[11px] rounded-lg bg-indigo-50 border border-indigo-150 text-indigo-850">
                {configMessage}
              </div>
            )}

            <form onSubmit={handleUpdatePasswords} className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase leading-none">Standard Destructives Protection PIN</label>
                  <span className="text-[10px] text-slate-400">Current Action Gate</span>
                </div>
                <input
                  type="text"
                  value={pwProtect}
                  onChange={(e) => setPwProtect(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-250 p-2.5 rounded-xl font-bold text-zinc-800 text-xs focus:bg-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase leading-none">Superadmin Deletions Approval PIN</label>
                  <span className="text-[10px] text-slate-400">Master Cascade Purge Key</span>
                </div>
                <input
                  type="text"
                  value={pwSuper}
                  onChange={(e) => setPwSuper(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-250 p-2.5 rounded-xl font-bold text-zinc-800 text-xs focus:bg-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-950 text-white font-bold rounded-xl shadow-sm cursor-pointer"
              >
                Modify Protection Credentials
              </button>
            </form>
          </div>

          {/* DOCUMENTATION PANEL */}
          <div className="bg-slate-900 text-white border border-slate-850 rounded-3xl p-6 shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-4 leading-relaxed">
              <h3 className="font-bold text-white text-sm flex items-center space-x-2 pb-2 border-b border-slate-800">
                <AlertCircle className="w-5 h-5 text-indigo-400" />
                <span>Rostering & CBT Gating Safeguards</span>
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed font-normal">
                To guarantee flawless state parity, all candidate deletion overrides must go through centralized auditing records. 
              </p>
              <ul className="space-y-2 text-[11px] text-slate-350 list-disc list-inside">
                <li>Marking a candidate absent locks their exam entrance key automatically.</li>
                <li>Tutors can request deletions, which queue directly inside this page for Superadmin signature approval.</li>
                <li>Cascade purges drop child tables (results, eligibility gates, attendance records) safely to avoid orphan constraints.</li>
              </ul>
            </div>

            <div className="p-3 border border-indigo-900/40 bg-indigo-950/20 text-indigo-400 text-xs rounded-xl flex items-start space-x-2">
              <Info className="w-4.5 h-4.5 shrink-0 text-indigo-400" />
              <span>Standard local override defaults: <strong className="font-mono text-white">"admin"</strong> protecting checks and <strong className="font-mono text-white">"super"</strong> protecting queue approvals.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
