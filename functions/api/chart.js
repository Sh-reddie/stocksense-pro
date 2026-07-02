/**
 * StockSense Pro — Cloudflare Pages Function
 * GET /api/chart?sym=RELIANCE.NS&range=1d&interval=1d
 * Server-side Yahoo Finance v8 chart proxy — no CORS issues.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const sym      = url.searchParams.get('sym') || '';
  const range    = url.searchParams.get('range')    || '1d';
  const interval = url.searchParams.get('interval') || '1d';
  // Optional Yahoo events passthrough (e.g. events=div for dividend history,
  // events=div%7Csplit for splits too) — used by the Corp Actions tab.
  const events   = (url.searchParams.get('events') || '').replace(/[^a-z|,]/gi, '');

  if (!sym) {
    return Response.json({ error: 'sym param required' }, { status: 400, headers: CORS });
  }

  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}${events ? '&events=' + encodeURIComponent(events) : ''}`,
        { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        if (data?.chart?.result?.[0]) {
          return new Response(JSON.stringify(data), {
            headers: {
              ...CORS,
              'Content-Type': 'application/json',
              // Cache at the edge for 60s — chart data doesn't change second-to-second
              // and this cuts redundant YF round-trips when multiple tabs are open.
              'Cache-Control': 'public, max-age=60, s-maxage=60',
            },
          });
        }
      }
    } catch (e) { /* try next host */ }
  }

  return Response.json(
    { chart: { result: null, error: 'No data' } },
    { headers: CORS }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
