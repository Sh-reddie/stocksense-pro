/**
 * StockSense Pro — Cloudflare Pages Function
 * Handles GET and POST for /api/data using KV storage.
 *
 * KV binding name: STOCKSENSE_KV  (set this in Pages → Settings → Functions → KV bindings)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-SS-Token',
};

// ── GET /api/data — load portfolio from KV ──────────────────────────────────
export async function onRequestGet({ env }) {
  if (!env.STOCKSENSE_KV) {
    return Response.json(
      { ok: false, error: 'KV not configured — add STOCKSENSE_KV binding in Pages settings.' },
      { status: 500, headers: CORS }
    );
  }
  try {
    const raw = await env.STOCKSENSE_KV.get('portfolio');
    const data = raw ? JSON.parse(raw) : null;
    return Response.json({ ok: true, data }, { headers: CORS });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}

// ── POST /api/data — save portfolio to KV ───────────────────────────────────
export async function onRequestPost({ request, env }) {
  if (!env.STOCKSENSE_KV) {
    return Response.json(
      { ok: false, error: 'KV not configured — add STOCKSENSE_KV binding in Pages settings.' },
      { status: 500, headers: CORS }
    );
  }
  try {
    const incomingToken = request.headers.get('X-SS-Token') || '';
    const body = await request.json();

    // Simple token auth — first write registers the token; later writes must match.
    const storedToken = await env.STOCKSENSE_KV.get('ss_auth_token');
    if (storedToken) {
      if (incomingToken !== storedToken) {
        return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS });
      }
    } else if (incomingToken) {
      // First-time: register this token (derived from PIN hash in the app)
      await env.STOCKSENSE_KV.put('ss_auth_token', incomingToken);
    }

    // Strip internal fields, add server timestamp
    const { _token, _savedAt: _, ...portfolioData } = body;
    portfolioData._savedAt = new Date().toISOString();

    await env.STOCKSENSE_KV.put('portfolio', JSON.stringify(portfolioData));
    return Response.json({ ok: true, savedAt: portfolioData._savedAt }, { headers: CORS });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}

// ── OPTIONS — CORS preflight ─────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
