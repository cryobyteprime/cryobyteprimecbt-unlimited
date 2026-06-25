
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.config (
    id text PRIMARY KEY DEFAULT 'config_main',
    "examActivated" boolean NOT NULL DEFAULT false,
    "protectionPassword" text NOT NULL DEFAULT 'admin',
    "superadminPassword" text NOT NULL DEFAULT 'super'
);
INSERT INTO public.config (id) VALUES ('config_main') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.admin_profiles (
    id text PRIMARY KEY,
    email text UNIQUE NOT NULL,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('Superadmin', 'Admin', 'Tutor')),
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.students (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text UNIQUE NOT NULL,
    phone text,
    gender text,
    class text NOT NULL CHECK (class IN ('Class A', 'Class B')),
    "classSN" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz
);

CREATE TABLE IF NOT EXISTS public.att_sessions (
    id text PRIMARY KEY,
    class text NOT NULL CHECK (class IN ('Class A', 'Class B', 'Joint')),
    date text NOT NULL,
    topic text NOT NULL,
    notes text,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    "round1Serials" text[] NOT NULL DEFAULT '{}',
    "round2Serials" text[] NOT NULL DEFAULT '{}',
    "createdBy" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_att_sessions_class_date_topic
    ON public.att_sessions (class, date, topic);

CREATE TABLE IF NOT EXISTS public.att_records (
    id text PRIMARY KEY,
    "sessionId" text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    class text NOT NULL,
    "classSN" text NOT NULL,
    date text NOT NULL,
    status text NOT NULL CHECK (status IN ('present', 'late', 'absent')),
    round text,
    timestamp timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("sessionId", email)
);

CREATE TABLE IF NOT EXISTS public.att_edit_requests (
    id text PRIMARY KEY,
    "sessionId" text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    "classSN" text NOT NULL,
    "requestedStatus" text NOT NULL CHECK ("requestedStatus" IN ('present', 'late')),
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "resolvedAt" timestamptz,
    "resolvedBy" text,
    "rejectionNote" text
);

CREATE TABLE IF NOT EXISTS public.exam_eligibility (
    id text PRIMARY KEY,
    "sessionId" text NOT NULL,
    email text NOT NULL,
    status text NOT NULL CHECK (status IN ('eligible', 'locked')),
    reason text NOT NULL CHECK (reason IN ('present', 'late', 'absent', 'unmarked', 'admin_override')),
    "overrideBy" text,
    "overrideReason" text,
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("sessionId", email)
);

CREATE TABLE IF NOT EXISTS public.questions (
    id text PRIMARY KEY,
    text text NOT NULL,
    type text NOT NULL CHECK (type IN ('mcq', 'truefalse', 'fill')),
    options text[] DEFAULT '{}',
    answer text NOT NULL,
    subject text,
    difficulty text CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.results (
    id text PRIMARY KEY,
    email text NOT NULL,
    name text NOT NULL,
    class text NOT NULL CHECK (class IN ('Class A', 'Class B')),
    "classSN" text NOT NULL,
    "examSessionId" text NOT NULL,
    score integer NOT NULL,
    percentage numeric NOT NULL,
    "totalQuestions" integer NOT NULL,
    answers jsonb NOT NULL,
    "submittedAt" timestamptz NOT NULL DEFAULT now(),
    "attemptId" text NOT NULL,
    UNIQUE (email, "examSessionId")
);

CREATE TABLE IF NOT EXISTS public.deletion_requests (
    id text PRIMARY KEY,
    "requestedBy" text NOT NULL,
    role text NOT NULL CHECK (role IN ('Superadmin', 'Admin', 'Tutor')),
    page text NOT NULL,
    scope text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "resolvedBy" text,
    "resolvedAt" timestamptz,
    "resolutionReason" text
);

CREATE TABLE IF NOT EXISTS public.audit_log (
    id text PRIMARY KEY,
    "userName" text NOT NULL,
    "userRole" text NOT NULL CHECK ("userRole" IN ('Superadmin', 'Admin', 'Tutor')),
    timestamp timestamptz NOT NULL DEFAULT now(),
    action text NOT NULL,
    "originalValue" text,
    "newValue" text,
    reason text NOT NULL,
    page text NOT NULL
);

-- GRANTS (anon + authenticated, since the app uses internal admin gating, not Supabase Auth)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'config','admin_profiles','students','att_sessions','att_records',
    'att_edit_requests','exam_eligibility','questions','results',
    'deletion_requests','audit_log'
  ]) LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "public_all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "public_all" ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
