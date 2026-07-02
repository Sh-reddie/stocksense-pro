/**
 * StockSense Pro — /api/ipo   (v2, 2026-07-02)
 * Server-side IPO data — PRIMARY source: Chittorgarh's public JSON API
 * (webnodejs.chittorgarh.com), which powers chittorgarh.com's own reports:
 *
 *   report 82  — "IPOs Watch <year>": the full pipeline (upcoming / open /
 *                closed / listed) with dates, price band, category, exchange
 *   report 125 — "IPO Performance": listed IPOs with issue price, listing-day
 *                close (~ILDT_Close_Price), listing-day gain %, current market
 *                price, subscription
 *
 * Both verified live 2026-07-02 (123 + 120 records). Merged by IPO id
 * (~URLRewrite_Folder_Name). The old NSE (Akamai-gated) and Groww
 * (endpoint rotted) sources are kept only as a last-resort fallback.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function stripHtml(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim(); }
function toNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? null : n;
}
function fyOf(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
}

async function fetchChittorgarhReport(reportId, year) {
  const now = new Date();
  const url = `https://webnodejs.chittorgarh.com/cloud/report/data-read/${reportId}/1/${now.getMonth() + 1}/${year}/${fyOf(now)}/0/all/0?search=&v=12-15`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Referer': 'https://www.chittorgarh.com/',
      'Origin': 'https://www.chittorgarh.com',
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`chittorgarh ${reportId} http ${r.status}`);
  const j = await r.json();
  return Array.isArray(j?.reportTableData) ? j.reportTableData : [];
}

function parseTs(v) { const t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? null : t; }

function statusOf(openTs, closeTs, listTs, now) {
  if (listTs && listTs <= now) return 'Listed';
  if (openTs && openTs > now) return 'Upcoming';
  if (closeTs && closeTs < now) return 'Closed';   // closed, awaiting listing
  if (openTs && openTs <= now && (!closeTs || closeTs >= now)) return 'Open';
  return 'Upcoming';
}

async function tryChittorgarh(year) {
  const [pipeline, perf] = await Promise.all([
    fetchChittorgarhReport(82, year).catch(() => []),
    fetchChittorgarhReport(125, year).catch(() => []),
  ]);
  if (!pipeline.length && !perf.length) return null;

  const now = Date.now();
  const map = new Map();
  const keyOf = d => d['~URLRewrite_Folder_Name'] || stripHtml(d.Company).toLowerCase().replace(/[^a-z0-9]+/g, '-');

  pipeline.forEach(d => {
    const openTs = parseTs(d['~Issue_Open_Date']), closeTs = parseTs(d['~IssueCloseDate']), listTs = parseTs(d['~ListingDate']);
    map.set(keyOf(d), {
      id: keyOf(d),
      name: stripHtml(d.Company).replace(/\s*\(.*IPO\)\s*$/, '').replace(/\s+[A-Z]{1,2}$/, '').trim() || stripHtml(d['~IPO']),
      sym: (d['~nse_symbol'] || '').toUpperCase() || null,
      bseCode: d['~bse_script_code'] || null,
      isin: d['~isin'] || null,
      category: d['Issue Category'] || 'Mainboard',
      listingAt: d['Listing at'] || null,
      priceBand: String(d['Issue Price (Rs.)'] || '').trim() || null,
      issueAmtCr: toNum(d['Total Issue Amount (Incl.Firm reservations) (Rs.cr.)']),
      openDate: d['Opening Date'] || null, closeDate: d['Closing Date'] || null, listDate: d['Listing Date'] || null,
      openTs, closeTs, listTs,
      status: statusOf(openTs, closeTs, listTs, now),
      source: 'chittorgarh',
    });
  });

  perf.forEach(d => {
    const k = keyOf(d);
    const base = map.get(k) || {
      id: k,
      name: stripHtml(d.Company).replace(/\s*\(.*IPO\)\s*$/, '').replace(/\s+[A-Z]{1,2}$/, '').trim(),
      sym: (d['~nse_symbol'] || '').toUpperCase() || null,
      bseCode: d['~bse_script_code'] || null,
      isin: d['~isin'] || null,
      category: d['Issue Category'] || 'Mainboard',
      openDate: d['Opening Date'] || null, listDate: d['Listing Date'] || null,
      openTs: parseTs(d['~issue_open_date_plan']), listTs: parseTs(d['~IPO_listing_date']),
      status: 'Listed', source: 'chittorgarh',
    };
    base.issuePrice = toNum(d['Issue Price (Rs.)']) ?? base.issuePrice ?? null;
    base.listingClose = toNum(d['~ILDT_Close_Price']);
    base.listingGainPct = typeof d['~Change_In_Percentage_Listing_Day'] === 'number'
      ? d['~Change_In_Percentage_Listing_Day'] : toNum(d['~Change_In_Percentage_Listing_Day']);
    base.marketPrice = toNum(d['Market Price (Rs.)']);
    base.subscription = toNum(d['Subscription (x)']);
    base.issueAmtCr = base.issueAmtCr ?? toNum(d['Issue Amount (Rs.cr.)']);
    base.h52 = toNum(d['52 Week High']); base.l52 = toNum(d['52 Week Low']);
    if (!base.listDate && d['Listing Date']) base.listDate = d['Listing Date'];
    if (base.listTs && base.listTs <= now) base.status = 'Listed';
    map.set(k, base);
  });

  return [...map.values()];
}

/** Legacy fallback (rarely succeeds — NSE is Akamai-gated) */
async function tryNSE() {
  try {
    const home = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: AbortSignal.timeout(5000) });
    const cookies = (home.headers.get('set-cookie') || '').split(/,(?=[^ ])/).map(c => c.split(';')[0].trim()).join('; ');
    if (!cookies) return null;
    const r = await fetch('https://www.nseindia.com/api/ipo-current-allotment-detail', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo', 'Cookie': cookies },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data?.data || []);
    if (!arr.length) return null;
    const now = Date.now();
    return arr.slice(0, 30).map(d => {
      const openTs = parseTs(d.openDate || d.ipoOpenDate), closeTs = parseTs(d.closeDate || d.ipoCloseDate), listTs = parseTs(d.listingDate);
      return {
        id: ((d.symbol || d.companyName || '') + '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: d.companyName || d.name || '—',
        sym: (d.symbol || '').toUpperCase() || null,
        category: d.issueType || 'Mainboard',
        priceBand: d.issuePrice || null,
        openDate: d.openDate || null, closeDate: d.closeDate || null, listDate: d.listingDate || null,
        openTs, closeTs, listTs,
        status: statusOf(openTs, closeTs, listTs, now),
        subscription: toNum(d.totalSubscription || d.subscriptionTimes),
        source: 'nse',
      };
    });
  } catch (e) { return null; }
}

export async function onRequestGet() {
  const year = new Date().getFullYear();
  let ipos = await tryChittorgarh(year);

  // Around New Year the current-year report is nearly empty — pull last year too
  if (ipos && ipos.length < 15 && new Date().getMonth() < 2) {
    const prev = await tryChittorgarh(year - 1).catch(() => null);
    if (prev?.length) {
      const have = new Set(ipos.map(i => i.id));
      ipos = [...ipos, ...prev.filter(i => !have.has(i.id))];
    }
  }

  if (ipos?.length) {
    return new Response(JSON.stringify({ ok: true, ipos, source: 'chittorgarh', fetchedAt: Date.now() }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900, s-maxage=900' },
    });
  }

  const nse = await tryNSE();
  if (nse?.length) {
    return Response.json({ ok: true, ipos: nse, source: 'nse', fetchedAt: Date.now() }, { headers: CORS });
  }

  return Response.json({ ok: false, ipos: [], source: 'unavailable', fetchedAt: Date.now() }, { headers: { ...CORS, 'Cache-Control': 'no-store' } });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
