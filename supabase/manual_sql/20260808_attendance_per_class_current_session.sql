-- APPLIED 2026-08-08: attendance gate resolves the current session PER CLASS
-- (open session or marked today) and matches records by email only.
CREATE OR REPLACE FUNCTION public.cbt_attendance_status(p_email text, p_class_sn text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_class      text;
  v_session    text;
  v_status     text;
BEGIN
  -- Resolve the student's class (roster first, then serial prefix fallback).
  SELECT s.class INTO v_class FROM public.students s
   WHERE lower(s.email) = lower(trim(COALESCE(p_email,'')))
   LIMIT 1;

  IF v_class IS NULL THEN
    v_class := CASE upper(left(trim(COALESCE(p_class_sn,'')),1))
                 WHEN 'A' THEN 'Class A'
                 WHEN 'B' THEN 'Class B'
                 ELSE NULL END;
  END IF;

  IF v_class IS NULL THEN
    RETURN 'none';
  END IF;

  -- Current attendance session for THIS class: an open session, or a session
  -- whose attendance was actually marked today. Anything older is stale and
  -- grants no access.
  SELECT s.id INTO v_session
    FROM public.att_sessions s
   WHERE (s.class = v_class OR s.class = 'Joint')
     AND (
          s.status = 'open'
       OR EXISTS (
            SELECT 1 FROM public.att_records r
             WHERE r."sessionId" = s.id
               AND (r."timestamp" AT TIME ZONE 'Africa/Lagos')::date
                   = (now() AT TIME ZONE 'Africa/Lagos')::date
          )
     )
   ORDER BY (s.status = 'open') DESC,
            s.date DESC NULLS LAST,
            s."createdAt" DESC NULLS LAST
   LIMIT 1;

  IF v_session IS NULL THEN
    RETURN 'none';
  END IF;

  -- Status is matched by email only; serial-number matching could cross students.
  SELECT lower(r.status) INTO v_status
    FROM public.att_records r
   WHERE r."sessionId" = v_session
     AND lower(r.email) = lower(trim(p_email))
   ORDER BY r."timestamp" DESC NULLS LAST
   LIMIT 1;

  RETURN COALESCE(v_status, 'none');
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.cbt_attendance_status(text, text) TO anon, authenticated, service_role;
