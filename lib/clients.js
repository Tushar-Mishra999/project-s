// Shared API clients — initialised once and reused.
import { VoyageAIClient } from 'voyageai';
import { createClient } from '@supabase/supabase-js';

export const voyage = process.env.VOYAGE_API_KEY
  ? new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY })
  : null;

export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
      })
    : null;

export function ragReady() {
  const missing = [];
  if (!process.env.VERTEX_API_KEY) missing.push('VERTEX_API_KEY');
  if (!process.env.VOYAGE_API_KEY) missing.push('VOYAGE_API_KEY');
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
  return { ok: missing.length === 0, missing };
}
