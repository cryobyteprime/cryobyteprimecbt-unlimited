import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { db } from '@/integrations/supabase/db';

export const Route = createFileRoute('/supabase-test')({
  component: SupabaseTest,
  ssr: false,
});

type TableResult = { table: string; count: number | null; sample: any[]; error?: string };

const TABLES = ['students', 'questions', 'att_sessions', 'results', 'exam_eligibility', 'config'] as const;

function SupabaseTest() {
  const [results, setResults] = useState<TableResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const out: TableResult[] = [];
      for (const t of TABLES) {
        try {
          const { data, error, count } = await supabase
            .from(t)
            .select('*', { count: 'exact' })
            .limit(3);
          out.push({ table: t, count: count ?? null, sample: data ?? [], error: error?.message });
        } catch (e: any) {
          out.push({ table: t, count: null, sample: [], error: e?.message ?? String(e) });
        }
      }
      setResults(out);
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Supabase Connectivity Test</h1>
      <p style={{ color: '#555', marginBottom: 16 }}>
        Reads via publishable key from <code>{import.meta.env.VITE_SUPABASE_URL || 'env SUPABASE_URL'}</code>.
      </p>
      {loading && <p>Running queries…</p>}
      {!loading && results.map((r) => (
        <div key={r.table} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{r.table}</strong>
            <span>{r.error ? '❌ ' + r.error : `✅ ${r.count ?? 0} row(s)`}</span>
          </div>
          {r.sample.length > 0 && (
            <pre style={{ background: '#0b1020', color: '#cde', padding: 10, borderRadius: 6, overflow: 'auto', fontSize: 12, marginTop: 8 }}>
              {JSON.stringify(r.sample, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}