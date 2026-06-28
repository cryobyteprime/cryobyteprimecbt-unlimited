// Persist student CBT exam state so the candidate can auto-resume after a
// network drop, tab close, or full system shutdown. Storage is per-student
// (keyed by email) in localStorage; the saved deadline is absolute wall-clock
// time so the countdown continues correctly across shutdowns.
import type { Question } from '../types';

const KEY_PREFIX = 'cbp.examResume.v1.';

export interface ExamResumeState {
  email: string;
  classSN: string;
  sessionId: string;
  assessmentLabel: 'Exam' | 'Test';
  questions: Question[];
  answers: Record<string, string>;
  optionMap: Record<string, string[]>;
  activeQIndex: number;
  // Absolute deadline (ms since epoch) for this attempt.
  deadlineAt: number;
  durationMinutes: number;
  startedAt: number;
  savedAt: number;
}

function keyFor(email: string) {
  return KEY_PREFIX + email.trim().toLowerCase();
}

export function saveResume(state: ExamResumeState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(keyFor(state.email), JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    // Quota / private-mode: best-effort.
  }
}

export function loadResume(email: string, sessionId: string): ExamResumeState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(keyFor(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExamResumeState;
    if (!parsed || parsed.email?.toLowerCase() !== email.trim().toLowerCase()) return null;
    if (parsed.sessionId !== sessionId) return null;
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
    if (typeof parsed.deadlineAt !== 'number') return null;
    // Allow resume even past the deadline so the candidate can immediately
    // submit what they have; the caller clamps timeLeft to >= 0.
    return parsed;
  } catch {
    return null;
  }
}

export function clearResume(email: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(keyFor(email)); } catch {}
}

export function remainingSecondsFromDeadline(deadlineAt: number): number {
  return Math.max(0, Math.floor((deadlineAt - Date.now()) / 1000));
}