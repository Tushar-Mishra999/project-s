// Shared API clients — initialised once and reused.
import { createClient } from '@supabase/supabase-js';

export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
      })
    : null;

export function ragReady() {
  const missing = [];
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) missing.push('GOOGLE_APPLICATION_CREDENTIALS_JSON');
  if (!process.env.GOOGLE_CLOUD_PROJECT) missing.push('GOOGLE_CLOUD_PROJECT');
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
  return { ok: missing.length === 0, missing };
}
