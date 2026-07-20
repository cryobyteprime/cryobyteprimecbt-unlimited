-- RUN MANUALLY.
--
-- ROOT-CAUSE FIX: Absent students could still enter and submit the exam.
--
-- Two functions were wrong:
--
-- 1) public.student_cbt_start (from 20260707) treated a student as
--    eligible if ANY historical att_records row had status IN
--    ('present','late'). If the LATEST record for the current session
--    was 'absent', a stale prior row from a different session would
--    still let them in.
--
-- 2) public.student_cbt_submit (from 20260627 security hardening) never
--    checked the student's own att_records status at all. It only
--    checked that SOME att_session was still 'open' with the classSN
--    listed in its round1/round2 serials — so an absent student who
--    somehow reached the exam could still submit a result.
--
-- This migration rewrites both functions to gate on the student's
-- MOST RECENT attendance record (joined to att_sessions and ordered by
-- session date, then record timestamp). Only 'present' or 'late' as the
-- latest status is accepted. This makes the check identical on both
-- ends of the exam lifecycle, on the backend, regardless of how the
-- exam gate was opened (manual toggle or scheduled timer).

-- ─── 1) student_cbt_start ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.student_cbt_start(p_email text, p_class_sn text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student public.students%ROWTYPE;
  v_config public.config%ROWTYPE;
  v_elig public.exam_eligibility%ROWTYPE;
  v_session_id text;
  v_latest_status text;
  v_marked boolean := false;
  v_questions jsonb;
  v_prior public.results%ROWTYPE;
  v_assessment_type text;
  v_max int;
  v_duration int;
  v_randomize boolean;
  v_pool_size int;
BEGIN
  IF p_email IS NULL OR p_class_sn IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_credentials');
  END IF;

  SELECT * INTO v_student FROM public.students
    WHERE lower(email) = lower(trim(p_email))
      AND upper(trim("classSN")) = upper(trim(p_class_sn))
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  SELECT * INTO v_config FROM public.config LIMIT 1;
  v_assessment_type := COALESCE(v_config."assessmentType", 'exam');
  v_max       := GREATEST(1, COALESCE(v_config."maxQuestions", 20));
  v_duration  := GREATEST(1, COALESCE(v_config."examDurationMinutes", 12));
  v_randomize := COALESCE(v_config."randomizeQuestions", true);

  SELECT * INTO v_elig FROM public.exam_eligibility
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "updatedAt" DESC NULLS LAST
    LIMIT 1;

  -- LATEST attendance row wins. If it says 'absent' (or no record exists
  -- at all), the gate stays closed regardless of any older present/late.
  SELECT lower(r.status)
    INTO v_latest_status
    FROM public.att_records r
    LEFT JOIN public.att_sessions s ON s.id = r."sessionId"
   WHERE lower(r.email) = lower(v_student.email)
   ORDER BY COALESCE(s.date, r.date) DESC NULLS LAST,
            r."timestamp" DESC NULLS LAST
   LIMIT 1;

  v_marked := v_latest_status IN ('present', 'late');

  v_session_id := COALESCE(v_elig."sessionId", 'active-session');

  SELECT * INTO v_prior FROM public.results
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "submittedAt" DESC NULLS LAST
    LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'alreadySubmitted', true,
      'assessmentType', v_assessment_type,
      'student', to_jsonb(v_student),
      'sessionId', v_session_id,
      'result', to_jsonb(v_prior)
    );
  END IF;

  IF NOT COALESCE(v_config."examActivated", false) OR NOT v_marked THEN
    RETURN jsonb_build_object(
      'ok', true, 'eligible', false,
      'examActivated', COALESCE(v_config."examActivated", false),
      'attendanceMarked', v_marked,
      'attendanceStatus', COALESCE(v_latest_status, 'none'),
      'assessmentType', v_assessment_type,
      'student', to_jsonb(v_student),
      'sessionId', v_session_id
    );
  END IF;

  SELECT count(*) INTO v_pool_size FROM public.questions;

  IF v_randomize THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'text', text, 'type', type, 'options', options,
      'difficulty', difficulty, 'subject', subject
    )), '[]'::jsonb)
    INTO v_questions
    FROM (
      SELECT id, text, type, options, difficulty, subject
      FROM public.questions
      ORDER BY random()
      LIMIT v_max
    ) q;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'text', text, 'type', type, 'options', options,
      'difficulty', difficulty, 'subject', subject
    )), '[]'::jsonb)
    INTO v_questions
    FROM (
      SELECT id, text, type, options, difficulty, subject
      FROM public.questions
      ORDER BY "createdAt" ASC, id ASC
      LIMIT v_max
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'eligible', true,
    'examActivated', true,
    'attendanceMarked', true,
    'attendanceStatus', v_latest_status,
    'assessmentType', v_assessment_type,
    'student', to_jsonb(v_student),
    'sessionId', v_session_id,
    'questions', v_questions,
    'questionCount', jsonb_array_length(v_questions),
    'poolSize', v_pool_size,
    'maxQuestions', v_max,
    'durationMinutes', v_duration,
    'randomizeQuestions', v_randomize,
    'randomizeOptions', COALESCE(v_config."randomizeOptions", false),
    'examStartAt', v_config."examStartAt",
    'examEndAt', v_config."examEndAt",
    'monitoring', v_config."monitoring"
  );
END;
$function$;

-- ─── 2) student_cbt_submit ────────────────────────────────────────────
-- Defense-in-depth: identical latest-status attendance gate on submit.
CREATE OR REPLACE FUNCTION public.student_cbt_submit(
  p_email text, p_class_sn text, p_session_id text, p_attempt_id text, p_answers jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_config public.config%ROWTYPE;
  v_latest_status text;
  v_marked boolean := false;
  v_score integer := 0;
  v_total integer := 0;
  v_percentage numeric := 0;
  v_result_id text;
  v_existing public.results%ROWTYPE;
  v_qid text; v_correct text; v_given text; v_session text;
BEGIN
  SELECT * INTO v_student FROM public.students
    WHERE lower(email) = lower(trim(p_email))
      AND upper(trim("classSN")) = upper(trim(p_class_sn))
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    p_answers := '{}'::jsonb;
  END IF;

  v_session := COALESCE(NULLIF(trim(p_session_id), ''), 'active-session');

  -- Idempotency: return existing result without re-checking gates
  SELECT * INTO v_existing FROM public.results
    WHERE lower(email) = lower(v_student.email)
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'id', v_existing.id, 'score', v_existing.score,
      'percentage', v_existing.percentage, 'totalQuestions', v_existing."totalQuestions",
      'alreadySubmitted', true);
  END IF;

  SELECT * INTO v_config FROM public.config LIMIT 1;
  IF NOT COALESCE(v_config."examActivated", false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'exam_not_activated');
  END IF;

  -- Same latest-attendance-status rule as student_cbt_start.
  SELECT lower(r.status)
    INTO v_latest_status
    FROM public.att_records r
    LEFT JOIN public.att_sessions s ON s.id = r."sessionId"
   WHERE lower(r.email) = lower(v_student.email)
   ORDER BY COALESCE(s.date, r.date) DESC NULLS LAST,
            r."timestamp" DESC NULLS LAST
   LIMIT 1;

  v_marked := v_latest_status IN ('present', 'late');

  IF NOT v_marked THEN
    -- Log the blocked submit attempt so it surfaces on the monitoring panel.
    BEGIN
      INSERT INTO public.audit_log (id, "userId", "userName", "userRole", action, page, reason, "newValue", "timestamp")
      VALUES (
        'aud_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
        v_student.email, v_student.email, 'Candidate',
        'LOGIN_BLOCKED: submit rejected — attendance not present/late',
        'Student CBT Exam',
        'Attendance gate rejected submit',
        jsonb_build_object('classSN', v_student."classSN", 'attendanceStatus', COALESCE(v_latest_status, 'none'))::text,
        now()
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN jsonb_build_object('ok', false, 'error', 'not_eligible',
      'attendanceStatus', COALESCE(v_latest_status, 'none'));
  END IF;

  FOR v_qid IN SELECT jsonb_object_keys(p_answers) LOOP
    v_total := v_total + 1;
    SELECT upper(trim(answer)) INTO v_correct FROM public.questions WHERE id = v_qid;
    v_given := upper(trim(COALESCE(p_answers->>v_qid, '')));
    IF v_correct IS NOT NULL AND v_correct = v_given THEN
      v_score := v_score + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN v_percentage := 0;
  ELSE v_percentage := round((v_score::numeric / v_total::numeric) * 100);
  END IF;

  v_result_id := 'res_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  BEGIN
    INSERT INTO public.results (
      id, email, name, class, "classSN", "examSessionId",
      score, percentage, "totalQuestions", answers, "submittedAt", "attemptId"
    ) VALUES (
      v_result_id, v_student.email, v_student.name, v_student.class, v_student."classSN",
      v_session, v_score, v_percentage, GREATEST(v_total, 1), p_answers, now(),
      COALESCE(NULLIF(trim(p_attempt_id), ''), 'alt-' || extract(epoch from now())::text)
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.results
      WHERE lower(email) = lower(v_student.email)
      LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'id', v_existing.id, 'score', v_existing.score,
        'percentage', v_existing.percentage, 'totalQuestions', v_existing."totalQuestions",
        'alreadySubmitted', true);
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_result_id, 'score', v_score,
    'percentage', v_percentage, 'totalQuestions', GREATEST(v_total, 1));
END;
$$;

REVOKE ALL ON FUNCTION public.student_cbt_submit(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_cbt_submit(text, text, text, text, jsonb) TO anon, authenticated;

-- Ensure audit_log broadcasts realtime events so the Exam Monitoring
-- panel updates live (join, submit, blocked, violation).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;