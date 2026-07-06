-- RUN MANUALLY. Strict attendance gate: only students with an att_records
-- row of status present/late in an OPEN att_session can start a test/exam.
-- The exam gate (config.examActivated) must still be true, but eligibility
-- rows alone (exam_eligibility.status='eligible') no longer bypass
-- attendance. Absent / unmarked students are blocked even when the gate
-- window is open.

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

  -- SOLE attendance gate: an actual att_records row with status
  -- present or late in an OPEN att_session. Roster listing, eligibility
  -- rows, and admin overrides no longer grant access on their own.
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

  -- Prior submission blocks any re-attempt (dedupe by email).
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

  -- Both conditions REQUIRED: gate open AND attendance marked present/late.
  IF NOT COALESCE(v_config."examActivated", false) OR NOT v_open_marked THEN
    RETURN jsonb_build_object(
      'ok', true, 'eligible', false,
      'examActivated', COALESCE(v_config."examActivated", false),
      'attendanceMarked', v_open_marked,
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
