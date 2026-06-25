/**
 * End-to-end idempotency test for the CBT submission RPCs.
 *
 * Submits the same exam session twice for the same student and confirms:
 *  - The first call returns ok with a fresh `id`.
 *  - The second call returns ok with `alreadySubmitted: true` and the SAME `id`,
 *    score and totalQuestions — i.e. the second attempt lands on the existing
 *    scorecard rather than creating a new result or erroring out.
 *
 * Requires:
 *  - VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (read from .env)
 *  - TEST_STUDENT_EMAIL + TEST_STUDENT_CLASSSN env vars for a real student row
 *
 * Run:   bunx vitest run tests/e2e/exam-double-submit.test.ts
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  '';
const TEST_EMAIL = process.env.TEST_STUDENT_EMAIL || '';
const TEST_CLASSSN = process.env.TEST_STUDENT_CLASSSN || '';

const canRun = !!(SUPABASE_URL && SUPABASE_KEY && TEST_EMAIL && TEST_CLASSSN);

describe.skipIf(!canRun)('student_cbt_submit idempotency', () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  it('returns the existing scorecard on a second submission for the same session', async () => {
    // 1) Start the session to obtain a sessionId + question pool.
    const start = await supabase.rpc('student_cbt_start', {
      p_email: TEST_EMAIL,
      p_class_sn: TEST_CLASSSN,
    });
    expect(start.error).toBeNull();
    const startData: any = start.data;
    expect(startData?.ok).toBe(true);

    const sessionId: string = startData.sessionId || 'active-session';
    const questions: Array<{ id: string }> = startData.questions || [];

    // If the student already has a result, student_cbt_start surfaces it directly.
    // In that case re-submitting must still land on the same scorecard.
    const answers: Record<string, string> = {};
    questions.slice(0, 5).forEach(q => { answers[q.id] = 'A'; });

    const attemptId = `e2e-${Date.now()}`;

    // 2) First submit.
    const first = await supabase.rpc('student_cbt_submit', {
      p_email: TEST_EMAIL,
      p_class_sn: TEST_CLASSSN,
      p_session_id: sessionId,
      p_attempt_id: attemptId,
      p_answers: answers,
    });
    expect(first.error).toBeNull();
    const a: any = first.data;
    expect(a?.ok).toBe(true);
    expect(typeof a.id).toBe('string');

    // 3) Second submit with a *different* attemptId + different answers — must
    //    be ignored: the function returns the existing result.
    const differentAnswers: Record<string, string> = {};
    questions.slice(0, 5).forEach(q => { differentAnswers[q.id] = 'B'; });

    const second = await supabase.rpc('student_cbt_submit', {
      p_email: TEST_EMAIL,
      p_class_sn: TEST_CLASSSN,
      p_session_id: sessionId,
      p_attempt_id: `${attemptId}-retry`,
      p_answers: differentAnswers,
    });
    expect(second.error).toBeNull();
    const b: any = second.data;
    expect(b?.ok).toBe(true);
    expect(b.alreadySubmitted).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.score).toBe(a.score);
    expect(b.totalQuestions).toBe(a.totalQuestions);
    expect(b.percentage).toBe(a.percentage);
  });
});
