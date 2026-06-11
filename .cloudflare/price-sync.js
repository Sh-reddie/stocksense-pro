const NSE_STOCKS=['RELIANCE','TCS','HDFCBANK','BHARTIARTL','ICICIBANK','SBIN','INFY','LICI','HINDUNILVR','ITC','LT','KOTAKBANK','BAJFINANCE','HCLTECH','SUNPHARMA','NTPC','ONGC','ULTRACEMCO','MARUTI','WIPRO','BAJAJFINSV','TITAN','POWERGRID','ADANIENT','COALINDIA','ASIANPAINT','NESTLEIND','INDUSINDBK','AXISBANK','ADANIPORTS','JSWSTEEL','HINDALCO','GRASIM','TECHM','TATAMOTORS','DRREDDY','CIPLA','DIVISLAB','APOLLOHOSP','EICHERMOT','TATACONSUM','SBILIFE','HDFCLIFE','ICICIPRULI','BAJAJ-AUTO','BRITANNIA','HEROMOTOCO','M&M','TATASTEEL','BPCL','ADANIGREEN','ADANITRANS','SIEMENS','ABB','PIDILITIND','HAVELLS','BERGEPAINT','MARICO','GODREJCP','COLPAL','DABUR','EMAMILTD','MUTHOOTFIN','CHOLAFIN','BAJAJHLDNG','BOSCHLTD','TORNTPHARM','AUROPHARMA','LUPIN','BIOCON','DMART','TRENT','IRCTC','INDIGO','JUBLFOOD','MCDOWELL-N','UNITDSPR','SHREECEM','AMBUJACEM','ACCLTD','SAIL','NMDC','NATIONALUM','HINDZINC','VEDL','JINDALSTEL','JSWENERGY','TATAPOWER','RECLTD','PFC','IRFC','RVNL','CONCOR','TIINDIA','VOLTAS','BLUEDART','DELHIVERY','NAUKRI','AFFLE','PERSISTENT','MPHASIS','LTIM','COFORGE','TATAELXSI','KPITTECH','CYIENT','ZENSAR','OFSS','NEWGEN','NETWEB','KAYNES','DIXON','AMBER','HAPPSTMNDS','RATEGAIN','MASTEK','INTELLECT','BANKBARODA','CANARABANK','UNIONBANK','INDIANB','PNB','FEDERALBNK','IDFCFIRSTB','YESBANK','RBLBANK','DCBBANK','UJJIVANSFB','KTKBANK','MANAPPURAM','IIFL','CANFINHOME','AAVAS','REPCO','HOMEFIRST','ANGELONE','MOTILALOFS','SBICARDS','ICICIGI','STARHEALTH','GICRE','NIACL','ZYDUSLIFE','ALKEM','NATCOPHARM','IPCA','AJANTPHARMA','GRANULES','LAURUSLABS','GLAXO','PFIZER','ASTRAZEN','SANOFI','ABBOT','ESCORTS','FORCEMOT','ENDURANCE','EXIDEIND','SUNDRMFAST','TIMKEN','SCHAEFFLER','SKF','CRAFTSMAN','RAMCOCEM','JKCEMENT','DALBHARAT','KNRCON','PNCINFRA','NBCC','NCC','IRCON','RAILTEL','TITAGARH','GPPL','CESC','TORNTPOWER','NLCLINDIA','NHPC','SJVN','GIPCL','ADANIPOWER','RADICO','BALRAMCHIN','TRIVENI','VBL','BIKAJI','VENKEYS','WESTLIFE','DEVYANI','SULA','DLF','LODHA','GODREJPROP','PRESTIGE','BRIGADE','SOBHA','PHOENIXLTD','OBEROIRLTY','SUNTECK','KOLTEPATIL','TATACOMM','HFCL','ROUTE','TEJASNET','DEEPAKNITRITE','AARTI','PIIND','SUMCHEM','FINEORG','GALAXYSURF','TATACHEM','CHAMBALFERT','COROMANDEL','GNFC','NOCIL','BHEL','HAL','BEL','BEML','COCHINSHIP','GRSE','MAZAGON','CUMMINSIND','THERMAX','RAMKRISHNA','RATNAMANI','WELCORP','V2RETAIL','SHOPERSTOP','BATAINDIA','VMART','MANYAVAR','METRO','KALYANKJIL','SENCO','RAJESHEXPO','GMRINFRA','ADANIGAS','NYKAA','ZOMATO','PAYTM','POLICYBZR','HDFCSEC','CRISIL','ICRA','CARERATINGS','UIICL'];
const BSE_STOCKS=['TATASTEELLP','TATAMETALI','BIRLATYRE','BHAGCHEM','ZYDUSWELL','NAVNETEDUL','SUNTV','MFSL'];
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function getYFSession(){const r=await fetch('https://finance.yahoo.com/',{headers:{'User-Agent':UA,'Accept':'text/html,*/*','Accept-Language':'en-US,en;q=0.9'},redirect:'follow'});const vals=typeof r.headers.getAll==='function'?r.headers.getAll('set-cookie'):[];const ck=vals.map(c=>c.split(';')[0].trim()).join('; ');const cr=await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':UA,'Cookie':ck,'Referer':'https://finance.yahoo.com/','Accept':'*/*'}});const crumb=(await cr.text()).trim();if(!crumb||crumb.includes('Too Many')||crumb[0]==='<'||crumb[0]==='{')throw new Error('Bad crumb: '+crumb.slice(0,60));return{cookies:ck,crumb};}

async function syncPrices(env){let sess=null;try{sess=await getYFSession();console.log('crumb:',sess.crumb.slice(0,8));}catch(e){console.warn('no sess:',e.message);}const syms=[...new Set(NSE_STOCKS)].map(s=>s+'.NS').concat([...new Set(BSE_STOCKS)].map(s=>s+'.BO'));const prices={};let fetched=0;for(let i=0;i<syms.length;i+=50){const batch=syms.slice(i,i+50);const q=encodeURIComponent(batch.join(','));const cq=sess?('&crumb='+encodeURIComponent(sess.crumb)):'';let ok=false;for(const h of['query1','query2']){try{const hh={'User-Agent':UA,'Referer':'https://finance.yahoo.com/'};if(sess&&sess.cookies)hh['Cookie']=sess.cookies;const res=await fetch('https://'+h+'.finance.yahoo.com/v7/finance/quote?symbols='+q+'&fields=regularMarketPrice,regularMarketChangePercent&formatted=false'+cq,{headers:hh});const d=await res.json();const rs=d&&d.quoteResponse&&d.quoteResponse.result;if(Array.isArray(rs)&&rs.length>0){rs.forEach(r=>{const s=r.symbol||'';const ns=s.endsWith('.NS'),bo=s.endsWith('.BO');if(!ns&&!bo)return;const b=s.slice(0,-3);const ltp=r.regularMarketPrice||0;const cp=r.regularMarketChangePercent||0;if(ltp){prices[b+'|'+(ns?'NSE':'BSE')]={ltp,chgP:cp};fetched++;}});ok=true;break;}}catch(e){console.warn(h,'err:',e.message);}}if(!ok)console.warn('batch fail:',batch[0]);if(i+50<syms.length)await new Promise(r=>setTimeout(r,200));}console.log('fetched',fetched,'prices');if(fetched>0){await env.STOCKSENSE_KV.put('priceCache',JSON.stringify({ts:Date.now(),prices}));console.log('written to KV');}return{fetched,prices};}

async function fetchIndexPrices(){
  try{
    const q=encodeURIComponent('^NSEI,^BSESN,^NSEBANK');
    const res=await fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols='+q+'&fields=regularMarketPrice,regularMarketChangePercent&formatted=false',{headers:{'User-Agent':UA,'Referer':'https://finance.yahoo.com/'}});
    const d=await res.json();
    const rs=d&&d.quoteResponse&&d.quoteResponse.result;
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

function fmtIdx(idx){
  if(!idx)return '';
  const parts=[];
  if(idx.nifty)parts.push('Nifty '+idx.nifty.ltp.toFixed(0)+' ('+(idx.nifty.chgP>=0?'+':'')+idx.nifty.chgP.toFixed(2)+'%)');
  if(idx.banknifty)parts.push('BankNifty '+idx.banknifty.ltp.toFixed(0)+' ('+(idx.banknifty.chgP>=0?'+':'')+idx.banknifty.chgP.toFixed(2)+'%)');
  if(idx.sensex)parts.push('Sensex '+idx.sensex.ltp.toFixed(0)+' ('+(idx.sensex.chgP>=0?'+':'')+idx.sensex.chgP.toFixed(2)+'%)');
  return parts.join('  ');
}

async function tgSend(token,chatId,text){try{const r=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:'StockSense Pro\n\n'+text,parse_mode:'HTML'})});return(await r.json()).ok;}catch(e){return false;}}

async function checkAndSendAlerts(env,prices){
  let portfolio=null;
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)portfolio=JSON.parse(raw);}catch(e){return;}
  if(!portfolio)return;
  const cfg=portfolio.cfg||{};
  const token=cfg.tgToken;
  const chatId=cfg.tgChatId;
  if(!token||!chatId){console.log('no tg creds in cfg');return;}
  let cool={};
  try{const raw=await env.STOCKSENSE_KV.get('alertCooldowns');if(raw)cool=JSON.parse(raw);}catch(e){}
  const now=Date.now();
  const COOL=3600000;
  let dirty=false;
  let portfolioDirty=false;
  const canFire=k=>!cool[k]||(now-cool[k])>=COOL;
  const fired=k=>{cool[k]=now;dirty=true;};
  const msgs=[];

  for(const h of(portfolio.holdings||[])){
    if(!h.symbol)continue;
    const xch=h.exchange||'NSE';
    const cached=prices[h.symbol+'|'+xch];
    if(!cached)continue;
    const ltp=cached.ltp,cp=cached.chgP;

    // SL breach
    if(h.stopLoss&&ltp>0&&ltp<h.stopLoss&&canFire('sl|'+h.id)){
      const pct=((h.stopLoss-ltp)/h.stopLoss*100).toFixed(1);
      msgs.push('\u{1f6a8} <b>SL BREACH: '+h.symbol+'</b>\nLTP \u20b9'+ltp.toFixed(2)+' below SL \u20b9'+h.stopLoss.toFixed(2)+' (-'+pct+'%)\nConsider cutting position.');
      fired('sl|'+h.id);
    }
    // T1 hit
    if(h.target1&&ltp>=h.target1&&canFire('t1|'+h.id)){
      const pp=h.avgPrice?((ltp-h.avgPrice)/h.avgPrice*100).toFixed(1):'?';
      msgs.push('\u{1f3af} <b>TARGET 1 HIT: '+h.symbol+'</b>\nLTP \u20b9'+ltp.toFixed(2)+' reached T1 \u20b9'+h.target1.toFixed(2)+' (+'+pp+'% from avg)\nConsider partial booking.');
      fired('t1|'+h.id);
    }
    // T2 hit
    if(h.target2&&ltp>=h.target2&&canFire('t2|'+h.id)){
      const pp=h.avgPrice?((ltp-h.avgPrice)/h.avgPrice*100).toFixed(1):'?';
      msgs.push('\u{1f3c6} <b>TARGET 2 HIT: '+h.symbol+'</b>\nLTP \u20b9'+ltp.toFixed(2)+' reached T2 \u20b9'+h.target2.toFixed(2)+' (+'+pp+'% from avg)\nConsider full exit.');
      fired('t2|'+h.id);
    }
    // Big intraday move
    if(Math.abs(cp)>=5&&canFire('mv|'+h.id+'|'+new Date().toDateString())){
      msgs.push((cp>0?'\u{1f4c8}':'\u{1f4c9}')+' <b>'+h.symbol+' '+cp.toFixed(1)+'%</b>\nLTP \u20b9'+ltp.toFixed(2)+' \u2014 big intraday move in your portfolio.');
      fired('mv|'+h.id+'|'+new Date().toDateString());
    }
    // Trailing SL
    if(h.trailSlPct&&ltp>0){
      const curHigh=h.trailSlHigh||h.avgPrice||0;
      if(ltp>curHigh){
        h.trailSlHigh=ltp;
        portfolioDirty=true;
      }
      const trailLevel=(h.trailSlHigh||0)*(1-h.trailSlPct/100);
      if(trailLevel>0&&ltp<trailLevel&&canFire('tsl|'+h.id)){
        const dropPct=((h.trailSlHigh-ltp)/h.trailSlHigh*100).toFixed(1);
        msgs.push('\u{1f6a8} <b>TRAIL SL HIT: '+h.symbol+'</b>\nLTP \u20b9'+ltp.toFixed(2)+' dropped '+dropPct+'% from high \u20b9'+(h.trailSlHigh||0).toFixed(2)+'\nTrail SL (\u2212'+h.trailSlPct+'%): \u20b9'+trailLevel.toFixed(2)+'\nConsider exiting.');
        fired('tsl|'+h.id);
      }
    }
  }

  // Custom alerts
  for(const a of(portfolio.alerts||[])){
    if(a.triggered||!a.sym||!a.price)continue;
    const ltp=((prices[a.sym+'|NSE']||prices[a.sym+'|BSE'])||{}).ltp||0;
    if(!ltp)continue;
    const hit=(a.type==='above'&&ltp>=a.price)||(a.type==='below'&&ltp<=a.price);
    if(hit&&canFire('ca|'+a.id)){
      msgs.push('\u{1f514} <b>ALERT: '+a.sym+'</b>\nLTP \u20b9'+ltp.toFixed(2)+' '+(a.type==='above'?'crossed above':'crossed below')+' \u20b9'+a.price.toFixed(2)+(a.label?' ('+a.label+')':''));
      fired('ca|'+a.id);
    }
  }

  // Earnings reminder (24h ahead)
  const tomorrow=now+86400000;
  for(const h of(portfolio.holdings||[])){
    if(!h.earningsTs||!h.symbol)continue;
    const ets=h.earningsTs*1000;
    const ck='er|'+(h.id||h.symbol)+'|'+h.earningsTs;
    if(ets>=now&&ets<=tomorrow&&canFire(ck)){
      const eDate=new Date(ets).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      msgs.push('\u{1f4c5} <b>EARNINGS TOMORROW: '+h.symbol+'</b>\nResults expected around '+eDate+' IST\nConsider reducing position risk before results.');
      fired(ck);
    }
  }

  for(const m of msgs){await tgSend(token,chatId,m);await new Promise(r=>setTimeout(r,300));}
  if(msgs.length)console.log('sent',msgs.length,'alert(s) to Telegram');

  if(portfolioDirty){
    await env.STOCKSENSE_KV.put('portfolio',JSON.stringify(portfolio));
    console.log('updated trailSlHigh in portfolio');
  }
  if(dirty){
    for(const k of Object.keys(cool))if(now-cool[k]>86400000)delete cool[k];
    await env.STOCKSENSE_KV.put('alertCooldowns',JSON.stringify(cool));
  }
}

async function sendMorningBrief(env){
  let pf=null;
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)return;
  const cfg=pf.cfg||{};
  const token=cfg.tgToken,chatId=cfg.tgChatId;
  if(!token||!chatId)return;

  let prices={};
  try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}

  const now=new Date();
  const istOffset=5.5*3600000;
  const istNow=new Date(now.getTime()+istOffset);
  const dayStart=Date.UTC(istNow.getUTCFullYear(),istNow.getUTCMonth(),istNow.getUTCDate())-istOffset;
  const dayEnd=dayStart+86400000;
  const dateStr=istNow.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});

  const idx=await fetchIndexPrices();
  const sections=[];

  // Earnings today
  const earningsToday=(pf.holdings||[]).filter(h=>h.earningsTs&&(h.earningsTs*1000)>=dayStart&&(h.earningsTs*1000)<dayEnd).map(h=>h.symbol);
  if(earningsToday.length)sections.push('\u{1f4c5} <b>Earnings Today:</b> '+earningsToday.join(', '));

  // Near SL (within 3%)
  const nearSL=[];
  for(const h of(pf.holdings||[])){
    if(!h.stopLoss||!h.symbol)continue;
    const ltp=(prices[h.symbol+'|'+(h.exchange||'NSE')]||prices[h.symbol+'|BSE']||{}).ltp||h.ltp||0;
    if(!ltp||ltp<h.stopLoss)continue;
    if(ltp<=h.stopLoss*1.03){
      const gap=((ltp-h.stopLoss)/h.stopLoss*100).toFixed(1);
      nearSL.push(h.symbol+' \u20b9'+ltp.toFixed(0)+' / SL \u20b9'+h.stopLoss.toFixed(0)+' (+'+gap+'%)');
    }
  }
  if(nearSL.length)sections.push('\u26a0\ufe0f <b>Near Stop Loss (&lt;3%):</b>\n'+nearSL.join('\n'));

  // Near T1 (within 5%)
  const nearT1=[];
  for(const h of(pf.holdings||[])){
    if(!h.target1||!h.symbol)continue;
    const ltp=(prices[h.symbol+'|'+(h.exchange||'NSE')]||prices[h.symbol+'|BSE']||{}).ltp||h.ltp||0;
    if(!ltp||ltp>=h.target1)continue;
    if(ltp>=h.target1*0.95){
      const gap=((h.target1-ltp)/h.target1*100).toFixed(1);
      nearT1.push(h.symbol+' \u20b9'+ltp.toFixed(0)+' \u2192 T1 \u20b9'+h.target1.toFixed(0)+' ('+gap+'% away)');
    }
  }
  if(nearT1.length)sections.push('\u{1f3af} <b>Near Target 1 (&lt;5%):</b>\n'+nearT1.join('\n'));

  // Portfolio totals
  let inv=0,cur=0;
  for(const h of(pf.holdings||[])){
    if(!h.qty||!h.avgPrice)continue;
    const ltp=(prices[h.symbol+'|'+(h.exchange||'NSE')]||prices[h.symbol+'|BSE']||{}).ltp||h.ltp||0;
    inv+=h.qty*h.avgPrice;
    if(ltp)cur+=h.qty*ltp;
  }
  const pnl=cur-inv,pnlPct=inv>0?(pnl/inv*100):0;

  let msg='\u{1f305} <b>Morning Brief \u2014 '+dateStr+'</b>\n';
  const idxLine=fmtIdx(idx);
  if(idxLine)msg+=idxLine+'\n';
  msg+='--------------------\n';
  if(sections.length)msg+=sections.join('\n\n')+'\n\n--------------------\n';
  else msg+='All clear \u2014 no stocks near SL/T1 today.\n\n--------------------\n';
  msg+='<b>Portfolio:</b> \u20b9'+Math.round(cur).toLocaleString('en-IN')+' ('+(pnl>=0?'+':'')+pnlPct.toFixed(1)+'%)\n';
  msg+='<b>Holdings:</b> '+(pf.holdings||[]).length+' stocks';

  await tgSend(token,chatId,msg);
  console.log('morning brief sent');
}

async function sendEveningWrap(env){
  let pf=null;
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)return;
  const cfg=pf.cfg||{};
  const token=cfg.tgToken,chatId=cfg.tgChatId;
  if(!token||!chatId)return;

  let prices={};
  try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}

  const idx=await fetchIndexPrices();
  const istNow=new Date(Date.now()+5.5*3600000);
  const dateStr=istNow.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});

  let inv=0,cur=0,dayPnl=0;
  const rows=[];
  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const xch=h.exchange||'NSE';
    const c=prices[h.symbol+'|'+xch];
    const ltp=c?c.ltp:(h.ltp||0);
    const cp=c?c.chgP:0;
    const i2=h.qty*h.avgPrice,c2=h.qty*ltp;
    const dp=ltp>0?h.qty*ltp*(cp/100):0;
    inv+=i2;cur+=c2;dayPnl+=dp;
    if(ltp&&cp!==0)rows.push({sym:h.symbol,cp,ltp,dp});
  }
  rows.sort((a,b)=>b.cp-a.cp);
  const gainers=rows.filter(r=>r.cp>0).slice(0,3);
  const losers=[...rows].filter(r=>r.cp<0).slice(-3).reverse();
  const pnl=cur-inv,pnlPct=inv>0?(pnl/inv*100):0;

  let msg='\u{1f307} <b>Evening Wrap \u2014 '+dateStr+'</b>\n';
  const idxLine=fmtIdx(idx);
  if(idxLine)msg+=idxLine+'\n';
  msg+='--------------------\n';
  if(gainers.length){
    msg+='\u{1f4c8} <b>Top Gainers:</b>\n';
    for(const r of gainers)msg+=r.sym+' +'+r.cp.toFixed(1)+'% \u20b9'+r.ltp.toFixed(0)+'\n';
  }
  if(losers.length){
    msg+='\u{1f4c9} <b>Top Losers:</b>\n';
    for(const r of losers)msg+=r.sym+' '+r.cp.toFixed(1)+'% \u20b9'+r.ltp.toFixed(0)+'\n';
  }
  msg+='--------------------\n';
  msg+='<b>Day P&amp;L:</b> '+(dayPnl>=0?'+':'\u2212')+'\u20b9'+Math.abs(Math.round(dayPnl)).toLocaleString('en-IN')+'\n';
  msg+='<b>Portfolio:</b> \u20b9'+Math.round(cur).toLocaleString('en-IN')+' ('+(pnlPct>=0?'+':'')+pnlPct.toFixed(1)+'%)';

  await tgSend(token,chatId,msg);
  console.log('evening wrap sent');
}

async function sendWeeklyDigest(env,prices){
  let pf=null;
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}
  if(!pf)return;
  const cfg=pf.cfg||{};
  const token=cfg.tgToken,chatId=cfg.tgChatId;
  if(!token||!chatId)return;

  let baseline=null;
  try{const raw=await env.STOCKSENSE_KV.get('weeklyBaseline');if(raw)baseline=JSON.parse(raw);}catch(e){}

  // Store new baseline for next week regardless
  await env.STOCKSENSE_KV.put('weeklyBaseline',JSON.stringify({ts:Date.now(),prices}));

  if(!baseline){
    await tgSend(token,chatId,'\u{1f4c5} <b>Weekly Digest</b>\nFirst Monday \u2014 storing baseline for next week\'s digest.');
    return;
  }

  const bp=baseline.prices||{};
  const rows=[];
  let curNow=0,curThen=0;

  for(const h of(pf.holdings||[])){
    if(!h.symbol||!h.qty||!h.avgPrice)continue;
    const xch=h.exchange||'NSE';
    const key=h.symbol+'|'+xch;
    const ltpNow=(prices[key]||{}).ltp||h.ltp||0;
    const ltpThen=(bp[key]||{}).ltp||ltpNow;
    if(!ltpNow||!ltpThen)continue;
    const wkChg=((ltpNow-ltpThen)/ltpThen*100);
    curNow+=h.qty*ltpNow;
    curThen+=h.qty*ltpThen;
    rows.push({sym:h.symbol,wkChg,ltpNow,wkPnl:h.qty*(ltpNow-ltpThen)});
  }

  rows.sort((a,b)=>b.wkChg-a.wkChg);
  const winners=rows.filter(r=>r.wkChg>0).slice(0,5);
  const laggards=rows.filter(r=>r.wkChg<0).slice(-5).reverse();
  const wkPnl=curNow-curThen;
  const wkPct=curThen>0?(wkPnl/curThen*100):0;

  const baseDate=new Date(baseline.ts+5.5*3600000).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  let msg='\u{1f4c5} <b>Weekly Digest</b>\nSince '+baseDate+'\n--------------------\n';

  if(winners.length){
    msg+='\u{1f3c6} <b>Winners:</b>\n';
    for(const r of winners)msg+=r.sym+' +'+r.wkChg.toFixed(1)+'%\n';
  }
  if(laggards.length){
    msg+='\u26a0\ufe0f <b>Laggards:</b>\n';
    for(const r of laggards)msg+=r.sym+' '+r.wkChg.toFixed(1)+'%\n';
  }
  msg+='--------------------\n';
  msg+='<b>Week P&amp;L:</b> '+(wkPnl>=0?'+':'')+'\u20b9'+Math.abs(Math.round(wkPnl)).toLocaleString('en-IN')+' ('+(wkPct>=0?'+':'')+wkPct.toFixed(1)+'%)';

  await tgSend(token,chatId,msg);
  console.log('weekly digest sent');
}

async function sendPortfolioSnapshot(env,chatId,token){let prices={};try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=(JSON.parse(raw)).prices||{};}catch(e){}let pf=null;try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)pf=JSON.parse(raw);}catch(e){}if(!pf||!(pf.holdings||[]).length){await tgSend(token,chatId,'No holdings found. Add stocks in StockSense Pro first.');return;}let inv=0,cur=0,dayPnl=0;const rows=[];for(const h of pf.holdings){if(!h.symbol||!h.qty||!h.avgPrice)continue;const xch=h.exchange||'NSE';const c=prices[h.symbol+'|'+xch];const ltp=c?c.ltp:(h.ltp||0);const cp=c?c.chgP:0;const i2=h.qty*h.avgPrice,c2=h.qty*ltp;const pnl=c2-i2,pp=i2>0?(pnl/i2*100):0;const dp=ltp>0?h.qty*ltp*(cp/100):0;inv+=i2;cur+=c2;dayPnl+=dp;rows.push(h.symbol+' '+(pnl>=0?'+':'')+pp.toFixed(1)+'% Day:'+(cp>=0?'+':'')+cp.toFixed(1)+'% \u20b9'+ltp.toFixed(0));}const tp=cur-inv,tpp=inv>0?(tp/inv*100):0;const msg='<b>Portfolio Snapshot</b>\n--------------------\n'+rows.join('\n')+'\n--------------------\n<b>Invested:</b>  \u20b9'+Math.round(inv).toLocaleString('en-IN')+'\n<b>Current:</b>   \u20b9'+Math.round(cur).toLocaleString('en-IN')+'\n<b>P&amp;L:</b>       '+(tp>=0?'+':'')+Math.round(tp).toLocaleString('en-IN')+' ('+(tpp>=0?'+':'')+tpp.toFixed(1)+'%)\n<b>Day P&amp;L:</b>   '+(dayPnl>=0?'+':'')+'\u20b9'+Math.abs(Math.round(dayPnl)).toLocaleString('en-IN');await tgSend(token,chatId,msg);}

async function handleTelegram(request,env){
  let update;
  try{update=await request.json();}catch(e){return new Response('ok');}
  const msg=update.message||update.edited_message;
  if(!msg)return new Response('ok');
  const chatId=msg.chat&&msg.chat.id;
  const text=(msg.text||'').trim();
  if(!chatId)return new Response('ok');
  let token=null;
  try{const raw=await env.STOCKSENSE_KV.get('portfolio');if(raw)token=(JSON.parse(raw)).cfg?.tgToken;}catch(e){}
  if(!token)return new Response('ok');
  const cmd=text.split(' ')[0].toLowerCase().replace(/@.*$/,'');
  if(cmd==='/portfolio'||cmd==='/p'){
    await sendPortfolioSnapshot(env,chatId,token);
  }else if(cmd==='/brief'||cmd==='/morning'){
    await sendMorningBrief(env);
  }else if(cmd==='/evening'){
    await sendEveningWrap(env);
  }else if(cmd==='/weekly'){
    let prices={};
    try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
    await sendWeeklyDigest(env,prices);
  }else if(cmd==='/help'||cmd==='/start'){
    await tgSend(token,chatId,'<b>StockSense Pro Bot</b>\n\nCommands:\n/portfolio (or /p) \u2014 live portfolio snapshot with P&amp;L\n/brief \u2014 morning brief on demand\n/evening \u2014 evening wrap on demand\n/weekly \u2014 weekly digest on demand\n\nAutomatic every 15 min during market hours:\n\u2022 Stop loss breached\n\u2022 Target 1 / Target 2 hit\n\u2022 Trailing SL triggered\n\u2022 Custom price alerts triggered\n\u2022 Stock moves \u22655% intraday\n\u2022 Earnings reminder (24h ahead)\n\nAutomatic at 8:55 AM IST every weekday:\n\u2022 Morning brief (index levels, earnings today, near-SL, near-T1)\n\u2022 Weekly digest every Monday\n\nAutomatic at 3:35 PM IST every weekday:\n\u2022 Evening wrap (top gainers/losers, day P&amp;L)');
  }
  return new Response('ok');
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/telegram'){
      if(request.method==='POST')return handleTelegram(request,env);
      return new Response('StockSense Telegram webhook',{status:200});
    }
    if(url.pathname==='/sync'){
      const{fetched,prices}=await syncPrices(env);
      ctx.waitUntil(checkAndSendAlerts(env,prices));
      return new Response(JSON.stringify({fetched}),{headers:{'Content-Type':'application/json'}});
    }
    if(url.pathname==='/brief'){
      ctx.waitUntil(sendMorningBrief(env));
      return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
    }
    if(url.pathname==='/evening'){
      ctx.waitUntil(sendEveningWrap(env));
      return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
    }
    if(url.pathname==='/weekly'){
      ctx.waitUntil((async()=>{
        let prices={};
        try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
        await sendWeeklyDigest(env,prices);
      })());
      return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
    }
    return new Response('StockSense Price Sync Worker v5',{status:200});
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil((async()=>{
      if(event.cron==='25 3 * * 1-5'){
        await sendMorningBrief(env);
        // Monday: also run weekly digest
        const dow=new Date().getUTCDay();
        if(dow===1){
          let prices={};
          try{const raw=await env.STOCKSENSE_KV.get('priceCache');if(raw)prices=JSON.parse(raw).prices||{};}catch(e){}
          await sendWeeklyDigest(env,prices);
        }
      }else if(event.cron==='5 10 * * 1-5'){
        await sendEveningWrap(env);
      }else{
        const{prices}=await syncPrices(env);
        await checkAndSendAlerts(env,prices);
      }
    })());
  }
};
