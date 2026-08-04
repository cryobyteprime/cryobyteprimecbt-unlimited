// Runtime-validated wrappers around the student_cbt_* database functions.
//
// Every payload is parsed with zod BEFORE it reaches the network, so an
// incorrect argument fails immediately with a clear, human-readable error
// instead of a vague PostgREST 400/404.
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/external';

const email = z.string().trim().min(3, 'Email is required').max(255).email('Enter a valid email address');
const classSN = z.string().trim().min(1, 'Serial number is required').max(32);

export const StartArgs = z.object({ p_email: email, p_class_sn: classSN });
export const ResultArgs = z.object({ p_email: email, p_class_sn: classSN });
export const SubmitArgs = z.object({
  p_email: email,
  p_class_sn: classSN,
  p_session_id: z.string().trim().min(1, 'Session id is required').max(128),
  p_attempt_id: z.string().trim().min(1, 'Attempt id is required').max(128),
  p_answers: z.record(z.string(), z.string()).refine((a) => Object.keys(a).length > 0, {
    message: 'At least one answer must be submitted',
  }),
});
export const LogArgs = z.object({
  p_email: email,
  p_action: z.string().trim().min(1, 'Action is required').max(2000),
  p_reason: z.string().trim().min(1, 'Reason is required').max(1000),
  p_page: z.string().trim().min(1, 'Page is required').max(200),
  p_new_value: z.string().max(20000),
});

export class CbtValidationError extends Error {
  readonly issues: string[];
  constructor(fn: string, error: z.ZodError) {
    const issues = error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`);
    super(`Invalid payload for ${fn} — ${issues.join('; ')}`);
    this.name = 'CbtValidationError';
    this.issues = issues;
  }
}

function parse<S extends z.ZodTypeAny>(fn: string, schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CbtValidationError(fn, parsed.error);
  return parsed.data;
}

type RpcResult = { data: any; error: { message: string } | null };

export async function cbtStart(input: z.input<typeof StartArgs>): Promise<RpcResult> {
  return supabase.rpc('student_cbt_start', parse('student_cbt_start', StartArgs, input)) as unknown as RpcResult;
}

export async function cbtResult(input: z.input<typeof ResultArgs>): Promise<RpcResult> {
  return supabase.rpc('student_cbt_result', parse('student_cbt_result', ResultArgs, input)) as unknown as RpcResult;
}

export async function cbtSubmit(input: z.input<typeof SubmitArgs>): Promise<RpcResult> {
  const args = parse('student_cbt_submit', SubmitArgs, input);
  return supabase.rpc('student_cbt_submit', args as never) as unknown as RpcResult;
}

/** Fire-and-forget audit logging; validation problems are surfaced in the console only. */
export function cbtLog(input: z.input<typeof LogArgs>): void {
  try {
    const args = parse('student_cbt_log', LogArgs, input);
    void supabase.rpc('student_cbt_log', args);
  } catch (e) {
    console.warn('[cbtLog] skipped invalid audit payload:', (e as Error).message);
  }
}
