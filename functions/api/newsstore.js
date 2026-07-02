/**
 * StockSense Pro — /api/newsstore
 *   GET  /api/newsstore           — load the user's accumulated news archive
 *   POST /api/newsstore {items[]} — upsert freshly fetched items (server-side dedupe + prune)
 *
 * Storage: Cloudflare D1 (table auto-created), falling back to KV
 * (STOCKSENSE_KV key newsStore:<email>) exactly like /api/data does.
 *
 * Dedupe key: item.id — a client-computed hash of the normalised title, so the
 * same story from two refreshes (or two symbols) collapses into one row.
 * PRIMARY KEY (email, id) + INSERT OR IGNORE makes duplicates a no-op.
 *
 * Prune policy: keep newest MAX_ITEMS by pubTs, drop anything older than
 * MAX_AGE_DAYS — the archive grows with every refresh but stays bounded.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_ITEMS = 1500;
const MAX_AGE_DAYS = 45;

function getEmail(request) {
  return request.headers.get('cf-access-authenticated-user-email') || 'default';
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS news_items (
    email      TEXT NOT NULL,
    id         TEXT NOT NULL,
    title      TEXT NOT NULL,
    link       TEXT,
    source     TEXT,
    syms       TEXT,
    scope      TEXT,
    label      TEXT,
    senti      TEXT,
    pub_ts     INTEGER NOT NULL DEFAULT 0,
    fetched_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (email, id)
  )`).run();
}

function rowToItem(r) {
  return {
    id: r.id, title: r.title, link: r.link || null, source: r.source || '',
    syms: r.syms ? JSON.parse(r.syms) : [], scope: r.scope || 'stock',
    label: r.label || '', senti: r.senti || 'Neutral',
    pubTs: r.pub_ts || 0, fetchedAt: r.fetched_at || 0,
  };
}

function sanitizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const id = String(it.id || '').slice(0, 64);
  const title = String(it.title || '').slice(0, 400);
  if (!id || title.length < 10) return null;
  return {
    id, title,
    link: it.link ? String(it.link).slice(0, 1000) : null,
    source: String(it.source || '').slice(0, 80),
    syms: Array.isArray(it.syms) ? it.syms.slice(0, 10).map(s => String(s).slice(0, 20)) : [],
    scope: it.scope === 'market' ? 'market' : 'stock',
    label: String(it.label || '').slice(0, 40),
    senti: ['Positive', 'Negative', 'Neutral'].includes(it.senti) ? it.senti : 'Neutral',
    pubTs: +it.pubTs || 0,
    fetchedAt: +it.fetchedAt || Date.now(),
  };
}

// ── KV fallback helpers ────────────────────────────────────────────────────
async function kvLoad(env, email) {
  if (!env.STOCKSENSE_KV) return [];
  try {
    const raw = await env.STOCKSENSE_KV.get('newsStore:' + email);
    const j = raw ? JSON.parse(raw) : null;
    return Array.isArray(j?.items) ? j.items : [];
  } catch (e) { return []; }
}
async function kvSave(env, email, items) {
  if (!env.STOCKSENSE_KV) return;
  try { await env.STOCKSENSE_KV.put('newsStore:' + email, JSON.stringify({ items, ts: Date.now() })); } catch (e) {}
}
function pruneList(items) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  return items
    .filter(it => (it.pubTs || it.fetchedAt || 0) >= cutoff)
    .sort((a, b) => (b.pubTs || b.fetchedAt) - (a.pubTs || a.fetchedAt))
    .slice(0, MAX_ITEMS);
}

// ── GET ────────────────────────────────────────────────────────────────────
export async function onRequestGet({ request, env }) {
  const email = getEmail(request);
  if (env.DB) {
    try {
      await ensureTable(env.DB);
      const { results } = await env.DB
        .prepare('SELECT * FROM news_items WHERE email = ? ORDER BY pub_ts DESC LIMIT ?')
        .bind(email, MAX_ITEMS).all();
      const items = results.map(rowToItem);
      const lastRefresh = items.reduce((m, it) => Math.max(m, it.fetchedAt || 0), 0);
      return Response.json({ ok: true, storage: 'd1', total: items.length, lastRefresh, items }, { headers: CORS });
    } catch (e) { /* fall through to KV */ }
  }
  const items = pruneList(await kvLoad(env, email));
  const lastRefresh = items.reduce((m, it) => Math.max(m, it.fetchedAt || 0), 0);
  return Response.json({ ok: true, storage: 'kv', total: items.length, lastRefresh, items }, { headers: CORS });
}

// ── POST ───────────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const email = getEmail(request);
  let body;
  try { body = await request.json(); } catch (e) {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400, headers: CORS });
  }
  const incoming = (Array.isArray(body?.items) ? body.items : []).map(sanitizeItem).filter(Boolean).slice(0, 800);
  if (!incoming.length) return Response.json({ ok: true, added: 0, total: 0 }, { headers: CORS });

  if (env.DB) {
    try {
      await ensureTable(env.DB);
      const stmt = env.DB.prepare(
        'INSERT OR IGNORE INTO news_items (email,id,title,link,source,syms,scope,label,senti,pub_ts,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
      );
      // D1 batch — one round trip, atomic enough for our purpose
      const res = await env.DB.batch(incoming.map(it => stmt.bind(
        email, it.id, it.title, it.link, it.source, JSON.stringify(it.syms),
        it.scope, it.label, it.senti, it.pubTs, it.fetchedAt
      )));
      const added = res.reduce((s, r) => s + (r.meta?.changes || 0), 0);
      // Prune: age + count cap
      const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
      await env.DB.prepare('DELETE FROM news_items WHERE email = ? AND pub_ts < ? AND fetched_at < ?')
        .bind(email, cutoff, cutoff).run();
      await env.DB.prepare(`DELETE FROM news_items WHERE email = ?1 AND id NOT IN (
        SELECT id FROM news_items WHERE email = ?1 ORDER BY pub_ts DESC LIMIT ?2)`)
        .bind(email, MAX_ITEMS).run();
      const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM news_items WHERE email = ?').bind(email).all();
      return Response.json({ ok: true, storage: 'd1', added, total: results?.[0]?.n ?? null }, { headers: CORS });
    } catch (e) { /* fall through to KV */ }
  }

  const existing = await kvLoad(env, email);
  const have = new Set(existing.map(it => it.id));
  const fresh = incoming.filter(it => !have.has(it.id));
  const merged = pruneList([...existing, ...fresh]);
  await kvSave(env, email, merged);
  return Response.json({ ok: true, storage: 'kv', added: fresh.length, total: merged.length }, { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
