/**
 * StockSense Pro — Cloudflare Pages Function
 * GET /api/fundamentals?sym=HDFCBANK.BO
 * Server-side Yahoo Finance v11 quoteSummary proxy — returns PE, PB, ROE, etc.
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

const MODULES = 'summaryDetail,defaultKeyStatistics,financialData,quoteType';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const sym = url.searchParams.get('sym') || '';

  if (!sym) {
    return Response.json({ error: 'sym param required' }, { status: 400, headers: CORS });
  }

  // Strategy 1: v11 quoteSummary (richest fundamental data)
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(
        `${host}/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${MODULES}`,
        { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        const res = data?.quoteSummary?.result?.[0];
        if (res) {
          const sd = res.summaryDetail || {};
          const ks = res.defaultKeyStatistics || {};
          const fd = res.financialData || {};
          const qt = res.quoteType || {};
          return Response.json({
            ok: true,
            sym,
            pe:     sd.trailingPE?.raw       ?? null,
            fpe:    sd.forwardPE?.raw         ?? null,
            eps:    ks.trailingEps?.raw       ?? null,
            mcap:   sd.marketCap?.raw         ?? null,
            dy:     sd.dividendYield?.raw     ?? null,
            beta:   sd.beta?.raw              ?? null,
            pb:     ks.priceToBook?.raw       ?? null,
            roe:    fd.returnOnEquity?.raw    ?? null,
            de:     fd.debtToEquity?.raw      ?? null,
            rg:     fd.revenueGrowth?.raw     ?? null,
            eg:     fd.earningsGrowth?.raw    ?? null,
            cr:     fd.currentRatio?.raw      ?? null,
            rcm:    fd.recommendationKey      ?? null,
            name:   qt.longName || qt.shortName || null,
          }, { headers: CORS });
        }
      }
    } catch (e) { /* try next host */ }
  }

  // Strategy 2: v7/quote batch — has many of the same fields
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const fields = 'trailingPE,forwardPE,trailingEps,marketCap,dividendYield,beta,priceToBook,returnOnEquity,debtToEquity,revenueGrowth,earningsGrowth,currentRatio,recommendationKey,longName,shortName';
      const r = await fetch(
        `${host}/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=${fields}`,
        { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        const q = data?.quoteResponse?.result?.[0];
        if (q) {
          return Response.json({
            ok: true,
            sym,
            pe:   q.trailingPE   ?? null,
            fpe:  q.forwardPE    ?? null,
            eps:  q.trailingEps  ?? null,
            mcap: q.marketCap    ?? null,
            dy:   q.dividendYield ?? null,
            beta: q.beta         ?? null,
            pb:   q.priceToBook  ?? null,
            roe:  q.returnOnEquity ?? null,
            de:   q.debtToEquity ?? null,
            rg:   q.revenueGrowth ?? null,
            eg:   q.earningsGrowth ?? null,
            cr:   q.currentRatio ?? null,
            rcm:  q.recommendationKey ?? null,
            name: q.longName || q.shortName || null,
          }, { headers: CORS });
        }
      }
    } catch (e) { /* try next host */ }
  }

  return Response.json({ ok: false, error: 'No fundamental data available' }, { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
