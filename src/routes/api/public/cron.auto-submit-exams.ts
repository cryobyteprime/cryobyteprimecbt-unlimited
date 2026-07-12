import { createFileRoute } from '@tanstack/react-router';

// Fail-safe HTTP endpoint that runs the same server-side auto-submit
// used by pg_cron. Lets an external scheduler (or the stable
// project--{id}.lovable.app URL) trigger the sweep if pg_cron is not
// available. Protected by CRON_SECRET.
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  if (!secret || provided !== secret) {
    return new Response('unauthorized', { status: 401 });
  }
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin.rpc('auto_submit_expired_exams' as never);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true, result: data }), {
    headers: { 'content-type': 'application/json' },
  });
}

export const Route = createFileRoute('/api/public/cron/auto-submit-exams')({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});