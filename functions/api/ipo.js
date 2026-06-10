/**
 * StockSense Pro — Cloudflare Pages Function
 * GET /api/ipo
 * Server-side IPO data proxy — tries NSE (with session handshake) → Groww → seed.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function normaliseNSE(d) {
  const listDate = d.listingDate || d.listDate || d.listing_date || null;
  const now = new Date();
  let status = 'Open';
  if (listDate && new Date(listDate) < now) status = 'Listed';
  else {
    const close = new Date(d.closeDate || d.ipoCloseDate || '');
    const open  = new Date(d.openDate  || d.ipoOpenDate  || '');
    if (!isNaN(close) && close < now) status = 'Closed';
    else if (!isNaN(open) && open > now) status = 'Upcoming';
  }
  return {
    name:  d.companyName || d.name || d.issuerName || '—',
    sym:   (d.symbol || (d.companyName || '').split(' ')[0] || '—').toUpperCase(),
    openDate:  d.openDate  || d.ipoOpenDate  || '—',
    closeDate: d.closeDate || d.ipoCloseDate || '—',
    price: d.issuePrice || d.price || d.priceRange || '—',
    lotSize: d.lotSize || d.lot_size || '—',
    status,
    listDate: listDate || '—',
    subscription: d.totalSubscription || d.subscriptionTimes || null,
    category: d.issueType || 'Mainboard',
    source: 'NSE',
  };
}

function normaliseGroww(d) {
  const now = new Date();
  const close = new Date(d.closingDate || d.closeDate || '');
  const open  = new Date(d.openingDate || d.openDate  || '');
  const listing = new Date(d.listingDate || '');
  let status = 'Open';
  if (!isNaN(listing) && listing < now) status = 'Listed';
  else if (!isNaN(close) && close < now) status = 'Closed';
  else if (!isNaN(open) && open > now) status = 'Upcoming';
  return {
    name:  d.ipoName || d.companyName || d.name || '—',
    sym:   (d.scripCode || d.symbol || (d.ipoName || '').split(' ')[0] || '—').toUpperCase(),
    openDate:  d.openingDate || d.openDate  || '—',
    closeDate: d.closingDate || d.closeDate || '—',
    price: d.issuePrice || d.minPrice || '—',
    lotSize: d.lotSize || '—',
    status,
    listDate: d.listingDate || '—',
    subscription: d.subscriptionTimes || d.totalSubscription || null,
    category: d.issueType || 'Mainboard',
    source: 'Groww',
  };
}

/** Step 1: Get NSE session cookie by hitting the homepage */
async function getNSECookies() {
  try {
    const r = await fetch('https://www.nseindia.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(5000),
    });
    const cookies = r.headers.get('set-cookie') || '';
    return cookies.split(/,(?=[^ ])/).map(c => c.split(';')[0].trim()).join('; ');
  } catch(e) { return ''; }
}

/** Try NSE API with session cookies */
async function tryNSE() {
  const cookies = await getNSECookies();
  if (!cookies) return null;

  const endpoints = [
    'https://www.nseindia.com/api/ipo-current-allotment-detail',
    'https://www.nseindia.com/api/ipo',
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
          'Cookie': cookies,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const arr = Array.isArray(data) ? data : (data?.data || data?.result || []);
      if (arr.length) return arr.slice(0, 30).map(normaliseNSE);
    } catch(e) { /* next */ }
  }
  return null;
}

/** Try Groww IPO API */
async function tryGroww() {
  const endpoints = [
    'https://groww.in/v1/api/ipo/v1/ipos?page=0&size=20&sortBy=openDate&sortOrder=DESC',
    'https://groww.in/v1/api/ipo/v1/ipos/active',
    'https://groww.in/api/v3/ipos/live-ipos',
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://groww.in/ipo' },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const arr = Array.isArray(data) ? data
                : (data?.data?.content || data?.data || data?.ipos || data?.content || []);
      if (arr.length) return arr.slice(0, 20).map(normaliseGroww);
    } catch(e) { /* next */ }
  }
  return null;
}

export async function onRequestGet() {
  // Try NSE with session handshake
  const nseData = await tryNSE();
  if (nseData?.length) {
    return Response.json({ ok: true, ipos: nseData, source: 'nse' }, { headers: CORS });
  }

  // Try Groww
  const growwData = await tryGroww();
  if (growwData?.length) {
    return Response.json({ ok: true, ipos: growwData, source: 'groww' }, { headers: CORS });
  }

  // All sources unavailable
  return Response.json({ ok: false, ipos: [], source: 'unavailable' }, { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
