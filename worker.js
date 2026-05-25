/**
 * StockSense Pro — Cloudflare Worker
 *
 * Routes:
 *   GET  /api/data        — load portfolio from KV
 *   POST /api/data        — save portfolio to KV
 *   GET  /api/quote       — proxy Yahoo Finance v7 batch quote (no CORS issues)
 *   GET  /api/chart       — proxy Yahoo Finance v8 single-stock chart
 *   *                     — serve static assets (index.html etc.)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-SS-Token',
};

// Yahoo Finance headers — makes requests look like a real browser
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── API: portfolio storage ──────────────────────────────
    if (url.pathname === '/api/data') {
      return handleData(request, env);
    }

    // ── API: Yahoo Finance batch quote proxy ────────────────
    // GET /api/quote?symbols=RELIANCE.NS,TCS.NS,INFY.NS
    if (url.pathname === '/api/quote') {
      return proxyYFBatch(url, env);
    }

    // ── API: Yahoo Finance single-stock chart proxy ─────────
    // GET /api/chart?sym=RELIANCE.NS
    if (url.pathname === '/api/chart') {
      return proxyYFChart(url, env);
    }

    // ── Serve static assets (index.html etc.) ──────────────
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Deploy index.html as a Worker asset or via Cloudflare Pages.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

// ── /api/quote — batch price fetch via Yahoo Finance v7 ────────────────────
async function proxyYFBatch(url, env) {
  const symbols = url.searchParams.get('symbols') || '';
  if (!symbols) return json({ error: 'symbols param required' }, 400);

  const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,' +
    'regularMarketPreviousClose,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow,' +
    'shortName,longName,trailingPE,forwardPE,priceToBook,trailingEps,marketCap,' +
    'dividendYield,beta,returnOnEquity,debtToEquity,revenueGrowth,earningsGrowth,' +
    'currentRatio,recommendationKey';

  // Try query1 then query2
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(
        `${host}/v7/finance/quote?symbols=${symbols}&fields=${fields}`,
        { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        if (data?.quoteResponse?.result?.length) {
          return new Response(JSON.stringify(data), {
            headers: { ...CORS, 'Content-Type': 'application/json' },
          });
        }
      }
    } catch (e) { /* try next host */ }
  }

  return json({ quoteResponse: { result: [], error: null } });
}

// ── /api/chart — single stock v8/chart ─────────────────────────────────────
async function proxyYFChart(url, env) {
  const sym = url.searchParams.get('sym') || '';
  if (!sym) return json({ error: 'sym param required' }, 400);

  const range    = url.searchParams.get('range')    || '1d';
  const interval = url.searchParams.get('interval') || '1d';

  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
        { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
          return new Response(JSON.stringify(data), {
            headers: { ...CORS, 'Content-Type': 'application/json' },
          });
        }
      }
    } catch (e) { /* try next */ }
  }

  return json({ chart: { result: null, error: 'No data' } });
}

// ── /api/data — KV portfolio storage ───────────────────────────────────────
async function handleData(request, env) {
  const KV = env.STOCKSENSE_KV;
  if (!KV) return json({ ok: false, error: 'STOCKSENSE_KV not bound' }, 500);

  if (request.method === 'GET') {
    try {
      const raw = await KV.get('portfolio');
      return json({ ok: true, data: raw ? JSON.parse(raw) : null });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const incomingToken = request.headers.get('X-SS-Token') || body._token || '';

      const storedToken = await KV.get('ss_auth_token');
      if (storedToken && incomingToken !== storedToken) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
      }
      if (!storedToken && incomingToken) {
        await KV.put('ss_auth_token', incomingToken);
      }

      const { _token, ...data } = body;
      data._savedAt = new Date().toISOString();
      await KV.put('portfolio', JSON.stringify(data));
      return json({ ok: true, savedAt: data._savedAt });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
