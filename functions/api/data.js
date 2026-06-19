/**
 * StockSense Pro — Cloudflare Pages Function
 * GET  /api/data  — load authenticated user's portfolio from D1
 * POST /api/data  — save authenticated user's portfolio to D1
 *
 * Authentication: Cloudflare Access (Zero Trust)
 *   The 'cf-access-authenticated-user-email' header is set by Cloudflare Access
 *   on every authenticated request. No token check needed in this function.
 *
 * Storage: Cloudflare D1 (SQLite)
 *   Binding name: DB  (Pages → Settings → Functions → D1 database bindings)
 *   Schema: migrations/0001_schema.sql
 *
 * Fallback: If D1 not configured or Access not active, falls back to
 *   Cloudflare KV (STOCKSENSE_KV) for backward compatibility.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-SS-Token',
};

const DATA_KEYS = ['holdings','realised','watchlist','dividends','cfg','orders','alerts','symMap','pushSubscription'];

function getEmail(request) {
  return request.headers.get('cf-access-authenticated-user-email') || null;
}

// ── GET /api/data ─────────────────────────────────────────────────────────────
export async function onRequestGet({ request, env }) {
  const email = getEmail(request);

  // ── D1 path — per-user, server-authenticated ───────────────────────────────
  if (email && env.DB) {
    try {
      const { results } = await env.DB
        .prepare('SELECT key, value FROM user_data WHERE email = ?')
        .bind(email)
        .all();

      const data = {};
      for (const row of results) {
        try { data[row.key] = JSON.parse(row.value); } catch { data[row.key] = row.value; }
      }

      return Response.json({ ok: true, data, email, source: 'd1' }, { headers: CORS });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
    }
  }

  // ── KV fallback — single shared key, no user isolation ─────────────────────
  if (env.STOCKSENSE_KV) {
    try {
      const raw = await env.STOCKSENSE_KV.get('portfolio');
      return Response.json({ ok: true, data: raw ? JSON.parse(raw) : null, source: 'kv' }, { headers: CORS });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
    }
  }

  return Response.json(
    { ok: false, error: 'No storage backend configured (DB or STOCKSENSE_KV).' },
    { status: 500, headers: CORS }
  );
}

// ── POST /api/data ────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const email = getEmail(request);
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400, headers: CORS });
  }

  // ── D1 path ────────────────────────────────────────────────────────────────
  if (email && env.DB) {
    try {
      const now = Date.now();
      const savedAt = new Date(now).toISOString();

      const entries = Object.entries(body).filter(([k]) => DATA_KEYS.includes(k));
      if (entries.length > 0) {
        const stmts = entries.map(([k, v]) =>
          env.DB.prepare(
            'INSERT OR REPLACE INTO user_data (email, key, value, updated_at) VALUES (?, ?, ?, ?)'
          ).bind(email, k, JSON.stringify(v), now)
        );
        await env.DB.batch(stmts);
      }

      // Ensure user row exists
      await env.DB.prepare(
        'INSERT OR IGNORE INTO users (email, name, created_at) VALUES (?, ?, ?)'
      ).bind(email, email.split('@')[0], now).run();

      return Response.json({ ok: true, savedAt, source: 'd1' }, { headers: CORS });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
    }
  }

  // ── KV fallback ────────────────────────────────────────────────────────────
  if (env.STOCKSENSE_KV) {
    try {
      const { _token, _savedAt: _, ...portfolioData } = body;
      portfolioData._savedAt = new Date().toISOString();
      await env.STOCKSENSE_KV.put('portfolio', JSON.stringify(portfolioData));
      return Response.json({ ok: true, savedAt: portfolioData._savedAt, source: 'kv' }, { headers: CORS });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
    }
  }

  return Response.json({ ok: false, error: 'No storage backend configured.' }, { status: 500, headers: CORS });
}

// ── OPTIONS preflight ─────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
