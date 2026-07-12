-- RUN MANUALLY in the Supabase SQL editor.
-- Server-side fail-safe that auto-submits any candidate who started an exam
-- but never posted a `results` row before the scheduled window closed.
-- Independent of the browser: covers idle tabs, refreshes, network drops,
-- and closed laptops.
--
-- Runs every minute via pg_cron. Idempotent — a candidate who has any
-- results row (real or auto) is skipped.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.auto_submit_expired_exams()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_config public.config%ROWTYPE;
  v_end timestamptz;
  v_session_id text := 'active-session';
  v_max int;
  v_row record;
  v_count int := 0;
BEGIN
  SELECT * INTO v_config FROM public.config LIMIT 1;
  v_end := v_config."examEndAt";
  v_max := GREATEST(1, COALESCE(v_config."maxQuestions", 20));

  -- Nothing to do until the scheduled end time is set and has passed.
  IF v_end IS NULL OR now() < v_end THEN
    RETURN jsonb_build_object('ok', true, 'ran', false, 'reason', 'window_not_ended');
  END IF;

  FOR v_row IN
    SELECT DISTINCT lower(a."userName") AS email
      FROM public.audit_log a
     WHERE a.page = 'student-cbt'
       AND a.action LIKE 'EXAM_START%'
       AND a."userName" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.results r
          WHERE lower(r.email) = lower(a."userName")
       )
  LOOP
    DECLARE
      v_student public.students%ROWTYPE;
    BEGIN
      SELECT * INTO v_student FROM public.students
        WHERE lower(email) = v_row.email
        LIMIT 1;
      IF NOT FOUND THEN CONTINUE; END IF;

      INSERT INTO public.results (
        id, attemptId, email, name, class, "classSN",
        score, totalQuestions, percentage,
        answers, "examSessionId", "submittedAt"
      ) VALUES (
        gen_random_uuid()::text,
        gen_random_uuid()::text,
        v_student.email, v_student.name, v_student.class, v_student."classSN",
        0, v_max, 0,
        '[]'::jsonb, v_session_id, now()
      )
      ON CONFLICT DO NOTHING;

      PERFORM public.student_cbt_log(
        'EXAM_SUBMIT: server auto-submit — Reason: server_scheduled_window_ended | Score: 0/'
          || v_max || ' (0%)',
        v_student.email,
        jsonb_build_object(
          'source', 'auto_submit_expired_exams',
          'examEndAt', v_end,
          'timestamp', now()
        )::text,
        'student-cbt',
        'scheduled_window_ended'
      );

      v_count := v_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ran', true, 'autoSubmitted', v_count);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.auto_submit_expired_exams() TO service_role;

-- Schedule every minute. Unschedule any prior job with the same name first
-- so re-running this migration replaces it cleanly.
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'auto_submit_expired_exams';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  PERFORM cron.schedule(
    'auto_submit_expired_exams',
    '* * * * *',
    $cron$SELECT public.auto_submit_expired_exams();$cron$
  );
END $$;