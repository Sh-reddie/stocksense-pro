/**
 * GET /api/ai-status — read the AI analysis job + results from KV.
 *
 * The Cloudflare Worker (stocksense-price-sync) runs the resumable AI analysis
 * queue and writes two KV keys: `aiJob` (progress/state) and `aiResults`
 * (per-symbol analysis). This Pages Function exposes them to the web app
 * same-origin (so it inherits Cloudflare Access auth — no secret needed).
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestGet({ env }) {
  const kv = env.STOCKSENSE_KV;
  if (!kv) return new Response(JSON.stringify({ ok: false, error: 'KV not configured' }), { status: 503, headers: CORS });
  try {
    const [jobRaw, resRaw] = await Promise.all([kv.get('aiJob'), kv.get('aiResults')]);
    const job = jobRaw ? JSON.parse(jobRaw) : null;
    const results = resRaw ? JSON.parse(resRaw) : null;
    // Strip the (potentially large) queue array from the status payload — the
    // app only needs counts/cursor/status, not the full symbol list.
    const jobLite = job ? { ...job, queue: undefined, queueLen: (job.queue || []).length } : null;
    return new Response(JSON.stringify({ ok: true, job: jobLite, results }), {
      headers: { ...CORS, 'Cache-Control': 'no-cache' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
}
