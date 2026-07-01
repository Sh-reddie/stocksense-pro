/**
 * StockSense Pro — /api/news
 *   Per-stock:    /api/news?sym=RELIANCE&exchange=NSE
 *   Market-wide:  /api/news?q=Indian%20stock%20market%20NSE%20BSE&label=Market
 * Server-side Google News RSS proxy — no CORS, no third-party dependency
 * (news.google.com is fetched directly from Cloudflare's edge; only a
 * browser needs a CORS workaround, a server doesn't).
 *
 * Google intermittently rate-limits requests from Cloudflare's shared IP
 * ranges (confirmed: returns its "unusual traffic" block page). It isn't a
 * hard block — retries usually get through — but a burst of ~20 requests
 * (one per portfolio holding) can occasionally all land in a blocked window
 * at once. To keep "My Portfolio" news from going blank when that happens,
 * every successful fetch is cached in KV per-symbol; if a live fetch fails,
 * the last known-good cached result is served instead (clearly marked
 * stale, with an age) rather than an empty "no headlines" state.
 *
 * Tried and abandoned as fallbacks:
 *  - Yahoo Finance /v1/finance/search: reachable from Cloudflare (Google
 *    isn't), but its `news` array turned out to be generic trending finance
 *    content that ignores the search query entirely — confirmed with and
 *    without a proper session crumb, searching "SUZLON" both times returned
 *    identical unrelated headlines (Meta, Stryker, a school district). Not
 *    usable for symbol-specific news.
 *  - MoneyControl RSS: usually redirects to a login-consent page instead of
 *    serving the feed to non-browser requests. Kept as a cheap last-resort
 *    attempt since it's low-cost, but rarely succeeds.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseRSSTitles(xml) {
  if (!xml || !xml.includes('<item>')) return [];
  let titles = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/gs)]
    .slice(1, 10)
    .map(m => m[1].trim());
  if (!titles.length) {
    titles = [...xml.matchAll(/<title>(.*?)<\/title>/gs)]
      .slice(1, 10)
      .map(m => m[1].replace(/<[^>]+>/g, '').trim());
  }
  return titles
    .filter(t => t.length > 8)
    .map(decodeEntities)
    .slice(0, 8);
}

// Full-fidelity parse (title + link + pubDate + source) for the market-wide feed.
function parseRSSItems(xml, fallbackLabel) {
  if (!xml || !xml.includes('<item>')) return [];
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  blocks.slice(0, 15).forEach(block => {
    const getTag = (tag, fallback = '') => {
      const m = block.match(new RegExp(`<${tag}(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`)) ||
                block.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : fallback;
    };
    const title = decodeEntities(getTag('title'));
    const link = getTag('link') || getTag('guid');
    const pubDate = getTag('pubDate');
    const source = decodeEntities(getTag('source', fallbackLabel || ''));
    if (!title || title.length < 10) return;
    items.push({ title, link, pubDate, source });
  });
  return items;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function fetchRSS(query, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
      const r = await fetch(rssUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) throw new Error('rss http ' + r.status);
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(400);
    }
  }
  throw lastErr;
}

async function fetchMoneyControlItems(label) {
  const r = await fetch('https://www.moneycontrol.com/rss/buzzingstocks.xml', {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error('moneycontrol http ' + r.status);
  const xml = await r.text();
  return parseRSSItems(xml, label || 'MoneyControl');
}

// ── KV-backed "last known good" cache ──────────────────────────────────────
async function kvGetGood(env, key) {
  if (!env.STOCKSENSE_KV) return null;
  try {
    const raw = await env.STOCKSENSE_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
async function kvPutGood(env, key, payload) {
  if (!env.STOCKSENSE_KV) return;
  try { await env.STOCKSENSE_KV.put(key, JSON.stringify({ ...payload, ts: Date.now() }), { expirationTtl: 30 * 24 * 3600 }); }
  catch (e) {}
}

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url);
  const q     = (url.searchParams.get('q') || '').trim();
  const sym   = (url.searchParams.get('sym') || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  const exch  = (url.searchParams.get('exchange') || 'NSE').toUpperCase();
  const label = (url.searchParams.get('label') || '').trim();

  const CACHE_OK   = { ...CORS, 'Cache-Control': 'public, max-age=900, s-maxage=900' };       // 15 min — only for genuine hits
  const CACHE_MISS = { ...CORS, 'Cache-Control': 'no-store' };                                 // never cache a failure — so the next request gets a fresh attempt, not a baked-in "no news" for 15 min

  // ── Market-wide mode ──
  if (q && !sym) {
    const kvKey = 'newsKV:q:' + q.toLowerCase();
    try {
      const xml = await fetchRSS(q);
      const items = parseRSSItems(xml, label);
      if (items.length) {
        await kvPutGood(env, kvKey, { items, source: 'google-news' });
        return new Response(JSON.stringify({ ok: true, q, items, source: 'google-news', fetchedAt: Date.now() }), { headers: { ...CACHE_OK, 'Content-Type': 'application/json' } });
      }
    } catch (e) {}

    try {
      const items = await fetchMoneyControlItems(label);
      if (items.length) {
        await kvPutGood(env, kvKey, { items, source: 'moneycontrol' });
        return new Response(JSON.stringify({ ok: true, q, items, source: 'moneycontrol', fetchedAt: Date.now() }), { headers: { ...CACHE_OK, 'Content-Type': 'application/json' } });
      }
    } catch (e) {}

    // Both live sources failed — serve the last known-good result if we have one.
    const good = await kvGetGood(env, kvKey);
    if (good?.items?.length) {
      return new Response(JSON.stringify({ ok: true, q, items: good.items, source: good.source + '-stale', staleSinceMs: Date.now() - good.ts, fetchedAt: good.ts }), { headers: { ...CACHE_MISS, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, q, items: [], source: 'none', fetchedAt: Date.now() }), { headers: { ...CACHE_MISS, 'Content-Type': 'application/json' } });
  }

  // ── Per-stock mode ──
  if (!sym) {
    return Response.json({ ok: false, error: 'sym or q param required' }, { status: 400, headers: CORS });
  }

  const kvKey = 'newsKV:sym:' + sym;
  const queries = [
    `${sym} ${exch === 'BSE' ? 'BSE' : 'NSE'} stock India`,
    `${sym} share price India`,
  ];

  for (const query of queries) {
    try {
      const xml = await fetchRSS(query, 1); // 1 attempt per variant — the 2nd variant is itself a retry angle
      const titles = parseRSSTitles(xml);
      if (titles.length >= 2) {
        await kvPutGood(env, kvKey, { headlines: titles, source: 'google-news' });
        return new Response(JSON.stringify({ ok: true, sym, headlines: titles, source: 'google-news', fetchedAt: Date.now() }), { headers: { ...CACHE_OK, 'Content-Type': 'application/json' } });
      }
    } catch (e) {}
  }

  // MoneyControl fallback (cheap; usually gated behind login-consent, rarely works, but worth a shot)
  try {
    const r = await fetch('https://www.moneycontrol.com/rss/buzzingstocks.xml', { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const xml = await r.text();
      const allTitles = parseRSSTitles(xml);
      const symLower = sym.toLowerCase();
      const relevant = allTitles.filter(t => t.toLowerCase().includes(symLower));
      if (relevant.length) {
        await kvPutGood(env, kvKey, { headlines: relevant.slice(0, 5), source: 'moneycontrol' });
        return new Response(JSON.stringify({ ok: true, sym, headlines: relevant.slice(0, 5), source: 'moneycontrol', fetchedAt: Date.now() }), { headers: { ...CACHE_OK, 'Content-Type': 'application/json' } });
      }
    }
  } catch (e) {}

  // Everything live failed — serve the last known-good cached result if we have one,
  // clearly marked as stale, rather than an empty "no headlines" dead end.
  const good = await kvGetGood(env, kvKey);
  if (good?.headlines?.length) {
    return new Response(JSON.stringify({ ok: true, sym, headlines: good.headlines, source: good.source + '-stale', staleSinceMs: Date.now() - good.ts, fetchedAt: good.ts }), { headers: { ...CACHE_MISS, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true, sym, headlines: [], source: 'none', fetchedAt: Date.now() }), { headers: { ...CACHE_MISS, 'Content-Type': 'application/json' } });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
