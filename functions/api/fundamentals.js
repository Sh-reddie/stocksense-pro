/**
 * StockSense Pro — Cloudflare Pages Function
 * GET /api/fundamentals?sym=HDFCBANK.NS
 * Server-side Yahoo Finance proxy with crumb-based authentication
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const YF_HEADERS = {
  'User-Agent': YF_UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

const MODULES = 'summaryDetail,defaultKeyStatistics,financialData,quoteType';

/** Extract fundamental fields from a v11 quoteSummary result object */
function extractFromV11(res, sym) {
  const sd = res.summaryDetail || {};
  const ks = res.defaultKeyStatistics || {};
  const fd = res.financialData || {};
  const qt = res.quoteType || {};
  return {
    ok: true, sym,
    pe:   sd.trailingPE?.raw   ?? null,
    fpe:  sd.forwardPE?.raw    ?? null,
    eps:  ks.trailingEps?.raw  ?? null,
    mcap: sd.marketCap?.raw    ?? null,
    dy:   sd.dividendYield?.raw != null ? sd.dividendYield.raw / 100 : null,
    beta: sd.beta?.raw         ?? null,
    pb:   ks.priceToBook?.raw  ?? null,
    roe:  fd.returnOnEquity?.raw ?? null,
    de:   fd.debtToEquity?.raw ?? null,
    rg:   fd.revenueGrowth?.raw ?? null,
    eg:   fd.earningsGrowth?.raw ?? null,
    cr:   fd.currentRatio?.raw ?? null,
    rcm:  fd.recommendationKey ?? null,
    name: qt.longName || qt.shortName || null,
  };
}

/** Fetch Yahoo Finance session crumb for authenticated requests */
async function getYFCrumb() {
  try {
    // Step 1: Hit Yahoo Finance consent page to get a session cookie
    const initResp = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    const rawCookie = initResp.headers.get('set-cookie') || '';
    // Extract cookie key=value pairs (strip Path, Expires, Domain, SameSite attributes)
    const cookies = rawCookie.split(/,(?=[^;]+=[^;])/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

    if (!cookies) return null;

    // Step 2: Get the crumb using the session cookie
    const crumbResp = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, 'Cookie': cookies, 'Referer': 'https://finance.yahoo.com/' },
      signal: AbortSignal.timeout(5000),
    });
    if (crumbResp.ok) {
      const crumb = await crumbResp.text();
      // Crumb is a short alphanumeric string (not HTML or JSON)
      if (crumb && crumb.length < 60 && !crumb.startsWith('<') && !crumb.startsWith('{')) {
        return { crumb: crumb.trim(), cookies };
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/** Try v11/quoteSummary with optional crumb auth */
async function tryV11(sym, session) {
  const crumbParam = session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const extraHeaders = session?.cookies ? { 'Cookie': session.cookies } : {};

  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(
        `${host}/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${MODULES}${crumbParam}`,
        { headers: { ...YF_HEADERS, ...extraHeaders }, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        const res = data?.quoteSummary?.result?.[0];
        if (res) {
          const result = extractFromV11(res, sym);
          if (result.pe || result.mcap || result.roe || result.pb || result.eps) return result;
        }
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

/** Try v7/quote batch with optional crumb auth */
async function tryV7(sym, session) {
  const fields = 'trailingPE,forwardPE,trailingEps,marketCap,dividendYield,beta,priceToBook,returnOnEquity,debtToEquity,revenueGrowth,earningsGrowth,currentRatio,recommendationKey,longName,shortName';
  const crumbParam = session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const extraHeaders = session?.cookies ? { 'Cookie': session.cookies } : {};

  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(
        `${host}/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=${fields}${crumbParam}`,
        { headers: { ...YF_HEADERS, ...extraHeaders }, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        const q = data?.quoteResponse?.result?.[0];
        if (q && (q.trailingPE || q.marketCap || q.returnOnEquity || q.priceToBook || q.trailingEps)) {
          return {
            ok: true, sym,
            pe: q.trailingPE ?? null, fpe: q.forwardPE ?? null,
            eps: q.trailingEps ?? null, mcap: q.marketCap ?? null,
            dy: q.dividendYield != null ? q.dividendYield / 100 : null, beta: q.beta ?? null,
            pb: q.priceToBook ?? null, roe: q.returnOnEquity ?? null,
            de: q.debtToEquity ?? null, rg: q.revenueGrowth ?? null,
            eg: q.earningsGrowth ?? null, cr: q.currentRatio ?? null,
            rcm: q.recommendationKey ?? null,
            name: q.longName || q.shortName || null,
          };
        }
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const sym = url.searchParams.get('sym') || '';

  if (!sym) {
    return Response.json({ error: 'sym param required' }, { status: 400, headers: CORS });
  }

  // Fundamentals rarely change intra-day — cache at the edge for 4 hours.
  // This dramatically reduces YF round-trips when multiple users or page
  // reloads request the same symbol.
  const FUND_HEADERS = { ...CORS, 'Cache-Control': 'public, max-age=14400, s-maxage=14400' };

  // Strategy 1: run crumb-fetch and unauthenticated v11 in parallel —
  // whichever wins is used. Crumb adds ~1s overhead; racing cuts worst-case latency.
  const [session, unauthResult] = await Promise.all([
    getYFCrumb(),
    tryV11(sym, null).catch(() => null),
  ]);

  // Prefer authenticated result if crumb worked; fall back to unauthenticated
  if (session) {
    const authResult = await tryV11(sym, session) || await tryV7(sym, session);
    if (authResult) return Response.json(authResult, { headers: FUND_HEADERS });
  }
  if (unauthResult) return Response.json(unauthResult, { headers: FUND_HEADERS });

  // Last resort: v7 without crumb
  const result = await tryV7(sym, null);
  if (result) return Response.json(result, { headers: FUND_HEADERS });

  return Response.json({ ok: false, error: 'No fundamental data available' }, { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
