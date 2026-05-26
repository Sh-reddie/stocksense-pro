/**
 * StockSense Pro — Cloudflare Pages Function
 * GET /api/quote?symbols=RELIANCE.NS,TCS.NS
 * Server-side Yahoo Finance proxy — no CORS issues.
 * Strategy: tries v7/quote batch first, falls back to v8/chart per-symbol (parallel).
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

const FIELDS =
    'regularMarketPrice,regularMarketChange,regularMarketChangePercent,' +
    'regularMarketPreviousClose,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow,' +
    'shortName,longName,trailingPE,forwardPE,priceToBook,trailingEps,marketCap,' +
    'dividendYield,beta,returnOnEquity,debtToEquity,revenueGrowth,earningsGrowth,' +
    'currentRatio,recommendationKey';

/** Try v7/quote batch endpoint */
async function tryV7Batch(symbols) {
    for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
          try {
                  const r = await fetch(
                            `${host}/v7/finance/quote?symbols=${symbols}&fields=${FIELDS}`,
                    { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) }
                          );
                  if (r.ok) {
                            const data = await r.json();
                            if (data?.quoteResponse?.result?.length) return data.quoteResponse.result;
                  }
          } catch (e) { /* try next */ }
    }
    return null;
}

/** Fetch a single symbol via v8/chart and convert to quoteResponse shape */
async function fetchOneViaChart(sym) {
    for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
          try {
                  const r = await fetch(
                            `${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
                    { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) }
                          );
                  if (r.ok) {
                            const data = await r.json();
                            const meta = data?.chart?.result?.[0]?.meta;
                            if (meta?.regularMarketPrice) {
                                        return {
                                                      symbol: sym,
                                                      shortName: meta.shortName || meta.longName || sym,
                                                      longName: meta.longName || meta.shortName || sym,
                                                      regularMarketPrice: meta.regularMarketPrice,
                                                      regularMarketChange: meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice),
                                                      regularMarketChangePercent: meta.regularMarketChangePercent ||
                                                                      (meta.chartPreviousClose
                                                                                       ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
                                                                                       : 0),
                                                      regularMarketPreviousClose: meta.chartPreviousClose || meta.previousClose,
                                                      regularMarketVolume: meta.regularMarketVolume,
                                                      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
                                                      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
                                                      marketCap: meta.marketCap,
                                                      trailingPE: null, forwardPE: null, priceToBook: null,
                                                      trailingEps: null, dividendYield: null, beta: null,
                                                      returnOnEquity: null, debtToEquity: null, revenueGrowth: null,
                                                      earningsGrowth: null, currentRatio: null, recommendationKey: null,
                                        };
                            }
                  }
          } catch (e) { /* try next */ }
    }
    return null;
}

export async function onRequestGet({ request }) {
    const url = new URL(request.url);
    const symbols = url.searchParams.get('symbols') || '';
    if (!symbols) {
          return Response.json({ error: 'symbols param required' }, { status: 400, headers: CORS });
    }

  // Strategy 1: v7/quote batch (fastest, most data)
  const v7results = await tryV7Batch(symbols);
    if (v7results) {
          return new Response(
                  JSON.stringify({ quoteResponse: { result: v7results, error: null } }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
    }

  // Strategy 2: v8/chart per-symbol in parallel (always works)
  const symList = symbols.split(',').map(s => s.trim()).filter(Boolean);
    const results = await Promise.all(symList.map(fetchOneViaChart));
    const valid = results.filter(Boolean);

  if (valid.length) {
        return new Response(
                JSON.stringify({ quoteResponse: { result: valid, error: null } }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } }
              );
  }

  return Response.json(
    { quoteResponse: { result: [], error: 'No data from any source' } },
    { headers: CORS }
      );
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS });
}
