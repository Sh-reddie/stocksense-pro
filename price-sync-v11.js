// ── StockSense Price Sync Worker v11 ──────────────────────────────────────────
// New in v11: AI Chat Agent — natural language queries, portfolio advisor, action execution,
//             conversational memory (24h), /ask /analyze /recommend /reset commands
// New in v10: /news uses Yahoo Finance API; /watchlist limited+escaped
// New in v9: /notes /earnings /news /ipo /watchlist /sell /sector + inline keyboard buttons
// ─────────────────────────────────────────────────────────────────────────────

const NSE_STOCKS=['RELIANCE','TCS','HDFCBANK','BHARTIARTL','ICICIBANK','SBIN','INFY','LICI','HINDUNILVR','ITC','LT','KOTAKBANK','BAJFINANCE','HCLTECH','SUNPHARMA','NTPC','ONGC','ULTRACEMCO','MARUTI','WIPRO','BAJAJFINSV','TITAN','POWERGRID','ADANIENT','COALINDIA','ASIANPAINT','NESTLEIND','INDUSINDBK','AXISBANK','ADANIPORTS','JSWSTEEL','HINDALCO','GRASIM','TECHM','TATAMOTORS','DRREDDY','CIPLA','DIVISLAB','APOLLOHOSP','EICHERMOT','TATACONSUM','SBILIFE','HDFCLIFE','ICICIPRULI','BAJAJ-AUTO','BRITANNIA','HEROMOTOCO','M&M','TATASTEEL','BPCL','ADANIGREEN','ADANITRANS','SIEMENS','ABB','PIDILITIND','HAVELLS','BERGEPAINT','MARICO','GODREJCP','COLPAL','DABUR','EMAMILTD','MUTHOOTFIN','CHOLAFIN','BAJAJHLDNG','BOSCHLTD','TORNTPHARM','AUROPHARMA','LUPIN','BIOCON','DMART','TRENT','IRCTC','INDIGO','JUBLFOOD','MCDOWELL-N','UNITDSPR','SHREECEM','AMBUJACEM','ACCLTD','SAIL','NMDC','NATIONALUM','HINDZINC','VEDL','JINDALSTEL','JSWENERGY','TATAPOWER','RECLTD','PFC','IRFC','RVNL','CONCOR','TIINDIA','VOLTAS','BLUEDART','DELHIVERY','NAUKRI','AFFLE','PERSISTENT','MPHASIS','LTIM','COFORGE','TATAELXSI','KPITTECH','CYIENT','ZENSAR','OFSS','NEWGEN','NETWEB','KAYNES','DIXON','AMBER','HAPPSTMNDS','RATEGAIN','MASTEK','INTELLECT','BANKBARODA','CANARABANK','UNIONBANK','INDIANB','PNB','FEDERALBNK','IDFCFIRSTB','YESBANK','RBLBANK','DCBBANK','UJJIVANSFB','KTKBANK','MANAPPURAM','IIFL','CANFINHOME','AAVAS','REPCO','HOMEFIRST','ANGELONE','MOTILALOFS','SBICARDS','ICICIGI','STARHEALTH','GICRE','NIACL','ZYDUSLIFE','ALKEM','NATCOPHARM','IPCA','AJANTPHARMA','GRANULES','LAURUSLABS','GLAXO','PFIZER','ASTRAZEN','SANOFI','ABBOT','ESCORTS','FORCEMOT','ENDURANCE','EXIDEIND','SUNDRMFAST','TIMKEN','SCHAEFFLER','SKF','CRAFTSMAN','RAMCOCEM','JKCEMENT','DALBHARAT','KNRCON','PNCINFRA','NBCC','NCC','IRCON','RAILTEL','TITAGARH','GPPL','CESC','TORNTPOWER','NLCLINDIA','NHPC','SJVN','GIPCL','ADANIPOWER','RADICO','BALRAMCHIN','TRIVENI','VBL','BIKAJI','VENKEYS','WESTLIFE','DEVYANI','SULA','DLF','LODHA','GODREJPROP','PRESTIGE','BRIGADE','SOBHA','PHOENIXLTD','OBEROIRLTY','SUNTECK','KOLTEPATIL','TATACOMM','HFCL','ROUTE','TEJASNET','DEEPAKNITRITE','AARTI','PIIND','SUMCHEM','FINEORG','GALAXYSURF','TATACHEM','CHAMBALFERT','COROMANDEL','GNFC','NOCIL','BHEL','HAL','BEL','BEML','COCHINSHIP','GRSE','MAZAGON','CUMMINSIND','THERMAX','RAMKRISHNA','RATNAMANI','WELCORP','V2RETAIL','SHOPERSTOP','BATAINDIA','VMART','MANYAVAR','METRO','KALYANKJIL','SENCO','RAJESHEXPO','GMRINFRA','ADANIGAS','NYKAA','ZOMATO','PAYTM','POLICYBZR','HDFCSEC','CRISIL','ICRA','CARERATINGS','UIICL','GABRIEL','NAM-INDIA','KEI'];
const BSE_STOCKS=['TATASTEELLP','TATAMETALI','BIRLATYRE','BHAGCHEM','ZYDUSWELL','NAVNETEDUL','SUNTV','MFSL'];
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getYFSession(){
  const r=await fetch('https://finance.yahoo.com/',{headers:{'User-Agent':UA,'Accept':'text/html,*/*','Accept-Language':'en-US,en;q=0.9'},redirect:'follow'});
  const vals=typeof r.headers.getAll==='function'?r.headers.getAll('set-cookie'):[];
  const ck=vals.map(c=>c.split(';')[0].trim()).join('; ');
  const cr=await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':UA,'Cookie':ck,'Referer':'https://finance.yahoo.com/','Accept':'*/*'}});
  const crumb=(await cr.text()).trim();
  if(!crumb||crumb.includes('Too Many')||crumb[0]==='<'||crumb[0]==='{')throw new Error('Bad crumb: '+crumb.slice(0,60));
  return{cookies:ck,crumb};
}

// ── NSE session (cookie handshake) ─────────────────────────────────────────────
// NSE's site blocks bare API calls (no session, no browser Referer). This
// mirrors what a real browser does: hit the homepage first to receive the
// nsit/nseappid cookies, then reuse those cookies + a Referer on the API call.
// This only works server-side (a Worker) — it can't be done via a client-side
// CORS proxy because a proxy can't carry the cookie jar across two hops.
const NSE_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function _mergeCookies(a,b){
  const jar={};
  (a||'').split(';').map(s=>s.trim()).filter(Boolean).forEach(c=>{const i=c.indexOf('=');if(i>0)jar[c.slice(0,i)]=c;});
  (b||'').split(';').map(s=>s.trim()).filter(Boolean).forEach(c=>{const i=c.indexOf('=');if(i>0)jar[c.slice(0,i)]=c;});
  return Object.values(jar).join('; ');
}

async function getNSESession(refererPath){
  const homeHeaders={
    'User-Agent':NSE_UA,
    'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':'en-US,en;q=0.9',
    'Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'none','Sec-Fetch-Dest':'document',
  };
  const r=await fetch('https://www.nseindia.com/',{headers:homeHeaders,redirect:'follow'});
  const vals1=typeof r.headers.getAll==='function'?r.headers.getAll('set-cookie'):[];
  let cookies=vals1.map(c=>c.split(';')[0].trim()).join('; ');
  if(!cookies)throw new Error('NSE session: no cookies received from homepage');

  // Also visit the actual report page a browser would land on before this API
  // call — NSE/Akamai sets additional bot-manager cookies (bm_sz, ak_bmsc)
  // scoped to that navigation, not just the bare homepage.
  if(refererPath&&refererPath!=='/'){
    try{
      const r2=await fetch('https://www.nseindia.com'+refererPath,{
        headers:{...homeHeaders,'Cookie':cookies,'Referer':'https://www.nseindia.com/'},
        redirect:'follow',
      });
      const vals2=typeof r2.headers.getAll==='function'?r2.headers.getAll('set-cookie'):[];
      const cookies2=vals2.map(c=>c.split(';')[0].trim()).join('; ');
      if(cookies2)cookies=_mergeCookies(cookies,cookies2);
    }catch(e){ /* homepage cookies alone are still worth trying */ }
  }
  return{cookies};
}

// GET an NSE API path using an established session. Retries once with a fresh
// session if the first attempt looks blocked (NSE sometimes 401/403s a stale
// cookie, or returns an HTML challenge page instead of JSON).
async function nseApiFetch(path, refererPath){
  refererPath=refererPath||'/';
  let lastErr=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const sess=await getNSESession(refererPath);
      const res=await fetch('https://www.nseindia.com'+path,{
        headers:{
          'User-Agent':NSE_UA,
          'Accept':'application/json, text/plain, */*',
          'Accept-Language':'en-US,en;q=0.9',
          'Referer':'https://www.nseindia.com'+refererPath,
          'X-Requested-With':'XMLHttpRequest',
          'Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin','Sec-Fetch-Dest':'empty',
          'Cookie':sess.cookies,
        },
        signal:AbortSignal.timeout(10000),
      });
      const text=await res.text();
      if(!res.ok||!text||text.trim()[0]==='<'){
        console.warn('NSE '+path+' → HTTP '+res.status+' (attempt '+(attempt+1)+') body[0:150]='+JSON.stringify(text.slice(0,150)));
        lastErr=new Error('NSE '+path+' → HTTP '+res.status+' (attempt '+(attempt+1)+')'); continue;
      }
      return JSON.parse(text);
    }catch(e){ lastErr=e; }
  }
  throw lastErr||new Error('NSE fetch failed: '+path);
}

// ── FII / DII flows (live, EOD) ────────────────────────────────────────────────
// NSE publishes the day's FII/FPI + DII net figures once trading closes
// (~5:30-6:30pm IST). fiidiiTradeReact only ever returns the LATEST day, so we
// accumulate a rolling history in KV, one real day at a time, instead of the
// old approach of shipping a hardcoded seed array that never changed.
function fmtNseDate(d){
  // "2026-06-30" (ISO) — used as the de-dupe key regardless of NSE's own date format
  return d.toISOString().slice(0,10);
}
function parseNseDMY(s){
  // NSE dates look like "27-Jun-2026" or "27-06-2026" — normalize to ISO
  if(!s)return null;
  const m1=s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if(m1){
    const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const mo=months[m1[2]];
    if(mo==null)return null;
    return fmtNseDate(new Date(Date.UTC(+m1[3],mo,+m1[1])));
  }
  const m2=s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if(m2)return fmtNseDate(new Date(Date.UTC(+m2[3],+m2[2]-1,+m2[1])));
  const d=new Date(s);
  return isNaN(d)?null:fmtNseDate(d);
}

async function fetchFiiDiiLive(env){
  const raw=await nseApiFetch('/api/fiidiiTradeReact','/reports-fii-dii');
  if(!Array.isArray(raw)||!raw.length)throw new Error('fiidiiTradeReact: unexpected shape');
  // Rows come back as one entry per category for the latest date, e.g.
  // {category:"FII/FPI", date:"27-Jun-2026", buyValue:"12345.67", sellValue:"11234.56", netValue:"1111.11"}
  const byDate={};
  for(const row of raw){
    const cat=String(row.category||row.CATEGORY||'').toUpperCase();
    const date=parseNseDMY(row.date||row.DATE);
    if(!date)continue;
    if(!byDate[date])byDate[date]={date};
    const buy=parseFloat(row.buyValue??row.BUY_VALUE??row.buy_value)||0;
    const sell=parseFloat(row.sellValue??row.SELL_VALUE??row.sell_value)||0;
    if(cat.includes('FII')||cat.includes('FPI')){ byDate[date].fii_buy=buy; byDate[date].fii_sell=sell; }
    else if(cat.includes('DII')){ byDate[date].dii_buy=buy; byDate[date].dii_sell=sell; }
  }
  const newRows=Object.values(byDate).filter(r=>r.fii_buy!=null&&r.dii_buy!=null);
  if(!newRows.length)throw new Error('fiidiiTradeReact: no complete FII+DII rows parsed');

  let history=[];
  try{const r=await env.STOCKSENSE_KV.get('fiiDiiHistory');if(r)history=JSON.parse(r);}catch(e){}
  const byDateExisting=new Map(history.map(r=>[r.date,r]));
  for(const row of newRows)byDateExisting.set(row.date,row); // new day overwrites/adds
  const merged=[...byDateExisting.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,60);
  await env.STOCKSENSE_KV.put('fiiDiiHistory',JSON.stringify(merged));
  await env.STOCKSENSE_KV.put('fiiDiiMeta',JSON.stringify({ts:Date.now(),source:'nse-live'}));
  return merged;
}

// ── Bulk / Block deals (live, EOD) ─────────────────────────────────────────────
// KNOWN LIMITATION (checked 2026-06-30): unlike /api/fiidiiTradeReact (which
// works fine with just cookies from the homepage), NSE's
// /api/historical/bulk-deals and /block-deals endpoints sit behind Akamai Bot
// Manager (confirmed via the _abck cookie + an HTML "noindex,nofollow"
// challenge page returned with HTTP 200 instead of JSON). No amount of
// cookie/header spoofing from a Workers fetch() fixes this — Akamai is
// checking things a plain server-side fetch can't fake (TLS fingerprint,
// JS challenge execution, behavioral signals). Short of a paid scraping
// service or headless-browser proxy, this will keep failing, and the
// renderDeals() UI already degrades gracefully to labeled sample data when
// it does. Revisit if NSE ever changes their WAF config or a use case
// justifies paying for a real scraping service (e.g. ScraperAPI, Bright Data).
async function fetchDealsHistorical(kind){
  // kind: 'bulk-deals' | 'block-deals'
  const to=new Date();
  const from=new Date(to.getTime()-10*86400000); // last 10 calendar days
  const fmt=d=>String(d.getUTCDate()).padStart(2,'0')+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+d.getUTCFullYear();
  const path='/api/historical/'+kind+'?from='+fmt(from)+'&to='+fmt(to);
  const raw=await nseApiFetch(path,'/report-detail/eq_bulkblockdeals');
  const arr=Array.isArray(raw)?raw:(raw?.data||[]);
  return arr;
}

async function fetchBulkBlockDealsLive(env){
  const [bulkRaw,blockRaw]=await Promise.all([
    fetchDealsHistorical('bulk-deals').catch(e=>{console.warn('bulk-deals fetch failed:',e.message);return [];}),
    fetchDealsHistorical('block-deals').catch(e=>{console.warn('block-deals fetch failed:',e.message);return [];}),
  ]);
  const norm=(rows,type)=>rows.map(d=>({
    date: parseNseDMY(d.BD_DT_DATE||d.date||d.mTIMESTAMP) || (d.BD_DT_DATE||d.date||''),
    sym: d.BD_SYMBOL||d.symbol||d.SYMBOL||'',
    client: d.BD_CLIENT_NAME||d.client||d.clientName||'',
    qty: parseFloat(d.BD_QTY_TRD??d.qty??d.quantityTraded)||0,
    price: parseFloat(d.BD_TP_WATP??d.price??d.tradePrice)||0,
    type,
    side: /sell/i.test(d.BD_BUY_SELL||d.buySell||'')?'SELL':'BUY',
  })).filter(d=>d.sym&&d.qty);
  const deals=[...norm(bulkRaw,'Bulk'),...norm(blockRaw,'Block')]
    .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(!deals.length)throw new Error('bulk/block deals: both endpoints returned nothing parseable');
  await env.STOCKSENSE_KV.put('dealsCache',JSON.stringify({ts:Date.now(),source:'nse-live',deals}));
  return deals;
}

// Shared: refresh both FII/DII and deals, tolerating either one failing independently.
async function refreshMarketData(env){
  const results={fiidii:null,deals:null};
  try{ results.fiidii=await fetchFiiDiiLive(env); console.log('fiidii refreshed:',results.fiidii.length,'days'); }
  catch(e){ console.warn('fiidii refresh failed:',e.message); }
  try{ results.deals=await fetchBulkBlockDealsLive(env); console.log('deals refreshed:',results.deals.length,'rows'); }
  catch(e){ console.warn('deals refresh failed:',e.message); }
  return results;
}

async function tgSend(token,chatId,text,replyMarkup){
  try{
    const body={chat_id:chatId,text:'StockSense Pro\n\n'+text,parse_mode:'HTML'};
    if(replyMarkup)body.reply_markup=replyMarkup;
    const r=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return(await r.json()).ok;
  }catch(e){return false;}
}

async function answerCallback(token,callbackQueryId,text){
  try{await fetch('https://api.telegram.org/bot'+token+'/answerCallbackQuery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:callbackQueryId,text:text||''})});}catch(e){}
}

function fmtIdx(idx){
  if(!idx)return '';
  const parts=[];
  if(idx.nifty)parts.push('Nifty '+idx.nifty.ltp.toFixed(0)+' ('+(idx.nifty.chgP>=0?'+':'')+idx.nifty.chgP.toFixed(2)+'%)');
  if(idx.banknifty)parts.push('BankNifty '+idx.banknifty.ltp.toFixed(0)+' ('+(idx.banknifty.chgP>=0?'+':'')+idx.banknifty.chgP.toFixed(2)+'%)');
  if(idx.sensex)parts.push('Sensex '+idx.sensex.ltp.toFixed(0)+' ('+(idx.sensex.chgP>=0?'+':'')+idx.sensex.chgP.toFixed(2)+'%)');
  return parts.join('  ');
}

const PORTFOLIO_KEYBOARD={inline_keyboard:[[
  {text:'🔄 Refresh',callback_data:'refresh_portfolio'},
  {text:'📅 Brief',callback_data:'morning_brief'},
  {text:'🌇 Evening',callback_data:'evening_wrap'}
],[
  {text:'📈 Movers',callback_data:'top_movers'},
  {text:'👁 Watchlist',callback_data:'watchlist'},
  {text:'📅 Earnings',callback_data:'earnings_week'}
],[
  {text:'🧠 AI Recommend',callback_data:'ai_recommend'},
  {text:'🏭 Sector',callback_data:'sector_alloc'},
]]};

// ── Price / index fetchers ─────────────────────────────────────────────────

async function syncPrices(env){
  let sess=null;try{sess=await getYFSession();console.log('crumb:',sess.crumb.slice(0,8));}catch(e){console.warn('no sess:',e.message);}
  let prevPrices={};
  try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prevPrices=JSON.parse(raw).prices||{};}catch(e){}
  const syms=[...new Set(NSE_STOCKS)].map(s=>s+'.NS').concat([...new Set(BSE_STOCKS)].map(s=>s+'.BO'));
  const prices={};let fetched=0;
  for(let i=0;i<syms.length;i+=50){
    const batch=syms.slice(i,i+50);const q=encodeURIComponent(batch.join(','));
    const cq=sess?('&crumb='+encodeURIComponent(sess.crumb)):'';
    let ok=false;
    for(const h of['query1','query2']){
      try{
        const hh={'User-Agent':UA,'Referer':'https://finance.yahoo.com/'};
        if(sess&&sess.cookies)hh['Cookie']=sess.cookies;
        const res=await fetch('https://'+h+'.finance.yahoo.com/v7/finance/quote?symbols='+q+'&fields=regularMarketPrice,regularMarketChangePercent,earningsTimestampStart&formatted=false'+cq,{headers:hh});
        const d=await res.json();const rs=d&&d.quoteResponse&&d.quoteResponse.result;
        if(Array.isArray(rs)&&rs.length>0){rs.forEach(r=>{const s=r.symbol||'';const ns=s.endsWith('.NS'),bo=s.endsWith('.BO');if(!ns&&!bo)return;const b=s.slice(0,-3);const ltp=r.regularMarketPrice||0;const cp=r.regularMarketChangePercent||0;if(ltp){const et=r.earningsTimestampStart||0;prices[b+'|'+(ns?'NSE':'BSE')]={ltp,chgP:cp,earningsTs:et};fetched++;}});ok=true;break;}
      }catch(e){console.warn(h,'err:',e.message);}
    }
    if(!ok)console.warn('batch fail:',batch[0]);
    if(i+50<syms.length)await new Promise(r=>setTimeout(r,200));
  }
  console.log('fetched',fetched,'prices');
  if(fetched>0){await env.STOCKSENSE_KV.put('priceCache',JSON.stringify({ts:Date.now(),prices}));console.log('written to KV');}
  return{fetched,prices,prevPrices};
}

async function fetchIndexPrices(){
  try{
    let sess=null;try{sess=await getYFSession();}catch(e){}
    const q=['^NSEI','^BSESN','^NSEBANK'].map(encodeURIComponent).join(',');
    const cq=sess?('&crumb='+encodeURIComponent(sess.crumb)):'';
    const hh={'User-Agent':UA,'Referer':'https://finance.yahoo.com/'};
    if(sess&&sess.cookies)hh['Cookie']=sess.cookies;
    const res=await fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols='+q+'&fields=regularMarketPrice,regularMarketChangePercent&formatted=false'+cq,{headers:hh});
    const d=await res.json();const rs=d&&d.quoteResponse&&d.quoteResponse.result;
    if(!Array.isArray(rs))return null;
    const out={};
    for(const r of rs){
      if(r.symbol==='^NSEI')out.nifty={ltp:r.regularMarketPrice||0,chgP:r.regularMarketChangePercent||0};
      if(r.symbol==='^BSESN')out.sensex={ltp:r.regularMarketPrice||0,chgP:r.regularMarketChangePercent||0};
      if(r.symbol==='^NSEBANK')out.banknifty={ltp:r.regularMarketPrice||0,chgP:r.regularMarketChangePercent||0};
    }
    return out;
  }catch(e){console.warn('index fetch err:',e.message);return null;}
}

async function fetchLivePrice(sym){
  let sess=null;try{sess=await getYFSession();}catch(e){}
  const base=sym.toUpperCase().replace(/\.(NS|BO)$/i,'');
  const useBSE=sym.toUpperCase().endsWith('.BO');
  const useNSE=sym.toUpperCase().endsWith('.NS');
  const symbols=useBSE?[base+'.BO']:useNSE?[base+'.NS']:[base+'.NS',base+'.BO'];
  const q=encodeURIComponent(symbols.join(','));
  const cq=sess?('&crumb='+encodeURIComponent(sess.crumb)):'';
  const hh={'User-Agent':UA,'Referer':'https://finance.yahoo.com/'};
  if(sess&&sess.cookies)hh['Cookie']=sess.cookies;
  for(const host of['query1','query2']){
    try{
      const res=await fetch('https://'+host+'.finance.yahoo.com/v7/finance/quote?symbols='+q+'&fields=regularMarketPrice,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,shortName&formatted=false'+cq,{headers:hh});
      const d=await res.json();const rs=d&&d.quoteResponse&&d.quoteResponse.result;
      if(!Array.isArray(rs)||!rs.length)continue;
      const r=rs.find(x=>x.regularMarketPrice&&x.symbol.endsWith('.NS'))||rs.find(x=>x.regularMarketPrice&&x.symbol.endsWith('.BO'));
      if(!r)continue;
      return{sym:base,exchange:r.symbol.endsWith('.NS')?'NSE':'BSE',ltp:r.regularMarketPrice,chgP:r.regularMarketChangePercent||0,high:r.regularMarketDayHigh||0,low:r.regularMarketDayLow||0,prev:r.regularMarketPreviousClose||0,name:r.shortName||base};
    }catch(e){}
  }
  return null;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function sendPortfolioSnapshot(env,chatId,token){
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=(JSON.parse(raw)).prices||{};}catch(e){}
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf||!(pf.holdings||[]).length){await tgSend(token,chatId,'No holdings found. Use /add SYMBOL QTY AVG to add holdings.');return;}
  let inv=0,cur=0,dayPnl=0;const rows=[];
  for(const h of pf.holdings){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const xch=h.exchange||'NSE';const c=prices[h.symbol+'|'+xch];
    const ltp=c?c.ltp:(h.ltp||0);const cp=c?c.chgP:0;
    const i2=h.qty*h.avgPrice,c2=h.qty*ltp;
    const pnl=c2-i2,pp=i2>0?(pnl/i2*100):0;
    const dp=ltp>0?h.qty*ltp*(cp/100):0;
    inv+=i2;cur+=c2;dayPnl+=dp;
    rows.push(h.symbol+' '+(pnl>=0?'+':'')+pp.toFixed(1)+'% Day:'+(cp>=0?'+':'')+cp.toFixed(1)+'% ₹'+ltp.toFixed(0));
  }
  const tp=cur-inv,tpp=inv>0?(tp/inv*100):0;
  const msg='<b>Portfolio Snapshot</b>\n--------------------\n'+rows.join('\n')+'\n--------------------\n<b>Invested:</b>  ₹'+Math.round(inv).toLocaleString('en-IN')+'\n<b>Current:</b>   ₹'+Math.round(cur).toLocaleString('en-IN')+'\n<b>P&amp;L:</b>       '+(tp>=0?'+':'')+Math.round(tp).toLocaleString('en-IN')+' ('+(tpp>=0?'+':'')+tpp.toFixed(1)+'%)\n<b>Day P&amp;L:</b>   '+(dayPnl>=0?'+':'')+'₹'+Math.abs(Math.round(dayPnl)).toLocaleString('en-IN');
  await tgSend(token,chatId,msg,PORTFOLIO_KEYBOARD);
}

async function sendPriceQuery(env,chatId,token,sym){
  if(!sym){await tgSend(token,chatId,'Usage: /price SYMBOL\nExamples:\n/price RELIANCE\n/price RELIANCE.BO');return;}
  const base=sym.toUpperCase().replace(/\.(NS|BO)$/i,'');
  const useBSE=sym.toUpperCase().endsWith('.BO');
  try{
    const raw=await env.STOCKSENSE_KV.get('priceCache');
    if(raw){
      const cache=JSON.parse(raw);
      const xch=useBSE?'BSE':'NSE';
      const c=(cache.prices||{})[base+'|'+xch]||(!useBSE&&(cache.prices||{})[base+'|BSE']);
      if(c&&c.ltp){
        const ageMin=Math.round((Date.now()-(cache.ts||0))/60000);
        const s=c.chgP>=0?'+':'';
        const exch=(cache.prices||{})[base+'|NSE']?'NSE':'BSE';
        let msg='📊 <b>'+base+' ('+exch+')</b>\nLTP ₹'+c.ltp.toFixed(2)+' ('+s+c.chgP.toFixed(2)+'%)\n<i>📦 Cached '+ageMin+'m ago</i>';
        await tgSend(token,chatId,msg);return;
      }
    }
  }catch(e){}
  const r=await fetchLivePrice(sym);
  if(!r||!r.ltp){await tgSend(token,chatId,'❌ Could not fetch price for <b>'+sym.toUpperCase()+'</b>\nCheck the symbol and try again.');return;}
  const s=r.chgP>=0?'+':'';
  let msg='📊 <b>'+r.sym+' ('+r.exchange+')</b>\nLTP ₹'+r.ltp.toFixed(2)+' ('+s+r.chgP.toFixed(2)+'%)\n';
  if(r.high)msg+='High ₹'+r.high.toFixed(0)+' | Low ₹'+r.low.toFixed(0)+'\n';
  if(r.prev)msg+='Prev Close ₹'+r.prev.toFixed(2);
  await tgSend(token,chatId,msg);
}

async function sendPortfolioTop(env,chatId,token){
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf||!(pf.holdings||[]).length){await tgSend(token,chatId,'No holdings found.');return;}
  const rows=[];
  for(const h of pf.holdings){
    if(!h.symbol||!h.qty)continue;
    const c=prices[h.symbol+'|'+(h.exchange||'NSE')];
    if(!c||!c.ltp)continue;
    rows.push({sym:h.symbol,cp:c.chgP,ltp:c.ltp});
  }
  rows.sort((a,b)=>b.cp-a.cp);
  const gainers=rows.filter(r=>r.cp>0).slice(0,3);
  const losers=rows.filter(r=>r.cp<0).slice(-3).reverse();
  if(!gainers.length&&!losers.length){await tgSend(token,chatId,'No price data. Prices sync every 15 min during market hours.');return;}
  let msg='📊 <b>Portfolio Movers (Today)</b>\n--------------------\n';
  if(gainers.length){msg+='📈 <b>Top Gainers:</b>\n';for(const r of gainers)msg+=r.sym+' +'+r.cp.toFixed(1)+'% ₹'+r.ltp.toFixed(0)+'\n';}
  if(losers.length){msg+='\n📉 <b>Top Losers:</b>\n';for(const r of losers)msg+=r.sym+' '+r.cp.toFixed(1)+'% ₹'+r.ltp.toFixed(0)+'\n';}
  await tgSend(token,chatId,msg);
}

async function addOrUpdateHolding(env,chatId,token,args){
  const sym=(args[0]||'').toUpperCase();const qty=parseFloat(args[1]);const avg=parseFloat(args[2]);
  if(!sym||isNaN(qty)||isNaN(avg)||qty<=0||avg<=0){await tgSend(token,chatId,'Usage: /add SYMBOL QTY AVG_PRICE\nExamples:\n/add RELIANCE 10 2450.50\n/add TATASTEELLP.BO 100 150');return;}
  const base=sym.replace(/\.(NS|BO)$/,'');const exchange=sym.endsWith('.BO')?'BSE':'NSE';
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)pf={holdings:[],alerts:[],cfg:{}};
  if(!Array.isArray(pf.holdings))pf.holdings=[];
  const existing=pf.holdings.find(h=>h.symbol===base&&(h.exchange||'NSE')===exchange);
  if(existing){
    existing.qty=qty;existing.avgPrice=avg;
    await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(pf));
    await tgSend(token,chatId,'✅ <b>Updated:</b> '+base+' × '+qty+' @ ₹'+avg.toFixed(2)+' ('+exchange+')\nPortfolio saved.');
  }else{
    pf.holdings.push({id:Date.now()+Math.random(),symbol:base,exchange,qty,avgPrice:avg,ltp:0,buyDate:new Date().toISOString().slice(0,10)});
    await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(pf));
    await tgSend(token,chatId,'✅ <b>Added:</b> '+base+' × '+qty+' @ ₹'+avg.toFixed(2)+' ('+exchange+')\nTotal holdings: '+pf.holdings.length);
  }
}

async function updateStopLoss(env,chatId,token,args){
  const sym=(args[0]||'').toUpperCase().replace(/\.(NS|BO)$/,'');const price=parseFloat(args[1]);
  if(!sym||isNaN(price)||price<=0){await tgSend(token,chatId,'Usage: /sl SYMBOL PRICE\nExample: /sl RELIANCE 2300');return;}
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf){await tgSend(token,chatId,'No portfolio found.');return;}
  const h=pf.holdings.find(x=>x.symbol===sym);
  if(!h){await tgSend(token,chatId,'❌ '+sym+' not found in portfolio.\nUse /add '+sym+' QTY AVG to add it first.');return;}
  h.stopLoss=price;
  await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(pf));
  await tgSend(token,chatId,'✅ <b>Stop Loss updated</b>\n'+sym+' SL → ₹'+price.toFixed(2));
}

async function updateTarget(env,chatId,token,args){
  const sym=(args[0]||'').toUpperCase().replace(/\.(NS|BO)$/,'');
  const t1=parseFloat(args[1]);const t2=args[2]?parseFloat(args[2]):null;
  if(!sym||isNaN(t1)||t1<=0){await tgSend(token,chatId,'Usage: /target SYMBOL T1 [T2]\nExamples:\n/target RELIANCE 2800\n/target RELIANCE 2800 3100');return;}
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf){await tgSend(token,chatId,'No portfolio found.');return;}
  const h=pf.holdings.find(x=>x.symbol===sym);
  if(!h){await tgSend(token,chatId,'❌ '+sym+' not found in portfolio.\nUse /add '+sym+' QTY AVG to add it first.');return;}
  h.target1=t1;if(t2&&!isNaN(t2)&&t2>0)h.target2=t2;
  await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(pf));
  let reply='✅ <b>Targets updated</b>\n'+sym+' T1 → ₹'+t1.toFixed(2);
  if(t2&&!isNaN(t2)&&t2>0)reply+=', T2 → ₹'+t2.toFixed(2);
  await tgSend(token,chatId,reply);
}

async function addJournalNote(env,chatId,token,note){
  if(!note||!note.trim()){await tgSend(token,chatId,'Usage: /note YOUR TEXT\nExample: /note Booked 50% NTPC at 355 — near earnings');return;}
  const istNow=new Date(Date.now()+5.5*3600000);
  const dateStr=istNow.toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  let notes=[];try{const raw=await env.STOCKSENSE_KV.get('journalNotes');if(raw)notes=JSON.parse(raw);}catch(e){}
  notes.push({ts:Date.now(),note:note.trim()});
  if(notes.length>200)notes=notes.slice(-200);
  await env.STOCKSENSE_KV.put('journalNotes',JSON.stringify(notes));
  await tgSend(token,chatId,'📝 <b>Note saved ('+dateStr+' IST):</b>\n"'+note.trim()+'"');
}

// ── NEW: /notes [N] — read back journal notes ─────────────────────────────

async function sendNotes(env,chatId,token,args){
  const n=Math.min(parseInt(args[0])||5,20);
  let notes=[];try{const raw=await env.STOCKSENSE_KV.get('journalNotes');if(raw)notes=JSON.parse(raw);}catch(e){}
  if(!notes.length){await tgSend(token,chatId,'No notes yet.\nUse /note TEXT to save a trade journal note.');return;}
  const recent=notes.slice(-n).reverse();
  let msg='📝 <b>Last '+recent.length+' Notes</b>\n--------------------\n';
  for(const entry of recent){
    const d=new Date((entry.ts||0)+5.5*3600000);
    const ds=d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
    const ts=d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    msg+='\n<i>'+ds+' '+ts+'</i>\n'+entry.note+'\n';
  }
  await tgSend(token,chatId,msg);
}

// ── NEW: /earnings — this week's earnings for your holdings ──────────────

async function sendEarningsWeek(env,chatId,token){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  if(!pf||!(pf.holdings||[]).length){await tgSend(token,chatId,'No holdings found.');return;}
  const now=Date.now();
  const weekAhead=now+7*86400000;
  const rows=[];
  for(const h of(pf.holdings||[])){
    if(!h.symbol)continue;
    const priceEt=(prices[h.symbol+'|'+(h.exchange||'NSE')]||{}).earningsTs||0;
    const et=h.earningsTs||priceEt;
    if(!et)continue;
    const ets=et*1000;
    if(ets>=now-86400000&&ets<=weekAhead){
      const d=new Date(ets);
      const ds=d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Kolkata'});
      const ltp=(prices[h.symbol+'|'+(h.exchange||'NSE')]||{}).ltp||h.ltp||0;
      const pp=h.avgPrice&&ltp?((ltp-h.avgPrice)/h.avgPrice*100):null;
      rows.push({sym:h.symbol,ds,ets,ltp,pp});
    }
  }
  if(!rows.length){await tgSend(token,chatId,'No earnings scheduled in the next 7 days for your holdings.\n\n<i>Earnings data syncs from Yahoo Finance every 15 min.</i>');return;}
  rows.sort((a,b)=>a.ets-b.ets);
  let msg='📅 <b>Upcoming Earnings (Next 7 Days)</b>\n--------------------\n';
  for(const r of rows){
    msg+='\n<b>'+r.sym+'</b> — '+r.ds;
    if(r.ltp)msg+='\nLTP ₹'+r.ltp.toFixed(0)+(r.pp!=null?' ('+(r.pp>=0?'+':'')+r.pp.toFixed(1)+'% from avg)':'');
    msg+='\n';
  }
  msg+='\n<i>Consider reducing position risk before results.</i>';
  await tgSend(token,chatId,msg);
}

// ── NEW: /news SYMBOL — top headlines ────────────────────────────────────

// ── HTML escape helper ────────────────────────────────────────────────────────
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── NEW: /news SYMBOL — top headlines (Yahoo Finance search API) ──────────────

async function sendNews(env,chatId,token,sym){
  if(!sym){await tgSend(token,chatId,'Usage: /news SYMBOL\nExample: /news RELIANCE');return;}
  const base=sym.toUpperCase().replace(/\.(NS|BO)$/i,'');
  let titles=[];

  // Primary: Yahoo Finance search API (same infra as price fetches — reliable from CF)
  try{
    let sess=null;try{sess=await getYFSession();}catch(e){}
    const hh={'User-Agent':UA,'Accept':'application/json','Referer':'https://finance.yahoo.com/'};
    if(sess&&sess.cookies)hh['Cookie']=sess.cookies;
    const cq=sess?('&crumb='+encodeURIComponent(sess.crumb)):'';
    for(const q of [base+'.NS',base]){
      if(titles.length>=2)break;
      try{
        const res=await fetch('https://query1.finance.yahoo.com/v1/finance/search?q='+encodeURIComponent(q)+'&quotesCount=1&newsCount=5&enableFuzzyQuery=false'+cq,{headers:hh,signal:AbortSignal.timeout(6000)});
        if(res.ok){
          const d=await res.json();
          const news=d&&d.news||[];
          const t=news.slice(0,5).map(n=>n.title).filter(t=>t&&t.length>8);
          if(t.length>titles.length)titles=t;
        }
      }catch(e){}
    }
  }catch(e){}

  // Fallback: Google News RSS
  if(titles.length<2){
    for(const q of [base+' NSE stock India',base+' share price India']){
      if(titles.length>=2)break;
      try{
        const rssUrl='https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=en-IN&gl=IN&ceid=IN:en';
        const r=await fetch(rssUrl,{headers:{'User-Agent':UA},signal:AbortSignal.timeout(5000),redirect:'follow'});
        if(r.ok){
          const xml=await r.text();
          if(xml.includes('<item>')){
            let t=[...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/gs)].slice(1,8).map(m=>m[1].trim());
            if(!t.length)t=[...xml.matchAll(/<title>(.*?)<\/title>/gs)].slice(1,8).map(m=>m[1].replace(/<[^>]+>/g,'').trim());
            t=t.filter(x=>x.length>8).slice(0,5);
            if(t.length>titles.length)titles=t;
          }
        }
      }catch(e){}
    }
  }

  if(!titles.length){await tgSend(token,chatId,'Could not fetch news for <b>'+escHtml(base)+'</b>. Try again in a moment.');return;}
  let msg='📰 <b>'+escHtml(base)+' — Latest News</b>\n--------------------\n';
  titles.forEach((t,i)=>msg+='\n'+(i+1)+'. '+escHtml(t));
  await tgSend(token,chatId,msg);
}

// ── NEW: /ipo — upcoming IPO calendar ────────────────────────────────────

async function sendIPO(env,chatId,token){
  const GROWW_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const endpoints=[
    'https://groww.in/v1/api/ipo/v1/ipos/active',
    'https://groww.in/v1/api/ipo/v1/ipos?page=0&size=15&sortBy=openDate&sortOrder=DESC',
  ];
  let ipos=null;
  for(const url of endpoints){
    try{
      const r=await fetch(url,{headers:{'User-Agent':GROWW_UA,'Accept':'application/json','Referer':'https://groww.in/ipo'},signal:AbortSignal.timeout(6000)});
      if(!r.ok)continue;
      const d=await r.json();
      const arr=Array.isArray(d)?d:(d?.data?.content||d?.data||d?.ipos||d?.content||[]);
      if(arr.length){ipos=arr.slice(0,8);break;}
    }catch(e){}
  }
  if(!ipos||!ipos.length){
    await tgSend(token,chatId,'📋 <b>IPO Calendar</b>\n\nNo active/upcoming IPO data available right now.\nCheck <a href="https://www.nseindia.com/market-data/all-upcoming-issues-ipo">NSE IPO page</a> for latest.');
    return;
  }
  const now=new Date();
  let msg='📋 <b>IPO Calendar</b>\n--------------------\n';
  for(const d of ipos){
    const name=d.ipoName||d.companyName||d.name||'—';
    const openDate=d.openingDate||d.openDate||'—';
    const closeDate=d.closingDate||d.closeDate||'—';
    const price=d.issuePrice||d.minPrice||'—';
    const lot=d.lotSize||'—';
    const sub=d.subscriptionTimes||d.totalSubscription||null;
    const closeD=new Date(closeDate);
    const listD=new Date(d.listingDate||'');
    let status='Open';
    if(!isNaN(listD)&&listD<now)status='Listed';
    else if(!isNaN(closeD)&&closeD<now)status='Closed';
    else if(new Date(openDate)>now)status='Upcoming';
    const badge=status==='Open'?'🟢':status==='Listed'?'✅':status==='Upcoming'?'🔵':'⚫';
    msg+='\n'+badge+' <b>'+name+'</b>\n';
    if(openDate!=='—')msg+='Open: '+openDate+(closeDate!=='—'?' → '+closeDate:'')+'\n';
    if(price!=='—')msg+='Price: ₹'+price+(lot!=='—'?' | Lot: '+lot:'')+'\n';
    if(sub)msg+='Subscribed: '+sub+'x\n';
  }
  await tgSend(token,chatId,msg);
}

// ── NEW: /watchlist — watchlist with live prices ──────────────────────────

async function sendWatchlist(env,chatId,token){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  const wlAll=pf&&Array.isArray(pf.watchlist)?pf.watchlist:[];
  if(!wlAll.length){await tgSend(token,chatId,'Your watchlist is empty.\n\nAdd stocks via the StockSense web app to track them here.');return;}
  // Sort: BUY first, then by entryScore desc, limit to 25 to stay under Telegram 4096-char limit
  const sorted=[...wlAll].sort((a,b)=>{
    const aIsBuy=(a.signal||'').toUpperCase().includes('BUY')?1:0;
    const bIsBuy=(b.signal||'').toUpperCase().includes('BUY')?1:0;
    if(bIsBuy!==aIsBuy)return bIsBuy-aIsBuy;
    return (b.entryScore||0)-(a.entryScore||0);
  });
  const wl=sorted.slice(0,25);
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  let msg='👁 <b>Watchlist Top Picks</b> ('+wl.length+' of '+wlAll.length+')\n--------------------\n';
  for(const w of wl){
    if(!w.symbol)continue;
    const c=prices[w.symbol+'|NSE']||prices[w.symbol+'|BSE'];
    const ltp=c?c.ltp:(w.ltp||0);
    const cp=c?c.chgP:0;
    const s=cp>=0?'+':'';
    msg+='\n<b>'+escHtml(w.symbol)+'</b>';
    if(ltp)msg+=' ₹'+ltp.toFixed(0)+' ('+s+cp.toFixed(1)+'%)';
    if(w.signal)msg+=' | '+escHtml(w.signal);
    if(w.entryScore)msg+=' | Score: '+w.entryScore+'/10';
    if(w.ltpAtAdd&&ltp){
      const chgSince=((ltp-w.ltpAtAdd)/w.ltpAtAdd*100);
      msg+=' | Since: '+(chgSince>=0?'+':'')+chgSince.toFixed(1)+'%';
    }
    if(w.wlDecision)msg+='\n<i>'+escHtml(w.wlDecision)+'</i>';
  }
  // If HTML parse fails, retry as plain text
  const ok=await tgSend(token,chatId,msg);
  if(!ok){
    const plain=msg.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    await tgSend(token,chatId,plain);
  }
}

// ── NEW: /sell SYM QTY PRICE — book a trade exit ─────────────────────────

async function sellHolding(env,chatId,token,args){
  const sym=(args[0]||'').toUpperCase().replace(/\.(NS|BO)$/,'');
  const qty=parseFloat(args[1]);
  const price=parseFloat(args[2]);
  if(!sym||isNaN(qty)||qty<=0||isNaN(price)||price<=0){
    await tgSend(token,chatId,'Usage: /sell SYMBOL QTY SELL_PRICE\nExamples:\n/sell RELIANCE 5 2900\n/sell TATAPOWER 100 420');
    return;
  }
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf){await tgSend(token,chatId,'No portfolio found.');return;}
  if(!Array.isArray(pf.holdings))pf.holdings=[];
  if(!Array.isArray(pf.realised))pf.realised=[];
  const h=pf.holdings.find(x=>x.symbol===sym);
  if(!h){await tgSend(token,chatId,'❌ '+sym+' not found in portfolio.');return;}
  if(qty>h.qty){
    await tgSend(token,chatId,'❌ You only hold '+h.qty+' shares of '+sym+' but tried to sell '+qty+'.\nUse /sell '+sym+' '+h.qty+' '+price+' to sell all.');
    return;
  }
  const pnl=(price-h.avgPrice)*qty;
  const pnlPct=h.avgPrice>0?((price-h.avgPrice)/h.avgPrice*100):0;
  const sellDate=new Date().toISOString().slice(0,10);
  const holdDays=h.buyDate?Math.round((Date.now()-new Date(h.buyDate).getTime())/86400000):0;
  const txType=holdDays>=365?'LTCG':'STCG';
  pf.realised.push({
    id:Date.now().toString(36),symbol:sym,exchange:h.exchange||'NSE',
    buyDate:h.buyDate||'—',sellDate,qty,buyPrice:h.avgPrice,sellPrice:price,
    pnl:Math.round(pnl*100)/100,pnlPct:Math.round(pnlPct*100)/100,type:txType,holdDays
  });
  if(qty===h.qty){
    pf.holdings=pf.holdings.filter(x=>x.symbol!==sym);
  }else{
    h.qty=Math.round((h.qty-qty)*1000)/1000;
  }
  await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(pf));
  const emoji=pnl>=0?'✅':'🔴';
  let reply=emoji+' <b>Sold: '+sym+'</b>\n';
  reply+=qty+' shares @ ₹'+price.toFixed(2)+'\n';
  reply+='Avg buy: ₹'+h.avgPrice.toFixed(2)+'\n';
  reply+='<b>P&amp;L: '+(pnl>=0?'+':'')+'₹'+Math.round(Math.abs(pnl)).toLocaleString('en-IN')+' ('+(pnlPct>=0?'+':'')+pnlPct.toFixed(1)+'%)</b>\n';
  reply+='Type: '+txType+(holdDays>0?' ('+holdDays+' days)':'')+'\n';
  if(qty===h.qty)reply+='<i>Position fully closed.</i>';
  else reply+='<i>Remaining: '+(h.qty-qty>0?h.qty-qty:0)+' shares still held.</i>';
  // Wait — h.qty is already updated above. Let's fix the message.
  const remaining=pf.holdings.find(x=>x.symbol===sym);
  if(remaining)reply=reply.replace(/Remaining:.*<\/i>/,'<i>Remaining: '+remaining.qty+' shares still held.</i>');
  await tgSend(token,chatId,reply);
}

// ── NEW: /sector — sector allocation breakdown ────────────────────────────

async function sendSector(env,chatId,token){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  if(!pf||!(pf.holdings||[]).length){await tgSend(token,chatId,'No holdings found.');return;}
  const sectorMap={};let totalCur=0;
  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const xch=h.exchange||'NSE';const c=prices[h.symbol+'|'+xch];
    const ltp=c?c.ltp:(h.ltp||0);if(!ltp)continue;
    const val=h.qty*ltp;totalCur+=val;
    const sector=h.sector||'Other';
    if(!sectorMap[sector])sectorMap[sector]={val:0,inv:0,stocks:[]};
    sectorMap[sector].val+=val;
    sectorMap[sector].inv+=h.qty*h.avgPrice;
    sectorMap[sector].stocks.push(h.symbol);
  }
  if(!totalCur){await tgSend(token,chatId,'No price data yet. Prices sync every 15 min during market hours.');return;}
  const sectors=Object.entries(sectorMap).sort((a,b)=>b[1].val-a[1].val);
  let msg='🏭 <b>Sector Allocation</b>\n--------------------\n';
  for(const [name,s] of sectors){
    const pct=(s.val/totalCur*100).toFixed(1);
    const pnl=s.val-s.inv;const pnlPct=s.inv>0?((pnl/s.inv)*100):0;
    const bar='█'.repeat(Math.round(parseFloat(pct)/5));
    msg+='\n<b>'+name+'</b> '+pct+'%\n';
    msg+=bar+'\n';
    msg+='₹'+Math.round(s.val).toLocaleString('en-IN')+' | P&amp;L '+(pnl>=0?'+':'')+pnlPct.toFixed(1)+'%\n';
    msg+='<i>'+s.stocks.slice(0,5).join(', ')+(s.stocks.length>5?' +more':'')+' </i>\n';
  }
  msg+='--------------------\nTotal: ₹'+Math.round(totalCur).toLocaleString('en-IN');
  await tgSend(token,chatId,msg);
}

// ── Monthly & Weekly & Morning brief & Evening wrap (unchanged from v8) ───

async function sendMonthlyDigest(env){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)return;const cfg=pf.cfg||{};const token=env.TELEGRAM_TOKEN||cfg.tgToken,chatId=cfg.tgChatId;if(!token||!chatId)return;
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  const istNow=new Date(Date.now()+5.5*3600000);
  const currentMonth=istNow.getUTCFullYear()+'-'+(istNow.getUTCMonth()+1).toString().padStart(2,'0');
  let baseline=null;try{const raw=await env.STOCKSENSE_KV.get('monthlyBaseline');if(raw)baseline=JSON.parse(raw);}catch(e){}
  if(!baseline||baseline.month!==currentMonth){
    await env.STOCKSENSE_KV.put('monthlyBaseline',JSON.stringify({ts:Date.now(),month:currentMonth,prices}));
    await tgSend(token,chatId,'📅 <b>Monthly Digest</b>\nBaseline set for '+currentMonth+'.\nSend /monthly again anytime to see MTD performance.');return;
  }
  const bp=baseline.prices||{};const rows=[];let curNow=0,curThen=0;
  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const key=h.symbol+'|'+(h.exchange||'NSE');
    const ltpNow=(prices[key]||{}).ltp||h.ltp||0;const ltpThen=(bp[key]||{}).ltp||ltpNow;
    if(!ltpNow||!ltpThen)continue;
    const mChg=(ltpNow-ltpThen)/ltpThen*100;
    curNow+=h.qty*ltpNow;curThen+=h.qty*ltpThen;
    rows.push({sym:h.symbol,mChg,ltpNow,mPnl:h.qty*(ltpNow-ltpThen)});
  }
  rows.sort((a,b)=>b.mChg-a.mChg);
  const winners=rows.filter(r=>r.mChg>0).slice(0,5);const laggards=rows.filter(r=>r.mChg<0).slice(-5).reverse();
  const mPnl=curNow-curThen,mPct=curThen>0?(mPnl/curThen*100):0;
  const baseDate=new Date(baseline.ts+5.5*3600000).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  let msg='📅 <b>Monthly Digest</b>\nSince '+baseDate+'\n--------------------\n';
  if(winners.length){msg+='🏆 <b>Winners:</b>\n';for(const r of winners)msg+=r.sym+' +'+r.mChg.toFixed(1)+'%\n';}
  if(laggards.length){msg+='⚠️ <b>Laggards:</b>\n';for(const r of laggards)msg+=r.sym+' '+r.mChg.toFixed(1)+'%\n';}
  msg+='--------------------\n<b>Month P&amp;L:</b> '+(mPnl>=0?'+':'')+'₹'+Math.abs(Math.round(mPnl)).toLocaleString('en-IN')+' ('+(mPct>=0?'+':'')+mPct.toFixed(1)+'%)';
  await tgSend(token,chatId,msg);console.log('monthly digest sent');
}

async function sendMorningBrief(env){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)return;const cfg=pf.cfg||{};const token=env.TELEGRAM_TOKEN||cfg.tgToken,chatId=cfg.tgChatId;if(!token||!chatId)return;
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  const now=new Date();const istOffset=5.5*3600000;const istNow=new Date(now.getTime()+istOffset);
  const dayStart=Date.UTC(istNow.getUTCFullYear(),istNow.getUTCMonth(),istNow.getUTCDate())-istOffset;
  const dayEnd=dayStart+86400000;
  const dateStr=istNow.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  const idx=await fetchIndexPrices();const sections=[];
  const earningsToday=(pf.holdings||[]).filter(h=>{const et=h.earningsTs||(prices[h.symbol+'|'+(h.exchange||'NSE')]||{}).earningsTs;return et&&(et*1000)>=dayStart&&(et*1000)<dayEnd;}).map(h=>h.symbol);
  if(earningsToday.length)sections.push('📅 <b>Earnings Today:</b> '+earningsToday.join(', '));
  const nearSL=[];
  for(const h of(pf.holdings||[])){
    if(!h.stopLoss||!h.symbol)continue;
    const ltp=(prices[h.symbol+'|'+(h.exchange||'NSE')]||prices[h.symbol+'|BSE']||{}).ltp||h.ltp||0;
    if(!ltp||ltp<h.stopLoss)continue;
    if(ltp<=h.stopLoss*1.03){const gap=((ltp-h.stopLoss)/h.stopLoss*100).toFixed(1);nearSL.push(h.symbol+' ₹'+ltp.toFixed(0)+' / SL ₹'+h.stopLoss.toFixed(0)+' (+'+gap+'%)');}
  }
  if(nearSL.length)sections.push('⚠️ <b>Near Stop Loss (&lt;3%):</b>\n'+nearSL.join('\n'));
  const nearT1=[];
  for(const h of(pf.holdings||[])){
    if(!h.target1||!h.symbol)continue;
    const ltp=(prices[h.symbol+'|'+(h.exchange||'NSE')]||prices[h.symbol+'|BSE']||{}).ltp||h.ltp||0;
    if(!ltp||ltp>=h.target1)continue;
    if(ltp>=h.target1*0.95){const gap=((h.target1-ltp)/h.target1*100).toFixed(1);nearT1.push(h.symbol+' ₹'+ltp.toFixed(0)+' → T1 ₹'+h.target1.toFixed(0)+' ('+gap+'% away)');}
  }
  if(nearT1.length)sections.push('🎯 <b>Near Target 1 (&lt;5%):</b>\n'+nearT1.join('\n'));
  let inv=0,cur=0;
  for(const h of(pf.holdings||[])){if(!h.qty||!h.avgPrice)continue;const ltp=(prices[h.symbol+'|'+(h.exchange||'NSE')]||prices[h.symbol+'|BSE']||{}).ltp||h.ltp||0;inv+=h.qty*h.avgPrice;if(ltp)cur+=h.qty*ltp;}
  const pnl=cur-inv,pnlPct=inv>0?(pnl/inv*100):0;
  let msg='🌅 <b>Morning Brief — '+dateStr+'</b>\n';
  const idxLine=fmtIdx(idx);if(idxLine)msg+=idxLine+'\n';
  msg+='--------------------\n';
  if(sections.length)msg+=sections.join('\n\n')+'\n\n--------------------\n';
  else msg+='All clear — no stocks near SL/T1 today.\n\n--------------------\n';
  msg+='<b>Portfolio:</b> ₹'+Math.round(cur).toLocaleString('en-IN')+' ('+(pnl>=0?'+':'')+pnlPct.toFixed(1)+'%)\n';
  msg+='<b>Holdings:</b> '+(pf.holdings||[]).length+' stocks';
  await tgSend(token,chatId,msg);console.log('morning brief sent');
}

async function sendEveningWrap(env){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)return;const cfg=pf.cfg||{};const token=env.TELEGRAM_TOKEN||cfg.tgToken,chatId=cfg.tgChatId;if(!token||!chatId)return;
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  const idx=await fetchIndexPrices();
  const istNow=new Date(Date.now()+5.5*3600000);
  const dateStr=istNow.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  let inv=0,cur=0,dayPnl=0;const rows=[];
  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const xch=h.exchange||'NSE';const c=prices[h.symbol+'|'+xch];
    const ltp=c?c.ltp:(h.ltp||0);const cp=c?c.chgP:0;
    const i2=h.qty*h.avgPrice,c2=h.qty*ltp;const dp=ltp>0?h.qty*ltp*(cp/100):0;
    inv+=i2;cur+=c2;dayPnl+=dp;
    if(ltp&&cp!==0)rows.push({sym:h.symbol,cp,ltp,dp});
  }
  rows.sort((a,b)=>b.cp-a.cp);
  const gainers=rows.filter(r=>r.cp>0).slice(0,3);const losers=[...rows].filter(r=>r.cp<0).slice(-3).reverse();
  const pnl=cur-inv,pnlPct=inv>0?(pnl/inv*100):0;
  let msg='🌇 <b>Evening Wrap — '+dateStr+'</b>\n';
  const idxLine=fmtIdx(idx);if(idxLine)msg+=idxLine+'\n';
  msg+='--------------------\n';
  if(gainers.length){msg+='📈 <b>Top Gainers:</b>\n';for(const r of gainers)msg+=r.sym+' +'+r.cp.toFixed(1)+'% ₹'+r.ltp.toFixed(0)+'\n';}
  if(losers.length){msg+='📉 <b>Top Losers:</b>\n';for(const r of losers)msg+=r.sym+' '+r.cp.toFixed(1)+'% ₹'+r.ltp.toFixed(0)+'\n';}
  msg+='--------------------\n<b>Day P&amp;L:</b> '+(dayPnl>=0?'+':'−')+'₹'+Math.abs(Math.round(dayPnl)).toLocaleString('en-IN')+'\n';
  const _pdp=(cur-dayPnl)>0?dayPnl/(cur-dayPnl)*100:0; const _np=(idx&&idx.nifty)?idx.nifty.chgP:null;
  if(_np!=null){const _a=_pdp-_np; msg+='\ud83d\udcca <b>vs Nifty:</b> you '+(_pdp>=0?'+':'')+_pdp.toFixed(1)+'% vs Nifty '+(_np>=0?'+':'')+_np.toFixed(1)+'% ('+(_a>=0?'+':'')+_a.toFixed(1)+' pts)\n';}
  msg+='<b>Portfolio:</b> ₹'+Math.round(cur).toLocaleString('en-IN')+' ('+(pnlPct>=0?'+':'')+pnlPct.toFixed(1)+'%)';
  try{let _b=[];const _r=await env.STOCKSENSE_KV.get('portfolioBackups');if(_r)_b=JSON.parse(_r);_b.push({ts:Date.now(),holdings:pf.holdings||[],realised:pf.realised||[]});if(_b.length>7)_b=_b.slice(-7);await env.STOCKSENSE_KV.put('portfolioBackups',JSON.stringify(_b));}catch(e){}
  let _pcts=0;try{const _r2=await env.STOCKSENSE_KV.get('priceCache');if(_r2)_pcts=JSON.parse(_r2).ts||0;}catch(e){}
  if(_pcts){const _ag=Math.round((Date.now()-_pcts)/60000);const _tt=new Date(_pcts+5.5*3600000).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit'});msg+='\n--------------------\n\ud83e\ude7a Last sync '+_tt+' IST'+(_ag>45?' \u26a0\ufe0f '+_ag+'m ago — check sync':'')+' \u00b7 \ud83d\udcbe backup saved';}
  await tgSend(token,chatId,msg);console.log('evening wrap sent');
}

async function sendWeeklyDigest(env,prices){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)return;const cfg=pf.cfg||{};const token=env.TELEGRAM_TOKEN||cfg.tgToken,chatId=cfg.tgChatId;if(!token||!chatId)return;
  let baseline=null;try{const raw=await env.STOCKSENSE_KV.get('weeklyBaseline');if(raw)baseline=JSON.parse(raw);}catch(e){}
  await env.STOCKSENSE_KV.put('weeklyBaseline',JSON.stringify({ts:Date.now(),prices}));
  if(!baseline){await tgSend(token,chatId,'📅 <b>Weekly Digest</b>\nFirst Monday — storing baseline for next week\'s digest.');return;}
  const bp=baseline.prices||{};const rows=[];let curNow=0,curThen=0;
  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const xch=h.exchange||'NSE';const key=h.symbol+'|'+xch;
    const ltpNow=(prices[key]||{}).ltp||h.ltp||0;const ltpThen=(bp[key]||{}).ltp||ltpNow;
    if(!ltpNow||!ltpThen)continue;
    const wkChg=((ltpNow-ltpThen)/ltpThen*100);
    curNow+=h.qty*ltpNow;curThen+=h.qty*ltpThen;
    rows.push({sym:h.symbol,wkChg,ltpNow,wkPnl:h.qty*(ltpNow-ltpThen)});
  }
  rows.sort((a,b)=>b.wkChg-a.wkChg);
  const winners=rows.filter(r=>r.wkChg>0).slice(0,5);const laggards=rows.filter(r=>r.wkChg<0).slice(-5).reverse();
  const wkPnl=curNow-curThen,wkPct=curThen>0?(wkPnl/curThen*100):0;
  const baseDate=new Date(baseline.ts+5.5*3600000).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  let msg='📅 <b>Weekly Digest</b>\nSince '+baseDate+'\n--------------------\n';
  if(winners.length){msg+='🏆 <b>Winners:</b>\n';for(const r of winners)msg+=r.sym+' +'+r.wkChg.toFixed(1)+'%\n';}
  if(laggards.length){msg+='⚠️ <b>Laggards:</b>\n';for(const r of laggards)msg+=r.sym+' '+r.wkChg.toFixed(1)+'%\n';}
  msg+='--------------------\n<b>Week P&amp;L:</b> '+(wkPnl>=0?'+':'')+'₹'+Math.abs(Math.round(wkPnl)).toLocaleString('en-IN')+' ('+(wkPct>=0?'+':'')+wkPct.toFixed(1)+'%)';
  const _d=disciplineScan(pf,prices);const _g=[];if(_d.noStop.length)_g.push(_d.noStop.length+' no-stop');if(_d.noTarget.length)_g.push(_d.noTarget.length+' no-target');if(_d.overStock.length||_d.overSector.length)_g.push('over caps');
  msg+='\n--------------------\n\ud83d\uddd3\ufe0f <b>Checkpoint:</b> '+(_g.length?_g.join(' \u00b7 '):'all armed & in-cap \u2705')+'\nRun /discipline \u00b7 /rebalance to prune & rebalance.';
  await tgSend(token,chatId,msg);console.log('weekly digest sent');
}

// ── Alerts ────────────────────────────────────────────────────────────────────

async function checkAndSendAlerts(env,prices,prevPrices){
  let portfolio=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)portfolio=JSON.parse(raw);}catch(e){return;}
  if(!portfolio)return;
  const cfg=portfolio.cfg||{};const token=env.TELEGRAM_TOKEN||cfg.tgToken,chatId=cfg.tgChatId;
  if(!token||!chatId){console.log('no tg creds in cfg');return;}
  let cool={};try{const raw=await env.STOCKSENSE_KV.get('alertCooldowns');if(raw)cool=JSON.parse(raw);}catch(e){}
  const now=Date.now();const COOL=3600000;
  let dirty=false,portfolioDirty=false;
  const canFire=k=>!cool[k]||(now-cool[k])>=COOL;
  const fired=k=>{cool[k]=now;dirty=true;};
  const msgs=[];
  const hasPrev=prevPrices&&Object.keys(prevPrices).length>0;
  for(const h of(portfolio.holdings||[])){
    if(!h.symbol)continue;const xch=h.exchange||'NSE';const cached=prices[h.symbol+'|'+xch];
    if(!cached)continue;const ltp=cached.ltp,cp=cached.chgP;
    if(h.stopLoss&&ltp>0&&ltp<h.stopLoss&&canFire('sl|'+h.id)){
      const pct=((h.stopLoss-ltp)/h.stopLoss*100).toFixed(1);
      msgs.push('🚨 <b>SL BREACH: '+h.symbol+'</b>\nLTP ₹'+ltp.toFixed(2)+' below SL ₹'+h.stopLoss.toFixed(2)+' (-'+pct+'%)\nConsider cutting position.');
      fired('sl|'+h.id);
    }
    if(h.target1&&ltp>=h.target1&&canFire('t1|'+h.id)){
      const pp=h.avgPrice?((ltp-h.avgPrice)/h.avgPrice*100).toFixed(1):'?';
      msgs.push('🎯 <b>TARGET 1 HIT: '+h.symbol+'</b>\nLTP ₹'+ltp.toFixed(2)+' reached T1 ₹'+h.target1.toFixed(2)+' (+'+pp+'% from avg)\nConsider partial booking.');
      fired('t1|'+h.id);
    }
    if(h.target2&&ltp>=h.target2&&canFire('t2|'+h.id)){
      const pp=h.avgPrice?((ltp-h.avgPrice)/h.avgPrice*100).toFixed(1):'?';
      msgs.push('🏆 <b>TARGET 2 HIT: '+h.symbol+'</b>\nLTP ₹'+ltp.toFixed(2)+' reached T2 ₹'+h.target2.toFixed(2)+' (+'+pp+'% from avg)\nConsider full exit.');
      fired('t2|'+h.id);
    }
    if(Math.abs(cp)>=5&&canFire('mv|'+h.id+'|'+new Date().toDateString())){
      msgs.push((cp>0?'📈':'📉')+' <b>'+h.symbol+' '+cp.toFixed(1)+'%</b>\nLTP ₹'+ltp.toFixed(2)+' — big intraday move in your portfolio.');
      fired('mv|'+h.id+'|'+new Date().toDateString());
    }
    if(hasPrev){
      const prevLtp=(prevPrices[h.symbol+'|'+xch]||{}).ltp||0;
      if(prevLtp>0&&ltp>0){
        const cyclePct=(ltp-prevLtp)/prevLtp*100;
        const cycBucket=Math.floor(now/900000);
        if(Math.abs(cyclePct)>=3&&canFire('cyc|'+h.id+'|'+cycBucket)){
          msgs.push('⚡ <b>'+h.symbol+' '+(cyclePct>0?'+':'')+cyclePct.toFixed(1)+'% in 15 min</b>\nLTP ₹'+ltp.toFixed(0)+' | Prev ₹'+prevLtp.toFixed(0)+'\nSharp intraday move in your portfolio.');
          fired('cyc|'+h.id+'|'+cycBucket);
        }
      }
    }
    if(h.trailSlPct&&ltp>0){
      const curHigh=h.trailSlHigh||h.avgPrice||0;
      if(ltp>curHigh){h.trailSlHigh=ltp;portfolioDirty=true;}
      const trailLevel=(h.trailSlHigh||0)*(1-h.trailSlPct/100);
      if(trailLevel>0&&ltp<trailLevel&&canFire('tsl|'+h.id)){
        const dropPct=((h.trailSlHigh-ltp)/h.trailSlHigh*100).toFixed(1);
        msgs.push('🚨 <b>TRAIL SL HIT: '+h.symbol+'</b>\nLTP ₹'+ltp.toFixed(2)+' dropped '+dropPct+'% from high ₹'+(h.trailSlHigh||0).toFixed(2)+'\nTrail SL (−'+h.trailSlPct+'%): ₹'+trailLevel.toFixed(2)+'\nConsider exiting.');
        fired('tsl|'+h.id);
      }
    }
  }
  for(const a of(portfolio.alerts||[])){
    if(a.triggered||!a.sym||!a.price)continue;
    const ltp=((prices[a.sym+'|NSE']||prices[a.sym+'|BSE'])||{}).ltp||0;if(!ltp)continue;
    const hit=(a.type==='above'&&ltp>=a.price)||(a.type==='below'&&ltp<=a.price);
    if(hit&&canFire('ca|'+a.id)){
      msgs.push('🔔 <b>ALERT: '+a.sym+'</b>\nLTP ₹'+ltp.toFixed(2)+' '+(a.type==='above'?'crossed above':'crossed below')+' ₹'+a.price.toFixed(2)+(a.label?' ('+a.label+')':''));
      fired('ca|'+a.id);
    }
  }
  const tomorrow=now+86400000;
  for(const h of(portfolio.holdings||[])){
    const _et=(prices[h.symbol+'|'+(h.exchange||'NSE')]||{}).earningsTs||0;
    const _earningsTs=h.earningsTs||_et;if(!_earningsTs||!h.symbol)continue;
    const ets=_earningsTs*1000;const ck='er|'+(h.id||h.symbol)+'|'+_earningsTs;
    if(ets>=now&&ets<=tomorrow&&canFire(ck)){
      const eDate=new Date(ets).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      msgs.push('📅 <b>EARNINGS TOMORROW: '+h.symbol+'</b>\nResults expected around '+eDate+' IST\nConsider reducing position risk before results.');
      fired(ck);
    }
  }
  // ── Concentration breach (enforce your maxStockPct / maxSectorPct) ──
  {
    const maxStock=+cfg.maxStockPct||0, maxSector=+cfg.maxSectorPct||0;
    const ncFire=k=>!cool[k];
    if((maxStock||maxSector)&&cfg.concAlerts!==false){
      const day=new Date().toDateString();
      let total=0; const pos=[];
      for(const h of(portfolio.holdings||[])){
        if(!h.symbol||!h.qty)continue;
        const c=prices[h.symbol+'|'+(h.exchange||'NSE')];
        const ltp=(c&&c.ltp)||h.ltp||h.avgPrice||0;
        const val=h.qty*ltp; if(val<=0)continue;
        total+=val; pos.push({sym:h.symbol,sec:h.sector||'Other',val});
      }
      if(total>0){
        if(maxStock)for(const p of pos){
          const wt=p.val/total*100;
          if(wt>maxStock&&ncFire('conc-stk|'+p.sym+'|'+day)){
            msgs.push('\u26a0\ufe0f <b>Concentration: '+p.sym+'</b>\n'+wt.toFixed(0)+'% of portfolio \u2014 over your '+maxStock+'% per-stock cap.\nConsider trimming toward your limit.');
            fired('conc-stk|'+p.sym+'|'+day);
          }
        }
        if(maxSector){
          const secMap={}; for(const p of pos)secMap[p.sec]=(secMap[p.sec]||0)+p.val;
          for(const sec of Object.keys(secMap)){
            const wt=secMap[sec]/total*100;
            if(wt>maxSector&&ncFire('conc-sec|'+sec+'|'+day)){
              const names=pos.filter(p=>p.sec===sec).sort((a,b)=>b.val-a.val).slice(0,4).map(p=>p.sym).join(', ');
              msgs.push('\u26a0\ufe0f <b>Concentration: '+sec+' '+wt.toFixed(0)+'%</b>\nOver your '+maxSector+'% sector cap. Top: '+names+'.\nConsider rebalancing.');
              fired('conc-sec|'+sec+'|'+day);
            }
          }
        }
      }
    }
  }
  for(const m of msgs){await tgSend(token,chatId,m);await new Promise(r=>setTimeout(r,300));}
  if(msgs.length)console.log('sent',msgs.length,'alert(s) to Telegram');
  if(portfolioDirty){await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(portfolio));console.log('updated trailSlHigh');}
  if(dirty){
    for(const k of Object.keys(cool))if(now-cool[k]>86400000)delete cool[k];
    await env.STOCKSENSE_KV.put('alertCooldowns',JSON.stringify(cool));
  }
}

// ── AI CHAT AGENT ─────────────────────────────────────────────────────────────

const AI_MODELS_FALLBACK=[
  'meta-llama/llama-3.3-70b-instruct',
  'mistralai/mistral-small-3.2-24b-instruct',
  'qwen/qwen3-14b',
  'microsoft/phi-4-mini-instruct',
  'deepseek/deepseek-chat-v3-0324',
  // Free tier fallbacks (may be unavailable)
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-12b-it:free',
];

// Build model cascade: user's chosen model first, then standard fallbacks
function getAIModels(userModel){
  const base=AI_MODELS_FALLBACK;
  if(!userModel||userModel==='custom')return base;
  // Honor the user's EXACT selected model first (do NOT strip :free — respect their choice).
  return[userModel,...base.filter(m=>m!==userModel)];
}

async function callAI(orKey,messages,maxTokens=1500,userModel=null){
  const AI_MODELS=getAIModels(userModel);
  for(const model of AI_MODELS){
    try{
      const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+orKey,'HTTP-Referer':'https://stocksense-pro.pages.dev/','X-Title':'StockSense Pro'},
        body:JSON.stringify({model,messages,max_tokens:maxTokens,temperature:0.4}),
        signal:AbortSignal.timeout(25000),
      });
      const d=await r.json();
      if(d.error){console.warn('AI err ('+model+'):',d.error.message);continue;}
      const txt=d.choices?.[0]?.message?.content;
      if(txt&&txt.length>10)return {text:txt,model};
    }catch(e){console.warn('AI call fail ('+model+'):',e.message);}
  }
  return null;
}

function buildAgentSystemPrompt(pf,prices,idx){
  const holdings=pf?.holdings||[];
  const watchlist=pf?.watchlist||[];
  const realised=pf?.realised||[];

  // Portfolio summary
  let pfLines='';let totalInv=0,totalCur=0;
  for(const h of holdings){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const key=h.symbol+'|'+(h.exchange||'NSE');
    const ltp=(prices[key]||{}).ltp||h.ltp||h.avgPrice;
    const chgP=(prices[key]||{}).chgP||0;
    const inv=h.qty*h.avgPrice,cur=h.qty*ltp;
    const pnl=cur-inv,pnlP=inv?(pnl/inv*100):0;
    totalInv+=inv;totalCur+=cur;
    pfLines+=`  ${h.symbol} (${h.exchange||'NSE'}): ${h.qty}sh @ ₹${h.avgPrice.toFixed(2)} avg | LTP ₹${ltp.toFixed(2)} ${chgP>=0?'+':''}${chgP.toFixed(2)}% today | P&L ${pnl>=0?'+':''}₹${Math.round(pnl)} (${pnlP>=0?'+':''}${pnlP.toFixed(1)}%)${h.stopLoss?' | SL ₹'+h.stopLoss:''}${h.target1?' | T1 ₹'+h.target1+(h.target2?' T2 ₹'+h.target2:''):''}${h.signal?' | Signal: '+h.signal:''}${h.sector?' | Sector: '+h.sector:''}\n`;
  }
  const overallPnl=totalCur-totalInv,overallPnlP=totalInv?(overallPnl/totalInv*100):0;

  // Index context
  let mktLine='';
  if(idx?.nifty)mktLine+=`Nifty ${idx.nifty.ltp.toFixed(0)} (${idx.nifty.chgP>=0?'+':''}${idx.nifty.chgP.toFixed(2)}%)  `;
  if(idx?.sensex)mktLine+=`Sensex ${idx.sensex.ltp.toFixed(0)} (${idx.sensex.chgP>=0?'+':''}${idx.sensex.chgP.toFixed(2)}%)  `;
  if(idx?.banknifty)mktLine+=`BankNifty ${idx.banknifty.ltp.toFixed(0)} (${idx.banknifty.chgP>=0?'+':''}${idx.banknifty.chgP.toFixed(2)}%)`;

  // Watchlist
  let wlLines='';
  for(const w of watchlist.slice(0,15)){
    if(!w.symbol)continue;
    const c=prices[w.symbol+'|NSE']||prices[w.symbol+'|BSE'];
    const ltp=c?c.ltp:(w.ltp||0);
    wlLines+=`  ${w.symbol}: ₹${ltp?ltp.toFixed(2):'—'}${w.signal?' ('+w.signal+')':''}${w.entryScore?' Score '+w.entryScore+'/10':''}\n`;
  }

  // Recent realised P&L (last 5)
  let realisedLines='';
  for(const r of(realised||[]).slice(-5)){
    if(!r.symbol)continue;
    realisedLines+=`  ${r.symbol}: sold ${r.qty}sh @ ₹${r.sellPrice}, P&L ${r.pnl>=0?'+':''}₹${r.pnl} (${r.type})\n`;
  }

  const istDate=new Date(Date.now()+5.5*3600000).toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const istTime=new Date(Date.now()+5.5*3600000).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

  return `You are StockSense Pro — a sharp, expert Indian stock market AI and personal portfolio advisor for Sharath.
You have LIVE access to his portfolio, prices, and market data right now.

TODAY: ${istDate}, ${istTime} IST
MARKET: ${mktLine||'Indices unavailable'}

═══════════════ PORTFOLIO (${holdings.length} holdings) ═══════════════
Invested:     ₹${Math.round(totalInv).toLocaleString('en-IN')}
Current:      ₹${Math.round(totalCur).toLocaleString('en-IN')}
Overall P&L:  ${overallPnl>=0?'+':''}₹${Math.abs(Math.round(overallPnl)).toLocaleString('en-IN')} (${overallPnlP>=0?'+':''}${overallPnlP.toFixed(1)}%)

${pfLines||'No holdings yet.'}
${realisedLines?'Recent exits:\n'+realisedLines:''}
══════════════ WATCHLIST (${watchlist.length} stocks) ══════════════
${wlLines||'Empty'}

════════════════════════════════════════════════════

AVAILABLE ACTIONS — when Sharath asks you to perform these, embed EXACTLY ONE action block at the end:
<action>{"type":"set_sl","symbol":"SYMBOL","price":NUMBER}</action>
<action>{"type":"set_target","symbol":"SYMBOL","t1":NUMBER,"t2":NUMBER}</action>
<action>{"type":"add_holding","symbol":"SYMBOL","exchange":"NSE","qty":NUMBER,"avg":NUMBER}</action>
<action>{"type":"sell_holding","symbol":"SYMBOL","qty":NUMBER,"price":NUMBER}</action>
<action>{"type":"add_watchlist","symbol":"SYMBOL","exchange":"NSE"}</action>
<action>{"type":"remove_watchlist","symbol":"SYMBOL"}</action>
<action>{"type":"add_note","text":"TEXT"}</action>

RESPONSE RULES:
1. Be concise, specific, and actionable. Max 400 words. No fluff.
2. Use ₹ for prices. Indian number format (lakhs/crores). % for returns.
3. For stock recommendations: give entry zone, stop loss, target, and timeframe.
4. For portfolio questions: reference actual holdings with real P&L numbers.
5. For market questions: give sector-level context, not just price.
6. Detect actions from natural language: "set SL for Reliance at 2300" → <action> block.
7. If asked about a stock NOT in the portfolio, give fundamental + technical analysis.
8. Reply in same language as Sharath's message (Hindi OK).
9. Do NOT add disclaimers or "consult a financial advisor" lines — Sharath wants direct advice.
10. When recommending stocks, give top 2-3 picks with clear rationale, not a list of 10.`;
}

function extractActionBlocks(text){
  const regex=/<action>([\s\S]*?)<\/action>/g;
  const actions=[];let m;
  while((m=regex.exec(text))!==null){
    try{actions.push(JSON.parse(m[1].trim()));}catch(e){}
  }
  return actions;
}

function stripActionBlocks(text){
  return text.replace(/<action>[\s\S]*?<\/action>/g,'').replace(/\n{3,}/g,'\n\n').trim();
}

async function executeActions(actions,pf,env){
  const results=[];
  let dirty=false;
  for(const a of actions){
    try{
      if(a.type==='set_sl'){
        const sym=(a.symbol||'').toUpperCase();
        const h=pf.holdings.find(x=>x.symbol===sym);
        if(h&&a.price>0){h.stopLoss=a.price;dirty=true;results.push('✅ SL set: '+sym+' → ₹'+a.price);}
        else results.push('❌ '+sym+' not in portfolio');
      }else if(a.type==='set_target'){
        const sym=(a.symbol||'').toUpperCase();
        const h=pf.holdings.find(x=>x.symbol===sym);
        if(h){
          if(a.t1>0)h.target1=a.t1;
          if(a.t2>0)h.target2=a.t2;
          dirty=true;
          results.push('✅ Targets set: '+sym+(a.t1?' T1 ₹'+a.t1:'')+(a.t2?' T2 ₹'+a.t2:''));
        }else results.push('❌ '+sym+' not in portfolio');
      }else if(a.type==='add_holding'){
        const sym=(a.symbol||'').toUpperCase();
        const xch=(a.exchange||'NSE').toUpperCase();
        const qty=parseFloat(a.qty),avg=parseFloat(a.avg);
        if(!sym||isNaN(qty)||isNaN(avg)||qty<=0||avg<=0){results.push('❌ Invalid add_holding params');continue;}
        const existing=pf.holdings.find(x=>x.symbol===sym&&(x.exchange||'NSE')===xch);
        if(existing){existing.qty=qty;existing.avgPrice=avg;dirty=true;results.push('✅ Updated: '+sym+' ×'+qty+' @ ₹'+avg);}
        else{pf.holdings.push({id:Date.now().toString(36),symbol:sym,exchange:xch,qty,avgPrice:avg,buyDate:new Date().toISOString().slice(0,10),addedAt:Date.now()});dirty=true;results.push('✅ Added: '+sym+' ×'+qty+' @ ₹'+avg);}
      }else if(a.type==='sell_holding'){
        const sym=(a.symbol||'').toUpperCase();
        const qty=parseFloat(a.qty),price=parseFloat(a.price);
        const h=pf.holdings.find(x=>x.symbol===sym);
        if(!h){results.push('❌ '+sym+' not found');continue;}
        if(qty>h.qty){results.push('❌ Only '+h.qty+' shares held');continue;}
        const pnl=(price-h.avgPrice)*qty;
        const holdDays=h.buyDate?Math.round((Date.now()-new Date(h.buyDate).getTime())/86400000):0;
        const txType=holdDays>=365?'LTCG':'STCG';
        if(!pf.realised)pf.realised=[];
        pf.realised.push({id:Date.now().toString(36),symbol:sym,exchange:h.exchange||'NSE',buyDate:h.buyDate||'—',sellDate:new Date().toISOString().slice(0,10),qty,buyPrice:h.avgPrice,sellPrice:price,pnl:Math.round(pnl*100)/100,type:txType,holdDays});
        if(qty===h.qty)pf.holdings=pf.holdings.filter(x=>x.symbol!==sym);
        else h.qty=Math.round((h.qty-qty)*1000)/1000;
        dirty=true;
        results.push('✅ Sold '+qty+' '+sym+' @ ₹'+price+' | P&L '+(pnl>=0?'+':'')+'₹'+Math.round(pnl)+' ('+txType+')');
      }else if(a.type==='add_watchlist'){
        const sym=(a.symbol||'').toUpperCase();
        if(!pf.watchlist)pf.watchlist=[];
        if(!pf.watchlist.find(x=>x.symbol===sym)){
          pf.watchlist.push({id:Date.now().toString(36),symbol:sym,exchange:(a.exchange||'NSE').toUpperCase(),addedAt:Date.now()});
          dirty=true;results.push('✅ Added '+sym+' to watchlist');
        }else results.push('ℹ '+sym+' already on watchlist');
      }else if(a.type==='remove_watchlist'){
        const sym=(a.symbol||'').toUpperCase();
        const before=pf.watchlist?.length||0;
        pf.watchlist=(pf.watchlist||[]).filter(x=>x.symbol!==sym);
        if(pf.watchlist.length<before){dirty=true;results.push('✅ Removed '+sym+' from watchlist');}
        else results.push('ℹ '+sym+' not on watchlist');
      }else if(a.type==='add_note'){
        if(!a.text){continue;}
        let notes=[];try{const raw=await env.STOCKSENSE_KV.get('journalNotes');if(raw)notes=JSON.parse(raw);}catch(e){}
        notes.push({ts:Date.now(),note:a.text.trim()});
        if(notes.length>200)notes=notes.slice(-200);
        await env.STOCKSENSE_KV.put('journalNotes',JSON.stringify(notes));
        results.push('✅ Note saved');
      }
    }catch(e){results.push('⚠ Action error: '+e.message);}
  }
  if(dirty)await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(pf));
  return results;
}

async function handleChatAgent(msg,env){
  const chatId=msg.chat&&msg.chat.id;
  const userText=(msg.text||'').trim();
  if(!chatId||!userText)return;

  // Load creds
  let token=null,orKey=null,orModel=null,pf={holdings:[],watchlist:[],realised:[],cfg:{}};
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw){pf=JSON.parse(raw);token=env.TELEGRAM_TOKEN||pf.cfg?.tgToken;orKey=env.OPENROUTER_KEY||pf.cfg?.orKey;orModel=pf.cfg?.orModel||null;}}catch(e){}
  if(!token)return;

  // No OpenRouter key → guide user
  if(!orKey){
    await tgSend(token,chatId,'🤖 <b>AI Chat not configured</b>\n\nTo enable natural language chat:\n1. Open StockSense Pro web app\n2. Go to Settings → AI Provider\n3. Enter your OpenRouter API key (free at openrouter.ai)\n4. Save settings — it syncs here automatically\n\nMeanwhile, use /help for available commands.');
    return;
  }

  // Typing indicator (fire-and-forget)
  fetch('https://api.telegram.org/bot'+token+'/sendChatAction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,action:'typing'})}).catch(()=>{});

  // Load conversation history (last 10 messages = 5 exchanges)
  let history=[];
  try{const raw=await env.STOCKSENSE_KV.get('chatHistory:'+chatId);if(raw)history=JSON.parse(raw);}catch(e){}

  // Load live prices + indices
  let prices={};
  try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  let idx=null;try{idx=await fetchIndexPrices();}catch(e){}

  // Build prompt + message array
  const systemPrompt=buildAgentSystemPrompt(pf,prices,idx);
  const messages=[
    {role:'system',content:systemPrompt},
    ...history,
    {role:'user',content:userText},
  ];

  // Call AI — use user's configured model from Settings as primary
  const aiResult=await callAI(orKey,messages,1500,orModel);
  if(!aiResult){
    await tgSend(token,chatId,'⚠️ AI is temporarily unavailable (OpenRouter rate limit or timeout).\nTry again in ~60 seconds, or use /portfolio, /price, /brief for quick info.');
    return;
  }
  const aiRaw=aiResult.text;
  const aiModelUsed=aiResult.model;

  // Parse actions + execute
  const actions=extractActionBlocks(aiRaw);
  const actionResults=actions.length>0?await executeActions(actions,pf,env):[];
  const cleanResponse=stripActionBlocks(aiRaw);

  // Update conversation history (keep last 10 msgs, 24h TTL)
  history.push({role:'user',content:userText});
  history.push({role:'assistant',content:cleanResponse});
  if(history.length>10)history=history.slice(-10);
  await env.STOCKSENSE_KV.put('chatHistory:'+chatId,JSON.stringify(history),{expirationTtl:86400});

  // Send response
  let finalText=cleanResponse;
  if(actionResults.length>0)finalText+='\n\n<i>'+actionResults.join('\n')+'</i>';
  const _req=(orModel&&orModel!=='custom')?orModel:null;
  if(_req&&aiModelUsed!==_req)finalText+='\n\n<i>⚠️ '+_req.split('/').pop()+' unavailable — used '+aiModelUsed.split('/').pop()+'</i>';
  else finalText+='\n\n<i>🤖 '+aiModelUsed.split('/').pop()+'</i>';

  // Split if > 3800 chars (Telegram 4096 limit)
  if(finalText.length>3800){
    const part1=finalText.slice(0,3800).lastIndexOf('\n')>2000?finalText.slice(0,finalText.lastIndexOf('\n',3800)):finalText.slice(0,3800);
    const part2=finalText.slice(part1.length).trim();
    await tgSend(token,chatId,part1);
    if(part2)await tgSend(token,chatId,part2);
  }else{
    await tgSend(token,chatId,finalText);
  }
}

// ── /analyze SYMBOL — deep AI analysis ───────────────────────────────────────

async function sendAnalyze(env,chatId,token,sym){
  if(!sym){await tgSend(token,chatId,'Usage: /analyze SYMBOL\nExample: /analyze RELIANCE\n\nGets AI analysis with fundamentals, technicals, and buy/sell verdict.');return;}
  const base=sym.toUpperCase().replace(/\.(NS|BO)$/i,'');
  let pf={holdings:[],watchlist:[]};
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw){pf=JSON.parse(raw);}}catch(e){}
  const orKey=env.OPENROUTER_KEY||pf.cfg?.orKey;const orModel=pf.cfg?.orModel||null;
  if(!orKey){await tgSend(token,chatId,'⚠️ OpenRouter API key not configured. Set it in StockSense Settings → AI Provider.');return;}

  // Fetch live price
  await tgSend(token,chatId,'🔍 Analyzing <b>'+escHtml(base)+'</b>... (10-20 sec)');
  const pr=await fetchLivePrice(sym);

  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  let idx=null;try{idx=await fetchIndexPrices();}catch(e){}

  // Check if in portfolio
  const h=pf.holdings.find(x=>x.symbol===base);
  const inPortfolio=h?`In portfolio: ${h.qty} shares @ ₹${h.avgPrice} avg | LTP ₹${pr?.ltp||'—'} | P&L ${h.avgPrice&&pr?.ltp?((pr.ltp-h.avgPrice)/h.avgPrice*100).toFixed(1)+'%':'—'}${h.stopLoss?' | SL ₹'+h.stopLoss:''}${h.target1?' | T1 ₹'+h.target1:''}`:'Not in portfolio';

  const mktLine=idx?`Nifty ${idx.nifty?.ltp||'—'} (${idx.nifty?.chgP>=0?'+':''}${idx.nifty?.chgP?.toFixed(2)||'0'}%)  Sensex ${idx.sensex?.ltp||'—'} BankNifty ${idx.banknifty?.ltp||'—'}`:'';

  const prompt=`Provide a comprehensive stock analysis for ${base} NSE stock. Be specific and data-driven.

Live data:
- LTP: ₹${pr?.ltp||'—'} (${pr?.chgP>=0?'+':''}${pr?.chgP?.toFixed(2)||'0'}% today)
- Day Range: ₹${pr?.low||'—'} – ₹${pr?.high||'—'}
- Prev Close: ₹${pr?.prev||'—'}
- ${inPortfolio}
- Market: ${mktLine}

Analyze and respond with these sections:
1. 📊 **Quick Verdict** (BUY/HOLD/SELL/AVOID with confidence %)
2. 📈 **Trend & Momentum** (short-term + medium-term outlook)
3. 💡 **Key Catalysts** (why it could go up)
4. ⚠️ **Key Risks** (why it could fall)
5. 🎯 **Trade Setup** (entry zone, stop loss, target 1, target 2, timeframe)
6. 📋 **Action** (what Sharath should do right now)

Keep it under 350 words. Be direct — no disclaimers.`;

  const resp=await callAI(orKey,[{role:'user',content:prompt}],1500,orModel);
  if(!resp){await tgSend(token,chatId,'⚠️ AI analysis failed. Try /price '+base+' for live price, or try again later.');return;}
  await tgSend(token,chatId,'📊 <b>'+escHtml(base)+' Analysis</b>\n\n'+resp.text+'\n\n<i>🤖 '+resp.model.split('/').pop()+'</i>');
}

// ── /recommend — AI portfolio recommendations ────────────────────────────────

async function sendRecommend(env,chatId,token,args){
  let pf={holdings:[],watchlist:[],cfg:{}};
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  const orKey=env.OPENROUTER_KEY||pf.cfg?.orKey;const orModel=pf.cfg?.orModel||null;
  if(!orKey){await tgSend(token,chatId,'⚠️ OpenRouter API key not configured. Set it in StockSense Settings → AI Provider.');return;}

  await tgSend(token,chatId,'🧠 Generating recommendations... (15-25 sec)');

  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  let idx=null;try{idx=await fetchIndexPrices();}catch(e){}

  const holdings=pf.holdings||[];
  const sectors=[...new Set(holdings.map(h=>h.sector||'Other').filter(Boolean))];
  let pfSummary='';
  for(const h of holdings){
    const key=h.symbol+'|'+(h.exchange||'NSE');
    const ltp=(prices[key]||{}).ltp||h.avgPrice;
    const pnlP=h.avgPrice&&ltp?((ltp-h.avgPrice)/h.avgPrice*100):0;
    pfSummary+=`${h.symbol} (${h.sector||'Other'}): ${pnlP>=0?'+':''}${pnlP.toFixed(1)}% | Signal: ${h.signal||'—'}${h.stopLoss?' | SL: ₹'+h.stopLoss:''}\n`;
  }
  const mktLine=idx?`Nifty ${idx.nifty?.ltp||'—'} (${idx.nifty?.chgP?.toFixed(2)||'0'}%) BankNifty ${idx.banknifty?.ltp||'—'}`:'Market data unavailable';

  const type=args[0]||'';
  const prompt=`You are a top Indian equity fund manager. Sharath's current portfolio:

${pfSummary||'No holdings yet.'}

Sectors covered: ${sectors.join(', ')||'None'}
Market: ${mktLine}
Total holdings: ${holdings.length}

${type==='sector'?'Focus on sector rotation — which sectors to overweight/underweight now?':
type==='watchlist'?'Suggest 3 stocks to add to watchlist based on current market conditions.':
type==='trim'?'Which holdings should Sharath trim or exit now? Be specific with reasons.':
`Give Sharath's top 3 actionable recommendations right now:
1. A stock to ADD to portfolio (new position or existing gap) with entry, SL, target
2. A position to TRIM or EXIT (based on valuation / signal)
3. A sector opportunity he's missing

Base your advice on:
- Portfolio gaps (overexposed/underexposed sectors)
- Current market conditions
- Stocks showing momentum + reasonable valuations
- NSE/BSE stocks only (Indian market)`}

Be specific. Give stock names, price levels, and clear rationale. No generic advice. Under 300 words.`;

  const resp=await callAI(orKey,[{role:'user',content:prompt}],1200,orModel);
  if(!resp){await tgSend(token,chatId,'⚠️ AI recommendation failed. Try again in a moment.');return;}
  await tgSend(token,chatId,'🧠 <b>AI Recommendations</b>\n\n'+resp.text+'\n\n<i>🤖 '+resp.model.split('/').pop()+'</i>');
}

// ── Telegram router ───────────────────────────────────────────────────────────

async function handleCallbackQuery(update,env){
  const cq=update.callback_query;if(!cq)return;
  const chatId=cq.message&&cq.message.chat&&cq.message.chat.id;
  const data=cq.data||'';
  let token=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)token=env.TELEGRAM_TOKEN||(JSON.parse(raw)).cfg?.tgToken;}catch(e){}
  if(!token||!chatId){await answerCallback(token||'',cq.id,'No token');return;}
  await answerCallback(token,cq.id);
  if(data==='refresh_portfolio')await sendPortfolioSnapshot(env,chatId,token);
  else if(data==='morning_brief')await sendMorningBrief(env);
  else if(data==='evening_wrap')await sendEveningWrap(env);
  else if(data==='top_movers')await sendPortfolioTop(env,chatId,token);
  else if(data==='watchlist')await sendWatchlist(env,chatId,token);
  else if(data==='earnings_week')await sendEarningsWeek(env,chatId,token);
  else if(data==='ai_recommend')await sendRecommend(env,chatId,token,[]);
  else if(data==='sector_alloc')await sendSector(env,chatId,token);
}

async function handleTelegram(request,env){
  let update;try{update=await request.json();}catch(e){return new Response('ok');}
  if(update.callback_query){await handleCallbackQuery(update,env);return new Response('ok');}
  const msg=update.message||update.edited_message;if(!msg)return new Response('ok');
  const chatId=msg.chat&&msg.chat.id;const text=(msg.text||'').trim();if(!chatId||!text)return new Response('ok');
  let token=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)token=env.TELEGRAM_TOKEN||(JSON.parse(raw)).cfg?.tgToken;}catch(e){}
  if(!token)return new Response('ok');

  const parts=text.split(/\s+/);const cmd=parts[0].toLowerCase().replace(/@.*$/,'');const args=parts.slice(1);
  const isCommand=cmd.startsWith('/');

  // ── Commands ──────────────────────────────────────────────────────────────
  if(cmd==='/portfolio'||cmd==='/p')            await sendPortfolioSnapshot(env,chatId,token);
  else if(cmd==='/brief'||cmd==='/morning'||cmd==='/today') await sendMorningBrief(env);
  else if(cmd==='/evening')                     await sendEveningWrap(env);
  else if(cmd==='/weekly'){let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}await sendWeeklyDigest(env,prices);}
  else if(cmd==='/monthly')                     await sendMonthlyDigest(env);
  else if(cmd==='/alerts'){const{prices:ap,prevPrices:pp}=await syncPrices(env);await checkAndSendAlerts(env,ap,pp);}
  else if(cmd==='/price')                       await sendPriceQuery(env,chatId,token,args[0]);
  else if(cmd==='/top')                         await sendPortfolioTop(env,chatId,token);
  else if(cmd==='/add')                         await addOrUpdateHolding(env,chatId,token,args);
  else if(cmd==='/sl')                          await updateStopLoss(env,chatId,token,args);
  else if(cmd==='/target'||cmd==='/t')          await updateTarget(env,chatId,token,args);
  else if(cmd==='/note')                        await addJournalNote(env,chatId,token,args.join(' '));
  else if(cmd==='/notes')                       await sendNotes(env,chatId,token,args);
  else if(cmd==='/earnings')                    await sendEarningsWeek(env,chatId,token);
  else if(cmd==='/news')                        await sendNews(env,chatId,token,args[0]);
  else if(cmd==='/ipo')                         await sendIPO(env,chatId,token);
  else if(cmd==='/watchlist'||cmd==='/wl')      await sendWatchlist(env,chatId,token);
  else if(cmd==='/sell')                        await sellHolding(env,chatId,token,args);
  else if(cmd==='/sector')                      await sendSector(env,chatId,token);
  else if(cmd==='/rebalance'||cmd==='/rb')      await sendRebalance(env,chatId,token);
  else if(cmd==='/discipline'||cmd==='/checkup') await sendDiscipline(env,chatId,token);
  else if(cmd==='/health'||cmd==='/status')     await sendHealth(env,chatId,token);
  else if(cmd==='/backups')                     await sendBackups(env,chatId,token);
  else if(cmd==='/model')                       await sendModel(env,chatId,token,args.join(' ').trim());
  // ── v11 AI commands ──────────────────────────────────────────────────────
  else if(cmd==='/ask'){
    // /ask TEXT — explicit AI query
    const question=args.join(' ');
    if(!question){await tgSend(token,chatId,'Usage: /ask YOUR QUESTION\nExample: /ask Should I add more HDFC Bank?');return new Response('ok');}
    await handleChatAgent({...msg,text:question},env);
  }
  else if(cmd==='/analyze'||cmd==='/a')         await sendAnalyze(env,chatId,token,args[0]);
  else if(cmd==='/recommend'||cmd==='/rec')     await sendRecommend(env,chatId,token,args);
  else if(cmd==='/reset'){
    // Clear conversation history
    try{await env.STOCKSENSE_KV.delete('chatHistory:'+chatId);}catch(e){}
    await tgSend(token,chatId,'🔄 Conversation history cleared.\nThe AI will start fresh on your next message.');
  }
  else if(cmd==='/help'||cmd==='/start'){
    const helpText='<b>🤖 StockSense Pro Bot v11</b>\n\n'
      +'💬 <b>AI Chat (just type naturally!)</b>\n'
      +'Any message without / goes to the AI assistant:\n'
      +'"How is my portfolio doing?"\n'
      +'"Should I buy ZOMATO now?"\n'
      +'"Set SL for Reliance at 2300"\n'
      +'"What sectors am I missing?"\n\n'
      +'🧠 <b>AI Commands</b>\n'
      +'/ask TEXT — direct AI query\n'
      +'/analyze SYM — deep analysis + trade setup\n'
      +'/recommend — AI portfolio recommendations\n'
      +'/recommend sector — sector rotation advice\n'
      +'/recommend trim — what to exit\n'
      +'/reset — clear AI conversation memory\n\n'
      +'📊 <b>Market</b>\n'
      +'/price SYM — live price\n'
      +'/top — today\'s portfolio movers\n'
      +'/news SYM — latest headlines\n'
      +'/ipo — IPO calendar\n\n'
      +'💼 <b>Portfolio</b>\n'
      +'/portfolio (/p) — snapshot + quick buttons\n'
      +'/add SYM QTY AVG — add/update holding\n'
      +'/sell SYM QTY PRICE — book exit\n'
      +'/sl SYM PRICE — set stop loss\n'
      +'/target SYM T1 [T2] — set targets\n'
      +'/sector — sector allocation\n'
      +'/rebalance (/rb) — trim to your caps\n'
      +'/discipline — stop/target/cap audit\n'
      +'/health — status + last sync\n'
      +'/backups — saved snapshots\n'
      +'/model — view/set AI model\n'
      +'/watchlist (/wl) — watchlist\n\n'
      +'📋 <b>Digests</b>\n'
      +'/brief — morning brief\n'
      +'/evening — evening wrap\n'
      +'/weekly — week P&amp;L\n'
      +'/monthly — MTD digest\n'
      +'/earnings — upcoming earnings\n\n'
      +'📓 <b>Journal</b>\n'
      +'/note TEXT — save trade note\n'
      +'/notes [N] — read last N notes\n\n'
      +'🔔 <b>Auto Alerts (every 15 min, market hours):</b>\n'
      +'SL breach · T1/T2 hit · Trailing SL\n'
      +'≥3% in 15-min window · Earnings (24h ahead)\n\n'
      +'🕐 <b>Scheduled:</b> 8:55 AM IST weekdays → Morning brief';
    await tgSend(token,chatId,helpText);
  }
  else if(!isCommand){
    // ── Plain text → AI Chat Agent ─────────────────────────────────────────
    await handleChatAgent(msg,env);
  }
  else{
    // Unknown command
    await tgSend(token,chatId,'Unknown command. Send /help for the full list, or just type your question naturally to chat with the AI.');
  }

  return new Response('ok');
}

async function sendRebalance(env,chatId,token){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf){await tgSend(token,chatId,'No portfolio data.');return;}
  const cfg=pf.cfg||{};
  const maxStock=+cfg.maxStockPct||15, maxSector=+cfg.maxSectorPct||25, minPos=+cfg.minPosPct||2;
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  let T=0;const rows=[];
  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty)continue;
    const c=prices[h.symbol+'|'+(h.exchange||'NSE')];
    const ltp=(c&&c.ltp)||h.ltp||h.avgPrice||0;const v=h.qty*ltp;if(v<=0)continue;
    T+=v;rows.push({s:h.symbol,sec:h.sector||'Other',v});
  }
  if(T<=0){await tgSend(token,chatId,'No live prices cached yet — try after a sync.');return;}
  rows.forEach(r=>r.w=r.v/T*100);rows.sort((a,b)=>b.w-a.w);
  const secM={};rows.forEach(r=>secM[r.sec]=(secM[r.sec]||0)+r.v);
  const overSec=Object.entries(secM).map(([x,v])=>({s:x,pct:v/T*100,trim:v-T*maxSector/100})).filter(x=>x.trim>0).sort((a,b)=>b.trim-a.trim);
  const overStk=rows.filter(r=>r.w>maxStock).map(r=>({s:r.s,pct:r.w,trim:r.v-T*maxStock/100}));
  const tail=rows.filter(r=>r.w<minPos);const tailVal=tail.reduce((a,b)=>a+b.v,0);
  const overNames=new Set(overSec.map(x=>x.s));
  const freed=overSec.reduce((a,b)=>a+b.trim,0)+tail.filter(r=>!overNames.has(r.sec)).reduce((a,b)=>a+b.v,0);
  const inr=n=>'₹'+Math.round(n).toLocaleString('en-IN');
  let m='⚖️ <b>Rebalance Check</b>\n'+inr(T)+' · '+rows.length+' holdings\nCaps: '+maxStock+'%/stock · '+maxSector+'%/sector\n';
  if(!overSec.length&&!overStk.length&&!tail.length){
    m+='--------------------\n✅ Within your caps and well-sized — no rebalance needed.';
    await tgSend(token,chatId,m);return;
  }
  if(overSec.length){m+='--------------------\n🔴 <b>Sector over cap:</b>\n';for(const x of overSec)m+=x.s+' '+x.pct.toFixed(0)+'% → '+maxSector+'% (trim '+inr(x.trim)+')\n';}
  if(overStk.length){m+='--------------------\n🟠 <b>Stock over cap:</b>\n';for(const x of overStk)m+=x.s+' '+x.pct.toFixed(0)+'% → '+maxStock+'% (trim '+inr(x.trim)+')\n';}
  if(tail.length){m+='--------------------\n🧹 <b>Tail (under '+minPos+'%):</b> '+tail.length+' = '+inr(tailVal)+'\n'+tail.slice(0,10).map(r=>r.s).join(', ')+(tail.length>10?'…':'')+'\n<i>too small to move the needle — consolidate</i>\n';}
  m+='--------------------\n💰 <b>Frees ~'+inr(freed)+'</b> to redeploy into conviction names or an index sleeve.\nNot advice — your call.';
  await tgSend(token,chatId,m);
}

function disciplineScan(pf,prices){
  const cfg=pf.cfg||{};const maxStock=+cfg.maxStockPct||15,maxSector=+cfg.maxSectorPct||25;
  let T=0;const rows=[];
  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty)continue;
    const c=prices[h.symbol+'|'+(h.exchange||'NSE')];
    const ltp=(c&&c.ltp)||h.ltp||h.avgPrice||0;const v=h.qty*ltp;if(v<=0)continue;
    T+=v;rows.push({s:h.symbol,sec:h.sector||'Other',v,noStop:!h.stopLoss,noTarget:!h.target1});
  }
  rows.forEach(r=>r.w=T?r.v/T*100:0);
  const secM={};rows.forEach(r=>secM[r.sec]=(secM[r.sec]||0)+r.v);
  const overSector=Object.keys(secM).filter(x=>T&&secM[x]/T*100>maxSector);
  const overStock=rows.filter(r=>r.w>maxStock).map(r=>r.s);
  const noStop=rows.filter(r=>r.noStop).map(r=>r.s);
  const noTarget=rows.filter(r=>r.noTarget).map(r=>r.s);
  const armed=rows.filter(r=>!r.noStop&&!r.noTarget).length;
  return {total:rows.length,noStop,noTarget,overStock,overSector,armed,maxStock,maxSector};
}

async function sendDiscipline(env,chatId,token){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf){await tgSend(token,chatId,'No portfolio data.');return;}
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  const d=disciplineScan(pf,prices);
  const lst=a=>a.slice(0,12).join(', ')+(a.length>12?'…':'');
  let m='🩺 <b>Discipline Check</b>\n'+d.total+' holdings · '+d.armed+'/'+d.total+' armed (stop + target)\n--------------------\n';
  m+= d.noStop.length? '🛑 <b>No stop-loss:</b> '+d.noStop.length+'\n'+lst(d.noStop)+'\n' : '✅ Every position has a stop-loss\n';
  m+= d.noTarget.length? '🎯 <b>No target:</b> '+d.noTarget.length+'\n'+lst(d.noTarget)+'\n' : '✅ Every position has a target\n';
  if(d.overStock.length||d.overSector.length){
    m+='⚖️ <b>Over caps:</b> '+[...d.overStock.map(x=>x+' (stock)'),...d.overSector.map(x=>x+' (sector)')].join(', ')+' → /rebalance\n';
  } else { m+='✅ Within your '+d.maxStock+'%/'+d.maxSector+'% caps\n'; }
  m+='--------------------\n📝 Log a one-line thesis + exit for each name via /note SYM reason &amp; exit.\nPre-commit stop, target &amp; size before buying — then just approve the alerts.';
  await tgSend(token,chatId,m);
}

async function sendHealth(env,chatId,token){
  let pc=null;try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)pc=JSON.parse(raw);}catch(e){}
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  const cfg=(pf&&pf.cfg)||{};
  const ist=new Date(Date.now()+5.5*3600000);
  let m='🩺 <b>Health</b>\n';
  if(pc&&pc.ts){
    const ageMin=Math.round((Date.now()-pc.ts)/60000);
    const t=new Date(pc.ts+5.5*3600000).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    const nP=pc.prices?Object.keys(pc.prices).length:0;
    m+='Last sync: '+t+' IST ('+ageMin+'m ago)\n'+nP+' symbols cached\n';
    const h=ist.getUTCHours()+ist.getUTCMinutes()/60;const dow=ist.getUTCDay();
    const mkt=(dow>=1&&dow<=5)&&(h>=9.25&&h<=15.6);
    m+=(mkt&&ageMin>30)?'🔴 Stale during market hours — sync cron may be down.\n':'🟢 Healthy\n';
  } else { m+='⚠️ No price cache found.\n'; }
  m+='Holdings: '+((pf&&pf.holdings)?pf.holdings.length:0)+'\n';
  m+='AI model: '+(cfg.orModel||'—')+'\n';
  m+='Token: '+(env.TELEGRAM_TOKEN?'Workers Secret 🔐':'KV fallback');
  await tgSend(token,chatId,m);
}

async function sendBackups(env,chatId,token){
  let b=[];try{const raw=await env.STOCKSENSE_KV.get('portfolioBackups');if(raw)b=JSON.parse(raw);}catch(e){}
  if(!b.length){await tgSend(token,chatId,'💾 No backups yet — first snapshot is taken at the next evening wrap (~3:35 PM IST).');return;}
  let m='💾 <b>Backups</b> (last '+b.length+')\n';
  for(const x of b.slice().reverse()){const t=new Date(x.ts+5.5*3600000).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});m+=t+' IST · '+((x.holdings||[]).length)+' holdings\n';}
  m+='\nStored in KV (portfolioBackups). Ask to restore one if ever needed.';
  await tgSend(token,chatId,m);
}

// ── Resumable AI analysis queue ───────────────────────────────────────────────
// Mirrors lib/aiqueue.js (unit-tested). Runs in the */15 market-hours cron and
// on /ai-start. Uses the user's saved model; pauses on 429 and resumes next tick.
const AQ_IST_OFFSET=(5*60+30)*60*1000;
const AQ_MINUTE=60*1000;
const AQ_DAILY_CAP=200;           // REQUESTS/day (account has $10 credit → 1000/day free)
const AQ_PER_RUN_CAP=8;           // requests per invocation (~7-15s/call fits the Worker)
// Batch 1: the $10 credit gives ~1000 req/day, so quota is no longer the constraint —
// one stock per request maximises reliability (small models drop objects in multi-item batches).
const AQ_BATCH_SIZE=1;
// As of Jun 2026 most :free models are discontinued (404) and llama-3.3-70b:free is
// provider-throttled (429). With the account's $10 credit, deepseek-chat-v3 is reliable
// and extremely cheap (~a fraction of a cent per full 133-stock pass at batch 6).
// Non-reasoning nemotron: ~7s/call, clean JSON, free. (The :reasoning sibling takes
// 40-90s/call and Cloudflare Workers kill the task before it returns — unusable here.)
const AQ_DEFAULT_MODEL='nvidia/nemotron-3-nano-30b-a3b:free';
// 'openrouter/free' is an AUTO-ROUTER that can land on content-safety models which
// refuse financial analysis ("Unauthorized Advice"); map router/empty → reliable model.
function aq_resolveModel(m){return (!m||m==='openrouter/free'||m==='openrouter/auto')?AQ_DEFAULT_MODEL:m;}
const AQ_SYS='You are a financial-analysis assistant helping the portfolio OWNER review their OWN holdings for personal record-keeping. This is permitted and not advice to a third party. Respond with ONLY the requested JSON.';

function aq_dayKeyIST(now){return new Date(now+AQ_IST_OFFSET).toISOString().slice(0,10);}
function aq_isMarketHours(now){const ist=new Date(now+AQ_IST_OFFSET);const dow=ist.getUTCDay();if(dow===0||dow===6)return false;const mins=ist.getUTCHours()*60+ist.getUTCMinutes();return mins>=9*60&&mins<=16*60;}
function aq_nextISTMidnight(now){const ist=now+AQ_IST_OFFSET;const ds=Math.floor(ist/86400000)*86400000;return (ds+86400000)-AQ_IST_OFFSET;}
function aq_buildQueue(holdings,watchlist){
  const seen=new Set(),out=[];
  const add=(row,type)=>{if(!row||!row.symbol)return;const exch=row.exchange||'NSE';const k=row.symbol+'|'+exch;if(seen.has(k))return;seen.add(k);out.push({sym:row.symbol,exch,type});};
  for(const h of(holdings||[]))add(h,'holding');
  for(const w of(watchlist||[]))add(w,'watch');
  return out;
}
function aq_initJob(queue,model,now,dailyCap){
  return {status:queue.length?'running':'done',queue,cursor:0,total:queue.length,done:0,failed:0,model:model||null,dayKey:aq_dayKeyIST(now),dailyCount:0,dailyCap:dailyCap||AQ_DAILY_CAP,pausedUntil:0,startedAt:now,updatedAt:now,lastError:null};
}
function aq_rolloverDaily(job,now){const t=aq_dayKeyIST(now);if(job.dayKey!==t){job.dayKey=t;job.dailyCount=0;}return job;}
function aq_readResetHeader(headers,now){
  const reset=headers['x-ratelimit-reset'];
  if(reset!=null&&reset!==''){const n=Number(reset);if(!isNaN(n)){if(n>1e12)return n;if(n>1e9)return n*1000;if(n>0)return now+n*1000;}}
  const retry=headers['retry-after'];
  if(retry!=null&&retry!==''){const n=Number(retry);if(!isNaN(n)&&n>0)return now+n*1000;}
  return 0;
}
function aq_parseRateLimit(resp,now){
  const code=resp.status||(resp.body&&resp.body.error&&resp.body.error.code);
  if(code!==429)return{limited:false,kind:null,resetAt:0};
  const msg=((resp.body&&resp.body.error&&resp.body.error.message)||'').toLowerCase();
  const isDay=/per-?day|daily|free-models-per-day/.test(msg);
  const resetAt=aq_readResetHeader(resp.headers||{},now);
  if(resetAt)return{limited:true,kind:isDay?'day':'minute',resetAt};
  return{limited:true,kind:isDay?'day':'minute',resetAt:isDay?aq_nextISTMidnight(now):now+AQ_MINUTE};
}
function aq_applyPause(job,rl,now){job.status='paused';job.pausedUntil=rl.resetAt||(now+AQ_MINUTE);job.lastError='rate-limited ('+(rl.kind||'unknown')+')';job.updatedAt=now;return job;}
function aq_advance(job,ok,now){job.cursor+=1;job.dailyCount+=1;if(ok)job.done+=1;else job.failed+=1;job.updatedAt=now;if(job.cursor>=job.total){job.status='done';job.pausedUntil=0;}else if(job.status==='paused'){job.status='running';}return job;}
function aq_peekBatch(job,size){if(!job||aq_isComplete(job))return [];const out=[];let i=job.cursor;const type=job.queue[i]&&job.queue[i].type;while(i<job.total&&out.length<size&&job.queue[i].type===type){out.push(job.queue[i]);i++;}return out;}
function aq_advanceBatch(job,processed,ok,now){job.cursor+=processed;job.dailyCount+=1;job.done+=ok;job.failed+=(processed-ok);job.updatedAt=now;if(job.cursor>=job.total){job.status='done';job.pausedUntil=0;}else if(job.status==='paused'){job.status='running';}return job;}
function aq_isComplete(job){return !!job&&job.cursor>=job.total;}
function aq_canRunNow(job,now){if(!job||aq_isComplete(job))return false;if(job.status==='idle'||job.status==='done')return false;aq_rolloverDaily(job,now);if(job.dailyCount>=job.dailyCap)return false;if(job.pausedUntil&&now<job.pausedUntil)return false;return true;}
function aq_peek(job){if(!job||aq_isComplete(job))return null;return job.queue[job.cursor]||null;}
function aq_extractJSON(text){
  if(!text)return null;
  let s=text.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<thinking>[\s\S]*?<\/thinking>/gi,'').replace(/<reasoning>[\s\S]*?<\/reasoning>/gi,'').replace(/<reflection>[\s\S]*?<\/reflection>/gi,'').trim();
  for(const cand of [s,text]){
    try{return JSON.parse(cand.trim());}catch(e){}
    const md=cand.match(/```(?:json)?\s*([\s\S]*?)```/);if(md){try{return JSON.parse(md[1].trim());}catch(e){}}
    const fb=cand.indexOf('{'),lb=cand.lastIndexOf('}');if(fb>=0&&lb>fb){try{return JSON.parse(cand.slice(fb,lb+1));}catch(e){}}
  }
  return null;
}
function aq_extractObjects(text){if(!text)return [];const objs=[];let depth=0,start=-1,inStr=false,esc=false;for(let i=0;i<text.length;i++){const c=text[i];if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inStr=false;continue;}if(c==='"'){inStr=true;continue;}if(c==='{'){if(depth===0)start=i;depth++;}else if(c==='}'){if(depth>0){depth--;if(depth===0&&start>=0){try{objs.push(JSON.parse(text.slice(start,i+1)));}catch(e){}start=-1;}}}}return objs;}
async function aq_callModelOnce(orKey,model,messages,maxTokens){
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+orKey,'HTTP-Referer':'https://stocksense-pro.pages.dev/','X-Title':'StockSense Pro'},
      body:JSON.stringify({model,messages,max_tokens:maxTokens,temperature:0.4}),
      signal:AbortSignal.timeout(40000),
    });
    let body=null;try{body=await r.json();}catch(e){}
    const headers={};r.headers.forEach((v,k)=>headers[k.toLowerCase()]=v);
    const text=body&&body.choices&&body.choices[0]&&body.choices[0].message&&body.choices[0].message.content;
    return {ok:r.ok&&!!text,status:r.status,headers,body,text:text||null};
  }catch(e){return {ok:false,status:0,headers:{},body:null,text:null,err:e.message};}
}
function aq_buildPrompt(item,row,ltp,chgP){
  const sym=item.sym,exch=item.exch,sector=(row&&row.sector)||'Unknown';
  if(item.type==='holding'){
    const avg=row&&row.avgPrice||ltp,qty=row&&row.qty||0;
    const pnlP=avg?((ltp-avg)/avg*100).toFixed(1):'0';
    const sl=row&&row.stopLoss?(' Current SL ₹'+row.stopLoss+'.'):'';
    const t1=row&&row.target1?(' T1 ₹'+row.target1+'.'):'';
    return `You are an equity analyst. Holding ${sym} (${exch}), sector ${sector}: ${qty} sh @ avg ₹${avg}, LTP ₹${ltp} (${chgP>=0?'+':''}${chgP}% today), unrealised ${pnlP}%.${sl}${t1}\nReply ONLY compact JSON, no markdown: {"signal":"STRONG BUY|BUY MORE|HOLD|REDUCE|EXIT","stopLoss":<price>,"target1":<price>,"target2":<price>,"confidence":<1-10>,"action":"<1 sentence>","reasoning":"<2 sentences with numbers>","tradeType":"SHORT_TERM|LONG_TERM|BOTH"}`;
  }
  return `You are an equity analyst evaluating a fresh entry. Stock ${sym} (${exch}), sector ${sector}, LTP ₹${ltp} (${chgP>=0?'+':''}${chgP}% today).\nReply ONLY compact JSON, no markdown: {"decision":"ENTER NOW|WAIT|AVOID","entryScore":<0-10>,"conviction":"HIGH|MEDIUM|LOW","whyEnter":"<specific price/catalyst reason>","whyWait":"<condition that would trigger entry>"}`;
}
function aq_rowFor(item,pf){
  if(item.type==='holding')return (pf.holdings||[]).find(h=>h.symbol===item.sym&&(h.exchange||'NSE')===item.exch);
  return (pf.watchlist||[]).find(w=>w.symbol===item.sym);
}
function aq_buildBatchPrompt(items,pf,prices){
  const type=items[0].type;
  const lines=items.map((it,i)=>{
    const row=aq_rowFor(it,pf),pc=prices[it.sym+'|'+it.exch]||{};
    const ltp=pc.ltp||(row&&row.ltp)||(row&&row.avgPrice)||0;
    const chgP=(+(pc.chgP||0)).toFixed(2);
    const sector=(row&&row.sector)||'Unknown';
    if(type==='holding'){
      const avg=(row&&row.avgPrice)||ltp,qty=(row&&row.qty)||0;
      const pnlP=avg?(((ltp-avg)/avg)*100).toFixed(1):'0';
      const sl=row&&row.stopLoss?(' SL ₹'+row.stopLoss):'';const t1=row&&row.target1?(' T1 ₹'+row.target1):'';
      return `${i+1}. ${it.sym} (${it.exch}) sector ${sector}: ${qty}sh @ avg ₹${avg}, LTP ₹${ltp} (${chgP}% today), unrealised ${pnlP}%.${sl}${t1}`;
    }
    return `${i+1}. ${it.sym} (${it.exch}) sector ${sector}, LTP ₹${ltp} (${chgP}% today).`;
  }).join('\n');
  const n=items.length;
  if(type==='holding'){
    return `You are an equity analyst. Analyse the ${n} holdings below. Reply ONLY a JSON array of EXACTLY ${n} objects (no markdown), one per holding IN THE SAME ORDER, each including its "sym".\nObject schema: {"sym":"<symbol>","signal":"STRONG BUY|BUY MORE|HOLD|REDUCE|EXIT","stopLoss":<price>,"target1":<price>,"target2":<price>,"confidence":<1-10>,"action":"<1 sentence>","reasoning":"<1-2 sentences with numbers>","tradeType":"SHORT_TERM|LONG_TERM|BOTH"}\nHoldings:\n${lines}`;
  }
  return `You are an equity analyst evaluating fresh entries. Analyse the ${n} stocks below. Reply ONLY a JSON array of EXACTLY ${n} objects (no markdown), one per stock IN THE SAME ORDER, each including its "sym".\nObject schema: {"sym":"<symbol>","decision":"ENTER NOW|WAIT|AVOID","entryScore":<0-10>,"conviction":"HIGH|MEDIUM|LOW","whyEnter":"<specific reason>","whyWait":"<condition to trigger entry>"}\nStocks:\n${lines}`;
}
async function aq_analyzeBatch(items,pf,prices,model,orKey){
  const prompt=aq_buildBatchPrompt(items,pf,prices);
  // The free nemotron model intermittently returns empty/unparseable output, so
  // retry up to 3 times (50% → ~87% per stock). Stop early on 429 (pause) or success.
  let arr=null,lastErr='no-objects';
  for(let attempt=0;attempt<3 && !(arr&&arr.length);attempt++){
    const resp=await aq_callModelOnce(orKey,model,[{role:'system',content:AQ_SYS},{role:'user',content:prompt}],400*items.length+600);
    const rl=aq_parseRateLimit(resp,Date.now());
    if(rl.limited)return {ok:false,rl,results:[]};
    if(!resp.ok||!resp.text){lastErr=resp.err||('http '+resp.status);continue;}
    let a=aq_extractJSON(resp.text);
    if(!Array.isArray(a))a=aq_extractObjects(resp.text);
    if(a&&a.length){arr=a;break;}
    lastErr='no-objects';
  }
  if(!arr||!arr.length)return {ok:false,err:lastErr,results:[]};
  const bySym={};for(const o of arr){if(o&&o.sym)bySym[String(o.sym).toUpperCase()]=o;}
  const results=items.map((it,idx)=>{const f=bySym[it.sym.toUpperCase()]||arr[idx]||null;return {item:it,ok:!!(f&&typeof f==='object'),fields:f||{aiError:'missing in batch response'}};});
  return {ok:true,results};
}
async function aq_analyzeOne(item,pf,prices,model,orKey){
  const key=item.sym+'|'+item.exch,pc=prices[key]||{};
  let row=null;
  if(item.type==='holding')row=(pf.holdings||[]).find(h=>h.symbol===item.sym&&(h.exchange||'NSE')===item.exch);
  else row=(pf.watchlist||[]).find(w=>w.symbol===item.sym);
  const ltp=pc.ltp||(row&&row.ltp)||(row&&row.avgPrice)||0;
  const chgP=+(pc.chgP||0).toFixed?(+(pc.chgP||0)).toFixed(2):0;
  const resp=await aq_callModelOnce(orKey,model,[{role:'user',content:aq_buildPrompt(item,row,ltp,chgP)}],600);
  const rl=aq_parseRateLimit(resp,Date.now());
  if(rl.limited)return {ok:false,rl};
  if(!resp.ok||!resp.text)return {ok:false,err:resp.err||('http '+resp.status)};
  const j=aq_extractJSON(resp.text);
  if(!j)return {ok:false,err:'unparseable'};
  return {ok:true,result:j};
}
async function aq_loadJob(env){try{const raw=await env.STOCKSENSE_KV.get('aiJob');return raw?JSON.parse(raw):null;}catch(e){return null;}}
async function aq_saveJob(env,job){job.updatedAt=Date.now();try{await env.STOCKSENSE_KV.put('aiJob',JSON.stringify(job));}catch(e){}}
async function aq_saveResult(env,item,fields,model){
  let store={updatedAt:0,items:{}};try{const raw=await env.STOCKSENSE_KV.get('aiResults');if(raw)store=JSON.parse(raw);}catch(e){}
  if(!store.items)store.items={};
  store.items[item.sym+'|'+item.exch]=Object.assign({sym:item.sym,exch:item.exch,type:item.type},fields,{model,analysedAt:Date.now()});
  store.updatedAt=Date.now();
  try{await env.STOCKSENSE_KV.put('aiResults',JSON.stringify(store));}catch(e){}
}
function aq_fmtMsg(item,f,prices){
  const pc=(prices&&prices[item.sym+'|'+item.exch])||{};
  const ltp=pc.ltp!=null?('₹'+pc.ltp):'';
  if(item.type==='holding'){
    return `🤖 <b>${item.sym}</b>${ltp?(' · '+ltp):''}\nSignal: <b>${f.signal||'—'}</b> · Conf ${f.confidence!=null?f.confidence:'—'}/10\n`+
      (f.action?('🎯 '+f.action+'\n'):'')+
      `SL ₹${f.stopLoss!=null?f.stopLoss:'—'} · T1 ₹${f.target1!=null?f.target1:'—'}`+(f.target2!=null?(' · T2 ₹'+f.target2):'')+
      (f.reasoning?('\n💡 '+f.reasoning):'');
  }
  return `🔭 <b>${item.sym}</b>${ltp?(' · '+ltp):''} (watch)\nDecision: <b>${f.decision||'—'}</b> · Score ${f.entryScore!=null?f.entryScore:'—'}/10${f.conviction?(' · '+f.conviction):''}\n`+
    (f.whyEnter?('✅ '+f.whyEnter+'\n'):'')+(f.whyWait?('⏳ '+f.whyWait):'');
}
async function startAIJob(env,modelOverride){
  let pf={holdings:[],watchlist:[],cfg:{}};try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  const queue=aq_buildQueue(pf.holdings||[],pf.watchlist||[]);
  const model=aq_resolveModel(modelOverride||(pf.cfg&&pf.cfg.orModel));
  const job=aq_initJob(queue,model,Date.now(),AQ_DAILY_CAP);
  await aq_saveJob(env,job);
  return job;
}
async function runAIQueue(env,perRunCap,opts){
  perRunCap=perRunCap||AQ_PER_RUN_CAP;opts=opts||{};
  // Automatic (cron) runs only during IST market hours so we never spend quota
  // on stale weekend/overnight prices. Manual triggers pass force:true.
  if(!opts.force&&!aq_isMarketHours(Date.now()))return {ran:0,status:'market-closed'};
  let job=await aq_loadJob(env);
  if(!job)return {ran:0,status:'none'};
  aq_rolloverDaily(job,Date.now());
  if(!aq_canRunNow(job,Date.now())){await aq_saveJob(env,job);return {ran:0,status:job.status};}
  let pf={holdings:[],watchlist:[],cfg:{}};try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
  const orKey=env.OPENROUTER_KEY||(pf.cfg&&pf.cfg.orKey);
  const model=aq_resolveModel(job.model||(pf.cfg&&pf.cfg.orModel));
  const tgToken=env.TELEGRAM_TOKEN||(pf.cfg&&pf.cfg.tgToken);const tgChatId=pf.cfg&&pf.cfg.tgChatId;
  if(!orKey){job.status='paused';job.lastError='no OpenRouter key';job.pausedUntil=Date.now()+3600000;await aq_saveJob(env,job);return {ran:0,status:'no-key'};}
  let ran=0; // requests this run
  while(ran<perRunCap&&aq_canRunNow(job,Date.now())){
    const batch=aq_peekBatch(job,AQ_BATCH_SIZE);
    if(!batch.length)break;
    let res;try{res=await aq_analyzeBatch(batch,pf,prices,model,orKey);}catch(e){res={ok:false,err:e.message,results:[]};}
    if(res.rl&&res.rl.limited){aq_applyPause(job,res.rl,Date.now());await aq_saveJob(env,job);return {ran,status:'paused',pausedUntil:job.pausedUntil};}
    let ok=0;
    if(res.ok&&res.results){for(const r of res.results){if(r.ok){await aq_saveResult(env,r.item,r.fields,model);ok++;if(tgToken&&tgChatId){try{await tgSend(tgToken,tgChatId,aq_fmtMsg(r.item,r.fields,prices));}catch(e){}}}}}
    aq_advanceBatch(job,batch.length,ok,Date.now());
    if(!res.ok)job.lastError=res.err||'batch failed';
    ran++;
    await aq_saveJob(env,job);
  }
  await aq_saveJob(env,job);
  return {ran,status:job.status};
}

async function sendModel(env,chatId,token,arg){
  let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf){await tgSend(token,chatId,'No portfolio data.');return;}
  if(!arg){
    const cur=(pf.cfg&&pf.cfg.orModel)||'(none — using default cascade, llama-3.3-70b first)';
    await tgSend(token,chatId,'🤖 <b>AI model</b>\nCurrent: <code>'+cur+'</code>\n\nSet one with:\n<code>/model MODEL_ID</code>\n\nSome valid free models:\n• nvidia/nemotron-3-ultra-550b-a55b:free\n• google/gemma-4-31b-it:free\n• deepseek/deepseek-chat-v3-0324\n\nFull list: openrouter.ai/models');
    return;
  }
  let valid=null;
  try{const list=await fetch('https://openrouter.ai/api/v1/models').then(r=>r.json());valid=(list.data||[]).some(m=>m.id===arg);}catch(e){valid=null;}
  if(valid===false){await tgSend(token,chatId,'⚠️ <code>'+arg+'</code> is not a valid OpenRouter model id.\nCheck the exact id at openrouter.ai/models');return;}
  pf.cfg=pf.cfg||{};pf.cfg.orModel=arg;
  try{await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(pf));}catch(e){await tgSend(token,chatId,'⚠️ Could not save: '+e.message);return;}
  await tgSend(token,chatId,'✅ AI model set to <code>'+arg+'</code>\nAll chat, /ask, /analyze &amp; /recommend will use this exact model now (it falls back only if the model is down, and tells you when it does).');
}

// ── Worker entry point ────────────────────────────────────────────────────────

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    // ── Endpoint auth guard (added 2026-06-19): require secret on webhook + trigger URLs ──
    {const _p=url.pathname;
     if(_p==='/telegram'||_p==='/sync'||_p==='/brief'||_p==='/evening'||_p==='/weekly'||_p==='/monthly'||_p==='/ai-start'||_p==='/ai-run'||_p==='/ai-stop'||_p==='/fiidii-refresh'||_p==='/deals-refresh'){
       let _sec=null;try{const _r=await env.STOCKSENSE_KV.get('portfolio');const _tok=env.TELEGRAM_TOKEN||(_r?(JSON.parse(_r).cfg||{}).tgToken:null);
         if(_tok){const _h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ss-webhook:'+_tok));_sec=[...new Uint8Array(_h)].map(x=>x.toString(16).padStart(2,'0')).join('');}
       }catch(e){}
       if(_sec){let _ok=true;
         if(_p==='/telegram'){if(request.method==='POST')_ok=request.headers.get('x-telegram-bot-api-secret-token')===_sec;}
         else{_ok=url.searchParams.get('key')===_sec;}
         if(!_ok)return new Response('forbidden',{status:403});
       }
     }}
    if(url.pathname==='/telegram'){if(request.method==='POST')return handleTelegram(request,env);return new Response('StockSense Telegram webhook v11',{status:200});}
    if(url.pathname==='/sync'){const{fetched,prices,prevPrices}=await syncPrices(env);ctx.waitUntil(checkAndSendAlerts(env,prices,prevPrices));return new Response(JSON.stringify({fetched}),{headers:{'Content-Type':'application/json'}});}
    if(url.pathname==='/brief'){ctx.waitUntil(sendMorningBrief(env));return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}
    if(url.pathname==='/evening'){ctx.waitUntil(sendEveningWrap(env));return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}
    if(url.pathname==='/weekly'){ctx.waitUntil((async()=>{let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}await sendWeeklyDigest(env,prices);})());return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}
    if(url.pathname==='/monthly'){ctx.waitUntil(sendMonthlyDigest(env));return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}
    if(url.pathname==='/indices'){const idx=await fetchIndexPrices();return new Response(JSON.stringify(idx||{}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});}
    if(url.pathname==='/market-news'){
      // Google News RSS is reliably blocked (HTTP 503 "unusual traffic" page)
      // from Cloudflare's shared IP ranges — confirmed by direct test. Yahoo
      // Finance's search API is not, and is already proven reliable here (same
      // session pattern the Telegram /news command and price sync use), so
      // market-wide news is served from Yahoo instead.
      const q=(url.searchParams.get('q')||'Indian stock market').slice(0,80);
      const label=url.searchParams.get('label')||'Market';
      try{
        let sess=null;try{sess=await getYFSession();}catch(e){}
        const hh={'User-Agent':UA,'Accept':'application/json','Referer':'https://finance.yahoo.com/'};
        if(sess&&sess.cookies)hh['Cookie']=sess.cookies;
        const cq=sess?('&crumb='+encodeURIComponent(sess.crumb)):'';
        const res=await fetch('https://query1.finance.yahoo.com/v1/finance/search?q='+encodeURIComponent(q)+'&quotesCount=0&newsCount=10&enableFuzzyQuery=false'+cq,{headers:hh,signal:AbortSignal.timeout(8000)});
        const d=res.ok?await res.json():null;
        const news=(d&&d.news)||[];
        const items=news.map(n=>({
          title:n.title,
          link:n.link,
          pubDate:n.providerPublishTime?new Date(n.providerPublishTime*1000).toISOString():'',
          source:n.publisher||label,
        })).filter(it=>it.title&&it.title.length>8).slice(0,10);
        return new Response(JSON.stringify({ok:true,q,items,source:items.length?'yahoo-finance':'none',fetchedAt:Date.now()}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=900'}});
      }catch(e){
        return new Response(JSON.stringify({ok:false,q,items:[],source:'none',error:e.message,fetchedAt:Date.now()}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
    }
    const _MKTCORS={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
    if(url.pathname==='/fiidii'){
      let history=[],meta=null;
      try{const r=await env.STOCKSENSE_KV.get('fiiDiiHistory');if(r)history=JSON.parse(r);}catch(e){}
      try{const r=await env.STOCKSENSE_KV.get('fiiDiiMeta');if(r)meta=JSON.parse(r);}catch(e){}
      const staleMs=meta?Date.now()-meta.ts:Infinity;
      if(staleMs>26*3600000){ ctx.waitUntil(fetchFiiDiiLive(env).catch(e=>console.warn('fiidii lazy refresh failed:',e.message))); }
      return new Response(JSON.stringify({ok:true,history,fetchedAt:meta?.ts||null,source:meta?.source||'none'}),{headers:_MKTCORS});
    }
    if(url.pathname==='/fiidii-refresh'){
      try{const history=await fetchFiiDiiLive(env);return new Response(JSON.stringify({ok:true,history}),{headers:_MKTCORS});}
      catch(e){return new Response(JSON.stringify({ok:false,error:e.message}),{status:502,headers:_MKTCORS});}
    }
    if(url.pathname==='/deals'){
      let cache=null;
      try{const r=await env.STOCKSENSE_KV.get('dealsCache');if(r)cache=JSON.parse(r);}catch(e){}
      const staleMs=cache?Date.now()-cache.ts:Infinity;
      if(staleMs>26*3600000){ ctx.waitUntil(fetchBulkBlockDealsLive(env).catch(e=>console.warn('deals lazy refresh failed:',e.message))); }
      return new Response(JSON.stringify({ok:true,deals:cache?.deals||[],fetchedAt:cache?.ts||null,source:cache?.source||'none'}),{headers:_MKTCORS});
    }
    if(url.pathname==='/deals-refresh'){
      try{const deals=await fetchBulkBlockDealsLive(env);return new Response(JSON.stringify({ok:true,deals}),{headers:_MKTCORS});}
      catch(e){return new Response(JSON.stringify({ok:false,error:e.message}),{status:502,headers:_MKTCORS});}
    }
    const _AICORS={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
    if(url.pathname==='/ai-start'){const m=url.searchParams.get('model');const job=await startAIJob(env,m);ctx.waitUntil(runAIQueue(env,null,{force:true}));return new Response(JSON.stringify({ok:true,status:job.status,total:job.total,model:job.model}),{headers:_AICORS});}
    if(url.pathname==='/ai-run'){ctx.waitUntil(runAIQueue(env,null,{force:true}));return new Response('{"ok":true}',{headers:_AICORS});}
    if(url.pathname==='/ai-stop'){const job=await aq_loadJob(env);if(job){job.status='idle';job.pausedUntil=0;job.lastError='stopped by user';await aq_saveJob(env,job);}return new Response(JSON.stringify({ok:true,stopped:!!job}),{headers:_AICORS});}
    if(url.pathname==='/ai-status'){const job=await aq_loadJob(env);let results=null;try{const raw=await env.STOCKSENSE_KV.get('aiResults');if(raw)results=JSON.parse(raw);}catch(e){}return new Response(JSON.stringify({job,results}),{headers:_AICORS});}
    return new Response('StockSense Price Sync Worker v11 — AI Chat Agent',{status:200});
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil((async()=>{
      if(event.cron==='25 3 * * 1-5'){
        await sendMorningBrief(env);
        const dow=new Date().getUTCDay();
        if(dow===1){let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}await sendWeeklyDigest(env,prices);}
      }else if(event.cron==='5 10 * * 1-5'){
        await sendEveningWrap(env);
      }else if(event.cron==='0 13 * * 1-5'){
        // 18:30 IST — after NSE publishes EOD FII/DII + bulk/block deal reports (~5:30-6:30pm IST)
        await refreshMarketData(env);
      }else{
        const{prices,prevPrices}=await syncPrices(env);
        await checkAndSendAlerts(env,prices,prevPrices);
        try{await runAIQueue(env);}catch(e){console.warn('AI queue err:',e.message);}   // advance the resumable AI queue (never breaks price sync)
      }
    })());
  }
};
