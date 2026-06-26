-- Security hardening:
-- 1) Drop plaintext password columns from public.config (config_pw_plaintext)
-- 2) Restrict audit_log INSERT so userRole must match caller's actual role (audit_log_forgery)
-- 3) Enforce exam activation + eligibility in student_cbt_submit (cbt_submit_no_elig)

-- 1) Remove plaintext password columns
ALTER TABLE public.config DROP COLUMN IF EXISTS "protectionPassword";
ALTER TABLE public.config DROP COLUMN IF EXISTS "superadminPassword";

-- 2) Audit log: forbid forging userRole
DROP POLICY IF EXISTS "audit_log_authenticated_insert" ON public.audit_log;
CREATE POLICY "audit_log_role_bound_insert" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    ("userRole" = 'Superadmin' AND public.has_role(auth.uid(), 'superadmin'))
    OR ("userRole" = 'Admin'  AND public.has_role(auth.uid(), 'admin'))
    OR ("userRole" = 'Tutor'  AND public.has_role(auth.uid(), 'staff'))
  );

-- 3) student_cbt_submit: enforce exam activation + eligibility
CREATE OR REPLACE FUNCTION public.student_cbt_submit(
  p_email text, p_class_sn text, p_session_id text, p_attempt_id text, p_answers jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_config public.config%ROWTYPE;
  v_elig public.exam_eligibility%ROWTYPE;
  v_open_marked boolean := false;
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
    WHERE lower(email) = lower(v_student.email) AND "examSessionId" = v_session
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'id', v_existing.id, 'score', v_existing.score,
      'percentage', v_existing.percentage, 'totalQuestions', v_existing."totalQuestions",
      'alreadySubmitted', true);
  END IF;

  -- Gate: exam must be activated and student must be eligible
  SELECT * INTO v_config FROM public.config LIMIT 1;
  IF NOT COALESCE(v_config."examActivated", false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'exam_not_activated');
  END IF;

  SELECT * INTO v_elig FROM public.exam_eligibility
    WHERE lower(email) = lower(v_student.email)
    ORDER BY "updatedAt" DESC NULLS LAST LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.att_sessions
     WHERE status = 'open'
       AND ( upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round1Serials") x)
          OR upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round2Serials") x) )
  ) INTO v_open_marked;

  IF NOT ( (v_elig.status = 'eligible') OR v_open_marked ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_eligible');
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
