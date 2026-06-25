import React, { useState, useEffect } from 'react';
import { 
  FolderSync, Database, RefreshCw, Key, Download, FileSpreadsheet, Check, 
  HelpCircle, AlertTriangle, AlertCircle, PlayCircle, Loader2, Users, FileJson
} from 'lucide-react';
import { GoogleDriveService, googleSignIn, logout, DriveFile } from '../../lib/googleDriveService';
import { DB } from '../../lib/database';
import { Student, Question } from '../../types';

interface DriveSyncProps {
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
}

export default function DriveSync({ triggerAuditLog }: DriveSyncProps) {
  // --- STATE ---
  const [googleUser, setGoogleUser] = useState<any | null>(null);
  const [accessToken, setAccessToken] = useState<string>('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  
  const [signingIn, setSigningIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncSuccess, setSyncSuccess] = useState('');

  // Selected file parse previews
  const [loadingContent, setLoadingContent] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [fileContentStr, setFileContentStr] = useState<string>('');

  // Fetch file list in Google Folder
  const fetchDriveFolderContents = async (token: string) => {
    setSyncing(true);
    setSyncError('');
    try {
      const driveFiles = await GoogleDriveService.getCbtFolderFiles(token);
      setFiles(driveFiles);
    } catch (err: any) {
      setSyncError('Failed to fetch Drive filesystem: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    setSyncError('');
    setSyncSuccess('');
    try {
      const res = await googleSignIn();
      if (res) {
        setGoogleUser(res.user);
        setAccessToken(res.accessToken);
        await fetchDriveFolderContents(res.accessToken);
        
        await triggerAuditLog(
          `Logged in to Google OAuth Workspace (${res.user.email}) under administrative console`,
          'Google Drive Hub',
          null,
          { uid: res.user.uid, email: res.user.email },
          "Admin linked cloud storage drive"
        );
      }
    } catch (err: any) {
      setSyncError('OAuth link failure: ' + err.message);
    } finally {
      setSigningIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setGoogleUser(null);
    setAccessToken('');
    setFiles([]);
    setSelectedFile(null);
    setFileContentStr('');
    setSyncSuccess('Successfully signed out of Google Cloud.');
  };

  const handleInspectFile = async (file: DriveFile) => {
    setSelectedFile(file);
    setLoadingContent(true);
    setSyncError('');
    setSyncSuccess('');
    try {
      const content = await GoogleDriveService.getFileContent(accessToken, file);
      setFileContentStr(content);
    } catch {
      setSyncError("Error parsing Drive stream content.");
    } finally {
      setLoadingContent(false);
    }
  };

  // Parsing CSV student lists downloaded from the Drive (Requirement student_roster.csv)
  const handleImportRosterCSV = async () => {
    if (!fileContentStr) return;
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');

    try {
      const lines = fileContentStr.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        throw new Error('CSV holds no records under the header mapping.');
      }

      // Check template headers (name,email,phone,gender,class,classSN)
      const headers = lines[0].toLowerCase().split(',');
      const emailIdx = headers.indexOf('email');
      const nameIdx = headers.indexOf('name');
      const classIdx = headers.indexOf('class');
      const classSnIdx = headers.indexOf('classsn');
      const phoneIdx = headers.indexOf('phone');
      const genderIdx = headers.indexOf('gender');

      if (emailIdx === -1 || nameIdx === -1 || classIdx === -1 || classSnIdx === -1) {
        throw new Error('Incompatible CSV file headers. Required: name, email, class, classSN');
      }

      const activeStudentsList = await DB.getStudents();
      const existingEmails = new Set(activeStudentsList.map(s => s.email.toLowerCase()));
      const existingSerials = new Set(activeStudentsList.map(s => s.classSN.toUpperCase()));

      const added: Student[] = [];
      const stats = { duplicates: 0, bad_format: 0 };

      for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (columns.length < 4) continue;

        const email = columns[emailIdx]?.toLowerCase();
        const name = columns[nameIdx];
        const studentClass = columns[classIdx] as any; // e.g. Class A or Class B
        const serial = columns[classSnIdx]?.toUpperCase();

        if (!email || !name || !studentClass || !serial) {
          stats.bad_format++;
          continue;
        }

        if (existingEmails.has(email) || existingSerials.has(serial)) {
          stats.duplicates++;
          continue;
        }

        added.push({
          id: `csv-${Date.now()}-${i}`,
          name,
          email,
          phone: phoneIdx !== -1 ? columns[phoneIdx] : undefined,
          gender: genderIdx !== -1 ? (columns[genderIdx] as any) : undefined,
          class: studentClass.includes('A') || studentClass.includes('a') ? 'Class A' : 'Class B',
          classSN: serial,
          createdAt: new Date().toISOString()
        });
      }

      if (added.length === 0) {
        setSyncError(`Roster synchronization completed. 0 candidates imported. Details: ${stats.duplicates} duplicates, ${stats.bad_format} bad format instances bypassed.`);
      } else {
        const currentTotal = [...activeStudentsList, ...added];
        await DB.setStudents(currentTotal);

        setSyncSuccess(`Success! Synced ${added.length} new candidate rows from Drive file: "${selectedFile?.name}". Details: ${stats.duplicates} duplicate rows bypassed.`);
        await triggerAuditLog(
          `Imported ${added.length} candidate profiles from Google Drive CSV file: ${selectedFile?.name}`,
          'Google Drive Sync',
          null,
          { importedCount: added.length },
          "Course coordination cloud roster sync"
        );
        fetchDriveFolderContents(accessToken);
      }
    } catch (err: any) {
      setSyncError('Failed to sync student CSV roster: ' + err.message);
    } finally {
      setSyncing(false);
      setSelectedFile(null);
      setFileContentStr('');
    }
  };

  // Parsing JSON questions downloaded from the Drive (Requirement midterm_questions.json)
  const handleImportQuestionsJSON = async () => {
    if (!fileContentStr) return;
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');

    try {
      const parsed = JSON.parse(fileContentStr);
      if (!Array.isArray(parsed)) {
        throw new Error('Questions payload is expected to be a JSON array of objects.');
      }

      const activeQuestionsList = await DB.getQuestions();
      const added: Question[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item.text || !item.type || !item.answer) {
          continue;
        }

        // Prevent exact prompt text duplicates
        if (activeQuestionsList.some(q => q.text.toLowerCase().trim() === item.text.toLowerCase().trim())) {
          continue;
        }

        added.push({
          id: `gdrive-json-q-${Date.now()}-${i}`,
          text: item.text.trim(),
          type: item.type,
          options: item.options,
          answer: item.answer.trim(),
          subject: item.subject || 'Imported Category',
          difficulty: item.difficulty || 'Easy',
          createdAt: new Date().toISOString()
        });
      }

      if (added.length === 0) {
        setSyncError('Questions sync completed. 0 added. Reason: Exact quiz prompt cards already existed inside DB structures.');
      } else {
        const payloadTotal = [...activeQuestionsList, ...added];
        await DB.setQuestions(payloadTotal);

        setSyncSuccess(`Success! Seeded ${added.length} fresh quiz cards linked from Drive file: "${selectedFile?.name}"!`);
        await triggerAuditLog(
          `Imported ${added.length} exam questions from Drive JSON file: ${selectedFile?.name}`,
          'Google Drive Sync',
          null,
          { importedCount: added.length },
          "Administrative cloud question seeding"
        );
        fetchDriveFolderContents(accessToken);
      }

    } catch (err: any) {
      setSyncError('Error seeding questions JSON: ' + err.message);
    } finally {
      setSyncing(false);
      setSelectedFile(null);
      setFileContentStr('');
    }
  };

  const handleEnrichFromContacts = async () => {
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');
    try {
      const contacts = await GoogleDriveService.getGoogleContacts(accessToken);
      if (contacts.length === 0) {
        setSyncError('Found 0 standard Google Contacts profiles linked to this Google workspace.');
        setSyncing(false);
        return;
      }

      const activeStudentsList = await DB.getStudents();
      let count = 0;

      // Match contact details to existing emails and enrich lacking telephone fields (Requirement 2 scope)
      const updatedStudents = activeStudentsList.map(student => {
        const match = contacts.find((c: { email: string; phone?: string }) => c.email.toLowerCase() === student.email.toLowerCase());
        if (match && !student.phone && match.phone) {
          count++;
          return { ...student, phone: match.phone };
        }
        return student;
      });

      if (count > 0) {
        await DB.setStudents(updatedStudents);
        setSyncSuccess(`Success! Enriched ${count} student profile phone directories with matching Google Contacts rosters.`);
        await triggerAuditLog(
          `Enriched ${count} candidate roster records using Google Contacts API linkages.`,
          'Google Contacts Sync',
          null,
          { enrichedCount: count },
          "Administrative automated contact directory sync"
        );
      } else {
        setSyncSuccess('Roster matches completed. Standard email maps are already consistent or contains no additional phone entries.');
      }

    } catch (err: any) {
      setSyncError('Google Contacts API failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };


  // --- RENDERING ---
  return (
    <div id="drive-sync-module-root" className="space-y-6">
      
      {/* DRIVE INTRO HERO */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm select-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 text-sans text-xs">
          <div className="space-y-1 grow h-auto max-w-2xl">
            <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2.5">
              <FolderSync className="w-6 h-6 text-cyan-600" />
              <span>CryoBytePrime Drive & Contacts Sync Hub</span>
            </h2>
            <p className="text-slate-500 font-normal leading-relaxed">
              Authenticate via OAuth to interact with the central <strong className="font-bold text-cyan-600">"cryobyteprime_cbt"</strong> storage. Fetch, evaluate, and seed student directories or assessment questionnaires instantly.
            </p>
          </div>

          <div className="shrink-0">
            {googleUser ? (
              <div className="flex items-center space-x-3.5 bg-slate-50 border border-slate-200 p-2 rounded-2xl">
                {googleUser.photoURL && (
                  <img src={googleUser.photoURL} alt="Avatar" className="w-9 h-9 rounded-xl border object-cover shrink-0" referrerPolicy="no-referrer" />
                )}
                <div className="text-left font-sans truncate shrink pr-2 max-w-[130px]">
                  <p className="font-extrabold text-slate-900 leading-tight truncate">{googleUser.displayName}</p>
                  <p className="text-[10px] text-slate-400 font-mono truncate">{googleUser.email}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3.5 py-2 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer border border-rose-100"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn}
                className="px-5 py-3.5 bg-slate-900 hover:bg-slate-950 font-black text-white text-xs tracking-tight rounded-2xl flex items-center space-x-2 transition-colors cursor-pointer shadow-md disabled:opacity-40"
              >
                {signingIn ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Database className="w-4.5 h-4.5 text-white" />}
                <span>Authorize Google Workspace</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SYNC NOTIFICATIONS */}
      {syncError && (
        <div className="p-4 bg-rose-50 border border-rose-150 rounded-2xl text-rose-750 text-xs flex items-start space-x-2 animate-zoom-in font-sans">
          <AlertCircle className="w-4.5 h-4.5 shrink-0 text-rose-500" />
          <span className="font-semibold leading-relaxed">{syncError}</span>
        </div>
      )}

      {syncSuccess && (
        <div className="p-4 bg-green-50 border border-green-150 rounded-2xl text-green-700 text-xs flex items-start space-x-2 animate-zoom-in font-sans">
          <Check className="w-4.5 h-4.5 shrink-0 text-green-500 font-black" />
          <span className="font-bold leading-relaxed">{syncSuccess}</span>
        </div>
      )}

      {/* CORE INTEGRATION DASHBOARD */}
      {googleUser && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 select-none font-sans text-xs">
          
          {/* LEFT: FILES INSIDE CRYOBYTEPRIME_CBT FOLDER */}
          <div className="lg:col-span-7 bg-white border rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest leading-none">Files inside "cryobyteprime_cbt" Folder</span>
              
              <button
                onClick={() => fetchDriveFolderContents(accessToken)}
                disabled={syncing}
                className="p-1.5 text-slate-400 hover:text-slate-800 rounded hover:bg-slate-50 transition-all cursor-pointer"
                title="Refresh Folder"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin text-cyan-600' : ''}`} />
              </button>
            </div>

            {files.length === 0 ? (
              <div className="py-14 text-center font-mono text-slate-400 text-xs text-zinc-400">
                Empty folder or loading structures. If empty, standard seeds (such as "CryoBytePrime_logo.png") will show on offline test run.
              </div>
            ) : (
              <div className="space-y-2.5">
                {files.map((file) => (
                  <div key={file.id} className="p-3 border border-slate-150 rounded-2xl bg-white hover:bg-slate-50/70 transition-all flex items-center justify-between group">
                    <div className="flex items-center space-x-3 truncate">
                      {file.mimeType.includes('csv') ? (
                        <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-150 flex items-center justify-center font-black text-cyan-700 shrink-0 font-sans text-[10px] tracking-tighter shadow-sm"><FileSpreadsheet className="w-5 h-5" /></div>
                      ) : file.mimeType.includes('json') ? (
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-150 flex items-center justify-center font-black text-indigo-705 shrink-0 font-sans text-[10px] tracking-tighter shadow-sm"><FileJson className="w-5 h-5" /></div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center font-black text-slate-500 shrink-0 font-sans text-[10px] tracking-tighter overflow-hidden">
                          {file.thumbnailLink ? <img src={file.thumbnailLink} alt="Thumb" className="w-full h-full object-cover shrink-0 referrerPolicy='no-referrer'" /> : 'DOC'}
                        </div>
                      )}
                      
                      <div className="truncate text-left leading-tight pr-1">
                        <p className="font-bold text-slate-900 truncate">{file.name}</p>
                        <p className="text-[9px] text-slate-400 font-mono mt-0.5 uppercase truncate">{file.mimeType.split('.').pop()?.split('/').pop() || 'DOCUMENT'}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleInspectFile(file)}
                      disabled={loadingContent}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-251 text-slate-700 rounded-lg text-[10px] font-bold transition-all shrink-0 cursor-pointer"
                    >
                      Inspect Sync
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: SYSTEM SYNC COMMAND DECK / PARSE VIEW */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
            
            {/* FILE SUB PREVIEW IMPORTER */}
            <div className="bg-white border rounded-3xl p-5 shadow-sm space-y-4 grow">
              {selectedFile ? (
                <div className="space-y-4 animate-fade-in flex flex-col justify-between h-full min-h-[300px]">
                  <div className="space-y-3">
                    <h3 className="font-bold text-slate-900 pb-2 border-b">
                      File Analyzer: <span className="font-mono text-zinc-600 text-xs">{selectedFile.name}</span>
                    </h3>

                    {loadingContent ? (
                      <div className="py-20 text-center font-mono text-[10px] text-slate-400">
                        Downloading Drive stream bytes...
                      </div>
                    ) : (
                      <>
                        <p className="text-[11px] text-slate-500 font-medium">Ready to parse and synchronize database structures. Inspect schema properties below:</p>
                        <div className="bg-slate-50 border font-mono text-[9px] rounded-xl p-3 max-h-36 overflow-y-auto whitespace-pre text-slate-600 leading-relaxed select-text shadow-inner">
                          {fileContentStr || "(Empty content returned)"}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Dynamic Action Trigger Button based on format */}
                  {!loadingContent && fileContentStr && (
                    <div className="pt-3 border-t">
                      {selectedFile.mimeType.includes('csv') || selectedFile.name.endsWith('.csv') ? (
                        <button
                          type="button"
                          onClick={handleImportRosterCSV}
                          className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-xs shadow-sm flex items-center justify-center space-x-1 transition-all cursor-pointer rounded-xl"
                        >
                          <PlayCircle className="w-4.5 h-4.5 text-white" />
                          <span>Commit Students CSV Import</span>
                        </button>
                      ) : selectedFile.mimeType.includes('json') || selectedFile.name.endsWith('.json') ? (
                        <button
                          type="button"
                          onClick={handleImportQuestionsJSON}
                          className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-xs shadow-sm flex items-center justify-center space-x-1 transition-all cursor-pointer rounded-xl"
                        >
                          <PlayCircle className="w-4.5 h-4.5 text-white" />
                          <span>Commit Questions JSON Import</span>
                        </button>
                      ) : (
                        <div className="p-3 bg-amber-50 text-amber-705 border border-amber-150 rounded-xl leading-relaxed text-[11px]">
                          This file type ({selectedFile.mimeType}) contains no automated bulk parsers. Ensure files match either <strong className="font-bold font-mono">.csv</strong> or <strong className="font-bold font-mono">.json</strong> templates.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center h-full space-y-3 font-normal">
                  <Database className="w-10 h-10 text-slate-300 stroke-1" />
                  <p className="max-w-[180px] leading-relaxed mx-auto">Select a document file on the left file explorer to run live Sync processes.</p>
                </div>
              )}
            </div>

            {/* INTEGRATION EXTRA COMMANDS AND MICRO-UTILITIES */}
            <div className="bg-[#0F172A] text-white border border-slate-800 rounded-3xl p-5 shadow-sm space-y-4 shrink-0 text-left">
              <h4 className="font-bold text-white text-xs pb-1.5 border-b border-rose-950/10 flex items-center space-x-1.5">
                <Users className="w-4.5 h-4.5 text-cyan-400 animate-pulse" />
                <span>Google Contacts Matcher</span>
              </h4>
              <p className="text-slate-450 text-[11px] leading-relaxed">
                Connect and sync missing phone directories of existing candidates instantly using safe matching keys.
              </p>
              <button
                type="button"
                onClick={handleEnrichFromContacts}
                disabled={syncing}
                className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-cyan-600/20 transition-all cursor-pointer"
              >
                Match Phone Records from Google Contacts
              </button>
            </div>

          </div>

        </div>
      )}

      {/* DOCUMENTATION HELP */}
      {!googleUser && (
        <div className="p-4 rounded-2xl bg-white border border-slate-200 text-slate-600 text-xs flex items-start space-x-3.5 leading-relaxed font-sans select-none shadow-sm">
          <HelpCircle className="w-5 h-5 shrink-0 text-cyan-500" />
          <div className="space-y-1">
            <p className="font-bold text-slate-900 text-xs text-slate-900">Aesthetic Google Drive seeding templates:</p>
            <p className="text-[11px] text-slate-500">
              The driver searches for a directory named <strong className="font-semibold text-slate-800">"cryobyteprime_cbt"</strong>. It matches <strong className="font-semibold text-slate-800 font-mono text-[10px]">student_roster.csv</strong> containing headers <strong className="font-mono text-[10px]">name,email,phone,gender,class,classSN</strong>, or MCQ assessments seeded inside <strong className="font-semibold text-slate-805 font-mono text-[10px]">midterm_questions.json</strong>.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
