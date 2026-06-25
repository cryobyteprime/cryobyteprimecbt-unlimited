
-- =========================================================
-- 1) DROP existing permissive policies
-- =========================================================
DROP POLICY IF EXISTS "public_all" ON public.config;
DROP POLICY IF EXISTS "public_all" ON public.admin_profiles;
DROP POLICY IF EXISTS "public_all" ON public.students;
DROP POLICY IF EXISTS "public_all" ON public.att_sessions;
DROP POLICY IF EXISTS "public_all" ON public.att_records;
DROP POLICY IF EXISTS "public_all" ON public.att_edit_requests;
DROP POLICY IF EXISTS "public_all" ON public.exam_eligibility;
DROP POLICY IF EXISTS "public_all" ON public.questions;
DROP POLICY IF EXISTS "public_all" ON public.results;
DROP POLICY IF EXISTS "public_all" ON public.deletion_requests;
DROP POLICY IF EXISTS "public_all" ON public.audit_log;

-- =========================================================
-- 2) Revoke anon grants on app tables; keep authenticated grants
-- =========================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'config','admin_profiles','students','att_sessions','att_records',
    'att_edit_requests','exam_eligibility','questions','results',
    'deletion_requests','audit_log'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- =========================================================
-- 3) Lock down has_role function execution
-- =========================================================
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

-- =========================================================
-- 4) Scrub legacy plaintext passwords
-- =========================================================
UPDATE public.config SET "protectionPassword" = '', "superadminPassword" = '';

-- =========================================================
-- 5) Re-create policies with proper role gating
-- =========================================================

-- admin_profiles: superadmin only
CREATE POLICY "admin_profiles_superadmin_all" ON public.admin_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

-- config: superadmin only
CREATE POLICY "config_superadmin_all" ON public.config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
-- Allow any authenticated user to read examActivated (needed by admin portal UI)
CREATE POLICY "config_authenticated_read" ON public.config
  FOR SELECT TO authenticated USING (true);

-- audit_log: any authenticated can INSERT; only admin/superadmin can SELECT; no update/delete
CREATE POLICY "audit_log_admin_select" ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "audit_log_authenticated_insert" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- deletion_requests: any authenticated can INSERT & SELECT own workflow; admin/superadmin can SELECT/UPDATE/DELETE all
CREATE POLICY "deletion_requests_admin_all" ON public.deletion_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "deletion_requests_authenticated_insert" ON public.deletion_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "deletion_requests_authenticated_select" ON public.deletion_requests
  FOR SELECT TO authenticated USING (true);

-- students: any authenticated read; admin/superadmin manage
CREATE POLICY "students_authenticated_select" ON public.students
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "students_admin_write" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "students_admin_update" ON public.students
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "students_admin_delete" ON public.students
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- att_sessions: any authenticated read; admin/superadmin write; staff can read
CREATE POLICY "att_sessions_authenticated_select" ON public.att_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "att_sessions_admin_write" ON public.att_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "att_sessions_admin_update" ON public.att_sessions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "att_sessions_admin_delete" ON public.att_sessions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- att_records: authenticated read; admin/staff insert+update; admin delete
CREATE POLICY "att_records_authenticated_select" ON public.att_records
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "att_records_authenticated_insert" ON public.att_records
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "att_records_authenticated_update" ON public.att_records
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "att_records_admin_delete" ON public.att_records
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- att_edit_requests: admin/superadmin read+update+delete; any authenticated insert (still gated UI-side)
CREATE POLICY "att_edit_requests_admin_select" ON public.att_edit_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "att_edit_requests_authenticated_insert" ON public.att_edit_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "att_edit_requests_admin_update" ON public.att_edit_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "att_edit_requests_admin_delete" ON public.att_edit_requests
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- exam_eligibility: authenticated read; admin/superadmin write
CREATE POLICY "exam_eligibility_authenticated_select" ON public.exam_eligibility
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "exam_eligibility_admin_write" ON public.exam_eligibility
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "exam_eligibility_admin_update" ON public.exam_eligibility
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "exam_eligibility_admin_delete" ON public.exam_eligibility
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- questions: authenticated read (admins reviewing); admin/superadmin write
CREATE POLICY "questions_authenticated_select" ON public.questions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "questions_admin_insert" ON public.questions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "questions_admin_update" ON public.questions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "questions_admin_delete" ON public.questions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- results: authenticated read; admin/superadmin can manage; insert restricted to admin (student inserts go through RPC)
CREATE POLICY "results_authenticated_select" ON public.results
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "results_admin_insert" ON public.results
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "results_admin_update" ON public.results
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "results_admin_delete" ON public.results
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- 6) SECURITY DEFINER RPCs for anonymous student CBT flow
-- =========================================================

-- Start exam: validate student, check config, eligibility, return questions WITHOUT answers
CREATE OR REPLACE FUNCTION public.student_cbt_start(p_email text, p_class_sn text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_config public.config%ROWTYPE;
  v_elig public.exam_eligibility%ROWTYPE;
  v_session_id text;
  v_open_marked boolean := false;
  v_questions jsonb;
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
    ORDER BY "updatedAt" DESC NULLS LAST
    LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.att_sessions
     WHERE status = 'open'
       AND ( upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round1Serials") x)
          OR upper(trim(p_class_sn)) = ANY(SELECT upper(trim(x)) FROM unnest("round2Serials") x) )
  ) INTO v_open_marked;

  v_session_id := COALESCE(v_elig."sessionId", 'active-session');

  IF NOT COALESCE(v_config."examActivated", false)
     OR NOT ( (v_elig.status = 'eligible') OR v_open_marked ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'eligible', false,
      'examActivated', COALESCE(v_config."examActivated", false),
      'student', to_jsonb(v_student),
      'sessionId', v_session_id
    );
  END IF;

  -- Return questions stripped of answers
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
    'student', to_jsonb(v_student),
    'sessionId', v_session_id,
    'questions', v_questions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_cbt_start(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_cbt_start(text, text) TO anon, authenticated;

-- Submit exam: score server-side against stored answers, insert result
CREATE OR REPLACE FUNCTION public.student_cbt_submit(
  p_email text,
  p_class_sn text,
  p_session_id text,
  p_attempt_id text,
  p_answers jsonb
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
  v_qid text;
  v_correct text;
  v_given text;
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

  v_total := (SELECT count(*) FROM jsonb_object_keys(p_answers));
  IF v_total = 0 THEN
    -- Allow zero-answer submissions; count total as number of questions referenced
    v_total := 1;
  END IF;

  -- Recompute total from the set of question IDs we score
  v_total := 0;
  FOR v_qid IN SELECT jsonb_object_keys(p_answers) LOOP
    v_total := v_total + 1;
    SELECT upper(trim(answer)) INTO v_correct FROM public.questions WHERE id = v_qid;
    v_given := upper(trim(COALESCE(p_answers->>v_qid, '')));
    IF v_correct IS NOT NULL AND v_correct = v_given THEN
      v_score := v_score + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    v_percentage := 0;
  ELSE
    v_percentage := round((v_score::numeric / v_total::numeric) * 100);
  END IF;

  v_result_id := 'res_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

  INSERT INTO public.results (
    id, email, name, class, "classSN", "examSessionId",
    score, percentage, "totalQuestions", answers, "submittedAt", "attemptId"
  ) VALUES (
    v_result_id, v_student.email, v_student.name, v_student.class, v_student."classSN",
    COALESCE(p_session_id, 'active-session'),
    v_score, v_percentage, v_total, p_answers, now(),
    COALESCE(p_attempt_id, 'alt-' || extract(epoch from now())::text)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_result_id,
    'score', v_score,
    'percentage', v_percentage,
    'totalQuestions', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_cbt_submit(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_cbt_submit(text, text, text, text, jsonb) TO anon, authenticated;

-- Audit log entry for student integrity events
CREATE OR REPLACE FUNCTION public.student_cbt_log(
  p_email text,
  p_action text,
  p_reason text,
  p_page text,
  p_new_value text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE lower(email) = lower(trim(p_email))) THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_log (id, action, "userRole", "userName", page, reason, "newValue")
  VALUES (
    'log_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    COALESCE(p_action, ''),
    'Student',
    p_email,
    COALESCE(p_page, 'Student CBT Exam'),
    COALESCE(p_reason, ''),
    p_new_value
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_cbt_log(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_cbt_log(text, text, text, text, text) TO anon, authenticated;

-- Lock down handle_first_user_superadmin too
REVOKE EXECUTE ON FUNCTION public.handle_first_user_superadmin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_first_user_superadmin() FROM anon;
