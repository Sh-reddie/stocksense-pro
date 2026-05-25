/**
 * StockSense Pro — Cloudflare Pages Function
 * GET /api/quote?symbols=RELIANCE.NS,TCS.NS
 * Server-side Yahoo Finance v7 batch quote proxy — no CORS issues.
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

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbols = url.searchParams.get('symbols') || '';
  if (!symbols) {
    return Response.json({ error: 'symbols param required' }, { status: 400, headers: CORS });
  }

  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(
        `${host}/v7/finance/quote?symbols=${symbols}&fields=${FIELDS}`,
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

  return Response.json(
    { quoteResponse: { result: [], error: null } },
    { headers: CORS }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
