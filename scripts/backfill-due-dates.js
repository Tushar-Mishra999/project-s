import 'dotenv/config';
import { supabase } from '../lib/clients.js';

const DUE = '2026-05-10';

async function main() {
  if (!supabase) {
    console.error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }
  const { data, error } = await supabase.from('action_items').select('id, items');
  if (error) { console.error(error); process.exit(1); }
  let updatedCards = 0, updatedItems = 0;
  for (const row of data || []) {
    const items = Array.isArray(row.items) ? row.items : [];
    let changed = false;
    const next = items.map((it) => {
      if (!it || it.due_date) return it;
      changed = true;
      updatedItems += 1;
      return { ...it, due_date: DUE };
    });
    if (!changed) continue;
    const { error: upErr } = await supabase
      .from('action_items')
      .update({ items: next, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (upErr) { console.error(`update ${row.id} failed:`, upErr.message); continue; }
    updatedCards += 1;
  }
  console.log(`Done. Updated ${updatedItems} items across ${updatedCards} cards to due_date=${DUE}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
