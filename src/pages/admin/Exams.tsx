import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { 
  Award, HelpCircle, ToggleLeft, ToggleRight, Plus, Pencil, Trash2, 
  Search, ShieldAlert, Key, CheckCircle, XCircle, AlertTriangle, ListChecks,
  Sliders, PlusCircle, Check, Info, FileSpreadsheet, Send, Calendar, Clock, Lock as LockIcon,
  Download
} from 'lucide-react';
import { Question, ExamEligibility, Student, QuestionType, AdminRole } from '../../types';
import { DB } from '../../lib/database';
import { naturalSort } from '../../lib/attendanceUtils';
import CodeAwareText from '../../components/CodeAwareText';
import { confirmActionBool } from '../../components/confirmAction';

// Convert ISO timestamp <-> value for <input type="datetime-local"> (local timezone)
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSecs = Math.floor(ms / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return days > 0
    ? `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`
    : `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

interface ExamsProps {
  adminRole: AdminRole;
  adminEmail: string;
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
  protectionPasswordConfirm: (actionLabel: string, callback: () => void) => void;
}

export default function Exams({
  adminRole,
  adminEmail,
  triggerAuditLog,
  protectionPasswordConfirm
}: ExamsProps) {
  // --- STATE ---
  const [questions, setQuestions] = useState<Question[]>([]);
  const [eligibilityList, setEligibilityList] = useState<ExamEligibility[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [examActivated, setExamActivated] = useState(false);
  const [assessmentType, setAssessmentType] = useState<'exam' | 'test'>('exam');
  const assessmentLabel = assessmentType === 'test' ? 'Test' : 'Exam';

  // Schedule window (local time strings for <input type="datetime-local">)
  const [examStartLocal, setExamStartLocal] = useState<string>('');
  const [examEndLocal,   setExamEndLocal]   = useState<string>('');
  const [savedStartIso,  setSavedStartIso]  = useState<string | null>(null);
  const [savedEndIso,    setSavedEndIso]    = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMsg,    setScheduleMsg]    = useState<string>('');
  const [nowTick,        setNowTick]        = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ─── Auto-activate / auto-deactivate the Open gate at scheduled boundaries.
  // Runs whenever nowTick crosses examStartAt or examEndAt. Idempotent: only
  // writes when the desired state differs from the current `examActivated`.
  useEffect(() => {
    const startMs = savedStartIso ? new Date(savedStartIso).getTime() : null;
    const endMs   = savedEndIso   ? new Date(savedEndIso).getTime()   : null;
    if (!startMs && !endMs) return;
    const inWindow = (!startMs || nowTick >= startMs) && (!endMs || nowTick <= endMs);
    const desired = inWindow;
    if (desired === examActivated) return;
    // Only auto-flip ON when entering window, or OFF when leaving window
    (async () => {
      try {
        await DB.updateConfig({ examActivated: desired });
        setExamActivated(desired);
      } catch (e) {
        console.warn('[Schedule auto-activate] failed:', e);
      }
    })();
  }, [nowTick, savedStartIso, savedEndIso, examActivated]);


  // Exam controls (Task 1 + Task 3)
  const [examDuration, setExamDuration] = useState<number>(12);
  const [maxQuestions, setMaxQuestions] = useState<number>(20);
  const [randomizeQuestions, setRandomizeQuestions] = useState<boolean>(true);
  const [randomizeOptions, setRandomizeOptions] = useState<boolean>(false);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [controlsMsg, setControlsMsg] = useState('');

  // Monitoring settings (Task 2)
  const [monitoring, setMonitoring] = useState<Required<import('../../types').ExamMonitoringSettings>>({
    tabSwitch: true, fullscreen: true, copyPaste: true, rightClick: true,
    singleDevice: true, ipLogging: true, autoSubmit: true, resumePrevention: true,
    focusBlurShield: true, watermark: true, printBlock: true,
    screenshotDetect: true, screenCaptureDetect: true, maxViolations: 5,
  });
  const [monitoringSaving, setMonitoringSaving] = useState(false);
  const [monitoringMsg, setMonitoringMsg] = useState('');
  const [maxViolationsDraft, setMaxViolationsDraft] = useState<number>(5);

  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<'questions' | 'eligibility'>('questions');

  // Search/Filters
  const [qSearch, setQSearch] = useState('');
  const [eSearch, setESearch] = useState('');
  const [eClassFilter, setEClassFilter] = useState('All');
  const [eStatusFilter, setEStatusFilter] = useState('All');

  // New/Edit Question states
  const [isQModalOpen, setIsQModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState<QuestionType>('mcq');
  const [qOptions, setQOptions] = useState<string[]>(['', '', '', '']);
  const [qAnswer, setQAnswer] = useState('A');
  const [qSubject, setQSubject] = useState('');
  const [qDifficulty, setQDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Easy');
  const [qError, setQError] = useState('');

  // Eligibility Override states
  const [selectedElig, setSelectedElig] = useState<ExamEligibility | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);

  // Questions Import/Export states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importType, setImportType] = useState<'csv' | 'json' | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [parsedQuestions, setParsedQuestions] = useState<Omit<Question, 'id' | 'createdAt'>[]>([]);
  const [importError, setImportError] = useState('');
  const [jsonCopied, setJsonCopied] = useState(false);

  // Sync initial system config & lists
  const loadInitialData = async () => {
    setLoading(true);
    try {
      const qs = await DB.getQuestions();
      const elgs = await DB.getExamEligibility();
      const studs = await DB.getStudents();
      const conf = await DB.getConfig();

      setQuestions(qs);
      setEligibilityList(elgs);
      setStudents(studs);
      setExamActivated(conf.examActivated);
      setAssessmentType((conf.assessmentType === 'test') ? 'test' : 'exam');
      setSavedStartIso(conf.examStartAt ?? null);
      setSavedEndIso(conf.examEndAt ?? null);
      setExamStartLocal(isoToLocalInput(conf.examStartAt));
      setExamEndLocal(isoToLocalInput(conf.examEndAt));
      setExamDuration(typeof conf.examDurationMinutes === 'number' && conf.examDurationMinutes > 0 ? conf.examDurationMinutes : 12);
      setMaxQuestions(typeof conf.maxQuestions === 'number' && conf.maxQuestions > 0 ? conf.maxQuestions : 20);
      setRandomizeQuestions(conf.randomizeQuestions !== false);
      setRandomizeOptions(!!conf.randomizeOptions);
      setMonitoring({
        tabSwitch: conf.monitoring?.tabSwitch !== false,
        fullscreen: conf.monitoring?.fullscreen !== false,
        copyPaste: conf.monitoring?.copyPaste !== false,
        rightClick: conf.monitoring?.rightClick !== false,
        singleDevice: conf.monitoring?.singleDevice !== false,
        ipLogging: conf.monitoring?.ipLogging !== false,
        autoSubmit: conf.monitoring?.autoSubmit !== false,
        resumePrevention: conf.monitoring?.resumePrevention !== false,
        focusBlurShield: conf.monitoring?.focusBlurShield !== false,
        watermark: conf.monitoring?.watermark !== false,
        printBlock: conf.monitoring?.printBlock !== false,
        screenshotDetect: conf.monitoring?.screenshotDetect !== false,
        screenCaptureDetect: conf.monitoring?.screenCaptureDetect !== false,
        maxViolations: typeof conf.monitoring?.maxViolations === 'number' && conf.monitoring.maxViolations > 0 ? conf.monitoring.maxViolations : 5,
      });
      setMaxViolationsDraft(typeof conf.monitoring?.maxViolations === 'number' && conf.monitoring.maxViolations > 0 ? conf.monitoring.maxViolations : 5);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Live-sync admin Exams page with the remote `config` table so changes
  // made in another browser/tab show up here within ~1s instead of only on
  // page reload. Realtime is enabled on `public.config` via the
  // 20260628_realtime_config.sql migration.
  useEffect(() => {
    const channel = supabase
      .channel('admin-exams-config-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, () => {
        loadInitialData();
      })
      .subscribe();
    const interval = window.setInterval(() => { loadInitialData(); }, 15000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, []);

  // --- QUESTION BANK COMPUTED LISTS ---
  const filteredQuestions = useMemo(() => {
    const term = qSearch.toLowerCase().trim();
    if (!term) return questions;
    return questions.filter(q => 
      q.text.toLowerCase().includes(term) ||
      (q.subject && q.subject.toLowerCase().includes(term))
    );
  }, [questions, qSearch]);

  // --- ELIGIBILITY MAPPING COMPUTED LISTS (Requirement C2) ---
  const mappedEligibility = useMemo(() => {
    // Map existing eligibility, fallback to default 'locked' (unmarked) if student has no row yet
    const elimap = new Map<string, ExamEligibility>();
    eligibilityList.forEach(e => elimap.set(e.email.toLowerCase(), e));

    const list = students.map(student => {
      const emailLower = student.email.toLowerCase();
      const existing = elimap.get(emailLower);

      return {
        student,
        eligibility: existing || {
          id: `fallback-${student.id}`,
          sessionId: 'default',
          email: student.email,
          status: 'locked' as const,
          reason: 'unmarked' as const,
          updatedAt: student.createdAt
        }
      };
    });

    // Apply Filters
    let filtered = list;
    if (eClassFilter !== 'All') {
      filtered = filtered.filter(item => item.student.class === eClassFilter);
    }
    if (eStatusFilter !== 'All') {
      filtered = filtered.filter(item => item.eligibility.status === eStatusFilter);
    }
    if (eSearch.trim()) {
      const term = eSearch.toLowerCase().trim();
      filtered = filtered.filter(item => 
        item.student.name.toLowerCase().includes(term) ||
        item.student.classSN.toLowerCase().includes(term) ||
        item.student.email.toLowerCase().includes(term)
      );
    }

    // Natural sort by student serial code
    return filtered.sort((a, b) => naturalSort(a.student.classSN, b.student.classSN));
  }, [students, eligibilityList, eClassFilter, eStatusFilter, eSearch]);


  // --- CBT ACTIVATION GATING COMMANDS ---
  const handleToggleExam = async () => {
    const nextState = !examActivated;
    const actionLabel = nextState ? `ACTIVATE GENERAL ${assessmentLabel.toUpperCase()} ACCESS` : `DEACTIVATE GENERAL ${assessmentLabel.toUpperCase()} ACCESS`;

    protectionPasswordConfirm(actionLabel, async () => {
      try {
        await DB.updateConfig({ examActivated: nextState });
        setExamActivated(nextState);

        await triggerAuditLog(
          `${nextState ? 'Activated' : 'Suspended'} CBT Candidate Exam Entry overall gate`,
          'Exams Setup',
          { examActivated: !nextState },
          { examActivated: nextState },
          "Admin toggled general computer-based portal eligibility"
        );
      } catch (err) {
        alert("Config save failed: " + err);
      }
    });
  };

  const handleSetAssessmentType = async (next: 'exam' | 'test') => {
    if (next === assessmentType) return;
    protectionPasswordConfirm(`CHANGE ASSESSMENT TYPE TO ${next.toUpperCase()}`, async () => {
      try {
        await DB.updateConfig({ assessmentType: next });
        setAssessmentType(next);
        await triggerAuditLog(
          `Changed assessment type to "${next}"`,
          'Exams Setup',
          { assessmentType: assessmentType },
          { assessmentType: next },
          'Admin switched what students see called: Exam vs Test'
        );
      } catch (err) {
        alert('Config save failed: ' + err);
      }
    });
  };

  const handleSaveSchedule = async () => {
    setScheduleMsg('');
    const startIso = localInputToIso(examStartLocal);
    const endIso   = localInputToIso(examEndLocal);
    if (startIso && endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setScheduleMsg('End time must be after start time.');
      return;
    }
    protectionPasswordConfirm(`UPDATE ${assessmentLabel.toUpperCase()} SCHEDULE WINDOW`, async () => {
      setScheduleSaving(true);
      try {
        await DB.updateConfig({ examStartAt: startIso, examEndAt: endIso });
        await triggerAuditLog(
          `Updated ${assessmentLabel.toLowerCase()} schedule window`,
          'Exams Setup',
          { examStartAt: savedStartIso, examEndAt: savedEndIso },
          { examStartAt: startIso, examEndAt: endIso },
          'Admin set the assessment start/end window'
        );
        setSavedStartIso(startIso);
        setSavedEndIso(endIso);
        setScheduleMsg('Schedule saved.');
      } catch (err: any) {
        setScheduleMsg('Save failed: ' + (err?.message || err));
      } finally {
        setScheduleSaving(false);
      }
    });
  };

  const handleClearSchedule = () => {
    protectionPasswordConfirm(`CLEAR ${assessmentLabel.toUpperCase()} SCHEDULE WINDOW`, async () => {
      try {
        await DB.updateConfig({ examStartAt: null, examEndAt: null });
        await triggerAuditLog(
          `Cleared ${assessmentLabel.toLowerCase()} schedule window`,
          'Exams Setup',
          { examStartAt: savedStartIso, examEndAt: savedEndIso },
          { examStartAt: null, examEndAt: null },
          'Admin removed scheduled assessment window'
        );
        setSavedStartIso(null);
        setSavedEndIso(null);
        setExamStartLocal('');
        setExamEndLocal('');
        setScheduleMsg('Schedule cleared.');
      } catch (err: any) {
        setScheduleMsg('Clear failed: ' + (err?.message || err));
      }
    });
  };

  const handleSaveControls = async () => {
    setControlsMsg('');
    const dur = Math.max(1, Math.min(600, Math.floor(Number(examDuration) || 0)));
    const mq = Math.max(1, Math.min(500, Math.floor(Number(maxQuestions) || 0)));
    protectionPasswordConfirm(`UPDATE ${assessmentLabel.toUpperCase()} CONTROLS`, async () => {
      setControlsSaving(true);
      try {
        const prev = await DB.getConfig();
        await DB.updateConfig({
          examDurationMinutes: dur,
          maxQuestions: mq,
          randomizeQuestions,
          randomizeOptions,
        });
        await triggerAuditLog(
          `Updated ${assessmentLabel.toLowerCase()} controls (duration=${dur}m, maxQ=${mq}, randQ=${randomizeQuestions}, randOpt=${randomizeOptions})`,
          'Exams Setup',
          { duration: prev.examDurationMinutes, maxQuestions: prev.maxQuestions, randomizeQuestions: prev.randomizeQuestions, randomizeOptions: prev.randomizeOptions },
          { duration: dur, maxQuestions: mq, randomizeQuestions, randomizeOptions },
          'Admin updated per-attempt duration, question cap, and randomization'
        );
        setExamDuration(dur);
        setMaxQuestions(mq);
        setControlsMsg('Controls saved.');
      } catch (err: any) {
        setControlsMsg('Save failed: ' + (err?.message || err));
      } finally {
        setControlsSaving(false);
      }
    });
  };

  const handleToggleMonitoring = async (key: keyof typeof monitoring) => {
    const next = { ...monitoring, [key]: !monitoring[key] };
    setMonitoring(next);
    setMonitoringSaving(true);
    setMonitoringMsg('');
    try {
      await DB.updateConfig({ monitoring: next });
      await triggerAuditLog(
        `Toggled monitoring.${key} to ${next[key] ? 'ON' : 'OFF'}`,
        'Exams Setup',
        { [key]: monitoring[key] },
        { [key]: next[key] },
        'Admin changed exam monitoring setting'
      );
      setMonitoringMsg('Saved.');
    } catch (err: any) {
      setMonitoring(monitoring); // revert
      setMonitoringMsg('Save failed: ' + (err?.message || err));
    } finally {
      setMonitoringSaving(false);
    }
  };



  // --- QUESTION ACTIONS (ADD / EDIT / DELETE) ---
  const openQModal = (q?: Question) => {
    setQError('');
    if (q) {
      setEditingQuestion(q);
      setQText(q.text);
      setQType(q.type);
      setQOptions(q.options || ['', '', '', '']);
      setQAnswer(q.answer);
      setQSubject(q.subject || '');
      setQDifficulty(q.difficulty || 'Easy');
    } else {
      setEditingQuestion(null);
      setQText('');
      setQType('mcq');
      setQOptions(['', '', '', '']);
      setQAnswer('A');
      setQSubject('');
      setQDifficulty('Easy');
    }
    setIsQModalOpen(true);
  };

  const handleUpdateOption = (index: number, val: string) => {
    const updated = [...qOptions];
    updated[index] = val;
    setQOptions(updated);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setQError('');

    if (!qText.trim()) {
      setQError('Question prompt text cannot be blank.');
      return;
    }

    if (qType === 'mcq') {
      if (qOptions.some(o => !o.trim())) {
        setQError('All 4 option choices must be specified for MCQs.');
        return;
      }
    }

    const payload = {
      text: qText.trim(),
      type: qType,
      options: qType === 'mcq' ? qOptions.map(o => o.trim()) : undefined,
      answer: qType === 'truefalse' ? (qAnswer === 'True' || qAnswer === 'False' ? qAnswer : 'True') : qAnswer.trim(),
      subject: qSubject.trim() || 'General Programming',
      difficulty: qDifficulty
    };

    try {
      if (editingQuestion) {
        const result = await DB.updateQuestion(editingQuestion.id, payload);
        await triggerAuditLog(
          `Updated question ID: ${editingQuestion.id} (${payload.subject})`,
          'Exams Setup / Questions',
          editingQuestion,
          result,
          "Question payload adjusted in visual card modal"
        );
      } else {
        const result = await DB.addQuestion(payload);
        await triggerAuditLog(
          `Added new question to Bank: ${result.text.slice(0, 40)}...`,
          'Exams Setup / Questions',
          null,
          result,
          "Created new check question"
        );
      }
      setIsQModalOpen(false);
      loadInitialData();
    } catch (err) {
      setQError('Failed to save question: ' + err);
    }
  };

  const handleDeleteQuestion = (id: string, text: string) => {
    protectionPasswordConfirm("DELETE EXAM QUESTION", async () => {
      const ok = await confirmActionBool({
        title: 'Delete exam question',
        description: 'Permanently removes this question from the question pool. Any in-progress or future attempt referencing it will no longer see it.',
        scope: [
          `Question ID: ${id}`,
          `Text: "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"`,
        ],
        confirmLabel: 'Delete question',
        requireTypedConfirm: 'DELETE',
      });
      if (!ok) return;
      await DB.deleteQuestion(id);
      await triggerAuditLog(
        `Deleted question ID: ${id}`,
        'Exams Setup / Questions',
        { text },
        null,
        "Purged from question list pool"
      );
      loadInitialData();
    });
  };

  const handleDeleteAllQuestions = () => {
    if (questions.length === 0) {
      alert('The question pool is already empty.');
      return;
    }
    protectionPasswordConfirm("BULK DELETE QUESTION POOL", async () => {
      const ok = await confirmActionBool({
        title: 'Wipe the entire question pool',
        description: 'Permanently removes EVERY question from the pool. This cannot be undone. Active or future attempts will see no questions until you re-import.',
        scope: [
          `Total questions to delete: ${questions.length}`,
        ],
        confirmLabel: `Delete all ${questions.length} questions`,
        requireTypedConfirm: 'DELETE ALL',
      });
      if (!ok) return;
      const removed = await DB.deleteAllQuestions();
      await triggerAuditLog(
        `Bulk-deleted ${removed} questions from pool`,
        'Exams Setup / Questions',
        { count: removed },
        null,
        'Bulk wipe of question pool'
      );
      loadInitialData();
    });
  };

  // --- VALIDATE GRADING: scan for MCQ questions whose stored answer isn't A/B/C/D ---
  // Server grades by comparing student pick (always a letter A-D) to question.answer.
  // Any MCQ with a non-letter answer (e.g. full option text) will be marked WRONG even
  // when the student picks correctly. This audit auto-fixes them when possible.
  const handleValidateGrading = async () => {
    if (questions.length === 0) { alert('No questions to validate.'); return; }
    const KEYS = ['A', 'B', 'C', 'D'];
    const broken: { q: Question; suggestedLetter?: string }[] = [];
    const tfBroken: Question[] = [];
    questions.forEach(q => {
      const ans = String(q.answer ?? '').trim();
      if (q.type === 'mcq') {
        if (!KEYS.includes(ans.toUpperCase())) {
          const opts = (q.options || []).map(o => String(o ?? '').trim());
          const idx = opts.findIndex(o => o.toLowerCase() === ans.toLowerCase());
          broken.push({ q, suggestedLetter: idx >= 0 ? KEYS[idx] : undefined });
        }
      } else if (q.type === 'truefalse') {
        if (ans !== 'True' && ans !== 'False') tfBroken.push(q);
      }
    });
    if (broken.length === 0 && tfBroken.length === 0) {
      alert(`✅ All ${questions.length} questions will grade correctly.\n\nMCQ answers are A/B/C/D letters as expected, and True/False answers are normalized.`);
      return;
    }
    const fixable = broken.filter(b => b.suggestedLetter);
    const unfixable = broken.filter(b => !b.suggestedLetter);
    const summary = [
      `Found grading issues that would mark correct picks as WRONG:`,
      ``,
      `• MCQ with non-letter answer (auto-fixable): ${fixable.length}`,
      `• MCQ with answer not matching any option: ${unfixable.length}`,
      `• True/False with bad answer value: ${tfBroken.length}`,
      ``,
      fixable.length > 0 ? `Click OK to auto-fix the ${fixable.length} fixable MCQ${fixable.length === 1 ? '' : 's'} now (converts the stored answer text to the matching A/B/C/D letter). Unfixable rows must be edited manually.` : `No auto-fixable rows. Edit unfixable rows manually.`,
    ].join('\n');
    if (fixable.length === 0) { alert(summary); return; }
    if (!confirm(summary)) return;
    let fixed = 0;
    for (const { q, suggestedLetter } of fixable) {
      try {
        await DB.updateQuestion(q.id, { answer: suggestedLetter! });
        fixed++;
      } catch (e) {
        console.error('Failed to fix question', q.id, e);
      }
    }
    await triggerAuditLog(
      `Auto-fixed ${fixed} MCQ answer(s) to letter form`,
      'Exams Setup / Questions',
      { fixed, totalIssues: broken.length + tfBroken.length },
      null,
      'Validate grading — converted full-text MCQ answers to A/B/C/D'
    );
    alert(`Fixed ${fixed} question${fixed === 1 ? '' : 's'}. ${unfixable.length + tfBroken.length} still need manual review.`);
    loadInitialData();
  };

  // --- ELIGIBILITY OVERRIDES CONTROL (C2) ---
  const handleOpenOverride = (eli: ExamEligibility) => {
    setSelectedElig(eli);
    setOverrideReason('');
    setIsOverrideModalOpen(true);
  };

  const handleApplyOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedElig) return;

    if (!overrideReason.trim()) {
      alert("Override justification reason is required for security audits.");
      return;
    }

    try {
      const newStatus = selectedElig.status === 'eligible' ? 'locked' : 'eligible';
      
      const updated = await DB.updateExamEligibility('default', selectedElig.email, {
        status: newStatus,
        reason: 'admin_override',
        overrideBy: adminEmail,
        overrideReason: overrideReason.trim()
      });

      await triggerAuditLog(
        `GCP OVERRIDE: ${selectedElig.email} gate updated to: ${newStatus.toUpperCase()}`,
        'Exam Eligibility Overrides',
        selectedElig,
        updated,
        overrideReason.trim()
      );

      setIsOverrideModalOpen(false);
      setSelectedElig(null);
      loadInitialData();
    } catch (err) {
      alert("Eligibility overwrite failed: " + err);
    }
  };


  // --- QUESTIONS IMPORT / EXPORT METHODS ---

  const handleExportCSV = () => {
    if (questions.length === 0) {
      alert("No questions to export.");
      return;
    }
    const headers = ["Text", "Type", "Option A", "Option B", "Option C", "Option D", "Answer", "Subject", "Difficulty"];
    const rows = questions.map(q => {
      const optA = q.options?.[0] || '';
      const optB = q.options?.[1] || '';
      const optC = q.options?.[2] || '';
      const optD = q.options?.[3] || '';
      return [
        q.text,
        q.type,
        optA,
        optB,
        optC,
        optD,
        q.answer,
        q.subject || '',
        q.difficulty || 'Easy'
      ].map(field => `"${String(field).replace(/"/g, '""')}"`);
    });

    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `question_bank_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    triggerAuditLog(
      `Exported ${questions.length} questions to CSV`,
      'Exams Setup / Questions',
      null,
      null,
      "Question bank CSV download"
    ).catch(console.error);
  };

  const handleExportJSON = () => {
    if (questions.length === 0) {
      alert("No questions to export.");
      return;
    }
    const cleanQuestions = questions.map(({ id, createdAt, ...rest }) => rest);
    const jsonString = JSON.stringify(cleanQuestions, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `question_bank_export_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    triggerAuditLog(
      `Exported ${questions.length} questions to JSON`,
      'Exams Setup / Questions',
      null,
      null,
      "Question bank JSON download"
    ).catch(console.error);
  };

  const handleDownloadTemplate = () => {
    const template = {
      version: 1,
      questions: [
        {
          type: "mcq",
          text: "What does CPU stand for?",
          options: ["Central Processing Unit", "Core Power Unit", "Central Power Usage", "Computer Processing Unit"],
          correctIndex: 0,
          subject: "Computer Architecture",
          difficulty: "Easy"
        },
        {
          type: "truefalse",
          text: "Python is a compiled language.",
          answer: false,
          subject: "Programming",
          difficulty: "Easy"
        },
        {
          type: "fill",
          text: "The process of converting source code to machine code is called ______.",
          answer: "compilation",
          subject: "Programming",
          difficulty: "Medium"
        }
      ]
    };
    const jsonString = JSON.stringify(template, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "question_bank_template.json");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const parseCSVQuestions = (text: string) => {
    // Use papaparse — handles RFC-4180 quoted fields with embedded newlines,
    // which is what allows multi-line Python code blocks in a CSV cell to
    // preserve indentation correctly.
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h: string) => h.trim().toLowerCase(),
    });
    if (parsed.errors && parsed.errors.length > 0) {
      throw new Error('CSV parse error: ' + parsed.errors.map((e: any) => `Row ${e.row}: ${e.message}`).join('; '));
    }
    const rows = parsed.data || [];
    if (rows.length === 0) {
      throw new Error('CSV is empty or has no data rows after the header.');
    }
    const pick = (row: Record<string, string>, keys: string[]) => {
      for (const k of keys) {
        const v = row[k];
        if (v !== undefined && v !== null && String(v).length > 0) return String(v);
      }
      return '';
    };
    const questionsToImport: Omit<Question, 'id' | 'createdAt'>[] = [];
    const rowErrors: string[] = [];
    rows.forEach((row: Record<string, string>, idx: number) => {
      const textVal = pick(row, ['text']).replace(/\r\n/g, '\n');
      const typeVal = pick(row, ['type']).trim().toLowerCase();
      const answerVal = pick(row, ['answer']).replace(/\r\n/g, '\n');
      if (!textVal && !typeVal && !answerVal) return;
      if (!textVal) { rowErrors.push(`Row ${idx + 2}: missing "text"`); return; }
      if (!['mcq', 'truefalse', 'fill', 'code'].includes(typeVal)) {
        rowErrors.push(`Row ${idx + 2}: unsupported type "${typeVal}"`); return;
      }
      if (!answerVal) { rowErrors.push(`Row ${idx + 2}: missing "answer"`); return; }
      const resolvedType: QuestionType = typeVal === 'code' ? 'mcq' : (typeVal as QuestionType);
      let options: string[] | undefined = undefined;
      let resolvedAnswer = answerVal.trim();
      if (resolvedType === 'mcq') {
        const optA = pick(row, ['option a', 'optiona', 'optionA']).replace(/\r\n/g, '\n');
        const optB = pick(row, ['option b', 'optionb', 'optionB']).replace(/\r\n/g, '\n');
        const optC = pick(row, ['option c', 'optionc', 'optionC']).replace(/\r\n/g, '\n');
        const optD = pick(row, ['option d', 'optiond', 'optionD']).replace(/\r\n/g, '\n');
        if (!optA || !optB) { rowErrors.push(`Row ${idx + 2}: MCQ requires Option A and Option B`); return; }
        options = [optA, optB, optC, optD].filter(o => o !== '');
        const KEYS = ['A', 'B', 'C', 'D'];
        if (!KEYS.includes(resolvedAnswer.toUpperCase())) {
          const matchIdx = options.findIndex(o => o.toLowerCase() === resolvedAnswer.toLowerCase());
          if (matchIdx === -1) {
            rowErrors.push(`Row ${idx + 2}: answer "${resolvedAnswer.slice(0, 50)}" does not match any option`);
            return;
          }
          resolvedAnswer = KEYS[matchIdx];
        } else {
          resolvedAnswer = resolvedAnswer.toUpperCase();
        }
      } else if (resolvedType === 'truefalse') {
        const lower = resolvedAnswer.toLowerCase();
        if (lower === 'true') resolvedAnswer = 'True';
        else if (lower === 'false') resolvedAnswer = 'False';
      }
      const diffVal = pick(row, ['difficulty']).trim();
      questionsToImport.push({
        text: textVal,
        type: resolvedType,
        options,
        answer: resolvedAnswer,
        subject: pick(row, ['subject']).trim() || 'General Programming',
        difficulty: (['Easy','Medium','Hard'].includes(diffVal) ? diffVal as any : 'Easy'),
      });
    });
    if (rowErrors.length > 0) {
      throw new Error(`Import failed — fix the following rows and re-upload:\n\n${rowErrors.join('\n')}`);
    }
    if (questionsToImport.length === 0) {
      throw new Error('No valid exam questions parsed from CSV.');
    }
    return questionsToImport;
  };

  const parseJSONQuestions = (text: string) => {
    // CANONICAL JSON FORMAT (v1)
    // ----------------------------------------------------------------
    // Top-level shape (either is accepted):
    //   A) [ <question>, <question>, ... ]                 // bare array
    //   B) { "version": 1, "questions": [ <question>, ... ] }
    //
    // Question shape (per type):
    //   MCQ:
    //     { "type": "mcq", "text": "...", "options": ["A","B","C","D"],
    //       "correctIndex": 0,                // 0-based index INTO options (RECOMMENDED — bullet-proof)
    //       // -- or any ONE of these alternates --
    //       "correctOption": "A",             // letter
    //       "answer": "A" | "Central Processing Unit"
    //     }
    //   True/False:
    //     { "type": "truefalse", "text": "...", "answer": true | false | "True" | "False" }
    //   Fill in the blank:
    //     { "type": "fill", "text": "...", "answer": "compilation" }
    //
    // Common optional fields: id, subject, difficulty ("Easy"|"Medium"|"Hard").
    // Strict validator — every malformed item produces a clear error and the
    // whole import is rejected so a student can NEVER see a question whose
    // answer key is ambiguous or wrong.
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch (e: any) { throw new Error(`Invalid JSON: ${e.message}`); }

    const items: any[] = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).questions))
        ? (parsed as any).questions
        : [];
    if (!Array.isArray(parsed) && items.length === 0) {
      throw new Error('File must be a JSON array of questions, or an object with a "questions" array.');
    }
    if (items.length === 0) throw new Error('No questions found in JSON.');

    const KEYS = ['A', 'B', 'C', 'D'] as const;
    const errors: string[] = [];
    const out: Omit<Question, 'id' | 'createdAt'>[] = [];

    items.forEach((raw: any, idx: number) => {
      const label = `Item ${idx + 1}`;
      if (!raw || typeof raw !== 'object') { errors.push(`${label}: not an object`); return; }

      const text = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (!text) { errors.push(`${label}: missing/empty "text"`); return; }

      const rawType = String(raw.type ?? '').trim().toLowerCase();
      if (!['mcq', 'truefalse', 'fill', 'code'].includes(rawType)) {
        errors.push(`${label}: "type" must be one of mcq | truefalse | fill (got "${raw.type}")`); return;
      }
      const type: QuestionType = rawType === 'code' ? 'mcq' : (rawType as QuestionType);

      let options: string[] | undefined;
      let answer = '';

      if (type === 'mcq') {
        const rawOpts: any[] = Array.isArray(raw.options) ? raw.options : [];
        const opts = rawOpts.map(o => String(o ?? '').trim()).filter(o => o !== '');
        if (opts.length < 2) {
          errors.push(`${label}: MCQ needs at least 2 non-empty options`); return;
        }
        if (opts.length > 4) {
          errors.push(`${label}: MCQ supports at most 4 options (got ${opts.length})`); return;
        }
        const dupIdx = opts.findIndex((o, i) => opts.findIndex(x => x.toLowerCase() === o.toLowerCase()) !== i);
        if (dupIdx !== -1) {
          errors.push(`${label}: duplicate option text "${opts[dupIdx].slice(0, 40)}" — options must be unique`); return;
        }
        options = opts;

        // Resolve correct letter from (in order of preference):
        //   1. correctIndex   — 0-based number into options (safest)
        //   2. correctOption  — letter A/B/C/D
        //   3. answer         — letter A/B/C/D OR exact full option text (case-insensitive)
        let letter: string | null = null;

        if (typeof raw.correctIndex === 'number' && Number.isInteger(raw.correctIndex)) {
          if (raw.correctIndex < 0 || raw.correctIndex >= opts.length) {
            errors.push(`${label}: "correctIndex" ${raw.correctIndex} is out of range for ${opts.length} options`); return;
          }
          letter = KEYS[raw.correctIndex];
        } else if (raw.correctOption !== undefined && raw.correctOption !== null) {
          const co = String(raw.correctOption).trim().toUpperCase();
          if (!KEYS.includes(co as any) || KEYS.indexOf(co as any) >= opts.length) {
            errors.push(`${label}: "correctOption" must be one of ${KEYS.slice(0, opts.length).join('/')} (got "${raw.correctOption}")`); return;
          }
          letter = co;
        } else if (raw.answer !== undefined && raw.answer !== null && String(raw.answer).trim() !== '') {
          const a = String(raw.answer).trim();
          if (KEYS.includes(a.toUpperCase() as any) && KEYS.indexOf(a.toUpperCase() as any) < opts.length) {
            letter = a.toUpperCase();
          } else {
            const matches = opts
              .map((o, i) => ({ o, i }))
              .filter(({ o }) => o.toLowerCase() === a.toLowerCase());
            if (matches.length === 0) {
              errors.push(`${label}: "answer" ("${a.slice(0, 60)}") does not match any option. Use "correctIndex" (0-based) or set "answer" to the exact option text.`); return;
            }
            if (matches.length > 1) {
              errors.push(`${label}: "answer" matches ${matches.length} options — use "correctIndex" to disambiguate`); return;
            }
            letter = KEYS[matches[0].i];
          }
        } else {
          errors.push(`${label}: MCQ requires one of "correctIndex", "correctOption", or "answer"`); return;
        }
        answer = letter!;
      } else if (type === 'truefalse') {
        const v = raw.answer;
        if (v === true || v === 1) answer = 'True';
        else if (v === false || v === 0) answer = 'False';
        else if (typeof v === 'string') {
          const s = v.trim().toLowerCase();
          if (['true', 't', 'yes', 'y', '1'].includes(s)) answer = 'True';
          else if (['false', 'f', 'no', 'n', '0'].includes(s)) answer = 'False';
          else { errors.push(`${label}: True/False "answer" must be true or false (got "${v}")`); return; }
        } else {
          errors.push(`${label}: True/False requires boolean "answer" (true or false)`); return;
        }
      } else { // fill
        const a = raw.answer === undefined || raw.answer === null ? '' : String(raw.answer).trim();
        if (!a) { errors.push(`${label}: Fill-in requires a non-empty "answer"`); return; }
        answer = a;
      }

      const diff = String(raw.difficulty ?? '').trim();
      out.push({
        text,
        type,
        options,
        answer,
        subject: (typeof raw.subject === 'string' && raw.subject.trim()) ? raw.subject.trim() : 'General Programming',
        difficulty: (['Easy', 'Medium', 'Hard'].includes(diff) ? diff : 'Easy') as any,
      });
    });

    if (errors.length > 0) {
      throw new Error(`Import rejected — fix the following items and re-upload:\n\n${errors.join('\n')}`);
    }
    if (out.length === 0) throw new Error('No valid questions found in JSON file.');
    return out;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError('');
    setParsedQuestions([]);
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      try {
        if (ext === 'json') {
          setImportType('json');
          const parsed = parseJSONQuestions(text);
          setParsedQuestions(parsed);
        } else if (ext === 'csv') {
          setImportType('csv');
          const parsed = parseCSVQuestions(text);
          setParsedQuestions(parsed);
        } else {
          throw new Error("Unsupported file extension. Please select a .csv or .json file.");
        }
      } catch (err: any) {
        setImportError(err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    if (parsedQuestions.length === 0) return;
    try {
      await DB.bulkAddQuestions(parsedQuestions);
      await triggerAuditLog(
        `Imported ${parsedQuestions.length} questions from ${importFileName}`,
        'Exams Setup / Questions',
        null,
        { count: parsedQuestions.length, filename: importFileName },
        `Questions bulk uploaded via ${importType?.toUpperCase()} file`
      );
      setIsImportModalOpen(false);
      setParsedQuestions([]);
      setImportFileName('');
      await loadInitialData();
      alert(`Successfully imported ${parsedQuestions.length} questions to the bank.`);
    } catch (err: any) {
      setImportError(`Upload failed: ${err.message}`);
    }
  };


  // --- RENDER ---
  return (
    <div id="exams-module-root" className="space-y-6">
      
      {/* CBT ENTRY CONTROL HEADER CARD */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 border border-slate-800 shadow-lg select-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5 grow md:pr-4 min-w-0">
            <div className="flex items-center space-x-2">
              <Award className="w-5 h-5 text-cyan-400" />
              <span className="text-[10px] uppercase font-mono font-black tracking-widest text-slate-400 truncate">Computer-Based {assessmentLabel} Gateways</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight break-words">CBT Active {assessmentLabel} &amp; Roster Config</h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
              Turn the main {assessmentLabel.toLowerCase()} portal on or off, and pick whether students see this assessment titled as an <strong className="text-slate-200">Exam</strong> or a <strong className="text-slate-200">Test</strong>. Locked students must be manually whitelisted below.
            </p>

            {/* Assessment type segmented toggle */}
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Assessment Type:</span>
              <div className="inline-flex bg-slate-950 border border-slate-800 rounded-xl p-1">
                {(['exam', 'test'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleSetAssessmentType(t)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold uppercase tracking-tight transition-colors cursor-pointer ${
                      assessmentType === t
                        ? 'bg-cyan-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 shrink-0 bg-slate-950/80 px-4 py-3 rounded-2xl border border-slate-800 self-start md:self-auto">
            <span className="text-xs font-mono font-bold leading-none text-slate-400">{assessmentLabel.toUpperCase()} GATE:</span>
            {examActivated ? (
              <button
                type="button"
                onClick={handleToggleExam}
                className="flex items-center space-x-2 text-green-400 font-extrabold text-xs tracking-tight transition-all cursor-pointer focus:outline-none"
              >
                <span>OPEN (ACTIVATED)</span>
                <ToggleRight className="w-8 h-8 text-green-500 fill-green-500/10" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleToggleExam}
                className="flex items-center space-x-2 text-slate-400 font-bold text-xs tracking-tight transition-all cursor-pointer focus:outline-none"
              >
                <span>CLOSED (LOCKED)</span>
                <ToggleLeft className="w-8 h-8 text-slate-600" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ASSESSMENT SCHEDULE WINDOW */}
      {(() => {
        const startMs = savedStartIso ? new Date(savedStartIso).getTime() : null;
        const endMs   = savedEndIso   ? new Date(savedEndIso).getTime()   : null;
        let status: 'unset' | 'before' | 'live' | 'ended' = 'unset';
        let countdown = '';
        let label = '';
        if (startMs && endMs) {
          if (nowTick < startMs) { status = 'before'; countdown = formatCountdown(startMs - nowTick); label = `${assessmentLabel} starts in`; }
          else if (nowTick <= endMs) { status = 'live'; countdown = formatCountdown(endMs - nowTick); label = `${assessmentLabel} ends in`; }
          else { status = 'ended'; label = `${assessmentLabel} window has ended`; }
        }
        const statusColors: Record<typeof status, string> = {
          unset: 'bg-slate-100 text-slate-600 border-slate-200',
          before: 'bg-amber-50 text-amber-700 border-amber-200',
          live: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          ended: 'bg-rose-50 text-rose-700 border-rose-200',
        };
        return (
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2.5 min-w-0">
                <Calendar className="w-5 h-5 text-cyan-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-extrabold text-slate-900">{assessmentLabel} Schedule Window</h2>
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
                    Set when students may log in to begin the {assessmentLabel.toLowerCase()}. Students who are already in an attempt when the end time hits may complete and submit; new sign-ins are blocked after the end time.
                  </p>
                </div>
              </div>
              <div className={`px-3 py-2 rounded-xl border text-[11px] font-mono font-bold flex items-center gap-2 shrink-0 ${statusColors[status]}`}>
                <Clock className="w-3.5 h-3.5" />
                {status === 'unset' ? 'No schedule set' : (
                  <span>{label}{countdown ? `: ${countdown}` : ''}</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500">Start (local time)</span>
                <input
                  type="datetime-local"
                  value={examStartLocal}
                  onChange={(e) => setExamStartLocal(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:border-cyan-500"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500">End (local time)</span>
                <input
                  type="datetime-local"
                  value={examEndLocal}
                  onChange={(e) => setExamEndLocal(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:border-cyan-500"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSaveSchedule}
                disabled={scheduleSaving}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                {scheduleSaving ? 'Saving…' : 'Save Schedule'}
              </button>
              {(savedStartIso || savedEndIso) && (
                <button
                  type="button"
                  onClick={handleClearSchedule}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                >
                  Clear Schedule
                </button>
              )}
              {scheduleMsg && (
                <span className="text-[11px] font-mono text-slate-500">{scheduleMsg}</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* EXAM CONTROLS — Task 1 (duration) + Task 3 (max questions + randomization) */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="flex items-start gap-2.5">
          <Clock className="w-5 h-5 text-cyan-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-slate-900">{assessmentLabel} Controls</h2>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
              Per-attempt duration, question cap, and shuffle behavior. Grading always matches the original answer value, never the displayed position, so randomization is safe.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1 block">
            <span className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500">{assessmentLabel} Duration (minutes)</span>
            <input
              type="number"
              min={1}
              max={600}
              value={examDuration}
              onChange={(e) => setExamDuration(parseInt(e.target.value || '0', 10))}
              className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs font-bold focus:bg-white focus:outline-none focus:border-cyan-500"
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] font-black font-mono uppercase tracking-wider text-slate-500">Max questions per session</span>
            <input
              type="number"
              min={1}
              max={500}
              value={maxQuestions}
              onChange={(e) => setMaxQuestions(parseInt(e.target.value || '0', 10))}
              className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs font-bold focus:bg-white focus:outline-none focus:border-cyan-500"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
            <span className="text-xs font-bold text-slate-700">Randomize question order</span>
            <input
              type="checkbox"
              checked={randomizeQuestions}
              onChange={(e) => setRandomizeQuestions(e.target.checked)}
              className="w-4 h-4 accent-cyan-600 cursor-pointer"
            />
          </label>
          <label className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
            <span className="text-xs font-bold text-slate-700">Randomize MCQ option order</span>
            <input
              type="checkbox"
              checked={randomizeOptions}
              onChange={(e) => setRandomizeOptions(e.target.checked)}
              className="w-4 h-4 accent-cyan-600 cursor-pointer"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveControls}
            disabled={controlsSaving}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            {controlsSaving ? 'Saving…' : 'Save Controls'}
          </button>
          {controlsMsg && <span className="text-[11px] font-mono text-slate-500">{controlsMsg}</span>}
        </div>
      </div>

      {/* MONITORING SETTINGS — Task 2 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="flex items-start gap-2.5">
          <LockIcon className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-slate-900">Exam Monitoring Settings</h2>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
              Toggle individual integrity controls. Disabled controls won't run in the student CBT portal.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            ['tabSwitch', 'Tab Switch Detection', 'Log + warn on window/tab change'],
            ['fullscreen', 'Fullscreen Enforcement', 'Force fullscreen, flag on exit'],
            ['copyPaste', 'Copy / Paste Disable', 'Block clipboard during exam'],
            ['rightClick', 'Right-Click Disable', 'Prevent context menu'],
            ['singleDevice', 'Single-Device Lock', 'Flag duplicate sessions on same token'],
            ['ipLogging', 'IP Address Logging', 'Record IP per session'],
            ['autoSubmit', 'Auto-Submit on Timeout', 'Submit when timer hits zero'],
            ['resumePrevention', 'Resume Prevention', 'Block re-entry after exit'],
            ['focusBlurShield', 'Focus Blur Shield', 'Solid overlay when window loses focus'],
            ['watermark', 'Candidate Watermark', 'Overlay name/serial across exam'],
            ['printBlock', 'Print / PDF Block', 'Hide exam content from Print/Save-as-PDF'],
            ['screenshotDetect', 'Screenshot Shortcut Intercept', 'Warn on PrtScn / Cmd+Shift+3/4'],
            ['screenCaptureDetect', 'Screen Capture Detection', 'Detect screen share / recording (getDisplayMedia)'],
          ] as const).map(([key, label, desc]) => (
            <label key={key} className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer hover:bg-slate-100/70">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-800">{label}</div>
                <div className="text-[10px] text-slate-500 font-mono">{desc}</div>
              </div>
              <input
                type="checkbox"
                checked={!!monitoring[key]}
                onChange={() => handleToggleMonitoring(key)}
                disabled={monitoringSaving}
                className="w-4 h-4 accent-rose-600 mt-0.5 cursor-pointer shrink-0"
              />
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-800">Max Violations Before Auto-Submit</div>
            <div className="text-[10px] text-slate-500 font-mono">Combined limit across all integrity categories (1–20). Default 5.</div>
          </div>
          <input
            type="number"
            min={1}
            max={20}
            value={maxViolationsDraft}
            onChange={(e) => setMaxViolationsDraft(Math.max(1, Math.min(20, parseInt(e.target.value || '5', 10) || 5)))}
            onBlur={async () => {
              if (maxViolationsDraft === monitoring.maxViolations) return;
              const prev = monitoring.maxViolations;
              const next = { ...monitoring, maxViolations: maxViolationsDraft };
              setMonitoring(next);
              setMonitoringSaving(true);
              try {
                await DB.updateConfig({ monitoring: next });
                await triggerAuditLog(
                  `Changed maxViolations to ${maxViolationsDraft}`,
                  'Exams Setup',
                  { maxViolations: prev },
                  { maxViolations: maxViolationsDraft },
                  'Admin changed violation threshold'
                );
                setMonitoringMsg('Saved.');
              } catch (err: any) {
                setMonitoring(monitoring);
                setMaxViolationsDraft(prev);
                setMonitoringMsg('Save failed: ' + (err?.message || err));
              } finally {
                setMonitoringSaving(false);
              }
            }}
            className="w-20 text-center bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-mono font-extrabold"
            disabled={monitoringSaving}
          />
        </div>

        {monitoringMsg && <p className="text-[11px] font-mono text-slate-500">{monitoringMsg}</p>}
      </div>




      {/* CORE NAVIGATION TAB CONTROLS */}
      <div className="flex border-b border-slate-200 text-xs text-sans">
        <button
          onClick={() => setCurrentTab('questions')}
          className={`py-3 px-5 font-bold border-b-2 transition-all cursor-pointer ${
            currentTab === 'questions' 
              ? 'border-cyan-600 text-slate-900 bg-cyan-50/10 font-bold' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          Questions Pool ({questions.length})
        </button>
        <button
          onClick={() => setCurrentTab('eligibility')}
          className={`py-3 px-5 font-bold border-b-2 transition-all cursor-pointer ${
            currentTab === 'eligibility' 
              ? 'border-cyan-600 text-slate-900 bg-cyan-50/10 font-bold' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          Candidate CBT Eligibility & Overrides ({students.length})
        </button>
      </div>

      {/* VIEWPORT CONTROLS */}
      {currentTab === 'questions' ? (
        <div className="space-y-4 animate-fade-in">
          {/* SEARCH & REFRESH */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 border border-slate-200 rounded-2xl select-none">
            <div className="relative grow max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search queries and subjects..."
                value={qSearch}
                onChange={(e) => setQSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-250 rounded-xl focus:outline-none focus:bg-white text-xs text-slate-705 font-medium placeholder:text-slate-400"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-705 border border-slate-250 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1"
                title="Download questions as CSV"
              >
                <span>Export CSV</span>
              </button>
              
              <button
                type="button"
                onClick={handleExportJSON}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-705 border border-slate-250 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1"
                title="Download questions as JSON"
              >
                <span>Export JSON</span>
              </button>

              <button
                type="button"
                onClick={handleDeleteAllQuestions}
                disabled={questions.length === 0}
                className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Permanently delete every question in the pool"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete All</span>
              </button>

              <button
                type="button"
                onClick={handleValidateGrading}
                disabled={questions.length === 0}
                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Scan question pool for answers that would mark correct picks as wrong, and auto-fix them"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Validate Grading</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setImportError('');
                  setParsedQuestions([]);
                  setImportFileName('');
                  setIsImportModalOpen(true);
                }}
                className="px-3.5 py-2 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1 animate-pulse"
                title="Upload JSON/CSV to import questions"
              >
                <span>Import Q-Bank</span>
              </button>

              <button
                type="button"
                onClick={() => openQModal()}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-950 text-white rounded-xl text-xs font-bold shadow-sm flex items-center space-x-1 transition-colors cursor-pointer"
              >
                <PlusCircle className="w-4 h-4 text-white" />
                <span>Insert Question</span>
              </button>
            </div>
          </div>

          {/* QUESTIONS CARDS LIST */}
          {loading ? (
            <div className="py-20 text-center font-mono text-xs text-slate-400">
              Fetching database questions pool...
            </div>
          ) : filteredQuestions.length === 0 ? (
            <div className="bg-white border rounded-2xl p-12 text-center text-slate-450 text-xs text-slate-400">
              No questions found. Click "Insert Question" to begin seeding the pool.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredQuestions.map((q, idx) => (
                <div key={q.id} className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-4.5 shadow-sm hover:shadow transition-all relative flex flex-col justify-between group select-none">
                  <div className="space-y-3.5 pr-8">
                    {/* Difficulty and Subject metrics */}
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded-[5px] text-[9px] font-black tracking-tight font-mono bg-slate-100 text-slate-650 border border-slate-200 uppercase">{q.subject}</span>
                      <span className={`px-2 py-0.5 rounded-[5px] text-[9px] font-black tracking-tight font-mono border uppercase ${
                        q.difficulty === 'Easy' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                          : q.difficulty === 'Medium'
                          ? 'bg-amber-50 text-amber-705 border-amber-100'
                          : 'bg-rose-50 text-rose-700 border-rose-100'
                      }`}>{q.difficulty}</span>
                    </div>

                    {/* Question text */}
                    <div className="font-bold text-slate-900 text-xs leading-relaxed">
                      <span className="mr-1">{idx + 1}.</span>
                      <CodeAwareText text={q.text} />
                    </div>

                    {/* Options, if MCQ */}
                    {q.type === 'mcq' && Array.isArray(q.options) && (
                      <div className="space-y-1.5 grid grid-cols-2 gap-2">
                        {q.options.map((opt, i) => {
                          const optKey = ['A','B','C','D'][i];
                          const isCorrect = q.answer === optKey;
                          return (
                            <div key={i} className={`p-2 rounded-xl text-[11px] border font-sans select-none tracking-tight ${
                              isCorrect 
                                ? 'bg-green-50 border-green-200/60 text-green-800 font-extrabold shadow-sm' 
                                : 'bg-slate-50 border-slate-150 text-slate-500'
                            }`}>
                              <span className="font-mono font-black pr-1">{optKey}.</span> {opt}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* True / False display */}
                    {q.type === 'truefalse' && (
                      <div className="flex items-center space-x-2">
                        <span className={`px-3 py-1 bg-slate-50 text-[11px] font-semibold border rounded-lg ${q.answer === 'True' ? 'bg-green-50 border-green-200/50 text-green-700 font-black' : 'text-slate-400 border-slate-200'}`}>True</span>
                        <span className={`px-3 py-1 bg-slate-50 text-[11px] font-semibold border rounded-lg ${q.answer === 'False' ? 'bg-green-50 border-green-200/50 text-green-700 font-black' : 'text-slate-400 border-slate-200'}`}>False</span>
                      </div>
                    )}

                    {/* Fill Gap display */}
                    {q.type === 'fill' && (
                      <div className="p-2 bg-indigo-50/40 border border-indigo-100/50 text-indigo-850 font-mono text-[11px] rounded-xl">
                        Correct Input Phrase: <span className="font-black text-slate-900">{q.answer}</span>
                      </div>
                    )}
                  </div>

                  {/* Operation buttons overlaying on hover */}
                  <div className="absolute right-3.5 top-3 flex items-center space-x-1.5">
                    <button
                      onClick={() => openQModal(q)}
                      className="p-1 text-slate-450 hover:text-slate-700 hover:bg-slate-100 rounded transition-all cursor-pointer"
                      title="Edit Question"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteQuestion(q.id, q.text)}
                      className="p-1 text-slate-400 hover:text-rose-550 hover:bg-rose-50 rounded transition-all cursor-pointer"
                      title="Delete Question"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* TAB 2: CBT ELIGIBILITY GATE PANEL (Requirement C2) */
        <div className="space-y-4 animate-fade-in select-none">
          {/* SEARCH & STREAM FILTERS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-white p-3.5 border border-slate-200 rounded-2xl text-xs">
            {/* Search email or code */}
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search candidates by serial or name..."
                value={eSearch}
                onChange={(e) => setESearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white text-slate-705 placeholder:text-slate-400"
              />
            </div>

            {/* Class stream */}
            <select
              value={eClassFilter}
              onChange={(e) => setEClassFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl focus:outline-none focus:bg-white text-slate-700 cursor-pointer font-semibold"
            >
              <option value="All">All Class Streams</option>
              <option value="Class A">Class A Only</option>
              <option value="Class B">Class B Only</option>
            </select>

            {/* Gate Status */}
            <select
              value={eStatusFilter}
              onChange={(e) => setEStatusFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 py-2 px-3 rounded-xl focus:outline-none focus:bg-white text-slate-700 cursor-pointer font-semibold"
            >
              <option value="All">All Portal States</option>
              <option value="eligible">Eligible (Unlocked)</option>
              <option value="locked">Locked (Blocked)</option>
            </select>
          </div>

          {/* ELIGIBILITY OVERRIDES TABLE */}
          <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full border-collapse text-left text-xs text-slate-700">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] tracking-wider font-mono font-bold uppercase">
                <tr>
                  <th className="p-3.5">Serial</th>
                  <th className="p-3.5">Candidate Email</th>
                  <th className="p-3.5 opacity-80">Stream</th>
                  <th className="p-3.5">Portal Lock Status</th>
                  <th className="p-3.5">Evaluation Source</th>
                  <th className="p-3.5">Override Reason Logs</th>
                  <th className="p-3.5 text-right pr-6 w-36">Toggle Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center text-slate-400 font-mono">
                      Querying candidate access states...
                    </td>
                  </tr>
                ) : mappedEligibility.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center text-slate-400">
                      No matching student configurations found.
                    </td>
                  </tr>
                ) : (
                  mappedEligibility.map(({ student, eligibility }) => {
                    const isEligible = eligibility.status === 'eligible';
                    return (
                      <tr key={student.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3.5 font-mono font-black text-slate-900">{student.classSN}</td>
                        <td className="p-3.5">
                          <div>
                            <p className="font-bold text-slate-900 leading-tight">{student.name}</p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{student.email}</p>
                          </div>
                        </td>
                        <td className="p-3.5">{student.class}</td>
                        <td className="p-3.5">
                          {isEligible ? (
                            <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-green-50 border border-green-200 text-green-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                              <span>ELIGIBLE TO START</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 border border-rose-150 text-rose-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                              <span>PORTAL LOCKED</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-[10px] font-bold">
                          {eligibility.reason === 'present' && <span className="text-green-600">Present (Round 1)</span>}
                          {eligibility.reason === 'late' && <span className="text-amber-600">Late Arrived (Round 2)</span>}
                          {eligibility.reason === 'absent' && <span className="text-rose-600">Absent</span>}
                          {eligibility.reason === 'unmarked' && <span className="text-slate-400">Unmarked</span>}
                          {eligibility.reason === 'admin_override' && (
                            <span className="inline-flex items-center space-x-1 text-cyan-700 bg-cyan-50 border border-cyan-150 px-2 py-0.5 rounded text-[9px] font-mono">
                              <Key className="w-2.5 h-2.5 text-cyan-600" />
                              <span>Admin whitelisted</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 italic text-[11px] text-slate-500 max-w-[200px] truncate" title={eligibility.overrideReason}>
                          {eligibility.overrideReason || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="p-3.5 text-right pr-6">
                          <button
                            onClick={() => handleOpenOverride(eligibility)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight shadow-sm border transition-colors cursor-pointer ${
                              isEligible
                                ? 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700'
                                : 'bg-green-50 border-green-200 hover:bg-green-100 text-green-700'
                            }`}
                          >
                            {isEligible ? 'Lock Gate' : 'Whitelist'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* QUESTION POPUP MODAL */}
      {isQModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-45 animate-fade-in select-none">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col animate-zoom-in">
            {/* Header */}
            <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex items-center justify-between font-sans text-xs">
              <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                <HelpCircle className="w-5 h-5 text-cyan-600" />
                <span>{editingQuestion ? 'Modify Exam Question' : 'Add New Exam Question'}</span>
              </h3>
              <button onClick={() => setIsQModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Container */}
            <form onSubmit={handleSaveQuestion} className="p-5 overflow-y-auto space-y-4 text-xs">
              {qError && (
                <div className="p-3 bg-rose-50 border border-rose-100 text-rose-750 font-mono rounded-lg">
                  {qError}
                </div>
              )}

              {/* Subject Category Tag */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Topic / Domain Subject</label>
                  <input
                    type="text"
                    value={qSubject}
                    onChange={(e) => setQSubject(e.target.value)}
                    placeholder="e.g. Python Functions"
                    className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-200 focus:bg-white focus:outline-none"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Test Difficulty</label>
                  <select
                    value={qDifficulty}
                    onChange={(e) => setQDifficulty(e.target.value as any)}
                    className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-200 focus:bg-white focus:outline-none cursor-pointer text-slate-700"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </select>
                </div>
              </div>

              {/* Query Type Toggle */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase font-sans">Choice Input Type</label>
                <div className="grid grid-cols-3 bg-slate-100 p-1 border rounded-xl">
                  {(['mcq', 'truefalse', 'fill'] as QuestionType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setQType(t);
                        setQAnswer(t === 'mcq' ? 'A' : t === 'truefalse' ? 'True' : '');
                      }}
                      className={`py-1.5 rounded text-[10px] font-bold uppercase transition-all tracking-tight cursor-pointer ${
                        qType === t ? 'bg-white text-slate-900 shadow' : 'text-slate-500 font-medium'
                      }`}
                    >
                      {t === 'mcq' ? '4-Option MCQ' : t === 'truefalse' ? 'True/False' : 'Fill Gap'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Area */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Question Prompt / Stem Text</label>
                <textarea
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder={'Tip: wrap Python code in fenced blocks to preserve indentation:\n\n```python\ndef greet(name):\n    print(f"Hello, {name}")\n```'}
                  className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-200 focus:bg-white focus:outline-none h-32 resize-y font-mono text-[12px] whitespace-pre"
                  spellCheck={false}
                  required
                />
                <p className="text-[10px] text-slate-400 font-sans leading-relaxed">
                  Indentation inside <code className="px-1 rounded bg-slate-100 border">```python ... ```</code> fences is preserved exactly as PEP-8 style code. Tabs in option fields are also kept.
                </p>
              </div>

              {/* MCQ Options Choices */}
              {qType === 'mcq' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Specify Options & Correct Choice</label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {['A','B','C','D'].map((key, i) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-black text-slate-500">Option {key}</span>
                          <input
                            type="radio"
                            name="correctAnswerOptionChoice animate"
                            checked={qAnswer === key}
                            onChange={() => setQAnswer(key)}
                            className="text-cyan-600 cursor-pointer accent-cyan-600"
                          />
                        </div>
                        <input
                          type="text"
                          value={qOptions[i] || ''}
                          onChange={(e) => handleUpdateOption(i, e.target.value)}
                          placeholder={`Text choice ${key}`}
                          className="w-full bg-slate-50 p-2 rounded-lg border focus:bg-white focus:outline-none text-[11px]"
                          required
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* True False correct option pick */}
              {qType === 'truefalse' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Expected True or False setting</label>
                  <div className="flex items-center space-x-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
                    <label className="flex items-center space-x-1.5 cursor-pointer text-slate-700">
                      <input
                        type="radio"
                        checked={qAnswer === 'True'}
                        onChange={() => setQAnswer('True')}
                        className="accent-cyan-600 cursor-pointer"
                      />
                      <span className="font-semibold text-xs">True is correct</span>
                    </label>
                    <label className="flex items-center space-x-1.5 cursor-pointer text-slate-700">
                      <input
                        type="radio"
                        checked={qAnswer === 'False'}
                        onChange={() => setQAnswer('False')}
                        className="accent-cyan-600 cursor-pointer"
                      />
                      <span className="font-semibold text-xs">False is correct</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Fill gap text correct payload */}
              {qType === 'fill' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Correct Text String Answer (Case-Insensitive)</label>
                  <input
                    type="text"
                    value={qAnswer}
                    onChange={(e) => setQAnswer(e.target.value)}
                    placeholder="e.g. useMemo"
                    className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-200 focus:bg-white focus:outline-none font-mono text-cyan-600 font-bold"
                    required
                  />
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsQModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-705 bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  className="px-4.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold shadow-sm flex items-center space-x-1 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-white" />
                  <span>Commit Question</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ELIGIBILITY OVERRIDE LOGGING MODAL (C2) */}
      {isOverrideModalOpen && selectedElig && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-45 animate-fade-in select-none">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full animate-zoom-in">
            <div className="bg-slate-50 border-b border-slate-150 px-5 py-3.5 flex items-center justify-between font-sans text-xs">
              <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                <ShieldAlert className="w-4.5 h-4.5 text-rose-550" />
                <span>Override Candidate Entrance Gate</span>
              </h3>
              <button onClick={() => { setIsOverrideModalOpen(false); setSelectedElig(null); }} className="text-slate-450 hover:text-slate-650 cursor-pointer">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyOverride} className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Target Candidate Profile</p>
                <p className="font-bold text-slate-900 leading-tight">
                  {(students.find(s => s.email.toLowerCase() === selectedElig.email.toLowerCase())?.name) || 'Loading Candidate'}
                </p>
                <p className="font-mono text-[10px] text-slate-405">{selectedElig.email}</p>
                <p className="font-mono mt-1">
                  CURRENT ENTRANCE: {selectedElig.status === 'eligible' 
                    ? <span className="text-green-600 font-extrabold font-sans">ELIGIBLE (OPEN)</span> 
                    : <span className="text-rose-600 font-bold font-sans">LOCKED (BLOCKED)</span>
                  }
                </p>
              </div>

              {/* Justification Reason entry */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">
                  Write Audit Log Override Reason (Required)
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Student whitelisted due to pre-excused sick leave with doctor note verification."
                  className="w-full bg-slate-50 border border-slate-250 p-2.5 rounded-xl h-20 resize-none font-sans focus:outline-none focus:bg-white"
                  required
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setIsOverrideModalOpen(false); setSelectedElig(null); }}
                  className="px-4 py-2 border rounded-lg text-slate-655 font-semibold bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 rounded-lg text-white font-extrabold shadow-sm cursor-pointer ${
                    selectedElig.status === 'eligible' ? 'bg-rose-605 hover:bg-rose-700' : 'bg-green-605 hover:bg-green-700'
                  }`}
                >
                  {selectedElig.status === 'eligible' ? 'Confirm Lock' : 'Confirm Whitelist'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXAM QUESTIONS IMPORT MODAL */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-45 animate-fade-in select-none">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full animate-zoom-in flex flex-col max-h-[85vh]">
            <div className="bg-slate-50 border-b border-slate-150 px-5 py-4.5 flex items-center justify-between font-sans text-xs">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Bulk Questions Roster Import</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Acceptable formats: standard JSON array or CSV spreadsheet</p>
              </div>
              <button 
                onClick={() => { setIsImportModalOpen(false); setParsedQuestions([]); setImportFileName(''); }} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs grow">
              {/* File input selector */}
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-cyan-500 hover:bg-cyan-50/5 transition-all relative">
                <input
                  type="file"
                  accept=".csv,.json"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <FileSpreadsheet className="w-9 h-9 text-slate-400 mx-auto mb-2" />
                <p className="font-bold text-slate-700">Click or Drag a JSON or CSV question file here</p>
                <p className="text-[10px] text-slate-400 mt-1">Only <strong>.csv</strong> and <strong>.json</strong> are accepted. CSV columns: Text, Type, Option A, Option B, Option C, Option D, Answer, Subject, Difficulty.</p>
                <p className="text-[10px] text-cyan-700 mt-1.5 font-semibold">Python code is supported — wrap it in <code className="px-1 rounded bg-slate-100 border">```python ... ```</code> fences in any cell to preserve indentation. Quote multi-line CSV cells with double quotes.</p>
              </div>

              {/* JSON Format Reference — CANONICAL v1 */}
              <details className="border border-slate-200 rounded-xl bg-slate-50 text-[10px] font-mono" open>
                <summary className="px-3.5 py-2.5 cursor-pointer font-bold text-slate-600 text-[11px] font-sans select-none list-none flex items-center justify-between">
                  <span>📋 Canonical JSON Format (v1) — guarantees correct grading</span>
                  <span className="text-slate-400 font-normal text-[9px] uppercase tracking-wide">click to expand</span>
                </summary>
                <div className="px-3.5 pb-3.5 pt-1 space-y-2">
                  <p className="font-sans text-[10px] text-slate-500 mb-2">
                    The file must be a <span className="font-bold text-slate-700">JSON array</span> of question objects,
                    or <code className="px-1 rounded bg-slate-100 border">{`{ "version": 1, "questions": [...] }`}</code>.
                    Use <code className="px-1 rounded bg-slate-100 border">correctIndex</code> for MCQ — it is 0-based,
                    unambiguous, and immune to option re-ordering, so students can never be marked wrong on a correct pick.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[9px] border-collapse">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="text-left px-2 py-1 border border-slate-200 font-bold text-slate-700">Field</th>
                          <th className="text-left px-2 py-1 border border-slate-200 font-bold text-slate-700">Type</th>
                          <th className="text-left px-2 py-1 border border-slate-200 font-bold text-slate-700">Required</th>
                          <th className="text-left px-2 py-1 border border-slate-200 font-bold text-slate-700">Values / Notes</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {[
                          ['text', 'string', '✅ Yes', 'The question stem / prompt text'],
                          ['type', 'string', '✅ Yes', '"mcq" | "truefalse" | "fill" ("code" is an alias for mcq)'],
                          ['options', 'array', '✅ MCQ', '2 to 4 unique strings, no duplicates'],
                          ['correctIndex', 'number', '⭐ MCQ (best)', '0-based index into options (0 = first). Recommended.'],
                          ['correctOption', 'string', 'MCQ alt', '"A" | "B" | "C" | "D" — use only if you skip correctIndex'],
                          ['answer (MCQ)', 'string', 'MCQ alt', 'Letter (A/B/C/D) OR exact option text — must match exactly one option'],
                          ['answer (TF)', 'boolean', '✅ T/F', 'true or false (also accepts "True"/"False")'],
                          ['answer (fill)', 'string', '✅ Fill', 'Exact expected answer (case-insensitive at grade time)'],
                          ['subject', 'string', 'Optional', 'Defaults to "General Programming"'],
                          ['difficulty', 'string', 'Optional', '"Easy" | "Medium" | "Hard" — defaults to "Easy"'],
                        ].map(([f, t, r, n]) => (
                          <tr key={f} className="even:bg-white odd:bg-slate-50">
                            <td className="px-2 py-1 border border-slate-200 text-cyan-700 font-bold">{f}</td>
                            <td className="px-2 py-1 border border-slate-200 text-slate-500">{t}</td>
                            <td className="px-2 py-1 border border-slate-200 text-slate-600">{r}</td>
                            <td className="px-2 py-1 border border-slate-200 text-slate-500 font-sans">{n}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="font-sans text-[10px] font-bold text-slate-600">Example file (canonical):</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold font-sans transition-all cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                        title="Download JSON template"
                      >
                        <Download className="w-3 h-3" />
                        Download Template
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(`{
  "version": 1,
  "questions": [
    {
      "type": "mcq",
      "text": "What does CPU stand for?",
      "options": [
        "Central Processing Unit",
        "Core Power Unit",
        "Central Power Usage",
        "Computer Processing Unit"
      ],
      "correctIndex": 0,
      "subject": "Computer Architecture",
      "difficulty": "Easy"
    },
    {
      "type": "truefalse",
      "text": "Python is a compiled language.",
      "answer": false,
      "subject": "Programming",
      "difficulty": "Easy"
    },
    {
      "type": "fill",
      "text": "The process of converting source code to machine code is called ______.",
      "answer": "compilation",
      "subject": "Programming",
      "difficulty": "Medium"
    }
  ]
}`);
                          setJsonCopied(true);
                          setTimeout(() => setJsonCopied(false), 2000);
                        }}
                        className="px-2 py-1 rounded-md text-[9px] font-bold font-sans transition-all cursor-pointer"
                        style={{ background: jsonCopied ? '#22c55e' : '#334155', color: '#fff' }}
                      >
                        {jsonCopied ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                  <pre className="bg-slate-900 text-green-300 rounded-lg p-3 overflow-x-auto text-[9px] leading-relaxed whitespace-pre">{`{
  "version": 1,
  "questions": [
    {
      "type": "mcq",
      "text": "What does CPU stand for?",
      "options": [
        "Central Processing Unit",
        "Core Power Unit",
        "Central Power Usage",
        "Computer Processing Unit"
      ],
      "correctIndex": 0,
      "subject": "Computer Architecture",
      "difficulty": "Easy"
    },
    {
      "type": "truefalse",
      "text": "Python is a compiled language.",
      "answer": false,
      "subject": "Programming",
      "difficulty": "Easy"
    },
    {
      "type": "fill",
      "text": "The process of converting source code to machine code is called ______.",
      "answer": "compilation",
      "subject": "Programming",
      "difficulty": "Medium"
    }
  ]
}`}</pre>
                  </div>
                  <p className="font-sans text-[9px] text-slate-500 mt-2">
                    <strong>Why <code>correctIndex</code>?</strong> Students always submit the option letter (A/B/C/D),
                    and the server grades by comparing letters. With <code>correctIndex</code>, the importer locks the
                    correct letter at upload time — no ambiguity if two options share text, no breakage if you reword
                    an option later. Legacy <code>answer</code> (letter or full text) still works for backwards compat.
                  </p>
                </div>
              </details>

              {/* Error messages */}
              {importError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-750 p-3.5 rounded-xl font-sans leading-relaxed">
                  <p className="font-bold">❌ Parse failed:</p>
                  <p className="font-mono text-[10px] mt-1 break-words">{importError}</p>
                </div>
              )}

              {/* Preview parsed files parsed list summary */}
              {parsedQuestions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-800">Preview: parsed {parsedQuestions.length} valid questions</p>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-green-50 text-green-700 border border-green-100 rounded-md font-bold uppercase">{importType} Loaded</span>
                  </div>

                  <div className="border rounded-2xl divide-y max-h-52 overflow-y-auto bg-slate-50">
                    {parsedQuestions.slice(0, 10).map((pq, pidx) => (
                      <div key={pidx} className="p-3 space-y-1 bg-white">
                        <div className="flex items-center space-x-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase">{pq.subject}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-150 uppercase">{pq.type}</span>
                        </div>
                        <p className="font-bold text-slate-805 text-[11px] leading-tight">{pidx + 1}. {pq.text}</p>
                        <p className="text-[10px] text-emerald-700 font-semibold font-mono">Correct Answer: {pq.answer}</p>
                      </div>
                    ))}
                    {parsedQuestions.length > 10 && (
                      <div className="p-2.5 text-center text-[10px] text-slate-450 italic font-medium">
                        ... and {parsedQuestions.length - 10} more questions
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border-t border-slate-150 p-4.5 flex items-center justify-end space-x-2 rounded-b-3xl">
              <button
                type="button"
                onClick={() => { setIsImportModalOpen(false); setParsedQuestions([]); setImportFileName(''); }}
                className="px-4 py-2 border rounded-lg text-slate-600 font-semibold bg-white hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={parsedQuestions.length === 0}
                className="px-4.5 py-2 rounded-lg text-white font-extrabold shadow-sm bg-cyan-600 hover:bg-cyan-700 cursor-pointer disabled:bg-slate-300 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                Execute Bulk Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
