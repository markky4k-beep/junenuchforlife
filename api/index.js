// Vercel serverless entry. Wraps the Express app so every API/webhook request
// is handled by one function. Socket.IO / server.listen are skipped on Vercel
// (see server/index.js: guarded by process.env.VERCEL). Live Chat realtime is
// handled client-side via Supabase Realtime instead of Socket.IO.
import { app, ensureInit } from '../server/index.js';

export default async function handler(req, res) {
  await ensureInit();          // seed + settings cache once per cold start
  return app(req, res);
}
