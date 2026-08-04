import { supabase as sharedSupabase } from '../integrations/supabase/external';
import { 
  Student, 
  AttSession, 
  AttRecord, 
  AttEditRequest, 
  ExamEligibility, 
  Question, 
  Result, 
  DeletionRequest, 
  AuditLog, 
  AdminProfile, 
  SystemConfig 
} from '../types';

// Always use the shared authenticated Supabase client. It carries the user's
// session (JWT) so RLS policies that require `authenticated` will pass.
export const isSupabaseConfigured = true;
const supabase: any = sharedSupabase;


// Helper to execute Supabase mutations with self-healing support in case columns don't exist in Supabase schema cache
async function runWithSelfHealing<PL>(
  initialPayload: PL,
  actionFn: (currentPayload: PL) => Promise<{ data?: any; error: any }>
): Promise<{ data?: any; error: any }> {
  let payload = JSON.parse(JSON.stringify(initialPayload));
  
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await actionFn(payload);
      if (!res.error) {
        return res;
      }
      
      const errMsg = res.error.message || "";
      // Match error patterns like:
      // "Could not find the 'gender' column of 'students' in the schema cache"
      // "column \"gender\" of relation \"students\" does not exist"
      const match = errMsg.match(/Could not find the '([^']+)' column/i) || 
                    errMsg.match(/column "([^"]+)" of/i) || 
                    errMsg.match(/column "([^"]+)" does not exist/i);
      
      if (match && match[1]) {
        const missingColumn = match[1];
        console.warn(`[Self-Healing] stripping unmapped column "${missingColumn}" from Supabase payload.`);
        
        if (Array.isArray(payload)) {
          payload = payload.map(item => {
            if (item && typeof item === 'object') {
              const clone = { ...item };
              delete clone[missingColumn];
              return clone;
            }
            return item;
          });
        } else if (payload && typeof payload === 'object') {
          delete (payload as any)[missingColumn];
        } else {
          return res; // Can't heal non-object
        }
        
        // Retry with modified payload
        continue;
      }
      
      return res; // Return other types of errors
    } catch (err: any) {
      return { error: err };
    }
  }
  
  return { error: new Error("Too many self-healing retries failed.") };
}

// ==========================================
// Deterministic Nigerian Seed Generator
// ==========================================
const FIRST_NAMES = ["Chukwuemeka", "Adaeze", "Tunde", "Olumide", "Ngozi", "Femi", "Yemi", "Amarachi", "Chioma", "Kelechi", "Oluwaseun", "Damilola", "Temitope", "Fatima", "Aisha", "Zainab", "Chinedu", "Chidi", "Obinna", "Nkechi", "Efe", "Uche", "Bimbo", "Emeka"];
const LAST_NAMES = ["Okonkwo", "Balogun", "Onyekwerre", "Ugwu", "Nwachukwu", "Alabi", "Bello", "Adeniyi", "Adewale", "Eze", "Okafor", "Okoye", "Adebayo", "Soyinka", "Shonibare", "Suleiman", "Danjuma", "Obasanjo", "Chineye"];

function generateSeedStudents(): Student[] {
  const list: Student[] = [];
  
  // Deterministic random selection
  let nameCount = 0;
  
  // Class A: 44 students (A1 - A44)
  for (let i = 1; i <= 44; i++) {
    const fn = FIRST_NAMES[(i * 3 + 7) % FIRST_NAMES.length];
    const ln = LAST_NAMES[(i * 7 + 13) % LAST_NAMES.length];
    const name = `${fn} ${ln}`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@cryobyteprime.com`;
    const phone = `080${String(1234567 + i * 29).slice(-7)}`;
    const gender = (i % 3 === 0) ? 'Female' : 'Male';
    
    list.push({
      id: `student-a-${i}`,
      name,
      email,
      phone,
      gender,
      class: 'Class A',
      classSN: `A${i}`,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }

  // Class B: 43 students (B1 - B43)
  for (let i = 1; i <= 43; i++) {
    const fn = FIRST_NAMES[(i * 4 + 11) % FIRST_NAMES.length];
    const ln = LAST_NAMES[(i * 5 + 17) % LAST_NAMES.length];
    const name = `${fn} ${ln}`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@cryobyteprime.com`;
    const phone = `090${String(1284567 + i * 47).slice(-7)}`;
    const gender = (i % 2 === 0) ? 'Female' : 'Male';
    
    list.push({
      id: `student-b-${i}`,
      name,
      email,
      phone,
      gender,
      class: 'Class B',
      classSN: `B${i}`,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }

  return list;
}

// Generate deterministic demo Questions
function generateSeedQuestions(): Question[] {
  return [
    {
      id: "q-1",
      text: "Which of the following data structures operates on a Last-In, First-Out (LIFO) basis?",
      type: "mcq",
      options: ["Queue", "Stack", "Binary Tree", "Linked List"],
      answer: "B",
      subject: "Data Structures",
      difficulty: "Easy",
      createdAt: new Date().toISOString()
    },
    {
      id: "q-2",
      text: "True or False: In a relational database, a primary key allows NULL values to maintain flexibility.",
      type: "truefalse",
      answer: "False",
      subject: "Databases",
      difficulty: "Easy",
      createdAt: new Date().toISOString()
    },
    {
      id: "q-3",
      text: "What is the time complexity of searching for an element in a balanced Binary Search Tree (BST) of size N?",
      type: "mcq",
      options: ["O(1)", "O(N)", "O(log N)", "O(N log N)"],
      answer: "C",
      subject: "Algorithms",
      difficulty: "Medium",
      createdAt: new Date().toISOString()
    },
    {
      id: "q-4",
      text: "In React, which hook is used to perform side effects in functional components?",
      type: "fill",
      answer: "useEffect",
      subject: "Frontend Development",
      difficulty: "Easy",
      createdAt: new Date().toISOString()
    },
    {
      id: "q-5",
      text: "True or False: HTTP stands for Hypertext Transfer Protocol and is stateful by default.",
      type: "truefalse",
      answer: "False",
      subject: "Web Networking",
      difficulty: "Medium",
      createdAt: new Date().toISOString()
    },
    {
      id: "q-6",
      text: "Complete the statement: SQL represents Structured _____ Language.",
      type: "fill",
      answer: "Query",
      subject: "Databases",
      difficulty: "Easy",
      createdAt: new Date().toISOString()
    }
  ];
}

// ==========================================
// Local Storage Base Driver
// ==========================================
const STORAGE_KEYS = {
  STUDENTS: 'cbt_students',
  SESSIONS: 'cbt_att_sessions',
  RECORDS: 'cbt_att_records',
  EDIT_REQS: 'cbt_att_edit_requests',
  ELIGIBILITY: 'cbt_exam_eligibility',
  QUESTIONS: 'cbt_questions',
  RESULTS: 'cbt_results',
  DELETION_REQS: 'cbt_deletion_requests',
  AUDIT_LOG: 'cbt_audit_log',
  ADMIN_PROFILES: 'cbt_admin_profiles',
  CONFIG: 'cbt_config',
  EXAM_WINDOW: 'cbt_exam_window'
};

/**
 * Local-only config overlay. The Supabase `config` table may not yet have
 * columns for schedule / duration / monitoring, so they live here. Stored
 * under the legacy `cbt_exam_window` key for backward compatibility.
 */
type ExamOverlay = Partial<Pick<SystemConfig,
  'examStartAt' | 'examEndAt' | 'examDurationMinutes' |
  'maxQuestions' | 'randomizeQuestions' | 'randomizeOptions' | 'monitoring'
>>;
const OVERLAY_KEYS: (keyof ExamOverlay)[] = [
  'examStartAt', 'examEndAt', 'examDurationMinutes',
  'maxQuestions', 'randomizeQuestions', 'randomizeOptions', 'monitoring',
];
function getExamWindow(): ExamOverlay {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.EXAM_WINDOW);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function setExamWindow(patch: ExamOverlay): ExamOverlay {
  const next = { ...getExamWindow(), ...patch };
  localStorage.setItem(STORAGE_KEYS.EXAM_WINDOW, JSON.stringify(next));
  return next;
}

function getLocalItem<T>(key: string, defaultValue: T): T {
  const item = localStorage.getItem(key);
  if (!item) {
    localStorage.setItem(key, JSON.stringify(defaultValue));
    return defaultValue;
  }
  try {
    return JSON.parse(item) as T;
  } catch {
    return defaultValue;
  }
}

function setLocalItem<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// Ensure local persistence is seeded
if (!localStorage.getItem(STORAGE_KEYS.STUDENTS)) {
  setLocalItem(STORAGE_KEYS.STUDENTS, generateSeedStudents());
}
if (!localStorage.getItem(STORAGE_KEYS.QUESTIONS)) {
  setLocalItem(STORAGE_KEYS.QUESTIONS, generateSeedQuestions());
}
if (!localStorage.getItem(STORAGE_KEYS.CONFIG)) {
  setLocalItem(STORAGE_KEYS.CONFIG, {
    examActivated: false,
    protectionPassword: "admin",
    superadminPassword: "super"
  });
}
if (!localStorage.getItem(STORAGE_KEYS.ADMIN_PROFILES)) {
  setLocalItem(STORAGE_KEYS.ADMIN_PROFILES, [
    { id: "sa-1", email: "super@cbt.com", name: "Super User", role: "Superadmin", createdAt: new Date().toISOString() },
    { id: "a-1", email: "admin@cbt.com", name: "Lead Admin (Seed)", role: "Admin", createdAt: new Date().toISOString() },
    { id: "t-1", email: "tutor@cbt.com", name: "Class Tutor", role: "Tutor", createdAt: new Date().toISOString() }
  ]);
}

// ==========================================
// Unified Core DB API
// ==========================================
export const DB = {
  // Students
  async getStudents(): Promise<Student[]> {
    if (supabase) {
      // Try ordering by createdAt; if that column name fails, retry without ordering.
      let { data, error } = await supabase.from('students').select('*').order('createdAt', { ascending: true });
      if (error) {
        const retry = await supabase.from('students').select('*');
        data = retry.data;
        error = retry.error;
      }
      if (!error && data && data.length > 0) {
        return (data as any[]).map(s => ({
          ...s,
          classSN: ((s.classSN ?? s.classsn ?? s.class_sn ?? '') + '').trim().toUpperCase(),
        }));
      }
      // Supabase reachable but no rows (or error) — seed local fallback so the app is usable end-to-end.
      const seeded = getLocalItem<Student[]>(STORAGE_KEYS.STUDENTS, generateSeedStudents());
      return seeded.map(s => ({ ...s, classSN: (s.classSN || '').trim().toUpperCase() }));
    }
    const local = getLocalItem<Student[]>(STORAGE_KEYS.STUDENTS, generateSeedStudents());
    return local.map(s => ({ ...s, classSN: (s.classSN || '').trim().toUpperCase() }));
  },

  async addStudent(student: Omit<Student, 'id' | 'createdAt'>): Promise<Student> {
    const newStudent: Student = {
      ...student,
      id: 'student_' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await runWithSelfHealing(newStudent, async (payload) => {
        return await supabase.from('students').insert(payload).select().single();
      });
      if (!error && data) return data;
    }
    const current = getLocalItem<Student[]>(STORAGE_KEYS.STUDENTS, []);
    current.push(newStudent);
    setLocalItem(STORAGE_KEYS.STUDENTS, current);
    return newStudent;
  },

  async updateStudent(id: string, patch: Partial<Student>): Promise<Student> {
    if (supabase) {
      const { data, error } = await runWithSelfHealing(patch, async (payload) => {
        return await supabase.from('students').update(payload).eq('id', id).select().single();
      });
      if (!error && data) return data;
    }
    const current = getLocalItem<Student[]>(STORAGE_KEYS.STUDENTS, []);
    const idx = current.findIndex(s => s.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch, updatedAt: new Date().toISOString() };
      setLocalItem(STORAGE_KEYS.STUDENTS, current);
      return current[idx];
    }
    throw new Error('Student not found');
  },

  async deleteStudent(id: string): Promise<boolean> {
    if (supabase) {
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (!error) return true;
    }
    const current = getLocalItem<Student[]>(STORAGE_KEYS.STUDENTS, []);
    const filtered = current.filter(s => s.id !== id);
    setLocalItem(STORAGE_KEYS.STUDENTS, filtered);
    return true;
  },

  async setStudents(arr: Student[]): Promise<void> {
    if (supabase) {
      try {
        const { error: deleteError } = await supabase.from('students').delete().gte('id', '');
        if (deleteError) {
          console.error("Supabase students delete error:", deleteError);
          throw deleteError;
        }
        if (arr.length > 0) {
          const { error: insertError } = await runWithSelfHealing(arr, async (payload) => {
            return await supabase.from('students').insert(payload);
          });
          if (insertError) {
            console.error("Supabase students insert error:", insertError);
            throw insertError;
          }
        }
      } catch (err: any) {
        console.error("Failed to sync students to Supabase:", err);
        throw new Error(err?.message || "Failed to sync students list to Supabase. Check your connection or constraints.");
      }
    }
    setLocalItem(STORAGE_KEYS.STUDENTS, arr);
  },

  // Attendance Sessions
  async getAttSessions(): Promise<AttSession[]> {
    if (supabase) {
      const { data, error } = await supabase.from('att_sessions').select('*').order('date', { ascending: false });
      if (!error && data) return data;
    }
    return getLocalItem<AttSession[]>(STORAGE_KEYS.SESSIONS, []);
  },

  async getAttSession(id: string): Promise<AttSession | null> {
    if (supabase) {
      const { data, error } = await supabase.from('att_sessions').select('*').eq('id', id).single();
      if (!error && data) return data;
    }
    const list = getLocalItem<AttSession[]>(STORAGE_KEYS.SESSIONS, []);
    return list.find(s => s.id === id) || null;
  },

  async addAttSession(session: Omit<AttSession, 'id' | 'createdAt'>): Promise<AttSession> {
    const newSession: AttSession = {
      ...session,
      id: 'session_' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase.from('att_sessions').insert(newSession).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AttSession[]>(STORAGE_KEYS.SESSIONS, []);
    current.push(newSession);
    setLocalItem(STORAGE_KEYS.SESSIONS, current);
    return newSession;
  },

  async updateAttSession(id: string, patch: Partial<AttSession>): Promise<AttSession> {
    if (supabase) {
      const { data, error } = await supabase.from('att_sessions').update(patch).eq('id', id).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AttSession[]>(STORAGE_KEYS.SESSIONS, []);
    const idx = current.findIndex(s => s.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch };
      setLocalItem(STORAGE_KEYS.SESSIONS, current);
      return current[idx];
    }
    throw new Error('Session not found');
  },

  async deleteAttSession(id: string): Promise<boolean> {
    if (supabase) {
      const { error } = await supabase.from('att_sessions').delete().eq('id', id);
      if (!error) return true;
    }
    const current = getLocalItem<AttSession[]>(STORAGE_KEYS.SESSIONS, []);
    const filtered = current.filter(s => s.id !== id);
    setLocalItem(STORAGE_KEYS.SESSIONS, filtered);
    return true;
  },

  async getOpenAttSession(): Promise<AttSession | null> {
    const list = await this.getAttSessions();
    return list.find(s => s.status === 'open') || null;
  },

  async getOpenAttSessions(): Promise<AttSession[]> {
    const list = await this.getAttSessions();
    return list.filter(s => s.status === 'open');
  },

  // Attendance Records
  // PostgREST caps a single response at 1000 rows. With ~91 students × dozens
  // of sessions the att_records table easily exceeds that, so we paginate
  // explicitly using Range headers to fetch every row.
  async getAttRecords(): Promise<AttRecord[]> {
    if (supabase) {
      const all: AttRecord[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('att_records')
          .select('*')
          .range(from, from + PAGE - 1);
        if (error) break;
        if (!data || data.length === 0) break;
        all.push(...(data as AttRecord[]));
        if (data.length < PAGE) break;
      }
      if (all.length > 0) return all;
    }
    return getLocalItem<AttRecord[]>(STORAGE_KEYS.RECORDS, []);
  },

  async addAttRecord(record: Omit<AttRecord, 'id'>): Promise<AttRecord> {
    const newRecord: AttRecord = {
      ...record,
      id: 'record_' + Math.random().toString(36).substr(2, 9)
    };
    if (supabase) {
      const { data, error } = await supabase.from('att_records').insert(newRecord).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AttRecord[]>(STORAGE_KEYS.RECORDS, []);
    // Prevent duplicate sessionId + email
    const filtered = current.filter(r => !(r.sessionId === record.sessionId && r.email === record.email));
    filtered.push(newRecord);
    setLocalItem(STORAGE_KEYS.RECORDS, filtered);
    return newRecord;
  },

  async addAttRecords(records: Omit<AttRecord, 'id'>[]): Promise<AttRecord[]> {
    const newRecords = records.map(r => ({
      ...r,
      id: 'record_' + Math.random().toString(36).substr(2, 9)
    }));
    if (supabase) {
      // Upsert on ("sessionId", email) so re-running finalize never throws a duplicate key error.
      // Note: sessionId is a camelCase quoted column — quotes are required in onConflict.
      const { data, error } = await supabase
        .from('att_records')
        .upsert(newRecords, { onConflict: '"sessionId",email' })
        .select();
      if (error) throw new Error(error.message || 'Failed to save attendance records');
      if (data) return data;
    }
    const current = getLocalItem<AttRecord[]>(STORAGE_KEYS.RECORDS, []);
    // Prevent duplicates
    const emailsToInsert = new Set(records.map(r => r.email));
    const sessionIdsToInsert = new Set(records.map(r => r.sessionId));
    const filtered = current.filter(r => !(sessionIdsToInsert.has(r.sessionId) && emailsToInsert.has(r.email)));
    const merged = [...filtered, ...newRecords];
    setLocalItem(STORAGE_KEYS.RECORDS, merged);
    return newRecords;
  },

  // Query records for a specific session directly server-side so we are
  // never bitten by the 1000-row PostgREST cap on getAttRecords().
  async getRecordsBySession(sessionId: string): Promise<AttRecord[]> {
    if (supabase) {
      const { data, error } = await supabase
        .from('att_records')
        .select('*')
        .eq('sessionId', sessionId);
      if (!error && data) return data as AttRecord[];
    }
    const list = getLocalItem<AttRecord[]>(STORAGE_KEYS.RECORDS, []);
    return list.filter(r => r.sessionId === sessionId);
  },

  async getRecordsByStudent(email: string): Promise<AttRecord[]> {
    if (supabase) {
      const { data, error } = await supabase
        .from('att_records')
        .select('*')
        .ilike('email', email);
      if (!error && data) return data as AttRecord[];
    }
    const list = getLocalItem<AttRecord[]>(STORAGE_KEYS.RECORDS, []);
    return list.filter(r => r.email.toLowerCase() === email.toLowerCase());
  },

  async updateAttRecord(id: string, patch: Partial<AttRecord>): Promise<AttRecord> {
    if (supabase) {
      const { data, error } = await supabase.from('att_records').update(patch).eq('id', id).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AttRecord[]>(STORAGE_KEYS.RECORDS, []);
    const idx = current.findIndex(r => r.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch };
      setLocalItem(STORAGE_KEYS.RECORDS, current);
      return current[idx];
    }
    throw new Error('Record not found');
  },

  async deleteRecordsBySession(sessionId: string): Promise<boolean> {
    if (supabase) {
      await supabase.from('att_records').delete().eq('sessionId', sessionId);
      return true;
    }
    const current = getLocalItem<AttRecord[]>(STORAGE_KEYS.RECORDS, []);
    const filtered = current.filter(r => r.sessionId !== sessionId);
    setLocalItem(STORAGE_KEYS.RECORDS, filtered);
    return true;
  },

  // Attendance Edit Requests
  async getAttEditReqs(): Promise<AttEditRequest[]> {
    if (supabase) {
      const { data, error } = await supabase.from('att_edit_requests').select('*').order('createdAt', { ascending: false });
      if (!error && data) return data;
    }
    return getLocalItem<AttEditRequest[]>(STORAGE_KEYS.EDIT_REQS, []);
  },

  async addAttEditReq(req: Omit<AttEditRequest, 'id' | 'createdAt'>): Promise<AttEditRequest> {
    const newReq: AttEditRequest = {
      ...req,
      id: 'req_' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase.from('att_edit_requests').insert(newReq).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AttEditRequest[]>(STORAGE_KEYS.EDIT_REQS, []);
    current.push(newReq);
    setLocalItem(STORAGE_KEYS.EDIT_REQS, current);
    return newReq;
  },

  async updateAttEditReq(id: string, patch: Partial<AttEditRequest>): Promise<AttEditRequest> {
    if (supabase) {
      const { data, error } = await supabase.from('att_edit_requests').update(patch).eq('id', id).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AttEditRequest[]>(STORAGE_KEYS.EDIT_REQS, []);
    const idx = current.findIndex(r => r.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch };
      setLocalItem(STORAGE_KEYS.EDIT_REQS, current);
      return current[idx];
    }
    throw new Error('Req not found');
  },

  async getPendingEditReqs(): Promise<AttEditRequest[]> {
    const list = await this.getAttEditReqs();
    return list.filter(r => r.status === 'pending');
  },

  // Exam Eligibility
  async getExamEligibility(): Promise<ExamEligibility[]> {
    if (supabase) {
      const { data, error } = await supabase.from('exam_eligibility').select('*');
      if (!error && data) return data;
    }
    return getLocalItem<ExamEligibility[]>(STORAGE_KEYS.ELIGIBILITY, []);
  },

  async updateExamEligibility(sessionId: string, email: string, patch: Partial<ExamEligibility>): Promise<ExamEligibility> {
    if (supabase) {
      const { data, error } = await supabase.from('exam_eligibility')
        .upsert({
          id: 'elig_' + Math.random().toString(36).substr(2, 9),
          sessionId,
          email,
          ...patch,
          updatedAt: new Date().toISOString()
        }, { onConflict: '"sessionId",email', ignoreDuplicates: false })
        .select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<ExamEligibility[]>(STORAGE_KEYS.ELIGIBILITY, []);
    const idx = current.findIndex(e => e.sessionId === sessionId && e.email.toLowerCase() === email.toLowerCase());
    
    if (idx !== -1) {
      current[idx] = { 
        ...current[idx], 
        ...patch, 
        updatedAt: new Date().toISOString() 
      };
      setLocalItem(STORAGE_KEYS.ELIGIBILITY, current);
      return current[idx];
    } else {
      const newElig: ExamEligibility = {
        id: 'elig_' + Math.random().toString(36).substr(2, 9),
        sessionId,
        email,
        status: patch.status || 'locked',
        reason: (patch.reason as any) || 'unmarked',
        overrideBy: patch.overrideBy,
        overrideReason: patch.overrideReason,
        updatedAt: new Date().toISOString()
      };
      current.push(newElig);
      setLocalItem(STORAGE_KEYS.ELIGIBILITY, current);
      return newElig;
    }
  },

  async updateExamEligibilityBulk(sessionId: string, entries: { email: string; status: 'eligible' | 'locked'; reason: 'present' | 'late' | 'absent' | 'unmarked' | 'admin_override' }[]): Promise<boolean> {
    if (supabase) {
      const payload = entries.map(e => ({
        id: 'elig_' + Math.random().toString(36).substr(2, 9),
        sessionId,
        email: e.email,
        status: e.status,
        reason: e.reason,
        updatedAt: new Date().toISOString()
      }));
      const { error } = await supabase.from('exam_eligibility').upsert(payload, { onConflict: '"sessionId",email', ignoreDuplicates: false });
      if (error) {
        console.error("Bulk Exam Eligibility upsert error:", error);
        throw error;
      }
      return true;
    }

    const current = getLocalItem<ExamEligibility[]>(STORAGE_KEYS.ELIGIBILITY, []);
    const entryMap = new Map(entries.map(e => [e.email.toLowerCase(), e]));

    const updatedEmails = new Set<string>();
    const nextList = current.map(item => {
      if (item.sessionId === sessionId) {
        const match = entryMap.get(item.email.toLowerCase());
        if (match) {
          updatedEmails.add(item.email.toLowerCase());
          return {
            ...item,
            status: match.status,
            reason: match.reason,
            updatedAt: new Date().toISOString()
          };
        }
      }
      return item;
    });

    for (const entry of entries) {
      if (!updatedEmails.has(entry.email.toLowerCase())) {
        nextList.push({
          id: 'elig_' + Math.random().toString(36).substr(2, 9),
          sessionId,
          email: entry.email,
          status: entry.status,
          reason: entry.reason,
          updatedAt: new Date().toISOString()
        });
      }
    }

    setLocalItem(STORAGE_KEYS.ELIGIBILITY, nextList);
    return true;
  },

  async deleteExamEligibilityBySession(sessionId: string): Promise<boolean> {
    if (supabase) {
      await supabase.from('exam_eligibility').delete().eq('sessionId', sessionId);
      return true;
    }
    const current = getLocalItem<ExamEligibility[]>(STORAGE_KEYS.ELIGIBILITY, []);
    const filtered = current.filter(e => e.sessionId !== sessionId);
    setLocalItem(STORAGE_KEYS.ELIGIBILITY, filtered);
    return true;
  },

  // Wipe every exam-eligibility row (used when a new attendance session
  // begins, so prior locked/eligible flags don't leak into the new round).
  async clearAllExamEligibility(): Promise<boolean> {
    if (supabase) {
      const { error } = await supabase
        .from('exam_eligibility')
        .delete()
        .not('id', 'is', null);
      if (error) {
        console.error('clearAllExamEligibility error:', error);
        return false;
      }
      return true;
    }
    setLocalItem(STORAGE_KEYS.ELIGIBILITY, []);
    return true;
  },

  // Questions Bank
  async getQuestions(): Promise<Question[]> {
    if (supabase) {
      const { data, error } = await supabase.from('questions').select('*').order('createdAt', { ascending: true });
      if (!error && data) return data;
    }
    return getLocalItem<Question[]>(STORAGE_KEYS.QUESTIONS, []);
  },

  async addQuestion(question: Omit<Question, 'id' | 'createdAt'>): Promise<Question> {
    const newQ: Question = {
      ...question,
      options: question.options ?? [],
      id: 'q_' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase.from('questions').insert(newQ).select().single();
      if (error) throw new Error(error.message);
      if (data) return data;
    }
    const current = getLocalItem<Question[]>(STORAGE_KEYS.QUESTIONS, []);
    current.push(newQ);
    setLocalItem(STORAGE_KEYS.QUESTIONS, current);
    return newQ;
  },

  async bulkAddQuestions(questions: Omit<Question, 'id' | 'createdAt'>[]): Promise<number> {
    const rows: Question[] = questions.map(q => ({
      ...q,
      options: q.options ?? [],
      id: 'q_' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString()
    }));
    if (supabase) {
      const { error } = await supabase.from('questions').insert(rows);
      if (error) throw new Error(error.message);
      return rows.length;
    }
    const current = getLocalItem<Question[]>(STORAGE_KEYS.QUESTIONS, []);
    current.push(...rows);
    setLocalItem(STORAGE_KEYS.QUESTIONS, current);
    return rows.length;
  },

  async updateQuestion(id: string, patch: Partial<Question>): Promise<Question> {
    if (supabase) {
      const { data, error } = await supabase.from('questions').update(patch).eq('id', id).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<Question[]>(STORAGE_KEYS.QUESTIONS, []);
    const idx = current.findIndex(q => q.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch };
      setLocalItem(STORAGE_KEYS.QUESTIONS, current);
      return current[idx];
    }
    throw new Error('Question not found');
  },

  async deleteQuestion(id: string): Promise<boolean> {
    if (supabase) {
      await supabase.from('questions').delete().eq('id', id);
      return true;
    }
    const current = getLocalItem<Question[]>(STORAGE_KEYS.QUESTIONS, []);
    const filtered = current.filter(q => q.id !== id);
    setLocalItem(STORAGE_KEYS.QUESTIONS, filtered);
    return true;
  },

  async setQuestions(arr: Question[]): Promise<void> {
    if (supabase) {
      await supabase.from('questions').delete().gte('id', '');
      await supabase.from('questions').insert(arr);
    }
    setLocalItem(STORAGE_KEYS.QUESTIONS, arr);
  },

  async deleteAllQuestions(): Promise<number> {
    let count = 0;
    if (supabase) {
      const { data } = await supabase.from('questions').select('id');
      count = data?.length ?? 0;
      await supabase.from('questions').delete().gte('id', '');
    } else {
      const current = getLocalItem<Question[]>(STORAGE_KEYS.QUESTIONS, []);
      count = current.length;
    }
    setLocalItem(STORAGE_KEYS.QUESTIONS, []);
    return count;
  },

  // Exam Results
  async getResults(): Promise<Result[]> {
    if (supabase) {
      const { data, error } = await supabase.from('results').select('*').order('submittedAt', { ascending: false });
      if (!error && data) return data;
    }
    return getLocalItem<Result[]>(STORAGE_KEYS.RESULTS, []);
  },

  async addResult(result: Omit<Result, 'id'>): Promise<Result> {
    const newRes: Result = {
      ...result,
      id: 'res_' + Math.random().toString(36).substr(2, 9)
    };
    if (supabase) {
      const { data, error } = await supabase.from('results').upsert(newRes).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<Result[]>(STORAGE_KEYS.RESULTS, []);
    // Upsert on email + examSessionId
    const filtered = current.filter(r => !(r.email.toLowerCase() === result.email.toLowerCase() && r.examSessionId === result.examSessionId));
    filtered.push(newRes);
    setLocalItem(STORAGE_KEYS.RESULTS, filtered);
    return newRes;
  },

  async deleteResultsBySession(sessionId: string): Promise<boolean> {
    if (supabase) {
      await supabase.from('results').delete().eq('examSessionId', sessionId);
      return true;
    }
    const current = getLocalItem<Result[]>(STORAGE_KEYS.RESULTS, []);
    const filtered = current.filter(r => r.examSessionId !== sessionId);
    setLocalItem(STORAGE_KEYS.RESULTS, filtered);
    return true;
  },


  async deleteResults(ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    if (supabase) {
      const { error } = await supabase.from('results').delete().in('id', ids);
      if (error) throw error;
      return true;
    }
    const current = getLocalItem<Result[]>(STORAGE_KEYS.RESULTS, []);
    const set = new Set(ids);
    setLocalItem(STORAGE_KEYS.RESULTS, current.filter(r => !set.has(r.id)));
    return true;
  },

  async deleteAllResults(): Promise<boolean> {
    if (supabase) {
      const { error } = await supabase.from('results').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
      return true;
    }
    setLocalItem(STORAGE_KEYS.RESULTS, []);
    return true;
  },


  async deleteResult(id: string): Promise<boolean> {
    if (supabase) {
      const { error } = await supabase.from('results').delete().eq('id', id);
      if (error) throw error;
      return true;
    }
    const current = getLocalItem<Result[]>(STORAGE_KEYS.RESULTS, []);
    setLocalItem(STORAGE_KEYS.RESULTS, current.filter(r => r.id !== id));
    return true;
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLog[]> {
    if (supabase) {
      const { data, error } = await supabase.from('audit_log').select('*').order('timestamp', { ascending: false });
      if (!error && data) return data;
    }
    return getLocalItem<AuditLog[]>(STORAGE_KEYS.AUDIT_LOG, []);
  },

  async addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    const newLog: AuditLog = {
      ...log,
      id: 'log_' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString()
    };
    if (supabase) {
      await supabase.from('audit_log').insert(newLog);
    }
    const current = getLocalItem<AuditLog[]>(STORAGE_KEYS.AUDIT_LOG, []);
    
    // Duplicate debounce within a short window (e.g. 2 seconds)
    const recent = current[current.length - 1];
    if (recent && 
        recent.userName === log.userName && 
        recent.action === log.action && 
        recent.page === log.page && 
        (new Date().getTime() - new Date(recent.timestamp).getTime()) < 2000) {
      return recent; // skip logging duplicate click flood
    }
    
    current.push(newLog);
    setLocalItem(STORAGE_KEYS.AUDIT_LOG, current);
    return newLog;
  },

  // Deletion Requests
  async getDeletionRequests(): Promise<DeletionRequest[]> {
    if (supabase) {
      const { data, error } = await supabase.from('deletion_requests').select('*').order('createdAt', { ascending: false });
      if (!error && data) return data;
    }
    return getLocalItem<DeletionRequest[]>(STORAGE_KEYS.DELETION_REQS, []);
  },

  async addDeletionRequest(req: Omit<DeletionRequest, 'id' | 'createdAt' | 'status'>): Promise<DeletionRequest> {
    const newReq: DeletionRequest = {
      ...req,
      id: 'del_' + Math.random().toString(36).substr(2, 9),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase.from('deletion_requests').insert(newReq).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<DeletionRequest[]>(STORAGE_KEYS.DELETION_REQS, []);
    current.push(newReq);
    setLocalItem(STORAGE_KEYS.DELETION_REQS, current);
    return newReq;
  },

  async updateDeletionRequest(id: string, patch: Partial<DeletionRequest>): Promise<DeletionRequest> {
    if (supabase) {
      const { data, error } = await supabase.from('deletion_requests').update(patch).eq('id', id).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<DeletionRequest[]>(STORAGE_KEYS.DELETION_REQS, []);
    const idx = current.findIndex(d => d.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch };
      setLocalItem(STORAGE_KEYS.DELETION_REQS, current);
      return current[idx];
    }
    throw new Error('Deletion request not found');
  },

  // System Config — ALL fields are now persisted in the remote `config` table
  // (schedule, duration, maxQuestions, randomize, monitoring columns were
  // added by the 20260628_server_question_allocation.sql migration). The
  // local overlay is kept only as a fallback merge for any field that the
  // remote row may not yet contain on legacy installs.
  async getConfig(): Promise<SystemConfig> {
    const win = getExamWindow();
    if (supabase) {
      const { data, error } = await supabase.from('config').select('*').limit(1).single();
      if (!error && data) {
        // Remote is the source of truth: only fall back to overlay for fields
        // that are null/undefined remotely.
        const remote: any = data;
        const merged: any = { ...remote };
        for (const k of OVERLAY_KEYS) {
          if (remote[k] === undefined || remote[k] === null) {
            if ((win as any)[k] !== undefined) merged[k] = (win as any)[k];
          }
        }
        return merged;
      }
    }
    const local = getLocalItem<SystemConfig>(STORAGE_KEYS.CONFIG, {
      examActivated: false,
      protectionPassword: 'admin',
      superadminPassword: 'super'
    });
    return { ...local, ...win };
  },

  async updateConfig(patch: Partial<SystemConfig>): Promise<SystemConfig> {
    // Mirror overlay fields to localStorage as a best-effort cache so the
    // admin UI still has something to show if Supabase is unreachable on
    // the next page load. Source of truth is the remote `config` row.
    const winPatch: ExamOverlay = {};
    for (const key of OVERLAY_KEYS) {
      if (key in patch) (winPatch as any)[key] = (patch as any)[key];
    }
    if (Object.keys(winPatch).length) setExamWindow(winPatch);

    if (supabase && Object.keys(patch).length) {
      const { data, error } = await supabase
        .from('config')
        .update(patch as any)
        .gte('id', '')
        .select()
        .single();
      if (!error && data) return data as any;
      if (error) console.warn('[updateConfig] remote write failed:', error.message);
    }
    const current = getLocalItem<SystemConfig>(STORAGE_KEYS.CONFIG, {
      examActivated: false,
      protectionPassword: 'admin',
      superadminPassword: 'super'
    });
    const updated = { ...current, ...(patch as any) };
    setLocalItem(STORAGE_KEYS.CONFIG, updated);
    return { ...updated, ...getExamWindow() };
  },

  // Admin Profiles
  async getAdminProfiles(): Promise<AdminProfile[]> {
    if (supabase) {
      const { data, error } = await supabase.from('admin_profiles').select('*');
      if (!error && data) return data;
    }
    return getLocalItem<AdminProfile[]>(STORAGE_KEYS.ADMIN_PROFILES, []);
  },

  async addAdminProfile(profile: Omit<AdminProfile, 'id' | 'createdAt'>): Promise<AdminProfile> {
    const newProfile: AdminProfile = {
      ...profile,
      id: 'profile_' + Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString()
    };
    if (supabase) {
      const { data, error } = await supabase.from('admin_profiles').insert(newProfile).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AdminProfile[]>(STORAGE_KEYS.ADMIN_PROFILES, []);
    current.push(newProfile);
    setLocalItem(STORAGE_KEYS.ADMIN_PROFILES, current);
    return newProfile;
  },

  async updateAdminProfile(id: string, patch: Partial<AdminProfile>): Promise<AdminProfile> {
    if (supabase) {
      const { data, error } = await supabase.from('admin_profiles').update(patch).eq('id', id).select().single();
      if (!error && data) return data;
    }
    const current = getLocalItem<AdminProfile[]>(STORAGE_KEYS.ADMIN_PROFILES, []);
    const idx = current.findIndex(p => p.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch };
      setLocalItem(STORAGE_KEYS.ADMIN_PROFILES, current);
      return current[idx];
    }
    throw new Error('Profile not found');
  },

  async deleteAdminProfile(id: string): Promise<boolean> {
    if (supabase) {
      await supabase.from('admin_profiles').delete().eq('id', id);
      return true;
    }
    const current = getLocalItem<AdminProfile[]>(STORAGE_KEYS.ADMIN_PROFILES, []);
    const filtered = current.filter(p => p.id !== id);
    setLocalItem(STORAGE_KEYS.ADMIN_PROFILES, filtered);
    return true;
  },

  // ==========================================
  // Full Backup + Wipe (Task 4)
  // ==========================================
  async exportFullBackup(): Promise<{
    generatedAt: string;
    version: string;
    counts: Record<string, number>;
    data: Record<string, any[]>;
    config: any;
  }> {
    const [students, sessions, records, editReqs, eligibility, questions, results, deletionReqs, auditLog, adminProfiles, config] = await Promise.all([
      this.getStudents(),
      this.getAttSessions(),
      this.getAttRecords(),
      this.getAttEditReqs(),
      this.getExamEligibility(),
      this.getQuestions(),
      this.getResults(),
      this.getDeletionRequests(),
      this.getAuditLogs(),
      this.getAdminProfiles(),
      this.getConfig(),
    ]);
    const data = {
      students, sessions, records, editRequests: editReqs, eligibility,
      questions, results, deletionRequests: deletionReqs, auditLog, adminProfiles,
    };
    const counts: Record<string, number> = {};
    for (const k of Object.keys(data)) counts[k] = (data as any)[k]?.length ?? 0;
    return {
      generatedAt: new Date().toISOString(),
      version: 'cbt-backup-v1',
      counts,
      data,
      config,
    };
  },

  /**
   * Wipe every operational table + local cache. NEVER call without a confirmed
   * successful backup download (the WipeDataButton enforces this).
   */
  async wipeAllData(): Promise<{ ok: true; wiped: string[] }> {
    const wiped: string[] = [];
    if (supabase) {
      // Order matters: clear dependent rows first.
      const tables = [
        'results', 'exam_eligibility', 'att_records', 'att_edit_requests',
        'att_sessions', 'deletion_requests', 'audit_log', 'questions', 'students',
      ];
      for (const t of tables) {
        try {
          await supabase.from(t).delete().not('id', 'is', null);
          wiped.push(`supabase:${t}`);
        } catch (e) {
          console.warn('wipeAllData: skipping', t, e);
        }
      }
    }
    // Local cache (always)
    const localKeys = [
      STORAGE_KEYS.STUDENTS, STORAGE_KEYS.SESSIONS, STORAGE_KEYS.RECORDS,
      STORAGE_KEYS.EDIT_REQS, STORAGE_KEYS.ELIGIBILITY, STORAGE_KEYS.QUESTIONS,
      STORAGE_KEYS.RESULTS, STORAGE_KEYS.DELETION_REQS, STORAGE_KEYS.AUDIT_LOG,
    ];
    for (const k of localKeys) {
      try { localStorage.removeItem(k); wiped.push(`local:${k}`); } catch {}
    }
    return { ok: true, wiped };
  },
};
