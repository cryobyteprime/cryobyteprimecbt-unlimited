
-- 1) Assessment type on config
ALTER TABLE public.config
  ADD COLUMN IF NOT EXISTS "assessmentType" text NOT NULL DEFAULT 'exam';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_assessment_type_check') THEN
    ALTER TABLE public.config
      ADD CONSTRAINT config_assessment_type_check
      CHECK ("assessmentType" IN ('exam','test'));
  END IF;
END $$;

-- 2) Enforce one attempt per (email, session)
CREATE UNIQUE INDEX IF NOT EXISTS results_email_session_unique
  ON public.results (lower(email), "examSessionId");

-- 3) Replace student_cbt_start: return prior result if any
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

  SELECT * INTO v_elig FROM public.exam_eligibility
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "updatedAt" DESC NULLS LAST
    LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.att_sessions
     WHERE status = 'open'
       AND ( upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round1Serials") x)
          OR upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round2Serials") x) )
  ) INTO v_open_marked;

  v_session_id := COALESCE(v_elig."sessionId", 'active-session');

  -- Check for prior submission on this session
  SELECT * INTO v_prior FROM public.results
    WHERE lower(email) = lower(v_student.email)
      AND "examSessionId" = v_session_id
    ORDER BY "submittedAt" DESC NULLS LAST
    LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'alreadySubmitted', true,
      'assessmentType', v_assessment_type,
      'student', to_jsonb(v_student),
      'sessionId', v_session_id,
      'result', to_jsonb(v_prior)
    );
  END IF;

  IF NOT COALESCE(v_config."examActivated", false)
     OR NOT ( (v_elig.status = 'eligible') OR v_open_marked ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'eligible', false,
      'examActivated', COALESCE(v_config."examActivated", false),
      'assessmentType', v_assessment_type,
      'student', to_jsonb(v_student),
      'sessionId', v_session_id
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'text', text, 'type', type, 'options', options,
    'difficulty', difficulty, 'subject', subject
  )), '[]'::jsonb)
  INTO v_questions
  FROM public.questions;

  RETURN jsonb_build_object(
    'ok', true,
    'eligible', true,
    'examActivated', true,
    'assessmentType', v_assessment_type,
    'student', to_jsonb(v_student),
    'sessionId', v_session_id,
    'questions', v_questions
  );
END;
$function$;

-- 4) Result-detail function: returns latest result + full question bank with correct answers
CREATE OR REPLACE FUNCTION public.student_cbt_result(p_email text, p_class_sn text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student public.students%ROWTYPE;
  v_result public.results%ROWTYPE;
  v_questions jsonb;
  v_assessment_type text;
BEGIN
  SELECT * INTO v_student FROM public.students
    WHERE lower(email) = lower(trim(p_email))
      AND upper(trim("classSN")) = upper(trim(p_class_sn))
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  SELECT COALESCE("assessmentType", 'exam') INTO v_assessment_type FROM public.config LIMIT 1;

  SELECT * INTO v_result FROM public.results
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "submittedAt" DESC NULLS LAST
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'hasResult', false,
      'assessmentType', v_assessment_type,
      'student', to_jsonb(v_student)
    );
  END IF;

  -- Return only questions that were on the attempt (answers keys)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'text', q.text, 'type', q.type, 'options', q.options,
    'difficulty', q.difficulty, 'subject', q.subject, 'answer', q.answer
  )), '[]'::jsonb)
  INTO v_questions
  FROM public.questions q
  WHERE q.id = ANY (SELECT jsonb_object_keys(v_result.answers));

  RETURN jsonb_build_object(
    'ok', true,
    'hasResult', true,
    'assessmentType', v_assessment_type,
    'student', to_jsonb(v_student),
    'result', to_jsonb(v_result),
    'questions', v_questions
  );
END;
$function$;
