import React, { useMemo, useState } from 'react';
import { Upload, X, AlertCircle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { AttSession, Student, AttRecord } from '../types';
import { DB } from '../lib/database';

interface Props {
  session: AttSession;
  students: Student[];
  onClose: () => void;
  onImported: () => void;
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
  adminEmail: string;
}

type ParsedRow = {
  rowNum: number;
  classSN: string;
  status: string;
  round?: string;
};

type Validated =
  | { kind: 'ok'; row: ParsedRow; student: Student; status: 'present' | 'late' | 'absent'; round: '1' | '2' | null }
  | { kind: 'bad-status'; row: ParsedRow }
  | { kind: 'unmatched'; row: ParsedRow }
  | { kind: 'wrong-class'; row: ParsedRow; student: Student };

function normalizeStatus(s: string): 'present' | 'late' | 'absent' | null {
  const t = (s || '').trim().toLowerCase();
  if (['present', 'p', 'yes', 'y', '1'].includes(t)) return 'present';
  if (['late', 'l'].includes(t)) return 'late';
  if (['absent', 'a', 'no', 'n', '0'].includes(t)) return 'absent';
  return null;
}
function normalizeRound(s?: string): '1' | '2' | null {
  if (!s) return null;
  const t = String(s).trim().toLowerCase().replace(/^round\s*/, '');
  if (t === '1' || t === 'r1') return '1';
  if (t === '2' || t === 'r2') return '2';
  return null;
}

export default function AttendanceImport({ session, students, onClose, onImported, triggerAuditLog, adminEmail }: Props) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<number | null>(null);

  const classStudents = useMemo(() => {
    if (session.class === 'Joint') return students;
    return students.filter((s) => s.class === session.class);
  }, [students, session.class]);

  const validated: Validated[] = useMemo(() => {
    return rows.map((row) => {
      const status = normalizeStatus(row.status);
      if (!status) return { kind: 'bad-status', row };
      const sn = (row.classSN || '').trim().toUpperCase();
      const student = students.find((s) => (s.classSN || '').toUpperCase() === sn);
      if (!student) return { kind: 'unmatched', row };
      if (session.class !== 'Joint' && student.class !== session.class) {
        return { kind: 'wrong-class', row, student };
      }
      return { kind: 'ok', row, student, status, round: normalizeRound(row.round) };
    });
  }, [rows, students, session.class]);

  const okRows = validated.filter((v): v is Extract<Validated, { kind: 'ok' }> => v.kind === 'ok');
  const badRows = validated.filter((v) => v.kind !== 'ok');

  const handleFile = async (file: File) => {
    setParseError(''); setRows([]); setCommitted(null); setFileName(file.name);
    try {
      const lower = file.name.toLowerCase();
      let raw: Record<string, any>[] = [];
      if (lower.endsWith('.csv')) {
        const text = await file.text();
        const res = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true });
        raw = res.data;
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      } else {
        setParseError('Unsupported file type. Use .csv, .xlsx, or .xls');
        return;
      }
      const parsed: ParsedRow[] = raw.map((r, i) => {
        // case-insensitive header match
        const find = (keys: string[]) => {
          for (const k of Object.keys(r)) {
            if (keys.includes(k.trim().toLowerCase())) return String(r[k] ?? '');
          }
          return '';
        };
        return {
          rowNum: i + 2, // header is row 1
          classSN: find(['classsn', 'class sn', 'serial', 'sn']),
          status: find(['status', 'attendance']),
          round: find(['round', 'r']) || undefined,
        };
      }).filter((r) => r.classSN || r.status);
      if (parsed.length === 0) {
        setParseError('No rows found. Expected columns: classSN, status (optional: round).');
        return;
      }
      setRows(parsed);
    } catch (err: any) {
      setParseError(err?.message || 'Failed to parse file');
    }
  };

  const commit = async () => {
    if (okRows.length === 0) return;
    setBusy(true);
    try {
      const records: Omit<AttRecord, 'id'>[] = okRows.map((v) => ({
        sessionId: session.id,
        email: v.student.email,
        name: v.student.name,
        class: v.student.class,
        classSN: v.student.classSN,
        date: session.date,
        status: v.status,
        round: v.round,
        timestamp: new Date().toISOString(),
      }));
      await DB.addAttRecords(records);
      await triggerAuditLog(
        `Imported ${records.length} attendance records for ${session.class} (${session.date}) from "${fileName}"`,
        'Attendance Sessions',
        null,
        { sessionId: session.id, count: records.length, file: fileName },
        'Bulk attendance import via CSV/Excel',
      );
      setCommitted(records.length);
      onImported();
    } catch (err: any) {
      setParseError(err?.message || 'Failed to save records');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-zoom-in">
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-2">
              <FileSpreadsheet className="w-4 h-4 text-cyan-600" />
              <span>Import attendance from CSV / Excel</span>
            </h3>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5 uppercase">
              {session.class} · {session.date} · {session.topic}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto grow space-y-4 text-xs">
          <div className="bg-cyan-50/40 border border-cyan-100 rounded-xl p-3.5 text-[11px] text-slate-700">
            <p className="font-bold text-slate-800 mb-1">Expected columns (header row required):</p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
              <li><code className="font-mono text-cyan-700">classSN</code> — student serial (e.g. A12, B5)</li>
              <li><code className="font-mono text-cyan-700">status</code> — present / late / absent</li>
              <li><code className="font-mono text-cyan-700">round</code> <span className="text-slate-400">(optional)</span> — 1 or 2</li>
            </ul>
          </div>

          <label className="flex items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl p-6 hover:border-cyan-500 hover:bg-cyan-50/30 cursor-pointer transition-colors">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="text-center space-y-1">
              <Upload className="w-6 h-6 text-cyan-600 mx-auto" />
              <p className="font-bold text-slate-800">Choose file</p>
              <p className="text-[10px] text-slate-500 font-mono">{fileName || '.csv .xlsx .xls'}</p>
            </div>
          </label>

          {parseError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-start space-x-2 text-[11px]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {committed !== null && (
            <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-xl flex items-start space-x-2 text-[11px]">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Saved {committed} attendance records to the session.</span>
            </div>
          )}

          {rows.length > 0 && committed === null && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-green-50 border border-green-200 rounded-xl p-2.5">
                  <p className="text-[10px] font-mono uppercase text-green-700">Ready to save</p>
                  <p className="text-lg font-black text-green-700">{okRows.length}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                  <p className="text-[10px] font-mono uppercase text-amber-700">Skipped rows</p>
                  <p className="text-lg font-black text-amber-700">{badRows.length}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Total rows</p>
                  <p className="text-lg font-black text-slate-700">{validated.length}</p>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 sticky top-0 text-[9px] font-mono uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-2 text-left">Row</th>
                      <th className="p-2 text-left">classSN</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Round</th>
                      <th className="p-2 text-left">Resolution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {validated.map((v, i) => (
                      <tr key={i} className={v.kind === 'ok' ? '' : 'bg-amber-50/40'}>
                        <td className="p-2 font-mono text-slate-400">{v.row.rowNum}</td>
                        <td className="p-2 font-mono font-bold">{v.row.classSN}</td>
                        <td className="p-2">{v.row.status || '—'}</td>
                        <td className="p-2 font-mono">{v.row.round || '—'}</td>
                        <td className="p-2">
                          {v.kind === 'ok' && (
                            <span className="text-green-700">✓ {v.student.name} → {v.status}{v.round ? ` (R${v.round})` : ''}</span>
                          )}
                          {v.kind === 'bad-status' && <span className="text-rose-600">Invalid status</span>}
                          {v.kind === 'unmatched' && <span className="text-rose-600">No student with that serial</span>}
                          {v.kind === 'wrong-class' && (
                            <span className="text-amber-700">Skipped — {v.student.name} is in {v.student.class}, not {session.class}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 font-mono">
                Class roster has {classStudents.length} students. Duplicate (sessionId, email) rows are upserted — re-importing is safe.
              </p>
            </>
          )}
        </div>

        <div className="bg-slate-50 border-t border-slate-200 px-5 py-3.5 flex items-center justify-end space-x-2">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 cursor-pointer">
            {committed !== null ? 'Close' : 'Cancel'}
          </button>
          {committed === null && (
            <button
              onClick={commit}
              disabled={busy || okRows.length === 0}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold shadow-sm cursor-pointer"
            >
              {busy ? 'Saving…' : `Save ${okRows.length} record${okRows.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}