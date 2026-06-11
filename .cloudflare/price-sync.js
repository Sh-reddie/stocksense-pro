const NSE_STOCKS=['RELIANCE','TCS','HDFCBANK','BHARTIARTL','ICICIBANK','SBIN','INFY','LICI','HINDUNILVR','ITC','LT','KOTAKBANK','BAJFINANCE','HCLTECH','SUNPHARMA','NTPC','ONGC','ULTRACEMCO','MARUTI','WIPRO','BAJAJFINSV','TITAN','POWERGRID','ADANIENT','COALINDIA','ASIANPAINT','NESTLEIND','INDUSINDBK','AXISBANK','ADANIPORTS','JSWSTEEL','HINDALCO','GRASIM','TECHM','TATAMOTORS','DRREDDY','CIPLA','DIVISLAB','APOLLOHOSP','EICHERMOT','TATACONSUM','SBILIFE','HDFCLIFE','ICICIPRULI','BAJAJ-AUTO','BRITANNIA','HEROMOTOCO','M&M','TATASTEEL','BPCL','ADANIGREEN','ADANITRANS','SIEMENS','ABB','PIDILITIND','HAVELLS','BERGEPAINT','MARICO','GODREJCP','COLPAL','DABUR','EMAMILTD','MUTHOOTFIN','CHOLAFIN','BAJAJHLDNG','BOSCHLTD','TORNTPHARM','AUROPHARMA','LUPIN','BIOCON','DMART','TRENT','IRCTC','INDIGO','JUBLFOOD','MCDOWELL-N','UNITDSPR','SHREECEM','AMBUJACEM','ACCLTD','SAIL','NMDC','NATIONALUM','HINDZINC','VEDL','JINDALSTEL','JSWENERGY','TATAPOWER','RECLTD','PFC','IRFC','RVNL','CONCOR','TIINDIA','VOLTAS','BLUEDART','DELHIVERY','NAUKRI','AFFLE','PERSISTENT','MPHASIS','LTIM','COFORGE','TATAELXSI','KPITTECH','CYIENT','ZENSAR','OFSS','NEWGEN','NETWEB','KAYNES','DIXON','AMBER','HAPPSTMNDS','RATEGAIN','MASTEK','INTELLECT','BANKBARODA','CANARABANK','UNIONBANK','INDIANB','PNB','FEDERALBNK','IDFCFIRSTB','YESBANK','RBLBANK','DCBBANK','UJJIVANSFB','KTKBANK','MANAPPURAM','IIFL','CANFINHOME','AAVAS','REPCO','HOMEFIRST','ANGELONE','MOTILALOFS','SBICARDS','ICICIGI','STARHEALTH','GICRE','NIACL','ZYDUSLIFE','ALKEM','NATCOPHARM','IPCA','AJANTPHARMA','GRANULES','LAURUSLABS','GLAXO','PFIZER','ASTRAZEN','SANOFI','ABBOT','ESCORTS','FORCEMOT','ENDURANCE','EXIDEIND','SUNDRMFAST','TIMKEN','SCHAEFFLER','SKF','CRAFTSMAN','RAMCOCEM','JKCEMENT','DALBHARAT','KNRCON','PNCINFRA','NBCC','NCC','IRCON','RAILTEL','TITAGARH','GPPL','CESC','TORNTPOWER','NLCLINDIA','NHPC','SJVN','GIPCL','ADANIPOWER','RADICO','BALRAMCHIN','TRIVENI','VBL','BIKAJI','VENKEYS','WESTLIFE','DEVYANI','SULA','DLF','LODHA','GODREJPROP','PRESTIGE','BRIGADE','SOBHA','PHOENIXLTD','OBEROIRLTY','SUNTECK','KOLTEPATIL','TATACOMM','HFCL','ROUTE','TEJASNET','DEEPAKNITRITE','AARTI','PIIND','SUMCHEM','FINEORG','GALAXYSURF','TATACHEM','CHAMBALFERT','COROMANDEL','GNFC','NOCIL','BHEL','HAL','BEL','BEML','COCHINSHIP','GRSE','MAZAGON','CUMMINSIND','THERMAX','RAMKRISHNA','RATNAMANI','WELCORP','V2RETAIL','SHOPERSTOP','BATAINDIA','VMART','MANYAVAR','METRO','KALYANKJIL','SENCO','RAJESHEXPO','GMRINFRA','ADANIGAS','NYKAA','ZOMATO','PAYTM','POLICYBZR','HDFCSEC','CRISIL','ICRA','CARERATINGS','UIICL'];
const BSE_STOCKS=['TATASTEELLP','TATAMETALI','BIRLATYRE','BHAGCHEM','ZYDUSWELL','NAVNETEDUL','SUNTV','MFSL'];
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function getYFSession() {
  const r = await fetch('https://finance.yahoo.com/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow'
  });
  const vals = typeof r.headers.getAll === 'function' ? r.headers.getAll('set-cookie') : [];
  const ck = vals.map(c => c.split(';')[0].trim()).join('; ');
  const cr = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': ck, 'Referer': 'https://finance.yahoo.com/', 'Accept': '*/*' }
  });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.includes('Too Many') || crumb[0] === '<' || crumb[0] === '{')
    throw new Error('Bad crumb: ' + crumb.slice(0, 60));
  return { cookies: ck, crumb };
}

async function syncPrices(env) {
  let sess = null;
  try { sess = await getYFSession(); console.log('crumb:', sess.crumb.slice(0, 8)); }
  catch (e) { console.warn('no sess:', e.message); }

  const syms = [...new Set(NSE_STOCKS)].map(s => s + '.NS')
    .concat([...new Set(BSE_STOCKS)].map(s => s + '.BO'));
  const prices = {}; let fetched = 0;

  for (let i = 0; i < syms.length; i += 50) {
    const batch = syms.slice(i, i + 50);
    const q = encodeURIComponent(batch.join(','));
    const cq = sess ? ('&crumb=' + encodeURIComponent(sess.crumb)) : '';
    let ok = false;
    for (const h of ['query1', 'query2']) {
      try {
        const hh = { 'User-Agent': UA, 'Referer': 'https://finance.yahoo.com/' };
        if (sess && sess.cookies) hh['Cookie'] = sess.cookies;
        const res = await fetch(
          'https://' + h + '.finance.yahoo.com/v7/finance/quote?symbols=' + q +
          '&fields=regularMarketPrice,regularMarketChangePercent&formatted=false' + cq,
          { headers: hh }
        );
        const d = await res.json();
        const rs = d && d.quoteResponse && d.quoteResponse.result;
        if (Array.isArray(rs) && rs.length > 0) {
          rs.forEach(r => {
            const s = r.symbol || ''; const ns = s.endsWith('.NS'), bo = s.endsWith('.BO');
            if (!ns && !bo) return;
            const b = s.slice(0, -3); const ltp = r.regularMarketPrice || 0; const cp = r.regularMarketChangePercent || 0;
            if (ltp) { prices[b + '|' + (ns ? 'NSE' : 'BSE')] = { ltp, chgP: cp }; fetched++; }
          });
          ok = true; break;
        }
      } catch (e) { console.warn(h, 'err:', e.message); }
    }
    if (!ok) console.warn('batch fail:', batch[0]);
    if (i + 50 < syms.length) await new Promise(r => setTimeout(r, 200));
  }

  console.log('fetched', fetched, 'prices');
  if (fetched > 0) {
    await env.STOCKSENSE_KV.put('priceCache', JSON.stringify({ ts: Date.now(), prices }));
    console.log('written to KV');
  }
  return { fetched, prices };
}

async function tgSend(token, chatId, text) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: 'StockSense Pro\n\n' + text, parse_mode: 'HTML' })
    });
    return (await r.json()).ok;
  } catch (e) { return false; }
}

async function checkAndSendAlerts(env, prices) {
  let portfolio = null;
  try { const raw = await env.STOCKSENSE_KV.get('portfolio'); if (raw) portfolio = JSON.parse(raw); }
  catch (e) { return; }
  if (!portfolio) return;

  const cfg = portfolio.cfg || {};
  const token = cfg.tgToken;
  const chatId = cfg.tgChatId;
  if (!token || !chatId) { console.log('no tg creds in cfg'); return; }

  let cool = {};
  try { const raw = await env.STOCKSENSE_KV.get('alertCooldowns'); if (raw) cool = JSON.parse(raw); }
  catch (e) {}
  const now = Date.now();
  const COOL = 3600000; // 1 hour
  let dirty = false;
  const canFire = k => !cool[k] || (now - cool[k]) >= COOL;
  const fired = k => { cool[k] = now; dirty = true; };

  const msgs = [];

  // Holdings: SL breach, target hits, big intraday moves
  for (const h of (portfolio.holdings || [])) {
    if (!h.symbol) continue;
    const xch = h.exchange || 'NSE';
    const cached = prices[h.symbol + '|' + xch];
    if (!cached) continue;
    const ltp = cached.ltp, cp = cached.chgP;

    if (h.stopLoss && ltp > 0 && ltp < h.stopLoss && canFire('sl|' + h.id)) {
      const pct = ((h.stopLoss - ltp) / h.stopLoss * 100).toFixed(1);
      msgs.push('🚨 <b>SL BREACH: ' + h.symbol + '</b>\nLTP ₹' + ltp.toFixed(2) + ' below SL ₹' + h.stopLoss.toFixed(2) + ' (-' + pct + '%)\nConsider cutting position.');
      fired('sl|' + h.id);
    }
    if (h.target1 && ltp >= h.target1 && canFire('t1|' + h.id)) {
      const pp = h.avgPrice ? ((ltp - h.avgPrice) / h.avgPrice * 100).toFixed(1) : '?';
      msgs.push('🎯 <b>TARGET 1 HIT: ' + h.symbol + '</b>\nLTP ₹' + ltp.toFixed(2) + ' reached T1 ₹' + h.target1.toFixed(2) + ' (+' + pp + '% from avg)\nConsider partial booking.');
      fired('t1|' + h.id);
    }
    if (h.target2 && ltp >= h.target2 && canFire('t2|' + h.id)) {
      const pp = h.avgPrice ? ((ltp - h.avgPrice) / h.avgPrice * 100).toFixed(1) : '?';
      msgs.push('🏆 <b>TARGET 2 HIT: ' + h.symbol + '</b>\nLTP ₹' + ltp.toFixed(2) + ' reached T2 ₹' + h.target2.toFixed(2) + ' (+' + pp + '% from avg)\nConsider full exit.');
      fired('t2|' + h.id);
    }
    if (Math.abs(cp) >= 5 && canFire('mv|' + h.id + '|' + new Date().toDateString())) {
      msgs.push((cp > 0 ? '📈' : '📉') + ' <b>' + h.symbol + ' ' + cp.toFixed(1) + '%</b>\nLTP ₹' + ltp.toFixed(2) + ' — big intraday move in your portfolio.');
      fired('mv|' + h.id + '|' + new Date().toDateString());
    }
  }

  // Custom price alerts
  for (const a of (portfolio.alerts || [])) {
    if (a.triggered || !a.sym || !a.price) continue;
    const ltp = ((prices[a.sym + '|NSE'] || prices[a.sym + '|BSE']) || {}).ltp || 0;
    if (!ltp) continue;
    const hit = (a.type === 'above' && ltp >= a.price) || (a.type === 'below' && ltp <= a.price);
    if (hit && canFire('ca|' + a.id)) {
      msgs.push('🔔 <b>ALERT: ' + a.sym + '</b>\nLTP ₹' + ltp.toFixed(2) + ' ' +
        (a.type === 'above' ? 'crossed above' : 'crossed below') + ' ₹' + a.price.toFixed(2) +
        (a.label ? ' (' + a.label + ')' : ''));
      fired('ca|' + a.id);
    }
  }

  for (const m of msgs) {
    await tgSend(token, chatId, m);
    await new Promise(r => setTimeout(r, 300));
  }
  if (msgs.length) console.log('sent', msgs.length, 'alert(s) to Telegram');

  if (dirty) {
    for (const k of Object.keys(cool)) if (now - cool[k] > 86400000) delete cool[k];
    await env.STOCKSENSE_KV.put('alertCooldowns', JSON.stringify(cool));
  }
}

async function sendPortfolioSnapshot(env, chatId, token) {
  let prices = {};
  try { const raw = await env.STOCKSENSE_KV.get('priceCache'); if (raw) prices = (JSON.parse(raw)).prices || {}; }
  catch (e) {}

  let pf = null;
  try { const raw = await env.STOCKSENSE_KV.get('portfolio'); if (raw) pf = JSON.parse(raw); }
  catch (e) {}
  if (!pf || !(pf.holdings || []).length) {
    await tgSend(token, chatId, 'No holdings found. Add stocks in StockSense Pro first.');
    return;
  }

  let inv = 0, cur = 0, dayPnl = 0;
  const rows = [];
  for (const h of pf.holdings) {
    if (!h.symbol || !h.qty || !h.avgPrice) continue;
    const xch = h.exchange || 'NSE';
    const c = prices[h.symbol + '|' + xch];
    const ltp = c ? c.ltp : (h.ltp || 0);
    const cp = c ? c.chgP : 0;
    const i2 = h.qty * h.avgPrice, c2 = h.qty * ltp;
    const pnl = c2 - i2, pp = i2 > 0 ? (pnl / i2 * 100) : 0;
    const dp = ltp > 0 ? h.qty * ltp * (cp / 100) : 0;
    inv += i2; cur += c2; dayPnl += dp;
    rows.push(h.symbol + ' ' + (pnl >= 0 ? '+' : '') + pp.toFixed(1) + '% Day:' + (cp >= 0 ? '+' : '') + cp.toFixed(1) + '% ₹' + ltp.toFixed(0));
  }

  const tp = cur - inv, tpp = inv > 0 ? (tp / inv * 100) : 0;
  const msg = '<b>Portfolio Snapshot</b>\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    rows.join('\n') + '\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    '<b>Invested:</b>  ₹' + Math.round(inv).toLocaleString('en-IN') + '\n' +
    '<b>Current:</b>   ₹' + Math.round(cur).toLocaleString('en-IN') + '\n' +
    '<b>P&amp;L:</b>       ' + (tp >= 0 ? '+' : '') + Math.round(tp).toLocaleString('en-IN') + ' (' + (tpp >= 0 ? '+' : '') + tpp.toFixed(1) + '%)\n' +
    '<b>Day P&amp;L:</b>   ' + (dayPnl >= 0 ? '+' : '') + '₹' + Math.abs(Math.round(dayPnl)).toLocaleString('en-IN');

  await tgSend(token, chatId, msg);
}

async function handleTelegram(request, env) {
  let update;
  try { update = await request.json(); } catch (e) { return new Response('ok'); }
  const msg = update.message || update.edited_message;
  if (!msg) return new Response('ok');
  const chatId = msg.chat && msg.chat.id;
  const text = (msg.text || '').trim();
  if (!chatId) return new Response('ok');

  let token = null;
  try { const raw = await env.STOCKSENSE_KV.get('portfolio'); if (raw) token = (JSON.parse(raw)).cfg?.tgToken; }
  catch (e) {}
  if (!token) return new Response('ok');

  const cmd = text.split(' ')[0].toLowerCase().replace(/@.*$/, '');
  if (cmd === '/portfolio' || cmd === '/p') {
    await sendPortfolioSnapshot(env, chatId, token);
  } else if (cmd === '/help' || cmd === '/start') {
    await tgSend(token, chatId,
      '<b>StockSense Pro Bot</b>\n\n' +
      'Commands:\n' +
      '/portfolio (or /p) — live portfolio snapshot with P&amp;L\n\n' +
      'Automatic alerts every 15 min during market hours:\n' +
      '• Stop loss breached\n' +
      '• Target 1 / Target 2 hit\n' +
      '• Custom price alerts triggered\n' +
      '• Stock moves ≥5% intraday'
    );
  }
  return new Response('ok');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/telegram') {
      if (request.method === 'POST') return handleTelegram(request, env);
      return new Response('StockSense Telegram webhook', { status: 200 });
    }
    if (url.pathname === '/sync') {
      const { fetched, prices } = await syncPrices(env);
      ctx.waitUntil(checkAndSendAlerts(env, prices));
      return new Response(JSON.stringify({ fetched }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('StockSense Price Sync Worker', { status: 200 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const { prices } = await syncPrices(env);
      await checkAndSendAlerts(env, prices);
    })());
  }
};
