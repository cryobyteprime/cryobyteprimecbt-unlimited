-- APPLIED 2026-08-16 to the live external database (project quvqjctlskmqeyhognvd).
-- Root cause fixed: cbt_attendance_status previously picked the latest attendance
-- session ACROSS ALL CLASSES, so Class A stayed eligible from a stale session and
-- Class B was never evaluated. Now resolved per class, open/today only, email match.
CREATE OR REPLACE FUNCTION public.cbt_attendance_status(p_email text, p_class_sn text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_email   text := lower(trim(COALESCE(p_email, '')));
  v_sn      text := upper(trim(COALESCE(p_class_sn, '')));
  v_class   text;
  v_session text;
  v_status  text;
BEGIN
  IF v_email = '' THEN RETURN 'none'; END IF;

  -- Resolve the student's class from the roster (class-agnostic; no hardcoding).
  SELECT s.class INTO v_class
    FROM public.students s
   WHERE lower(s.email) = v_email
   LIMIT 1;

  IF v_class IS NULL AND v_sn <> '' THEN
    SELECT s.class INTO v_class
      FROM public.students s
     WHERE upper(trim(s."classSN")) = v_sn
     LIMIT 1;
  END IF;

  IF v_class IS NULL THEN RETURN 'none'; END IF;

  -- Current attendance session for THIS class (or a Joint session):
  -- an OPEN session, or a session whose attendance was marked today (Lagos).
  -- Older/stale sessions from other days grant nothing, and a session
  -- belonging to another class can never be picked up.
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

  IF v_session IS NULL THEN RETURN 'none'; END IF;

  -- Match the record by EMAIL ONLY (serial numbers repeat across classes).
  SELECT lower(r.status) INTO v_status
    FROM public.att_records r
   WHERE r."sessionId" = v_session
     AND lower(r.email) = v_email
   ORDER BY r."timestamp" DESC NULLS LAST
   LIMIT 1;

  RETURN COALESCE(v_status, 'none');
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.cbt_attendance_status(text, text) TO anon, authenticated, service_role;
