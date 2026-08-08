-- APPLIED 2026-08-08 to the live database. Single-source attendance gate:
-- only an att_records row with status present/late in the current marked
-- attendance session grants exam/test access. Roster listing no longer counts.
CREATE OR REPLACE FUNCTION public.cbt_attendance_status(p_email text, p_class_sn text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cur_session text;
  v_status text;
BEGIN
  -- Current attendance session = most recent session that actually has
  -- marked records. Sessions created but never marked are ignored so a
  -- freshly opened empty session cannot lock everybody out.
  SELECT s.id INTO v_cur_session
    FROM public.att_sessions s
   WHERE EXISTS (SELECT 1 FROM public.att_records r WHERE r."sessionId" = s.id)
   ORDER BY s.date DESC NULLS LAST, s."createdAt" DESC NULLS LAST
   LIMIT 1;

  IF v_cur_session IS NULL THEN
    RETURN 'none';
  END IF;

  SELECT lower(r.status) INTO v_status
    FROM public.att_records r
   WHERE r."sessionId" = v_cur_session
     AND ( lower(r.email) = lower(trim(p_email))
        OR upper(trim(r."classSN")) = upper(trim(COALESCE(p_class_sn, ''))) )
   ORDER BY (CASE WHEN lower(r.email) = lower(trim(p_email)) THEN 0 ELSE 1 END),
            r."timestamp" DESC NULLS LAST
   LIMIT 1;

  RETURN COALESCE(v_status, 'none');
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.cbt_attendance_status(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.student_cbt_start(p_email text, p_class_sn text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student       public.students%ROWTYPE;
  v_config        public.config%ROWTYPE;
  v_elig          public.exam_eligibility%ROWTYPE;
  v_open_session  public.att_sessions%ROWTYPE;
  v_session_id    text;
  v_latest_status text;
  v_open_marked   boolean := false;
  v_marked        boolean := false;
  v_questions     jsonb;
  v_prior         public.results%ROWTYPE;
  v_assessment_type text;
  v_max           int;
  v_duration      int;
  v_randomize     boolean;
  v_pool_size     int;
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

  -- ── ATTENDANCE GATE (single source of truth) ─────────────────────────
  -- A candidate is eligible ONLY when an att_records row marks them
  -- present/late. Being listed on an open session roster grants nothing.
  v_open_marked := false;
  v_latest_status := public.cbt_attendance_status(v_student.email, p_class_sn);
  v_marked := v_latest_status IN ('present', 'late');
  -- ─────────────────────────────────────────────────────────────────────

  -- Session ID: prefer open session → then exam_eligibility → fallback.
  SELECT * INTO v_elig FROM public.exam_eligibility
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "updatedAt" DESC NULLS LAST
    LIMIT 1;

  v_session_id := COALESCE(
    v_open_session.id,       -- live open session (most authoritative)
    v_elig."sessionId",      -- previously recorded eligibility
    'active-session'         -- last-resort fallback
  );

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

  -- Both conditions REQUIRED: exam gate must be activated AND attendance OK.
  IF NOT COALESCE(v_config."examActivated", false) OR NOT v_marked THEN
    RETURN jsonb_build_object(
      'ok', true, 'eligible', false,
      'examActivated', COALESCE(v_config."examActivated", false),
      'attendanceMarked', v_marked,
      'attendanceStatus', CASE
        WHEN v_open_marked THEN 'present_or_late_open_session'
        ELSE COALESCE(v_latest_status, 'none')
      END,
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
    'attendanceStatus', CASE WHEN v_open_marked THEN 'present_open_session' ELSE v_latest_status END,
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
$function$

;
CREATE OR REPLACE FUNCTION public.student_cbt_submit(p_email text, p_class_sn text, p_session_id text, p_attempt_id text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student       public.students%ROWTYPE;
  v_config        public.config%ROWTYPE;
  v_latest_status text;
  v_open_marked   boolean := false;
  v_marked        boolean := false;
  v_score         integer := 0;
  v_total         integer := 0;
  v_percentage    numeric := 0;
  v_result_id     text;
  v_existing      public.results%ROWTYPE;
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

  -- Idempotency: return existing result without re-checking gates.
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

  -- ── ATTENDANCE GATE (single source of truth) ─────────────────────────
  -- A candidate is eligible ONLY when an att_records row marks them
  -- present/late. Being listed on an open session roster grants nothing.
  v_open_marked := false;
  v_latest_status := public.cbt_attendance_status(v_student.email, p_class_sn);
  v_marked := v_latest_status IN ('present', 'late');
  -- ─────────────────────────────────────────────────────────────────────

  IF NOT v_marked THEN
    BEGIN
      INSERT INTO public.audit_log (id, "userId", "userName", "userRole", action, page, reason, "newValue", "timestamp")
      VALUES (
        'aud_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
        v_student.email, v_student.email, 'Candidate',
        'LOGIN_BLOCKED: submit rejected — attendance not present/late',
        'Student CBT Exam',
        'Attendance gate rejected submit',
        jsonb_build_object('classSN', v_student."classSN",
          'attendanceStatus', COALESCE(v_latest_status, 'none'),
          'openSessionMarked', v_open_marked)::text,
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
$function$

;
