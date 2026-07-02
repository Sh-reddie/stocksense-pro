/**
 * StockSense Pro — /api/snapstore
 * Generic per-section item archive (same pattern as /api/newsstore, but
 * schemaless: each item is a JSON blob keyed by (email, sec, id)).
 *
 *   GET  /api/snapstore?sec=ipo              — load a section's archive
 *   POST /api/snapstore {sec, items:[{id,…}]} — upsert (INSERT OR REPLACE:
 *        fresh fetches update evolving fields like subscription/market price,
 *        while never dropping items that vanished from the live feed)
 *
 * Storage: D1 table section_items (auto-created), KV fallback snap:<sec>:<email>.
 * Used by: IPO Tracker (sec=ipo), Macro snapshot (sec=macro), Calendar (sec=calendar).
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_ITEMS_PER_SEC = 600;

function getEmail(request) {
  return request.headers.get('cf-access-authenticated-user-email') || 'default';
}
function getSec(v) {
  const s = String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return s || null;
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS section_items (
    email      TEXT NOT NULL,
    sec        TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (email, sec, id)
  )`).run();
}

async function kvLoad(env, email, sec) {
  if (!env.STOCKSENSE_KV) return [];
  try {
    const raw = await env.STOCKSENSE_KV.get(`snap:${sec}:${email}`);
    const j = raw ? JSON.parse(raw) : null;
    return Array.isArray(j?.items) ? j.items : [];
  } catch (e) { return []; }
}
async function kvSave(env, email, sec, items) {
  if (!env.STOCKSENSE_KV) return;
  try { await env.STOCKSENSE_KV.put(`snap:${sec}:${email}`, JSON.stringify({ items, ts: Date.now() })); } catch (e) {}
}

export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  const sec = getSec(new URL(request.url).searchParams.get('sec'));
  if (!sec) return Response.json({ ok: false, error: 'sec param required' }, { status: 400, headers: CORS });

  if (env.DB) {
    try {
      await ensureTable(env.DB);
      const { results } = await env.DB
        .prepare('SELECT id, data, updated_at FROM section_items WHERE email = ? AND sec = ? ORDER BY updated_at DESC LIMIT ?')
        .bind(email, sec, MAX_ITEMS_PER_SEC).all();
      const items = results.map(r => { try { return { ...JSON.parse(r.data), id: r.id, _updatedAt: r.updated_at }; } catch { return null; } }).filter(Boolean);
      const lastRefresh = items.reduce((m, it) => Math.max(m, it._updatedAt || 0), 0);
      return Response.json({ ok: true, storage: 'd1', sec, total: items.length, lastRefresh, items }, { headers: CORS });
    } catch (e) { /* fall through */ }
  }
  const items = await kvLoad(env, email, sec);
  const lastRefresh = items.reduce((m, it) => Math.max(m, it._updatedAt || 0), 0);
  return Response.json({ ok: true, storage: 'kv', sec, total: items.length, lastRefresh, items }, { headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const email = getEmail(request);
  let body;
  try { body = await request.json(); } catch (e) {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400, headers: CORS });
  }
  const sec = getSec(body?.sec);
  if (!sec) return Response.json({ ok: false, error: 'sec required' }, { status: 400, headers: CORS });
  const now = Date.now();
  const incoming = (Array.isArray(body?.items) ? body.items : [])
    .filter(it => it && typeof it === 'object' && it.id)
    .slice(0, 500)
    .map(it => ({ id: String(it.id).slice(0, 120), data: it }));
  if (!incoming.length) return Response.json({ ok: true, upserted: 0 }, { headers: CORS });

  if (env.DB) {
    try {
      await ensureTable(env.DB);
      const stmt = env.DB.prepare(
        'INSERT OR REPLACE INTO section_items (email, sec, id, data, updated_at) VALUES (?,?,?,?,?)'
      );
      await env.DB.batch(incoming.map(({ id, data }) => {
        const { _updatedAt, ...clean } = data;
        return stmt.bind(email, sec, id, JSON.stringify(clean), now);
      }));
      // Cap per-section growth
      await env.DB.prepare(`DELETE FROM section_items WHERE email = ?1 AND sec = ?2 AND id NOT IN (
        SELECT id FROM section_items WHERE email = ?1 AND sec = ?2 ORDER BY updated_at DESC LIMIT ?3)`)
        .bind(email, sec, MAX_ITEMS_PER_SEC).run();
      const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM section_items WHERE email = ? AND sec = ?').bind(email, sec).all();
      return Response.json({ ok: true, storage: 'd1', upserted: incoming.length, total: results?.[0]?.n ?? null }, { headers: CORS });
    } catch (e) { /* fall through */ }
  }

  const existing = await kvLoad(env, email, sec);
  const map = new Map(existing.map(it => [String(it.id), it]));
  incoming.forEach(({ id, data }) => map.set(id, { ...data, _updatedAt: now }));
  const merged = [...map.values()].sort((a, b) => (b._updatedAt || 0) - (a._updatedAt || 0)).slice(0, MAX_ITEMS_PER_SEC);
  await kvSave(env, email, sec, merged);
  return Response.json({ ok: true, storage: 'kv', upserted: incoming.length, total: merged.length }, { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
