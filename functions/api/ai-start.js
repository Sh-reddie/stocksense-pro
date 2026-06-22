/**
 * POST /api/ai-start — (re)start the AI analysis queue.
 *
 * Builds the work queue from the current portfolio and kicks the Worker to
 * begin processing. Runs server-side so the Worker's webhook secret is computed
 * from KV (cfg.tgToken) and never exposed to the browser. Same-origin →
 * inherits Cloudflare Access auth.
 */
const WORKER = 'https://stocksense-price-sync.sharathreddy-y001.workers.dev';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

async function workerSecret(kv) {
  try {
    const raw = await kv.get('portfolio');
    const tok = raw ? (JSON.parse(raw).cfg || {}).tgToken : null;
    if (!tok) return null;
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ss-webhook:' + tok));
    return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}

export async function onRequestPost({ env }) {
  const kv = env.STOCKSENSE_KV;
  if (!kv) return new Response(JSON.stringify({ ok: false, error: 'KV not configured' }), { status: 503, headers: CORS });
  try {
    const secret = await workerSecret(kv);
    const url = WORKER + '/ai-start' + (secret ? ('?key=' + secret) : '');
    const r = await fetch(url, { method: 'GET' });
    const text = await r.text();
    if (!r.ok) return new Response(JSON.stringify({ ok: false, error: 'worker ' + r.status, detail: text.slice(0, 200) }), { status: 502, headers: CORS });
    return new Response(text, { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
}
