/**
 * POST /api/ai-stop — halt the AI analysis queue (sets it idle).
 * Same-origin (Cloudflare Access). Computes the Worker secret from KV.
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
    const r = await fetch(WORKER + '/ai-stop' + (secret ? ('?key=' + secret) : ''), { method: 'GET' });
    const text = await r.text();
    return new Response(text, { status: r.ok ? 200 : 502, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
}
