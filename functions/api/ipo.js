/**
 * StockSense Pro — Cloudflare Pages Function
 * GET /api/ipo
 * Server-side NSE IPO proxy — no CORS issues, proper browser headers.
 * Tries NSE current IPO endpoint → falls back to NSE all-IPO list → seed data.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
  'Origin': 'https://www.nseindia.com',
  'Cache-Control': 'no-cache',
};

const NSE_ENDPOINTS = [
  'https://www.nseindia.com/api/ipo-current-allotment-detail',
  'https://www.nseindia.com/api/ipo',
  'https://www.nseindia.com/api/ipo-allotment-status',
];

function normalise(d) {
  const listDate = d.listingDate || d.listDate || d.listing_date || null;
  const now = new Date();
  let status = 'Open';
  if (listDate && new Date(listDate) < now) status = 'Listed';
  else if (d.closeDate || d.ipoCloseDate) {
    const close = new Date(d.closeDate || d.ipoCloseDate);
    if (!isNaN(close) && close < now) status = 'Closed';
    else if (!isNaN(close) && close > now) {
      const open = new Date(d.openDate || d.ipoOpenDate || now);
      status = open > now ? 'Upcoming' : 'Open';
    }
  }
  return {
    name:         d.companyName || d.name || d.issuerName || '—',
    sym:          (d.symbol || d.scripCode || (d.companyName || '').split(' ')[0] || '—').toUpperCase(),
    openDate:     d.openDate  || d.ipoOpenDate  || d.open_date  || '—',
    closeDate:    d.closeDate || d.ipoCloseDate || d.close_date || '—',
    price:        d.issuePrice || d.price || d.priceRange || '—',
    lotSize:      d.lotSize || d.lot_size || '—',
    gmp:          d.gmp || null,
    status,
    listDate:     listDate || '—',
    subscription: d.totalSubscription || d.subscriptionTimes || d.subscription || null,
    category:     d.issueType || d.category || 'Mainboard',
    source:       'Live',
  };
}

export async function onRequestGet() {
  // Try each NSE endpoint
  for (const url of NSE_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        headers: NSE_HEADERS,
        signal: AbortSignal.timeout(6000),
        cf: { cacheTtl: 300, cacheEverything: true }, // edge-cache 5 min
      });
      if (!r.ok) continue;
      const data = await r.json();
      const arr = Array.isArray(data) ? data
                : (data?.data || data?.result || data?.ipoList || []);
      if (!arr.length) continue;
      const ipos = arr.slice(0, 30).map(normalise);
      return Response.json({ ok: true, ipos, source: 'nse-live' }, { headers: CORS });
    } catch (e) { /* try next */ }
  }

  // All live endpoints failed — return empty so client uses manual/seed data
  return Response.json({ ok: false, ipos: [], source: 'unavailable' }, { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
