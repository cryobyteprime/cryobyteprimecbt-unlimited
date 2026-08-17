BEGIN;

CREATE OR REPLACE FUNCTION public.cbt_current_att_session(p_class text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT s.id
    FROM public.att_sessions s
   WHERE (s.class = p_class OR s.class = 'Joint')
     AND (
          lower(trim(COALESCE(s.status,''))) = 'open'
       OR COALESCE(NULLIF(trim(s.date), ''),
                   to_char((s."createdAt" AT TIME ZONE 'Africa/Lagos')::date,'YYYY-MM-DD'))
          = to_char((now() AT TIME ZONE 'Africa/Lagos')::date,'YYYY-MM-DD')
       OR EXISTS (
            SELECT 1 FROM public.att_records r
             WHERE r."sessionId" = s.id
               AND (r."timestamp" AT TIME ZONE 'Africa/Lagos')::date
                   = (now() AT TIME ZONE 'Africa/Lagos')::date)
     )
   ORDER BY (lower(trim(COALESCE(s.status,''))) = 'open') DESC,
            COALESCE(NULLIF(trim(s.date), ''),
                     to_char((s."createdAt" AT TIME ZONE 'Africa/Lagos')::date,'YYYY-MM-DD')) DESC,
            s."createdAt" DESC NULLS LAST,
            s.id DESC
   LIMIT 1;
$fn$;
GRANT EXECUTE ON FUNCTION public.cbt_current_att_session(text) TO anon, authenticated, service_role;

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
  v_in_r1   boolean := false;
  v_in_r2   boolean := false;
  v_elig    text;
BEGIN
  IF v_email = '' AND v_sn = '' THEN RETURN 'none'; END IF;

  IF v_email <> '' THEN
    SELECT s.class, upper(trim(s."classSN")) INTO v_class, v_sn
      FROM public.students s WHERE lower(s.email) = v_email LIMIT 1;
  END IF;
  IF v_class IS NULL AND v_sn <> '' THEN
    SELECT s.class, lower(s.email) INTO v_class, v_email
      FROM public.students s WHERE upper(trim(s."classSN")) = v_sn LIMIT 1;
  END IF;
  IF v_class IS NULL THEN RETURN 'none'; END IF;

  -- Only a CURRENT session (open, or dated/marked today in Lagos) counts.
  v_session := public.cbt_current_att_session(v_class);
  IF v_session IS NULL THEN RETURN 'none'; END IF;

  SELECT lower(trim(e.status)) INTO v_elig
    FROM public.exam_eligibility e
   WHERE e."sessionId" = v_session
     AND lower(e.email) = v_email
     AND lower(trim(COALESCE(e.reason, ''))) = 'admin_override'
   ORDER BY e."updatedAt" DESC NULLS LAST LIMIT 1;
  IF v_elig = 'eligible' THEN RETURN 'present'; END IF;
  IF v_elig = 'locked'   THEN RETURN 'absent';  END IF;

  SELECT lower(trim(r.status)) INTO v_status
    FROM public.att_records r
   WHERE r."sessionId" = v_session AND lower(r.email) = v_email
   ORDER BY r."timestamp" DESC NULLS LAST LIMIT 1;

  IF v_status IN ('present', 'late', 'absent') THEN RETURN v_status; END IF;

  IF v_sn <> '' THEN
    SELECT
      EXISTS (SELECT 1 FROM unnest(COALESCE(s."round1Serials", '{}'::text[])) x WHERE upper(trim(x)) = v_sn),
      EXISTS (SELECT 1 FROM unnest(COALESCE(s."round2Serials", '{}'::text[])) x WHERE upper(trim(x)) = v_sn)
      INTO v_in_r1, v_in_r2
      FROM public.att_sessions s WHERE s.id = v_session;
    IF v_in_r1 THEN RETURN 'present'; END IF;
    IF v_in_r2 THEN RETURN 'late';    END IF;
  END IF;

  RETURN 'absent';
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.cbt_attendance_status(text, text) TO anon, authenticated, service_role;
COMMIT;
