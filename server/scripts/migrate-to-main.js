// One-shot data copy: source Supabase project -> unified "Main" project.
// Copies website storefront/CMS tables. Safe to re-run (upsert on PK).
//
// Usage (PowerShell):
//   $env:SRC_URL="https://rwomqggjaqvephdnsnlg.supabase.co"
//   $env:SRC_KEY="<source service_role key>"
//   $env:DST_URL="https://gtqpefjhaxheyllygbrn.supabase.co"
//   $env:DST_KEY="<Main service_role key>"
//   node server/scripts/migrate-to-main.js
//
// If the env vars are not set, it falls back to reading SRC_* from the
// project root .env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SRC_URL = process.env.SRC_URL || process.env.SUPABASE_URL;
const SRC_KEY = process.env.SRC_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const DST_URL = process.env.DST_URL;
const DST_KEY = process.env.DST_KEY;

if (!SRC_URL || !SRC_KEY || !DST_URL || !DST_KEY) {
  console.error('Missing env. Need SRC_URL/SRC_KEY (or root .env) and DST_URL/DST_KEY.');
  process.exit(1);
}

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false } });
const dst = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } });

// table -> conflict target (primary key). Order respects FKs (none cross here).
const TABLES = [
  ['settings', 'key'],
  ['users', 'id'],
  ['products', 'id'],
  ['articles', 'id'],
  ['coupons', 'code'],
  ['leads', 'id'],
  ['reviews', 'id'],
  ['orders', 'id'],
  ['auth_tokens', 'token'],
  ['messages', 'id'],
];

async function copyTable(name, pk) {
  const { data, error } = await src.from(name).select('*');
  if (error) { console.error(`  ✗ read ${name}:`, error.message); return; }
  if (!data || data.length === 0) { console.log(`  • ${name}: 0 rows (skip)`); return; }
  const { error: upErr } = await dst.from(name).upsert(data, { onConflict: pk });
  if (upErr) { console.error(`  ✗ write ${name}:`, upErr.message); return; }
  console.log(`  ✓ ${name}: ${data.length} rows copied`);
}

(async () => {
  console.log(`Copy ${SRC_URL}  ->  ${DST_URL}`);
  for (const [name, pk] of TABLES) await copyTable(name, pk);
  console.log('Done.');
})();
