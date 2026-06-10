#!/usr/bin/env node
/**
 * StockSense Price Sync — GitHub Actions cron script
 * Runs every 15 min during IST market hours (Mon-Fri).
 * Fetches live prices from Yahoo Finance → stores in Cloudflare KV.
 *
 * Required env vars (add as GitHub Secrets):
 *   CF_ACCOUNT_ID       — Cloudflare account ID
 *   CF_API_TOKEN        — CF API token with KV:Edit permission
 *   CF_KV_NAMESPACE_ID  — STOCKSENSE_KV namespace ID
 */

'use strict';
const https = require('https');

const CF_ACCOUNT_ID      = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN       = process.env.CF_API_TOKEN;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE_ID) {
  console.error('[price-sync] ❌ Missing env vars: CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_NAMESPACE_ID');
  process.exit(1);
}

// ── Top NSE stocks to track (NIFTY 500 core) ─────────────────────────────────
// These cover >95% of market cap and are the most-viewed stocks in the app
const NSE_STOCKS = [
  // NIFTY 50
  'RELIANCE','TCS','HDFCBANK','BHARTIARTL','ICICIBANK','SBIN','INFY','LICI',
  'HINDUNILVR','ITC','LT','KOTAKBANK','BAJFINANCE','HCLTECH','SUNPHARMA',
  'NTPC','ONGC','ULTRACEMCO','MARUTI','WIPRO','BAJAJFINSV','TITAN','POWERGRID',
  'ADANIENT','COALINDIA','ASIANPAINT','NESTLEIND','INDUSINDBK','AXISBANK',
  'ADANIPORTS','JSWSTEEL','HINDALCO','GRASIM','TECHM','TATAMOTORS','DRREDDY',
  'CIPLA','DIVISLAB','APOLLOHOSP','EICHERMOT','TATACONSUM','SBILIFE','HDFCLIFE',
  'ICICIPRULI','BAJAJ-AUTO','BRITANNIA','HEROMOTOCO','M&M','TATASTEEL','BPCL',
  // NIFTY Next 50
  'ADANIGREEN','ADANITRANS','SIEMENS','ABB','PIDILITIND','HAVELLS','BERGEPAINT',
  'MARICO','GODREJCP','COLPAL','DABUR','EMAMILTD','MUTHOOTFIN','CHOLAFIN',
  'BAJAJHLDNG','BOSCHLTD','TORNTPHARM','AUROPHARMA','LUPIN','BIOCON','DMART',
  'TRENT','IRCTC','INDIGO','JUBLFOOD','MCDOWELL-N','UNITDSPR','SHREECEM',
  'AMBUJACEM','ACCLTD','SAIL','NMDC','NATIONALUM','HINDZINC','VEDL','JINDALSTEL',
  'JSWENERGY','TATAPOWER','RECLTD','PFC','IRFC','RVNL','CONCOR','TIINDIA',
  'VOLTAS','BLUEDART','DELHIVERY','NAUKRI','AFFLE','PERSISTENT','MPHASIS',
  // IT & Tech
  'LTIM','COFORGE','TATAELXSI','KPITTECH','CYIENT','ZENSAR','OFSS','NEWGEN',
  'NETWEB','KAYNES','DIXON','AMBER','HAPPSTMNDS','RATEGAIN','MASTEK','INTELLECT',
  // Banks & Finance
  'BANKBARODA','CANARABANK','UNIONBANK','INDIANB','PNB','FEDERALBNK','IDFCFIRSTB',
  'YESBANK','RBLBANK','DCBBANK','UJJIVANSFB','KTKBANK','MANAPPURAM','IIFL',
  'CHOLAFIN','BAJAJHLDNG','MUTHOOTFIN','CANFINHOME','AAVAS','REPCO','HOMEFIRST',
  'ANGELONE','MOTILALOFS','SBICARDS','ICICIGI','STARHEALTH','GICRE','NIACL',
  // Pharma
  'ZYDUSLIFE','ALKEM','NATCOPHARM','IPCA','AJANTPHARMA','GRANULES','LAURUSLABS',
  'GLAXO','PFIZER','ASTRAZEN','SANOFI','ABBOT','TORNTPHARM','SUNPHARMA',
  // Auto & Ancillaries
  'ESCORTS','FORCEMOT','MOTHERSUMI','ENDURANCE','MINDARIND','SUBROS','SUPRAJIT',
  'EXIDEIND','SUNDRMFAST','TIMKEN','SCHAEFFLER','SKF','CRAFTSMAN',
  // Cement & Infra
  'RAMCOCEM','JKCEMENT','DALBHARAT','HEIDELBERG','KNRCON','PNCINFRA','NBCC',
  'NCC','RVNL','IRCON','RAILTEL','TITAGARH','GPPL',
  // Energy & Power
  'CESC','TORNTPOWER','NLCLINDIA','NHPC','SJVN','GIPCL','ADANIPOWER',
  // FMCG & Consumer
  'RADICO','BALRAMCHIN','MCDOWELL-N','UNITDSPR','TRIVENI','VBL','BIKAJI',
  'VENKEYS','WESTLIFE','DEVYANI','SAPPHIREFDS','SULA',
  // Real Estate
  'DLF','LODHA','GODREJPROP','PRESTIGE','BRIGADE','SOBHA','PHOENIXLTD',
  'OBEROIRLTY','SUNTECK','KOLTEPATIL','MAHINDCIE',
  // Telecom & Media
  'TATACOMM','HFCL','ROUTE','TEJASNET','VINDHYATEL','BHARTIHEXA',
  // Chemicals
  'DEEPAKNITRITE','AARTI','PIIND','SUMCHEM','FINEORG','SFL','GALAXYSURF',
  'TATACHEM','CHAMBALFERT','COROMANDEL','GNFC','NOCIL','BASF',
  // Agri & Fertilisers
  'KSCL','KAVERI','JKAGRI','ZUARI','CHAMBAL','GSFC','RCF','FACT','SPIC',
  // Capital Goods
  'BHEL','HAL','BEL','BEML','COCHINSHIP','GRSE','MAZAGON','GARFIBRES',
  'CUMMINSIND','THERMAX','RAMKRISHNA','RATNAMANI','APL','JINDALSAW','WELCORP',
  // Retail & Lifestyle
  'TRENT','V2RETAIL','SHOPERSTOP','BATAINDIA','VMART','MANYAVAR','METRO',
  // Jewellery & Gems
  'KALYANKJIL','SENCO','GOLDIAM','PC','RAJESHEXPO',
  // Misc Large Caps
  'GMRINFRA','ADANIGAS','ADANIWILMAR','NYKAA','ZOMATO','PAYTM','POLICYBZR',
  'HDFCSEC','PAISABAZAAR','CRISIL','ICRA','CARERATINGS',
  // PSU Banks / Insurance
  'LICI','UIICL','NIACL','GICRE','ICICIPRULI','HDFCLIFE','SBILIFE','MAXHEALTH',
];

// BSE-only stocks (not on NSE)
const BSE_STOCKS = [
  'TATASTEELLP','TATAMETALI','BIRLATYRE','PRISM','BHAGCHEM','ZYDUSWELL',
  'SARLAFIBER','NAVNETEDUL','SUNTV','GCPL','VGUCL','MFSL','PDSL',
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
      },
      timeout: 12000,
    };
    const req = https.get(url, options, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`JSON parse error (HTTP ${res.statusCode}): ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function fetchBatch(symbols) {
  const q = encodeURIComponent(symbols.join(','));
  const fields = 'regularMarketPrice,regularMarketChangePercent';
  for (const host of ['query1', 'query2']) {
    const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${q}&fields=${fields}&formatted=false`;
    try {
      const data = await httpsGet(url);
      return data?.quoteResponse?.result || [];
    } catch(e) {
      console.warn(`[price-sync] ${host} batch failed (${symbols[0]}...): ${e.message}`);
    }
  }
  return [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Cloudflare KV write ───────────────────────────────────────────────────────

function writeToKV(key, value) {
  const body = JSON.stringify(value);
  const url  = new URL(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'PUT',
      headers: {
        'Authorization':  `Bearer ${CF_API_TOKEN}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success) resolve(parsed);
          else reject(new Error('KV write failed: ' + JSON.stringify(parsed.errors)));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('KV write timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTs = Date.now();
  console.log(`[price-sync] ▶ Starting at ${new Date(startTs).toISOString()}`);

  // Deduplicate and build YF symbols
  const nseSyms = [...new Set(NSE_STOCKS)].map(s => s + '.NS');
  const bseSyms = [...new Set(BSE_STOCKS)].map(s => s + '.BO');
  const allSyms = [...nseSyms, ...bseSyms];

  console.log(`[price-sync] Querying ${allSyms.length} symbols in batches of 50…`);

  const BATCH    = 50;
  const prices   = {};
  let   fetched  = 0;
  let   batches  = 0;

  for (let i = 0; i < allSyms.length; i += BATCH) {
    const batch  = allSyms.slice(i, i + BATCH);
    const quotes = await fetchBatch(batch);
    batches++;

    quotes.forEach(q => {
      const sym  = q.symbol || '';
      const isNS = sym.endsWith('.NS');
      const isBO = sym.endsWith('.BO');
      if (!isNS && !isBO) return;
      const base = sym.replace(/\.(NS|BO)$/, '');
      const xch  = isNS ? 'NSE' : 'BSE';
      const ltp  = q.regularMarketPrice || 0;
      const chgP = q.regularMarketChangePercent || 0;
      if (ltp) { prices[`${base}|${xch}`] = { ltp, chgP }; fetched++; }
    });

    // Polite delay between batches
    if (i + BATCH < allSyms.length) await sleep(250);
  }

  const elapsed = Date.now() - startTs;
  console.log(`[price-sync] Fetched ${fetched} prices across ${batches} batches in ${elapsed}ms`);

  if (!fetched) {
    console.warn('[price-sync] ⚠ No prices fetched — skipping KV write');
    return;
  }

  const payload = { ts: Date.now(), prices };
  await writeToKV('priceCache', payload);
  console.log(`[price-sync] ✅ Written ${fetched} prices to Cloudflare KV`);
}

main().catch(e => {
  console.error('[price-sync] ❌ Fatal:', e.message);
  process.exit(1);
});
