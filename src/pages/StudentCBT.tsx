import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Award, AlertTriangle, HelpCircle, ChevronLeft, ChevronRight,
  AlertCircle, Sparkles, BookOpen, Clock, FileCheck, Maximize, AlertOctagon
} from 'lucide-react';
import { supabase } from '../integrations/supabase/client';
import { DB } from '../lib/database';
import { Student, Question, Result, ExamEligibility, ExamMonitoringSettings, DEFAULT_MONITORING } from '../types';
import CodeAwareText from '../components/CodeAwareText';

function formatWindowCountdown(ms: number): string {
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

// Fisher-Yates shuffle
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DEFAULT_MAX_QUESTIONS = 20;
const DEFAULT_DURATION_MINUTES = 12;
// Default max malpractice warnings before auto-submit (overridden by admin
// config monitoring.maxViolations). At this count the exam is force-submitted
// AND a penalty deduction is applied to the final score.
const DEFAULT_MAX_VIOLATIONS = 5;
const MALPRACTICE_PENALTY_PERCENT = 20;
// Submit button is locked for the first 60s of an exam to prevent accidental
// premature submissions.
const SUBMIT_UNLOCK_SECONDS = 60;
// Grace window for accidental mobile fullscreen exits / screen-sleep blips.
// If fullscreen is re-entered (or the tab becomes visible again) within this
// window, no malpractice is recorded.
const ANTI_CHEAT_DEBOUNCE_MS = 3000;

export default function StudentCBT() {
  const [stage, setStage] = useState<'login' | 'unauthorized' | 'quiz' | 'scorecard' | 'already'>('login');
  const [assessmentLabel, setAssessmentLabel] = useState<'Exam' | 'Test'>('Exam');
  const [reviewQuestions, setReviewQuestions] = useState<(Question & { answer: string })[]>([]);

  const [email, setEmail] = useState('');
  const [serialCode, setSerialCode] = useState('');
  const [loginError, setLoginError] = useState('');

  const [currentStudent, setCurrentStudent] = useState<Student | null>(null);
  const [configActive, setConfigActive] = useState(false);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [eligibility, setEligibility] = useState<ExamEligibility | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQIndex, setActiveQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [timeLeft, setTimeLeft] = useState(720);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [generatedResult, setGeneratedResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>('');

  // Scheduled assessment window + admin-configurable controls
  const [examStartAt, setExamStartAt] = useState<string | null>(null);
  const [examEndAt,   setExamEndAt]   = useState<string | null>(null);
  const [nowTick,     setNowTick]     = useState<number>(Date.now());
  const [durationMinutes, setDurationMinutes] = useState<number>(DEFAULT_DURATION_MINUTES);
  const [maxQuestions,    setMaxQuestions]    = useState<number>(DEFAULT_MAX_QUESTIONS);
  const [randomizeQuestionsCfg, setRandomizeQuestionsCfg] = useState<boolean>(true);
  const [randomizeOptionsCfg,   setRandomizeOptionsCfg]   = useState<boolean>(false);
  const [monitoring, setMonitoring] = useState<Required<ExamMonitoringSettings>>(DEFAULT_MONITORING);

  /**
   * For each question id, when option randomization is on we keep a permutation
   * `displayedKey -> originalKey` (A/B/C/D). When the student selects an option
   * we store the ORIGINAL key, so server-side grading (which matches by answer
   * value) stays correct regardless of display order.
   */
  const [optionMap, setOptionMap] = useState<Record<string, string[]>>({}); // qid -> originalKey[] in display order

  useEffect(() => {
    let cancelled = false;
    const fetchWindow = async () => {
      try {
        const conf = await DB.getConfig();
        if (cancelled) return;
        setExamStartAt(conf.examStartAt ?? null);
        setExamEndAt(conf.examEndAt ?? null);
        if (conf.assessmentType) {
          setAssessmentLabel(conf.assessmentType === 'test' ? 'Test' : 'Exam');
        }
        if (typeof conf.examDurationMinutes === 'number' && conf.examDurationMinutes > 0) {
          setDurationMinutes(conf.examDurationMinutes);
        }
        if (typeof conf.maxQuestions === 'number' && conf.maxQuestions > 0) {
          setMaxQuestions(conf.maxQuestions);
        }
        setRandomizeQuestionsCfg(conf.randomizeQuestions !== false);
        setRandomizeOptionsCfg(!!conf.randomizeOptions);
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
          maxViolations: typeof conf.monitoring?.maxViolations === 'number' && conf.monitoring.maxViolations > 0 ? conf.monitoring.maxViolations : DEFAULT_MAX_VIOLATIONS,
        });
      } catch { /* offline / no config — keep defaults */ }
    };
    fetchWindow();
    const refresh = setInterval(fetchWindow, 30_000);
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => { cancelled = true; clearInterval(refresh); clearInterval(tick); };
  }, []);

  const windowState = useMemo<{ kind: 'unset' | 'before' | 'open' | 'ended'; msToBoundary: number }>(() => {
    const startMs = examStartAt ? new Date(examStartAt).getTime() : null;
    const endMs   = examEndAt   ? new Date(examEndAt).getTime()   : null;
    if (!startMs && !endMs) return { kind: 'unset', msToBoundary: 0 };
    if (startMs && nowTick < startMs) return { kind: 'before', msToBoundary: startMs - nowTick };
    if (endMs && nowTick > endMs)     return { kind: 'ended',  msToBoundary: 0 };
    if (endMs) return { kind: 'open', msToBoundary: endMs - nowTick };
    return { kind: 'open', msToBoundary: 0 };
  }, [examStartAt, examEndAt, nowTick]);

  // Anti-cheat state
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const [tabWarningMsg, setTabWarningMsg] = useState<string>('');
  const [showFullscreenOverlay, setShowFullscreenOverlay] = useState(false);
  const [windowBlurred, setWindowBlurred] = useState(false);

  // Submit-flow state
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitUnlockIn, setSubmitUnlockIn] = useState<number>(SUBMIT_UNLOCK_SECONDS);
  // When the exam is force-submitted for malpractice we record the original
  // (pre-penalty) score and the adjusted score so the candidate sees both.
  const [forceSubmitInfo, setForceSubmitInfo] = useState<{
    penaltyApplied: boolean;
    rawScore: number;
    rawPercentage: number;
    adjustedPercentage: number;
    penaltyPercent: number;
  } | null>(null);

  // Refs that mute false-positive malpractice events:
  // - suppressMalpracticeRef: true while the Submit confirmation dialog is open,
  //   or while we deliberately request fullscreen.
  // - *DebounceRef: pending timers for fullscreen-exit / visibility-change
  //   debouncing — cleared if the state reverts within the grace window so
  //   accidental mobile gestures and screen-lock blips don't fire.
  const suppressMalpracticeRef = useRef(false);
  const fullscreenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for use inside closures/event handlers (always up-to-date)
  const tabSwitchCountRef = useRef(0);
  const stageRef = useRef<string>('login');
  const currentStudentRef = useRef<Student | null>(null);
  const questionsRef = useRef<Question[]>([]);
  const answersRef = useRef<Record<string, string>>({});
  const eligibilityRef = useRef<ExamEligibility | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => { stageRef.current = stage; }, [stage]);
  useEffect(() => { currentStudentRef.current = currentStudent; }, [currentStudent]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { eligibilityRef.current = eligibility; }, [eligibility]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // --- ANTI-CHEAT: Block copy/paste/cut/right-click during exam ---
  useEffect(() => {
    if (stage !== 'quiz') return;
    const blockClipboard = (e: Event) => e.preventDefault();
    const blockContext   = (e: Event) => e.preventDefault();
    if (monitoring.copyPaste) {
      document.addEventListener('copy', blockClipboard);
      document.addEventListener('paste', blockClipboard);
      document.addEventListener('cut',   blockClipboard);
    }
    if (monitoring.rightClick) {
      document.addEventListener('contextmenu', blockContext);
    }
    return () => {
      document.removeEventListener('copy', blockClipboard);
      document.removeEventListener('paste', blockClipboard);
      document.removeEventListener('cut',   blockClipboard);
      document.removeEventListener('contextmenu', blockContext);
    };
  }, [stage, monitoring.copyPaste, monitoring.rightClick]);

  // --- ANTI-CHEAT: Tab/window visibility detection ---
  // Mobile devices fire `visibilitychange` for momentary system gestures
  // (notification pull-downs) and natural screen-lock / device-sleep. To avoid
  // counting those as malpractice we DEBOUNCE the event: only after the page
  // has been hidden continuously for ANTI_CHEAT_DEBOUNCE_MS AND the window
  // has lost focus (heuristic for real tab-switch / app-backgrounding, NOT
  // screen-sleep where the page is hidden but focus is retained on resume)
  // do we record a violation. The Submit-confirmation dialog also suppresses
  // events while it's open.
  // Unified integrity-violation reporter — used by every monitoring layer.
  // Records to audit log, shows a banner, and auto-submits when the
  // admin-configured violation limit is reached.
  const recordIntegrityViolation = (category: string, detail: string) => {
    if (suppressMalpracticeRef.current) return;
    if (submittedRef.current) return;
    if (stageRef.current !== 'quiz') return;

    const max = monitoring.maxViolations || DEFAULT_MAX_VIOLATIONS;
    const newCount = tabSwitchCountRef.current + 1;
    tabSwitchCountRef.current = newCount;
    setTabSwitchCount(newCount);
    setTabWarningMsg(`${category} — ${detail} (Violation ${newCount} of ${max})`);
    setShowTabWarning(true);

    const student = currentStudentRef.current;
    if (student) {
      supabase.rpc('student_cbt_log', {
        p_email: student.email,
        p_action: `${category}: ${detail} (violation #${newCount} of ${max})`,
        p_reason: 'Automated exam integrity monitor',
        p_page: 'Student CBT Exam',
        p_new_value: JSON.stringify({ category, detail, violation: newCount, max, timestamp: new Date().toISOString() }),
      });
    }

    if (newCount >= max && monitoring.autoSubmit) {
      triggerAutoSubmission('malpractice_exhausted');
    }
  };

  // --- ANTI-CHEAT: Tab/window visibility detection ---
  useEffect(() => {
    if (stage !== 'quiz' || !monitoring.tabSwitch) return;

    const recordViolation = () => {
      if (!document.hidden) return;
      recordIntegrityViolation('TAB_SWITCH_VIOLATION', 'Candidate left exam tab/window');
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (visibilityDebounceRef.current) clearTimeout(visibilityDebounceRef.current);
        visibilityDebounceRef.current = setTimeout(recordViolation, ANTI_CHEAT_DEBOUNCE_MS);
      } else {
        if (visibilityDebounceRef.current) {
          clearTimeout(visibilityDebounceRef.current);
          visibilityDebounceRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityDebounceRef.current) clearTimeout(visibilityDebounceRef.current);
    };
  }, [stage, monitoring.tabSwitch, monitoring.autoSubmit, monitoring.maxViolations]);

  // --- ANTI-CHEAT: Fullscreen exit detection ---
  useEffect(() => {
    if (stage !== 'quiz' || !monitoring.fullscreen) return;

    const recordFullscreenExit = () => {
      if (document.fullscreenElement) return;
      if (document.visibilityState !== 'visible') return;
      setShowFullscreenOverlay(true);
      recordIntegrityViolation('FULLSCREEN_EXIT', 'Candidate exited fullscreen during exam');
    };

    const handleFullscreenChange = () => {
      const inFullscreen = !!document.fullscreenElement;
      if (inFullscreen) {
        if (fullscreenDebounceRef.current) {
          clearTimeout(fullscreenDebounceRef.current);
          fullscreenDebounceRef.current = null;
        }
        setShowFullscreenOverlay(false);
      } else {
        if (fullscreenDebounceRef.current) clearTimeout(fullscreenDebounceRef.current);
        fullscreenDebounceRef.current = setTimeout(recordFullscreenExit, ANTI_CHEAT_DEBOUNCE_MS);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (fullscreenDebounceRef.current) clearTimeout(fullscreenDebounceRef.current);
    };
  }, [stage, monitoring.fullscreen, monitoring.maxViolations]);

  // --- LAYER 1: Focus Blur Shield ---
  // Solid overlay when the window loses focus. Catches most screenshot
  // keyboard shortcuts that require switching away (Win+Shift+S, system tools).
  useEffect(() => {
    if (stage !== 'quiz' || !monitoring.focusBlurShield) return;
    const onBlur = () => {
      if (suppressMalpracticeRef.current) return;
      setWindowBlurred(true);
    };
    const onFocus = () => setWindowBlurred(false);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [stage, monitoring.focusBlurShield]);

  // --- LAYER 3: Print / Save-as-PDF block ---
  // CSS @media print hides all exam content during the quiz stage.
  useEffect(() => {
    if (stage !== 'quiz' || !monitoring.printBlock) return;
    const style = document.createElement('style');
    style.setAttribute('data-cbt-print-block', '1');
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        body::before {
          content: "Printing is disabled during this exam. This attempt has been logged.";
          visibility: visible !important;
          display: block;
          padding: 2rem;
          font: bold 16pt sans-serif;
          color: #b91c1c;
        }
      }
    `;
    document.head.appendChild(style);
    const onBeforePrint = () => {
      recordIntegrityViolation('PRINT_BLOCKED', 'Print / Save-as-PDF attempted');
    };
    window.addEventListener('beforeprint', onBeforePrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      style.remove();
    };
  }, [stage, monitoring.printBlock, monitoring.maxViolations]);

  // --- LAYER 4: Screenshot shortcut intercept ---
  // Detect PrintScreen, Cmd/Win+Shift+3/4/5, Ctrl+P, etc., warn and log.
  useEffect(() => {
    if (stage !== 'quiz' || !monitoring.screenshotDetect) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const meta = e.metaKey || e.ctrlKey;
      const isPrintScreen = k === 'PrintScreen' || k === 'Snapshot';
      const isMacShot = (e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(k));
      const isWinShot = (e.metaKey && e.shiftKey && k.toLowerCase() === 's'); // Win+Shift+S
      const isPrintShortcut = meta && k.toLowerCase() === 'p';
      const isSaveShortcut = meta && k.toLowerCase() === 's';
      if (isPrintScreen || isMacShot || isWinShot || isPrintShortcut || isSaveShortcut) {
        e.preventDefault();
        e.stopPropagation();
        recordIntegrityViolation('SCREENSHOT_SHORTCUT', `Screenshot/print shortcut intercepted (${k})`);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stage, monitoring.screenshotDetect, monitoring.maxViolations]);

  // --- LAYER 5: Screen capture (getDisplayMedia) detection ---
  // Monkey-patch navigator.mediaDevices.getDisplayMedia for the duration of
  // the exam: log the attempt and reject so the candidate cannot screen-share
  // or screen-record the exam content.
  useEffect(() => {
    if (stage !== 'quiz' || !monitoring.screenCaptureDetect) return;
    const md: any = (navigator as any).mediaDevices;
    if (!md || typeof md.getDisplayMedia !== 'function') return;
    const original = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = async (..._args: any[]) => {
      recordIntegrityViolation('SCREEN_CAPTURE_BLOCKED', 'Screen share / recording attempted');
      throw new DOMException('Screen capture blocked during exam', 'NotAllowedError');
    };
    return () => { md.getDisplayMedia = original; };
  }, [stage, monitoring.screenCaptureDetect, monitoring.maxViolations]);



  // Countdown for the 60-second Submit-button lock at exam start.
  useEffect(() => {
    if (stage !== 'quiz') return;
    if (submitUnlockIn <= 0) return;
    const t = setInterval(() => {
      setSubmitUnlockIn(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [stage, submitUnlockIn]);

  // --- HELPERS ---
  const requestFullscreen = () => {
    // Suppress malpractice events while we deliberately request fullscreen —
    // some browsers fire `fullscreenchange` with no element briefly before
    // settling, and we never want that to count as an exit.
    suppressMalpracticeRef.current = true;
    document.documentElement.requestFullscreen().then(() => {
      setShowFullscreenOverlay(false);
    }).catch(() => {}).finally(() => {
      setTimeout(() => { suppressMalpracticeRef.current = false; }, 500);
    });
  };

  const exitFullscreen = () => {
    suppressMalpracticeRef.current = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(() => { suppressMalpracticeRef.current = false; }, 500);
  };

  // --- ACTIONS ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedSerial = serialCode.trim().toUpperCase();

    if (!trimmedEmail || !trimmedSerial) {
      setLoginError('Both registered Email and Serial ID code are required.');
      return;
    }

    if (windowState.kind === 'before') {
      setLoginError(`The ${assessmentLabel.toLowerCase()} has not started yet. Try again when the countdown reaches zero.`);
      return;
    }
    if (windowState.kind === 'ended') {
      setLoginError(`The ${assessmentLabel.toLowerCase()} window has closed. New sign-ins are no longer accepted.`);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('student_cbt_start', {
        p_email: trimmedEmail,
        p_class_sn: trimmedSerial,
      });
      if (error) {
        setLoginError('Server error validating entrance.');
        return;
      }
      const res: any = data;
      if (!res?.ok) {
        setLoginError('Invalid credentials. Ensure your registration email matches your serial number.');
        return;
      }

      const student = res.student as Student;
      setCurrentStudent(student);
      setEligibility(res.sessionId ? ({ sessionId: res.sessionId } as ExamEligibility) : null);
      setIsWhitelisted(!!res.eligible);
      setConfigActive(!!res.examActivated);
      const aType = (res.assessmentType === 'test') ? 'Test' : 'Exam';
      setAssessmentLabel(aType);

      // Already-submitted path: load full review and jump to scorecard.
      if (res.alreadySubmitted && res.result) {
        await loadResultDetail(student);
        setGeneratedResult(res.result as Result);
        setStage('already');
        return;
      }

      if (!res.examActivated || !res.eligible) {
        setStage('unauthorized');
      } else {
        const questionsPool: Question[] = (res.questions as Question[]) || [];
        if (questionsPool.length === 0) {
          setLoginError('There are currently no active questions in the Examination database pool.');
          return;
        }

        // Apply admin-configured ordering + cap. Grading on the server matches by
        // answer VALUE (A/B/C/D), so we always submit the original key even when
        // options are reshuffled below.
        const ordered = randomizeQuestionsCfg ? shuffleArray(questionsPool) : questionsPool.slice();
        const finalQuestions = ordered.slice(0, Math.max(1, maxQuestions));

        // Build per-question option permutation if option randomization is on.
        const newOptionMap: Record<string, string[]> = {};
        if (randomizeOptionsCfg) {
          for (const q of finalQuestions) {
            if (q.type === 'mcq' && Array.isArray(q.options) && q.options.length === 4) {
              // shuffle original A/B/C/D keys; index i in display = newOptionMap[q.id][i]
              newOptionMap[q.id] = shuffleArray(['A', 'B', 'C', 'D']);
            }
          }
        }
        setOptionMap(newOptionMap);

        submittedRef.current = false;
        setQuestions(finalQuestions);
        setAnswers({});
        setActiveQIndex(0);
        setTabSwitchCount(0);
        tabSwitchCountRef.current = 0;
        setShowTabWarning(false);
        setShowFullscreenOverlay(false);
        setTimeLeft(Math.max(1, durationMinutes) * 60);
        setSubmitUnlockIn(SUBMIT_UNLOCK_SECONDS);
        setForceSubmitInfo(null);
        setShowSubmitDialog(false);
        setStage('quiz');

        supabase.rpc('student_cbt_log', {
          p_email: student.email,
          p_action: `EXAM_START: Candidate began exam session (${finalQuestions.length} questions drawn from pool of ${questionsPool.length}, duration=${durationMinutes}m)`,
          p_reason: 'Automated exam session tracker',
          p_page: 'Student CBT Exam',
          p_new_value: JSON.stringify({ classSN: student.classSN, class: student.class, questionCount: finalQuestions.length, poolSize: questionsPool.length, durationMinutes, randomizeQuestions: randomizeQuestionsCfg, randomizeOptions: randomizeOptionsCfg, timestamp: new Date().toISOString() }),
        });

        if (monitoring.fullscreen) requestFullscreen();
        startCountdown();
      }
    } catch (err) {
      setLoginError('Error validating entrance: ' + err);
    }
  };

  const loadResultDetail = async (student: Student) => {
    try {
      const { data, error } = await supabase.rpc('student_cbt_result', {
        p_email: student.email,
        p_class_sn: student.classSN,
      });
      if (error) return;
      const r: any = data;
      if (r?.ok && r?.hasResult) {
        setReviewQuestions(r.questions || []);
      }
    } catch {}
  };

  const startCountdown = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          // Auto-submit on timeout is gated by the monitoring toggle; when off we
          // still stop the clock but leave the student to submit manually.
          if (monitoring.autoSubmit) triggerAutoSubmission('timer_expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const formattedTimeLeft = useMemo(() => {
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [timeLeft]);

  const handleSelectAnswer = (qId: string, answerVal: string) => {
    setAnswers(prev => ({ ...prev, [qId]: answerVal }));
  };

  const triggerAutoSubmission = async (reason: string = 'manual') => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setSubmitError('');

    if (timerRef.current) clearInterval(timerRef.current);

    const student = currentStudentRef.current;
    const qs = questionsRef.current;
    const ans = answersRef.current;
    const elig = eligibilityRef.current;

    if (!student || qs.length === 0) { setSubmitting(false); return; }

    exitFullscreen();

    // Ensure every question id appears (even if unanswered) so server scores full total.
    const answersForSubmit: Record<string, string> = {};
    qs.forEach(q => { answersForSubmit[q.id] = (ans[q.id] || '').toString(); });
    const attemptId = `alt-${Date.now()}`;

    try {
      const { data, error } = await supabase.rpc('student_cbt_submit', {
        p_email: student.email,
        p_class_sn: student.classSN,
        p_session_id: elig?.sessionId || 'active-session',
        p_attempt_id: attemptId,
        p_answers: answersForSubmit,
      });
      if (error || !(data as any)?.ok) {
        throw new Error(error?.message || 'Server rejected submission');
      }
      const scored: any = data;

      supabase.rpc('student_cbt_log', {
        p_email: student.email,
        p_action: `EXAM_SUBMIT: Candidate submitted exam — Reason: ${reason} | Score: ${scored.score}/${scored.totalQuestions} (${scored.percentage}%) | Tab violations: ${tabSwitchCountRef.current}${scored.alreadySubmitted ? ' | alreadySubmitted=true' : ''}`,
        p_reason: 'Automated exam session tracker',
        p_page: 'Student CBT Exam',
        p_new_value: JSON.stringify({ score: scored.score, percentage: scored.percentage, totalQuestions: scored.totalQuestions, reason, tabViolations: tabSwitchCountRef.current, alreadySubmitted: !!scored.alreadySubmitted, timestamp: new Date().toISOString() }),
      });

      // MALPRACTICE PENALTY: if this submission was forced because the
      // candidate exhausted the 5 anti-cheat warnings, apply a configurable
      // percentage deduction to the displayed score and record both raw and
      // adjusted figures in the audit log.
      let displayScore = scored.score as number;
      let displayPercentage = scored.percentage as number;
      const isMalpracticeForced = reason === 'malpractice_exhausted' || reason === 'tab_violation_auto_submit';
      if (isMalpracticeForced && !scored.alreadySubmitted) {
        const rawPercentage = scored.percentage as number;
        const rawScore = scored.score as number;
        const adjustedPercentage = Math.max(0, Math.round(rawPercentage * (1 - MALPRACTICE_PENALTY_PERCENT / 100)));
        const adjustedScore = Math.max(0, Math.round(rawScore * (1 - MALPRACTICE_PENALTY_PERCENT / 100)));
        displayScore = adjustedScore;
        displayPercentage = adjustedPercentage;
        setForceSubmitInfo({
          penaltyApplied: true,
          rawScore,
          rawPercentage,
          adjustedPercentage,
          penaltyPercent: MALPRACTICE_PENALTY_PERCENT,
        });
        supabase.rpc('student_cbt_log', {
          p_email: student.email,
          p_action: `MALPRACTICE_PENALTY_APPLIED: ${MALPRACTICE_PENALTY_PERCENT}% deduction — raw ${rawScore}/${scored.totalQuestions} (${rawPercentage}%) → adjusted ${adjustedScore}/${scored.totalQuestions} (${adjustedPercentage}%) after ${tabSwitchCountRef.current} violations`,
          p_reason: 'Force-submitted due to repeated malpractice violations',
          p_page: 'Student CBT Exam',
          p_new_value: JSON.stringify({ rawScore, rawPercentage, adjustedScore, adjustedPercentage, penaltyPercent: MALPRACTICE_PENALTY_PERCENT, violations: tabSwitchCountRef.current, reason }),
        });
      }

      const committed: Result = {
        id: scored.id,
        email: student.email,
        name: student.name,
        class: student.class,
        classSN: student.classSN,
        examSessionId: elig?.sessionId || 'active-session',
        score: displayScore,
        percentage: displayPercentage,
        totalQuestions: scored.totalQuestions,
        answers: answersForSubmit,
        submittedAt: new Date().toISOString(),
        attemptId,
      };
      setGeneratedResult(committed);
      // Fetch full review (questions + correct answers) before showing scorecard.
      await loadResultDetail(student);
      setStage(scored.alreadySubmitted ? 'already' : 'scorecard');
    } catch (e: any) {
      submittedRef.current = false;
      setSubmitError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSubmit = () => {
    if (submitting || submittedRef.current) return;
    if (submitUnlockIn > 0) return; // 60-second lockout at exam start
    // Open a styled confirmation dialog. Opening / cancelling this dialog
    // NEVER triggers malpractice events — the suppress ref is set while it's
    // open so visibility / fullscreen handlers ignore changes.
    suppressMalpracticeRef.current = true;
    setShowSubmitDialog(true);
  };

  const handleCancelSubmit = () => {
    setShowSubmitDialog(false);
    // Re-enable malpractice handlers a moment later so any focus-shift caused
    // by closing the dialog doesn't race in as a violation.
    setTimeout(() => { suppressMalpracticeRef.current = false; }, 250);
  };

  const handleConfirmSubmit = () => {
    setShowSubmitDialog(false);
    suppressMalpracticeRef.current = false;
    triggerAutoSubmission('manual');
  };

  const handleRetrySubmit = () => {
    submittedRef.current = false;
    setSubmitError('');
    triggerAutoSubmission('retry');
  };

  const handleReturnToPortal = () => {
    setEmail('');
    setSerialCode('');
    setCurrentStudent(null);
    setAnswers({});
    setGeneratedResult(null);
    setReviewQuestions([]);
    setTabSwitchCount(0);
    tabSwitchCountRef.current = 0;
    setShowTabWarning(false);
    setShowFullscreenOverlay(false);
    setShowSubmitDialog(false);
    setForceSubmitInfo(null);
    suppressMalpracticeRef.current = false;
    submittedRef.current = false;
    setStage('login');
  };

  const isQuestionAnswered = (qId: string) => !!answers[qId];

  // --- RENDERING ---
  return (
    <div
      id="student-cbt-root"
      className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-755 selection:bg-cyan-50 selection:text-cyan-700 select-none"
      onContextMenu={(e) => stage === 'quiz' && e.preventDefault()}
    >

      {/* PERSISTENT CORE HEADER */}
      <header className="bg-white border-b sticky top-0 z-40 select-none">
        <div id="student-header-inner" className="max-w-6xl mx-auto px-3 sm:px-5 py-3 sm:py-4.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center space-x-3">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-cyan-50 flex items-center justify-center font-bold text-cyan-600 shadow-sm border border-cyan-150">
              <Award className="w-5.5 h-5.5" />
            </div>
            <div className="text-left min-w-0">
              <h1 className="text-sm font-black tracking-tight text-slate-900 leading-none truncate">CryoBytePrime</h1>
              <p className="text-[10px] font-bold font-mono tracking-wider text-slate-400 uppercase mt-0.5 truncate">
                {assessmentLabel} Engine
              </p>
            </div>
          </div>
          <div className="hidden sm:flex shrink-0 items-center space-x-2 bg-slate-100 px-3 py-1.5 rounded-xl border">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="text-[10px] uppercase font-mono font-black text-slate-500 tracking-wider">
              {assessmentLabel.toUpperCase()} SECURE TERMINAL
            </span>
          </div>
        </div>
      </header>

      {/* FULLSCREEN RE-ENTER OVERLAY */}
      {showFullscreenOverlay && stage === 'quiz' && (
        <div className="fixed inset-0 z-[100] bg-slate-950/97 flex flex-col items-center justify-center text-center space-y-6 p-6 backdrop-blur-sm">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mx-auto">
            <Maximize className="w-8 h-8 text-amber-400" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h2 className="text-xl font-black text-white">Fullscreen Required</h2>
            <p className="text-sm text-slate-400 leading-relaxed font-normal">
              Exiting fullscreen during the exam has been logged as a security violation. You must return to fullscreen to continue.
            </p>
          </div>
          <button
            onClick={requestFullscreen}
            className="px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold rounded-xl shadow-lg cursor-pointer transition-colors flex items-center space-x-2 text-sm"
          >
            <Maximize className="w-4 h-4" />
            <span>Return to Fullscreen</span>
          </button>
        </div>
      )}

      {/* LAYER 1: FOCUS BLUR SHIELD — solid overlay when window loses focus */}
      {windowBlurred && stage === 'quiz' && monitoring.focusBlurShield && (
        <div className="fixed inset-0 z-[110] bg-slate-950 flex flex-col items-center justify-center text-center space-y-4 p-6">
          <AlertOctagon className="w-12 h-12 text-rose-400" />
          <h2 className="text-xl font-black text-white">Exam Paused — Return Focus</h2>
          <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
            This window lost focus. Exam content is hidden until you return. Repeated focus loss is logged as a violation.
          </p>
        </div>
      )}

      {/* LAYER 2: CANDIDATE WATERMARK — traceable overlay across the exam */}
      {stage === 'quiz' && currentStudent && monitoring.watermark && (
        <div
          aria-hidden
          className="fixed inset-0 z-[90] pointer-events-none overflow-hidden select-none"
          style={{ mixBlendMode: 'multiply' }}
        >
          <div
            className="absolute inset-0 flex flex-wrap content-start gap-x-12 gap-y-16 p-8 text-slate-400/25 font-mono font-black text-[11px] tracking-wider uppercase"
            style={{ transform: 'rotate(-20deg) scale(1.4)', transformOrigin: 'center' }}
          >
            {Array.from({ length: 120 }).map((_, i) => (
              <span key={i} className="whitespace-nowrap">
                {currentStudent.name} · {currentStudent.classSN} · {currentStudent.email}
              </span>
            ))}
          </div>
        </div>
      )}


      {/* TAB SWITCH VIOLATION BANNER */}
      {showTabWarning && stage === 'quiz' && (
        <div className="sticky top-[65px] z-50 bg-amber-500 text-white px-5 py-2.5 flex items-center justify-between text-xs font-semibold shadow-md">
          <div className="flex items-center space-x-2">
            <AlertOctagon className="w-4 h-4 shrink-0" />
            <span>
              <strong>Security Alert:</strong> {tabWarningMsg || `Violation ${tabSwitchCount} of ${monitoring.maxViolations} recorded.`}
              {tabSwitchCount >= (monitoring.maxViolations - 1) && (
                <strong> Warning: Next violation will auto-submit your exam.</strong>
              )}
            </span>
          </div>
          <button
            onClick={() => setShowTabWarning(false)}
            className="ml-4 shrink-0 text-white/80 hover:text-white cursor-pointer font-bold"
          >✕</button>
        </div>
      )}

      {/* ===== LOGIN STAGE ===== */}
      {stage === 'login' && (
        <main className="grow flex items-center justify-center p-5 select-none h-auto">
          <div className="bg-white border border-slate-200 shadow-2xl rounded-3xl p-6.5 max-w-sm w-full text-xs space-y-5 text-center animate-zoom-in">
            <div className="space-y-1.5">
              <HelpCircle className="w-10 h-10 text-cyan-600 mx-auto shrink-0 animate-bounce" />
              <h2 className="text-base font-extrabold text-slate-900">Sign In to Student {assessmentLabel}</h2>
              <p className="text-[11px] text-slate-450 leading-relaxed font-normal">Enter your designated course credentials to check-in your {assessmentLabel.toLowerCase()} candidate registry.</p>
            </div>

            {windowState.kind !== 'unset' && (
              <div
                className={`p-3 rounded-xl border text-left font-sans leading-relaxed flex items-start gap-2 ${
                  windowState.kind === 'before'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : windowState.kind === 'open'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-extrabold text-[11px]">
                    {windowState.kind === 'before' && `${assessmentLabel} starts in`}
                    {windowState.kind === 'open'   && `${assessmentLabel} ends in`}
                    {windowState.kind === 'ended'  && `${assessmentLabel} window closed`}
                  </p>
                  {windowState.kind !== 'ended' && (
                    <p className="font-mono text-base font-black tracking-tight tabular-nums">
                      {formatWindowCountdown(windowState.msToBoundary)}
                    </p>
                  )}
                  {windowState.kind === 'ended' && (
                    <p className="text-[11px]">New sign-ins are no longer accepted.</p>
                  )}
                </div>
              </div>
            )}

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-left font-sans leading-relaxed">
                <p className="font-semibold">{loginError}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4 text-left">
              <div className="space-y-1">
                <label className="text-[10px] font-black font-mono text-slate-500 uppercase">Registration Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. adaeze.eze.12@cryobyteprime.com"
                  className="w-full bg-slate-50 border border-slate-251 p-2.5 rounded-xl focus:bg-white focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black font-mono text-slate-550 uppercase">Student Serial ID</label>
                <input
                  type="text"
                  value={serialCode}
                  onChange={(e) => setSerialCode(e.target.value.toUpperCase())}
                  placeholder="e.g. A22"
                  className="w-full bg-slate-50 border border-slate-251 p-2.5 rounded-xl font-mono text-xs font-extrabold focus:bg-white focus:outline-none focus:border-cyan-500 uppercase"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={windowState.kind === 'before' || windowState.kind === 'ended'}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-extrabold rounded-xl shadow-md cursor-pointer transition-colors"
              >
                {windowState.kind === 'before' ? `Locked — ${assessmentLabel} Not Started`
                  : windowState.kind === 'ended' ? `${assessmentLabel} Closed`
                  : `Enter ${assessmentLabel} Portal`}
              </button>
            </form>

            <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
              This exam uses fullscreen lockdown, tab monitoring, and randomized question sets. Ensure you are ready before signing in.
            </p>
          </div>
        </main>
      )}

      {/* ===== UNAUTHORIZED STAGE ===== */}
      {stage === 'unauthorized' && (
        <main className="grow flex items-center justify-center p-5 select-none">
          <div className="bg-white border rounded-3xl p-8 max-w-md w-full shadow-xl text-center space-y-6 animate-zoom-in text-xs">
            <div className="space-y-2">
              <div className="w-14 h-14 bg-rose-50 border border-rose-150 rounded-2xl flex items-center justify-center text-rose-600 mx-auto">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Portal Entry Locked</h2>
              <p className="text-slate-500 leading-relaxed font-normal">
                Credentials verified, but you are currently blocked from entering the live exam. Check the reasons below:
              </p>
            </div>

            <div className="bg-slate-50 border p-4.5 rounded-2xl text-left space-y-2 font-sans text-[11px] leading-relaxed text-slate-650">
              {!configActive && (
                <div className="flex items-start space-x-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0"></span>
                  <p>
                    <strong className="text-slate-800">Exam overall gate inactive:</strong> The class tutor has not activated general exam access. Please wait for coordinates to be activated.
                  </p>
                </div>
              )}
              {!isWhitelisted && (
                <div className="flex items-start space-x-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0"></span>
                  <p>
                    <strong className="text-slate-800 font-bold">Portal locked automatically:</strong> You have been logged as <span className="text-rose-600 font-bold">ABSENT</span> or your attendance was unregistered for the linked roster check-in blocks. Standard exam gates dictate that you must be present inside class to earn CBT access keys!
                  </p>
                </div>
              )}
            </div>

            <div className="p-3 border border-indigo-100 bg-indigo-50/40 text-indigo-850 rounded-2xl flex items-start space-x-2 text-[10.5px] text-left leading-relaxed">
              <AlertCircle className="w-4 h-4 shrink-0 text-indigo-550 mt-0.5" />
              <span>Contact the lesson coordinators or class superadmin to apply a whitelist override if pre-excused.</span>
            </div>

            <button
              onClick={handleReturnToPortal}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-950 text-white font-bold rounded-xl transition-all cursor-pointer"
            >
              Back to Sign In
            </button>
          </div>
        </main>
      )}

      {/* ===== QUIZ STAGE ===== */}
      {stage === 'quiz' && currentStudent && questions.length > 0 && (
        <main className="grow max-w-6xl w-full mx-auto p-5 grid grid-cols-1 md:grid-cols-12 gap-5 select-none min-h-0 h-auto">

          {/* LEFT PANEL: QUESTION GRID BUBBLES BAR */}
          <div className="md:col-span-3 bg-white border rounded-2xl p-4 flex flex-col justify-between shadow-sm min-h-0">
            <div className="space-y-4 text-xs font-sans">
              <div className="flex items-center space-x-2 pb-2 border-b">
                <BookOpen className="w-5 h-5 text-cyan-600" />
                <span className="font-bold text-slate-800">Evaluation Navigator</span>
              </div>

              <p className="text-slate-400 text-[10.5px] font-medium leading-relaxed">Toggle cards below to jump to specific check prompts:</p>

              {/* Grid Bubbles */}
              <div className="grid grid-cols-4 gap-2.5 max-h-[40vh] overflow-y-auto p-0.5 select-none">
                {questions.map((q, idx) => {
                  const isAnswered = isQuestionAnswered(q.id);
                  const isActive = idx === activeQIndex;
                  return (
                    <button
                      key={q.id}
                      onClick={() => setActiveQIndex(idx)}
                      className={`h-9 rounded-xl border font-mono font-bold text-xs flex items-center justify-center relative cursor-pointer font-black transition-all ${
                        isActive
                          ? 'bg-cyan-600 border-cyan-700 text-white shadow shadow-cyan-600/10'
                          : isAnswered
                          ? 'bg-cyan-50 border-cyan-150 text-cyan-700 font-extrabold'
                          : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}
                    >
                      <span>{idx + 1}</span>
                      {isAnswered && !isActive && (
                        <span className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-cyan-500"></span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Completion Stats */}
            <div className="pt-4 border-t space-y-4 text-xs select-none">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium">
                  <span className="text-slate-500">Progress Tracker</span>
                  <span className="font-mono text-slate-900 font-bold">{Math.round((Object.keys(answers).length / questions.length) * 100)}% Done</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border">
                  <div
                    className="bg-cyan-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${(Object.keys(answers).length / questions.length) * 100}%` }}
                  ></div>
                </div>
              </div>

              {/* Violations counter */}
              {tabSwitchCount > 0 && (
                <div className="p-2.5 border border-amber-200 rounded-xl bg-amber-50 flex items-center justify-between text-[10px] font-mono leading-none">
                  <span className="text-amber-700">Tab violations:</span>
                  <strong className="text-amber-800 font-black">{tabSwitchCount} / {monitoring.maxViolations}</strong>
                </div>
              )}

              <div className="p-2.5 border rounded-xl bg-slate-50 flex items-center justify-between text-[10px] font-mono leading-none">
                <span className="text-slate-400">CLASS SERIAL:</span>
                <strong className="text-slate-800 font-black">{currentStudent.classSN}</strong>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL: EXAMINATION TIMED QUESTIONS VIEWPORT */}
          <div className="md:col-span-9 bg-white border rounded-2xl p-6.5 shadow-sm flex flex-col justify-between space-y-6 relative select-none">

            {/* Header: Countdown clock and candidate info */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pb-3.5 border-b text-xs">
              <div className="min-w-0">
                <p className="font-bold text-slate-900 font-sans text-sm truncate">{currentStudent.name}</p>
                <p className="text-[10px] text-slate-400 font-mono tracking-tight mt-0.5 truncate">{currentStudent.email}</p>
              </div>

              <div className={`flex items-center space-x-2 px-3 sm:px-4.5 py-2 sm:py-2.5 rounded-2xl border font-mono font-bold font-black text-sm tracking-tight shrink-0 transition-colors ${
                timeLeft < 180
                  ? 'bg-rose-50 border-rose-200 text-rose-700 animate-pulse'
                  : 'bg-slate-900 border-slate-800 text-white'
              }`}>
                <Clock className="w-4.5 h-4.5 stroke-[2.5]" />
                <span className="hidden sm:inline text-xs leading-none">TIME LEFT:</span>
                <span className="text-base tracking-widest">{formattedTimeLeft}</span>
              </div>
            </div>

            {/* Main prompt body */}
            <div className="space-y-6 grow py-6.5">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 bg-slate-100 border text-slate-650 text-[10px] font-black font-mono tracking-tight rounded-md uppercase">
                    QUESTION {activeQIndex + 1} OF {questions.length}
                  </span>
                  <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-150 text-indigo-705 text-[10px] font-black font-mono tracking-tight rounded-md uppercase">
                    {questions[activeQIndex].subject || 'General'}
                  </span>
                </div>

                <div className="font-extrabold text-slate-900 text-sm md:text-base leading-relaxed h-auto">
                  <CodeAwareText text={questions[activeQIndex].text} />
                </div>
              </div>

              {/* SELECT ANSWER BOX */}
              <div className="pt-4">
                {/* MCQ SELECT AREA */}
                {questions[activeQIndex].type === 'mcq' && (() => {
                  const q = questions[activeQIndex];
                  const rawOpts = (q.options || []).filter(o => o !== null && o !== undefined && String(o).trim() !== '');
                  if (rawOpts.length === 0) {
                    return (
                      <div className="p-4 rounded-2xl border border-amber-300 bg-amber-50 flex items-start space-x-3 text-xs font-sans">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-amber-800 font-semibold leading-relaxed">
                          This question could not load correctly. Please contact the invigilator.
                        </p>
                      </div>
                    );
                  }
                  const baseKeys = ['A', 'B', 'C', 'D'];
                  // Permutation: each display slot maps to an ORIGINAL key. Without
                  // randomization the identity permutation [A,B,C,D] is used so the
                  // server (which grades by answer VALUE) keeps matching correctly.
                  const perm = optionMap[q.id] && optionMap[q.id].length === rawOpts.length
                    ? optionMap[q.id]
                    : baseKeys.slice(0, rawOpts.length);
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 font-sans">
                      {perm.map((originalKey, i) => {
                        const displayKey = baseKeys[i];
                        const optIndex = baseKeys.indexOf(originalKey);
                        const optText = rawOpts[optIndex] ?? rawOpts[i];
                        const isSelected = answers[q.id] === originalKey;
                        return (
                          <button
                            key={`${q.id}-${originalKey}`}
                            type="button"
                            onClick={() => handleSelectAnswer(q.id, originalKey)}
                            className={`p-3.5 rounded-2xl border text-left flex items-start space-x-3 transition-all text-xs font-sans select-none cursor-pointer hover:bg-slate-55/70 ${
                              isSelected
                                ? 'bg-cyan-50/70 border-cyan-500/30 text-cyan-950 font-extrabold shadow-sm'
                                : 'bg-white border-slate-200 text-slate-600'
                            }`}
                          >
                            <span className={`w-5.5 h-5.5 rounded-full flex items-center justify-center font-mono font-black border text-[10px] ${
                              isSelected ? 'bg-cyan-600 text-white border-cyan-705' : 'bg-slate-100 border-slate-250 text-slate-500'
                            }`}>{displayKey}</span>
                            <span className="shrink grow min-w-0 leading-normal font-semibold pr-2 mt-0.5 text-slate-900 text-left">
                              <CodeAwareText text={optText} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* TRUE / FALSE SELECT AREA */}
                {questions[activeQIndex].type === 'truefalse' && (
                  <div className="grid grid-cols-2 gap-4 pb-3">
                    {['True', 'False'].map((key) => {
                      const isSelected = answers[questions[activeQIndex].id] === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleSelectAnswer(questions[activeQIndex].id, key)}
                          className={`p-5 rounded-2xl border text-center transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-cyan-50/60 border-cyan-500/30 text-cyan-900 font-black shadow-md scale-[1.01]'
                              : 'bg-white border-slate-200 text-slate-500 font-semibold'
                          }`}
                        >
                          <span className="text-sm block">{key}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* FILL AREA */}
                {questions[activeQIndex].type === 'fill' && (
                  <div className="space-y-1.5 pb-3 font-sans">
                    <label className="text-[10px] font-bold font-mono text-slate-400 uppercase">Write your answer below:</label>
                    <input
                      type="text"
                      value={answers[questions[activeQIndex].id] || ''}
                      onChange={(e) => handleSelectAnswer(questions[activeQIndex].id, e.target.value)}
                      placeholder="e.g. key constraint"
                      className="w-full max-w-md bg-slate-50 border border-slate-250 p-3 rounded-xl font-semibold text-slate-800 text-xs focus:bg-white focus:outline-none focus:border-cyan-500"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Footer navigational controls — Submit lives in its own pinned
                bar below, well away from Prev/Next, to avoid accidental taps. */}
            <div className="flex items-center justify-center gap-3 border-t pt-4 select-none font-sans">
              <button
                type="button"
                onClick={() => setActiveQIndex(prev => Math.max(0, prev - 1))}
                disabled={activeQIndex === 0}
                className="px-5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4 inline mr-1" />
                <span>Previous</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveQIndex(prev => Math.min(questions.length - 1, prev + 1))}
                disabled={activeQIndex === questions.length - 1}
                className="px-5 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-30 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4 inline ml-1" />
              </button>
            </div>

            {/* Dedicated SUBMIT zone — visually separated, centered, with a
                red/destructive tone so candidates recognise its finality.
                Locked for the first 60 seconds of the exam. On mobile the
                spacer is much larger so a thumb tap on Next can't slide into
                Submit by mistake. */}
            <div className="mt-20 sm:mt-10 pt-6 sm:pt-5 border-t-2 border-dashed border-rose-200 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={handleManualSubmit}
                disabled={submitting || submitUnlockIn > 0}
                aria-busy={submitting}
                data-testid="submit-exam-btn"
                className="px-8 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 font-extrabold text-white shadow-lg flex items-center space-x-2 cursor-pointer text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {submitting ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9" opacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>
                    <span>Submitting…</span>
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4 text-white" />
                    <span>{submitUnlockIn > 0 ? `Submit locked (${submitUnlockIn}s)` : `Submit ${assessmentLabel}`}</span>
                  </>
                )}
              </button>
              <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                {submitUnlockIn > 0
                  ? 'Submit unlocks shortly to prevent accidental early submission.'
                  : 'This is final — you cannot retake the exam after submitting.'}
              </p>
            </div>

            {/* Submit Confirmation Dialog — opening / cancelling this dialog
                never fires malpractice events. */}
            {showSubmitDialog && (
              <div className="fixed inset-0 z-[110] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 animate-zoom-in">
                  <div className="flex items-center space-x-3">
                    <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-6 h-6 text-rose-600" />
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900">Submit {assessmentLabel}?</h3>
                      <p className="text-[11px] text-slate-500 font-mono uppercase tracking-wide mt-0.5">This action cannot be undone</p>
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed">
                    You have answered <strong className="text-cyan-700">{Object.keys(answers).length}</strong> of <strong className="text-slate-900">{questions.length}</strong> questions.
                    {Object.keys(answers).length < questions.length && (
                      <span className="block mt-1 text-rose-700 font-semibold">
                        {questions.length - Object.keys(answers).length} question{questions.length - Object.keys(answers).length === 1 ? '' : 's'} will be marked unanswered.
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row-reverse gap-2.5">
                    <button
                      type="button"
                      onClick={handleConfirmSubmit}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer transition-colors"
                    >
                      Yes, Submit
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelSubmit}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer transition-colors"
                    >
                      No, Go Back
                    </button>
                  </div>
                </div>
              </div>
            )}

            {submitError && (
              <div className="mt-3 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-[11px] font-semibold flex items-center justify-between gap-3">
                <span className="leading-relaxed">Submission failed: {submitError}</span>
                <button
                  type="button"
                  onClick={handleRetrySubmit}
                  disabled={submitting}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] disabled:opacity-60"
                >Retry</button>
              </div>
            )}
          </div>
        </main>
      )}

      {/* ===== SCORECARD STAGE ===== */}
      {(stage === 'scorecard' || stage === 'already') && generatedResult && currentStudent && (
        <main className="grow flex items-start justify-center p-3 sm:p-5 select-none font-sans">
          <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl max-w-2xl w-full overflow-hidden flex flex-col animate-zoom-in text-xs">
            {/* Ribbon */}
            <div className="bg-cyan-600 text-white p-5 sm:p-6 space-y-1.5 shrink-0 text-center">
              <Sparkles className="w-9 h-9 text-white mx-auto animate-pulse" />
              <h2 className="text-base font-black">
                {stage === 'already'
                  ? `${assessmentLabel} Already Submitted`
                  : `${assessmentLabel} Answer Sheet Saved`}
              </h2>
              <p className="text-[11px] text-cyan-100 font-mono tracking-tight uppercase break-words">
                Submitted at {new Date(generatedResult.submittedAt).toLocaleString()}
              </p>
            </div>

            {/* Score body */}
            <div className="p-4 sm:p-6 space-y-5 grow overflow-y-auto">
              {stage === 'already' && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-relaxed font-semibold text-center">
                  You have already taken this {assessmentLabel.toLowerCase()}. Only one attempt is allowed per session. Below is your full score detail.
                </div>
              )}

              {forceSubmitInfo?.penaltyApplied && (
                <div className="p-4 rounded-xl bg-rose-50 border-2 border-rose-300 text-rose-900 text-[11.5px] leading-relaxed font-semibold space-y-2">
                  <div className="flex items-center space-x-2">
                    <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0" />
                    <strong className="text-rose-700 text-xs font-black uppercase tracking-wide">Malpractice Penalty Applied</strong>
                  </div>
                  <p>Your {assessmentLabel.toLowerCase()} has been submitted due to repeated malpractice violations. A penalty deduction has been applied to your score.</p>
                  <div className="grid grid-cols-3 gap-2 pt-1 text-[10px] font-mono">
                    <div className="p-2 rounded bg-white border border-rose-200 text-center">
                      <div className="text-slate-400 uppercase">Raw</div>
                      <div className="text-slate-700 font-black text-sm">{forceSubmitInfo.rawPercentage}%</div>
                    </div>
                    <div className="p-2 rounded bg-white border border-rose-200 text-center">
                      <div className="text-slate-400 uppercase">Penalty</div>
                      <div className="text-rose-600 font-black text-sm">−{forceSubmitInfo.penaltyPercent}%</div>
                    </div>
                    <div className="p-2 rounded bg-white border-2 border-rose-400 text-center">
                      <div className="text-slate-400 uppercase">Final</div>
                      <div className="text-rose-700 font-black text-sm">{forceSubmitInfo.adjustedPercentage}%</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1 text-center">
                <p className="text-[10px] font-bold font-mono text-slate-450 uppercase leading-none">Candidate</p>
                <h3 className="text-base font-extrabold text-slate-900 leading-tight break-words">{generatedResult.name}</h3>
                <p className="font-mono text-indigo-700 text-[10.5px] break-all">{generatedResult.email}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-xl bg-slate-50 border">
                  <span className="text-[10px] font-mono font-bold text-slate-400 block uppercase">Correct</span>
                  <strong className="text-xl font-extrabold text-cyan-600 block mt-0.5">
                    {generatedResult.score} / {generatedResult.totalQuestions}
                  </strong>
                </div>
                <div className="text-center p-3 rounded-xl bg-slate-50 border">
                  <span className="text-[10px] font-mono font-bold text-slate-400 block uppercase">Percentage</span>
                  <strong className="text-xl font-extrabold text-cyan-600 block mt-0.5">{generatedResult.percentage}%</strong>
                </div>
                <div className="text-center p-3 rounded-xl bg-slate-50 border col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-mono font-bold text-slate-400 block uppercase">Type</span>
                  <strong className="text-xl font-extrabold text-cyan-600 block mt-0.5">{assessmentLabel}</strong>
                </div>
              </div>

              <div className={`p-3 rounded-2xl border text-[11px] leading-relaxed font-semibold text-center ${
                generatedResult.percentage >= 75
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : generatedResult.percentage >= 50
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}>
                {generatedResult.percentage >= 75 && 'Outstanding achievement — strong command of the material.'}
                {generatedResult.percentage >= 50 && generatedResult.percentage < 75 && 'Solid attempt — review the items you missed below.'}
                {generatedResult.percentage < 50 && 'Below pass — review every item and book a tutoring session.'}
              </div>

              {/* Per-question full review */}
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span>Per-Question Review</span>
                  <span className="text-[10px] font-mono text-slate-400 uppercase">
                    {reviewQuestions.length} item{reviewQuestions.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="space-y-3 text-left">
                  {reviewQuestions.length === 0 && (
                    <p className="text-[11px] text-slate-500 italic text-center py-4">Loading detailed review...</p>
                  )}
                  {reviewQuestions.map((q, idx) => {
                    const candAns = (generatedResult.answers && generatedResult.answers[q.id]) || '';
                    const correctAns = q.answer || '';
                    const isCorrect = candAns.trim().toUpperCase() === correctAns.trim().toUpperCase();
                    const renderChoice = (key: string) => {
                      if (q.type === 'mcq' && Array.isArray(q.options)) {
                        const i = ['A','B','C','D'].indexOf(key.toUpperCase());
                        if (i >= 0 && q.options[i]) return `${key.toUpperCase()}. ${q.options[i]}`;
                      }
                      return key || '(no answer)';
                    };
                    return (
                      <div key={q.id} className={`p-3 border rounded-xl text-[11px] leading-relaxed ${
                        isCorrect ? 'bg-green-50/60 border-green-200' : 'bg-rose-50/40 border-rose-200'
                      }`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="font-bold text-slate-800">Q{idx + 1}</span>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black font-mono uppercase ${
                            isCorrect ? 'bg-green-600 text-white' : 'bg-rose-600 text-white'
                          }`}>
                            {isCorrect ? '✓ Correct' : '✗ Wrong'}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900 mb-2">
                          <CodeAwareText text={q.text} />
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 mt-2">
                          <div className="p-2 rounded-md bg-white border text-slate-700">
                            <span className="font-mono text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Your answer</span>
                            <span className={`font-semibold break-words ${isCorrect ? 'text-green-700' : 'text-rose-700'}`}>
                              {candAns ? renderChoice(candAns) : <em className="text-slate-400">Skipped</em>}
                            </span>
                          </div>
                          {!isCorrect && (
                            <div className="p-2 rounded-md bg-white border border-green-200 text-slate-700">
                              <span className="font-mono text-[9px] font-bold text-green-600 uppercase block mb-0.5">Correct answer</span>
                              <span className="font-semibold text-green-700 break-words">{renderChoice(correctAns)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t p-4 shrink-0">
              <button
                onClick={handleReturnToPortal}
                className="w-full py-3 bg-slate-900 hover:bg-slate-950 text-white font-bold rounded-xl shadow-md transition-colors cursor-pointer"
              >
                Close {assessmentLabel} Portal
              </button>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
