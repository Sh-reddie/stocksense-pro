/**
 * StockSense Pro — /api/news
 *   Per-stock:    /api/news?sym=RELIANCE&exchange=NSE
 *   Market-wide:  /api/news?q=Indian%20stock%20market%20NSE%20BSE&label=Market
 * Server-side Google News RSS proxy — no CORS, no third-party dependency
 * (news.google.com is fetched directly from Cloudflare's edge; only a
 * browser needs a CORS workaround, a server doesn't).
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
  // CDATA titles first, then plain
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

// Full-fidelity parse (title + link + pubDate + source) for the market-wide feed —
// mirrors the client-side parseRSSItems() that used to run against allorigins.win.
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

// Google News RSS from Cloudflare's shared IP ranges gets intermittently
// rate-limited (503, or a hang until timeout) — not a hard block, since it
// does succeed on retry. Two attempts with a short gap clears most of these.
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
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error('moneycontrol http ' + r.status);
  const xml = await r.text();
  return parseRSSItems(xml, label || 'MoneyControl');
}

export async function onRequestGet({ request }) {
  const url   = new URL(request.url);
  const q     = (url.searchParams.get('q') || '').trim();
  const sym   = (url.searchParams.get('sym') || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  const exch  = (url.searchParams.get('exchange') || 'NSE').toUpperCase();
  const label = (url.searchParams.get('label') || '').trim();

  const CACHE = { ...CORS, 'Cache-Control': 'public, max-age=900, s-maxage=900' }; // 15 min edge cache

  // ── Market-wide mode: /api/news?q=...&label=... — returns full items (title/link/pubDate/source) ──
  if (q && !sym) {
    let debugInfo = null;
    try {
      const xml = await fetchRSS(q);
      const items = parseRSSItems(xml, label);
      if (items.length) {
        return new Response(
          JSON.stringify({ ok: true, q, items, source: 'google-news', fetchedAt: Date.now() }),
          { headers: { ...CACHE, 'Content-Type': 'application/json' } }
        );
      }
      debugInfo = { xmlLen: xml.length, xmlPreview: xml.slice(0, 300) };
    } catch (e) {
      debugInfo = { error: e.message };
    }

    // Google News is intermittently rate-limited from Cloudflare's IPs — fall
    // back to MoneyControl's general market RSS feed rather than showing nothing.
    try {
      const items = await fetchMoneyControlItems(label);
      if (items.length) {
        return new Response(
          JSON.stringify({ ok: true, q, items, source: 'moneycontrol', fetchedAt: Date.now() }),
          { headers: { ...CACHE, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) { debugInfo = debugInfo || { error: e.message }; }

    return new Response(
      JSON.stringify({ ok: true, q, items: [], source: 'none', fetchedAt: Date.now(), _debug: url.searchParams.get('debug') ? debugInfo : undefined }),
      { headers: { ...CACHE, 'Content-Type': 'application/json' } }
    );
  }

  // ── Per-stock mode (existing behaviour, unchanged shape) ──
  if (!sym) {
    return Response.json({ ok: false, error: 'sym or q param required' }, { status: 400, headers: CORS });
  }

  // Build two query variants — broader first for reliability
  const queries = [
    `${sym} ${exch === 'BSE' ? 'BSE' : 'NSE'} stock India`,
    `${sym} share price India`,
  ];

  for (const query of queries) {
    try {
      const xml = await fetchRSS(query);
      const titles = parseRSSTitles(xml);
      if (titles.length >= 2) {
        return new Response(
          JSON.stringify({ ok: true, sym, headlines: titles, source: 'google-news', fetchedAt: Date.now() }),
          { headers: { ...CACHE, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) { /* try next query */ }
  }

  // MoneyControl RSS fallback
  try {
    const mcUrl = `https://www.moneycontrol.com/rss/buzzingstocks.xml`;
    const r = await fetch(mcUrl, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const xml = await r.text();
      const allTitles = parseRSSTitles(xml);
      const symLower = sym.toLowerCase();
      const relevant = allTitles.filter(t => t.toLowerCase().includes(symLower));
      if (relevant.length) {
        return new Response(
          JSON.stringify({ ok: true, sym, headlines: relevant.slice(0, 5), source: 'moneycontrol', fetchedAt: Date.now() }),
          { headers: { ...CACHE, 'Content-Type': 'application/json' } }
        );
      }
    }
  } catch (e) {}

  // Empty response — caller falls back to AI knowledge mode
  return new Response(
    JSON.stringify({ ok: true, sym, headlines: [], source: 'none', fetchedAt: Date.now() }),
    { headers: { ...CACHE, 'Content-Type': 'application/json' } }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
