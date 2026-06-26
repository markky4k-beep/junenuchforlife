import { createSupabaseAdminClient, isSupabaseConfigured } from './supabase-client.js';

let client = null;
let warned = false;

function getClient() {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    try {
      client = createSupabaseAdminClient();
    } catch (err) {
      if (!warned) {
        warned = true;
        console.error('[supabase-sync] init fail:', err.message);
      }
      return null;
    }
  }
  return client;
}

function logOnce(err) {
  console.error('[supabase-sync]', err?.message || err);
}

export function syncUpsert(table, row, onConflict = 'id') {
  const supabase = getClient();
  if (!supabase || !row) return;
  Promise.resolve()
    .then(async () => {
      const { error } = await supabase.from(table).upsert(row, { onConflict });
      if (error) throw error;
    })
    .catch(logOnce);
}

export function syncDelete(table, column, value) {
  const supabase = getClient();
  if (!supabase || value == null) return;
  Promise.resolve()
    .then(async () => {
      const { error } = await supabase.from(table).delete().eq(column, value);
      if (error) throw error;
    })
    .catch(logOnce);
}
