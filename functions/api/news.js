/**
 * StockSense Pro — /api/news?sym=RELIANCE&exchange=NSE
 * Server-side Google News RSS proxy — no CORS, no third-party dependency.
 * Returns up to 8 recent headlines as a JSON array of strings.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
    .map(t => t
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    )
    .slice(0, 8);
}

export async function onRequestGet({ request }) {
  const url    = new URL(request.url);
  const sym    = (url.searchParams.get('sym') || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  const exch   = (url.searchParams.get('exchange') || 'NSE').toUpperCase();

  if (!sym) {
    return Response.json({ ok: false, error: 'sym param required' }, { status: 400, headers: CORS });
  }

  // Build two query variants — broader first for reliability
  const queries = [
    `${sym} ${exch === 'BSE' ? 'BSE' : 'NSE'} stock India`,
    `${sym} share price India`,
  ];

  const CACHE = { ...CORS, 'Cache-Control': 'public, max-age=900, s-maxage=900' }; // 15 min edge cache

  for (const q of queries) {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
    try {
      const r = await fetch(rssUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (r.ok) {
        const xml = await r.text();
        const titles = parseRSSTitles(xml);
        if (titles.length >= 2) {
          return new Response(
            JSON.stringify({ ok: true, sym, headlines: titles, source: 'google-news' }),
            { headers: { ...CACHE, 'Content-Type': 'application/json' } }
          );
        }
      }
    } catch(e) { /* try next query */ }
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
          JSON.stringify({ ok: true, sym, headlines: relevant.slice(0, 5), source: 'moneycontrol' }),
          { headers: { ...CACHE, 'Content-Type': 'application/json' } }
        );
      }
    }
  } catch(e) {}

  // Empty response — caller falls back to AI knowledge mode
  return new Response(
    JSON.stringify({ ok: true, sym, headlines: [], source: 'none' }),
    { headers: { ...CACHE, 'Content-Type': 'application/json' } }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
