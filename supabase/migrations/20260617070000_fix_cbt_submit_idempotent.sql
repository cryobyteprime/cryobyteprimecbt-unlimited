-- Make student_cbt_submit idempotent and surface alreadySubmitted from student_cbt_start.

CREATE OR REPLACE FUNCTION public.student_cbt_submit(
  p_email text, p_class_sn text, p_session_id text, p_attempt_id text, p_answers jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT * INTO v_existing FROM public.results
    WHERE lower(email) = lower(v_student.email) AND "examSessionId" = v_session
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
    SELECT * INTO v_existing FROM public.results
      WHERE lower(email) = lower(v_student.email) AND "examSessionId" = v_session
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


CREATE OR REPLACE FUNCTION public.student_cbt_start(p_email text, p_class_sn text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_config public.config%ROWTYPE;
  v_elig public.exam_eligibility%ROWTYPE;
  v_session_id text;
  v_open_marked boolean := false;
  v_questions jsonb;
  v_existing public.results%ROWTYPE;
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
  SELECT * INTO v_elig FROM public.exam_eligibility
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "updatedAt" DESC NULLS LAST LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.att_sessions
     WHERE status = 'open'
       AND ( upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round1Serials") x)
          OR upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round2Serials") x) )
  ) INTO v_open_marked;

  v_session_id := COALESCE(v_elig."sessionId", 'active-session');

  SELECT * INTO v_existing FROM public.results
    WHERE lower(email) = lower(v_student.email) AND "examSessionId" = v_session_id
    ORDER BY "submittedAt" DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'alreadySubmitted', true, 'eligible', true,
      'examActivated', COALESCE(v_config."examActivated", false),
      'assessmentType', COALESCE(v_config."assessmentType", 'exam'),
      'student', to_jsonb(v_student), 'sessionId', v_session_id,
      'result', to_jsonb(v_existing));
  END IF;

  IF NOT COALESCE(v_config."examActivated", false)
     OR NOT ( (v_elig.status = 'eligible') OR v_open_marked ) THEN
    RETURN jsonb_build_object('ok', true, 'eligible', false,
      'examActivated', COALESCE(v_config."examActivated", false),
      'assessmentType', COALESCE(v_config."assessmentType", 'exam'),
      'student', to_jsonb(v_student), 'sessionId', v_session_id);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'text', text, 'type', type, 'options', options,
    'difficulty', difficulty, 'subject', subject)), '[]'::jsonb)
  INTO v_questions FROM public.questions;

  RETURN jsonb_build_object('ok', true, 'eligible', true, 'examActivated', true,
    'assessmentType', COALESCE(v_config."assessmentType", 'exam'),
    'student', to_jsonb(v_student), 'sessionId', v_session_id, 'questions', v_questions);
END;
$$;

REVOKE ALL ON FUNCTION public.student_cbt_start(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_cbt_start(text, text) TO anon, authenticated;
