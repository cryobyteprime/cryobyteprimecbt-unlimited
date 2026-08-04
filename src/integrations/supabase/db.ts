// The generated `Database` types describe the managed Cloud schema, which does
// not include this app's tables/RPCs. These loosely-typed views of the same
// clients let app code query the real schema without fighting the generated types.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './client';

export type AnyDb = SupabaseClient<any, 'public', any>;

export const db = supabase as unknown as AnyDb;
