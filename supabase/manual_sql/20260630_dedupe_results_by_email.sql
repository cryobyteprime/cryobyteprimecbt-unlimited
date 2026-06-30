-- RUN THIS MANUALLY in the Supabase SQL editor.
--
-- BUG FIX: A student was able to log in a second time and write the test again.
-- Root cause: student_cbt_start / student_cbt_submit deduped by
-- (lower(email), examSessionId). If the admin issued a new eligibility row
-- (new sessionId) between the two logins, or the student's first attempt was
-- saved against a different session_id than the second one (e.g. open-
-- attendance fallback vs eligibility row), the prior-result lookup missed
-- and a fresh attempt was issued.
--
-- Fix: dedupe by lower(email) ALONE within the current exam cycle. Any prior
-- result for the candidate blocks further attempts. Admins must explicitly
-- clear/wipe results before starting a new cycle (the admin Exams page already
-- supports this).
--
-- Also enforce at the DB level with a unique index on lower(email) so the
-- race window between SELECT and INSERT cannot produce a second row.

-- 1) De-duplicate any existing duplicates BEFORE adding the unique index:
--    keep the earliest submission per email, delete the rest. The first
--    attempt is the authoritative one.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY lower(email) ORDER BY "submittedAt" ASC NULLS LAST, id ASC) AS rn
    FROM public.results
)
DELETE FROM public.results r
 USING ranked
 WHERE r.id = ranked.id AND ranked.rn > 1;

-- 2) Hard DB-level guarantee: one result per student email.
DROP INDEX IF EXISTS public.results_email_unique_idx;
CREATE UNIQUE INDEX results_email_unique_idx
  ON public.results (lower(email));

-- 3) student_cbt_start: dedupe by email only.
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
  v_open_marked boolean := false;
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

  SELECT EXISTS (
    SELECT 1
      FROM public.att_records r
      JOIN public.att_sessions s ON s.id = r."sessionId"
     WHERE s.status = 'open'
       AND r.status IN ('present', 'late')
       AND ( lower(r.email) = lower(v_student.email)
          OR upper(trim(r."classSN")) = upper(trim(p_class_sn)) )
  ) INTO v_open_marked;

  v_session_id := COALESCE(v_elig."sessionId", 'active-session');

  -- DEDUPE BY EMAIL ONLY. Any prior result row for this student — regardless
  -- of which examSessionId it was recorded against — blocks re-entry.
  SELECT * INTO v_prior FROM public.results
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "submittedAt" ASC NULLS LAST
    LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'alreadySubmitted', true,
      'assessmentType', v_assessment_type,
      'student', to_jsonb(v_student),
      'sessionId', v_prior."examSessionId",
      'result', to_jsonb(v_prior)
    );
  END IF;

  IF NOT COALESCE(v_config."examActivated", false)
     OR NOT ( (v_elig.status = 'eligible') OR v_open_marked ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'eligible', false,
      'examActivated', COALESCE(v_config."examActivated", false),
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

-- 4) student_cbt_submit: dedupe by email only + rely on the unique index.
CREATE OR REPLACE FUNCTION public.student_cbt_submit(
  p_email text, p_class_sn text, p_session_id text, p_attempt_id text, p_answers jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
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

  -- Dedupe by email ONLY — the first submission is authoritative.
  SELECT * INTO v_existing FROM public.results
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "submittedAt" ASC NULLS LAST
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'id', v_existing.id, 'score', v_existing.score,
      'percentage', v_existing.percentage, 'totalQuestions', v_existing."totalQuestions",
      'alreadySubmitted', true);
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
    -- Lost the race: another concurrent submission inserted first. Return it.
    SELECT * INTO v_existing FROM public.results
      WHERE lower(email) = lower(v_student.email)
      ORDER BY "submittedAt" ASC NULLS LAST
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
REVOKE ALL ON FUNCTION public.student_cbt_start(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_cbt_start(text, text) TO anon, authenticated;
