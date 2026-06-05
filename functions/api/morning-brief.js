/**
 * StockSense Pro — /api/morning-brief
 * Called daily at 9am IST by the Claude scheduled task.
 * Reads portfolio from KV, computes key stats, sends push notification.
 *
 * Required env vars (Cloudflare Pages → Settings → Variables):
 *   STOCKSENSE_KV         — KV namespace binding
 *   VAPID_PUBLIC_KEY      — VAPID public key
 *   VAPID_PRIVATE_KEY     — VAPID private key
 *   VAPID_SUBJECT         — mailto: subject
 *   MORNING_BRIEF_TOKEN   — secret token to authenticate this endpoint
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-SS-Token',
};

const b64uDecode = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
const b64uEncode = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function makeVapidJWT(endpoint, privateKeyB64u, subject, pubKeyB64u) {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header  = b64uEncode(new TextEncoder().encode(JSON.stringify({ typ:'JWT', alg:'ES256' })));
  const payload = b64uEncode(new TextEncoder().encode(JSON.stringify({ aud: origin, exp: now + 43200, sub: subject })));
  const msg = header + '.' + payload;
  const privKey = await crypto.subtle.importKey('jwk',
    { kty:'EC', crv:'P-256', d: privateKeyB64u, x: b64uEncode(b64uDecode(pubKeyB64u).slice(1,33)), y: b64uEncode(b64uDecode(pubKeyB64u).slice(33,65)), key_ops:['sign'] },
    { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, privKey, new TextEncoder().encode(msg));
  return msg + '.' + b64uEncode(sig);
}

async function encryptPush(subscription, plaintext) {
  const clientPubKey = b64uDecode(subscription.keys.p256dh);
  const auth         = b64uDecode(subscription.keys.auth);
  const ephKP  = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', ephKP.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', clientPubKey, { name:'ECDH', namedCurve:'P-256' }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name:'ECDH', public: clientKey }, ephKP.privateKey, 256);
  const prk  = await crypto.subtle.importKey('raw', sharedBits, { name:'HKDF' }, false, ['deriveBits']);
  const concat = (...a) => { const o = new Uint8Array(a.reduce((n,x)=>n+x.length,0)); let i=0; a.forEach(x=>{o.set(x,i);i+=x.length;}); return o; };
  const utf8  = s => new TextEncoder().encode(s);
  const authInfo = concat(utf8('Content-Encoding: auth\0'), new Uint8Array(1));
  const ikm  = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt: auth, info: authInfo }, prk, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey  = await crypto.subtle.importKey('raw', ikm, { name:'HKDF' }, false, ['deriveBits']);
  const cekInfo = concat(utf8('Content-Encoding: aesgcm\0'), utf8('\0'), clientPubKey, ephPub);
  const cekBits = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info: cekInfo }, ikmKey, 128);
  const cek = await crypto.subtle.importKey('raw', cekBits, { name:'AES-GCM' }, false, ['encrypt']);
  const nonceInfo = concat(utf8('Content-Encoding: nonce\0'), utf8('\0'), clientPubKey, ephPub);
  const nonceBits = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info: nonceInfo }, ikmKey, 96);
  const padded = concat(new Uint8Array(2), new TextEncoder().encode(plaintext));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv: nonceBits }, cek, padded));
  return { ciphertext, salt, serverPub: ephPub };
}

async function sendPush(subscription, payload, env) {
  const VAPID_PUBLIC  = env.VAPID_PUBLIC_KEY  || 'BAGwFvjEBVSieZpJCRmGeRA0xH9DLGntLVHDnG3bh88d8FjTe3b6coW5RC7xRjyUCdzFh0hDQB7axQop0mD613c';
  const VAPID_PRIVATE = env.VAPID_PRIVATE_KEY || '1_Wtz2gjRAKmy3VorvlRbG4ujbLLZtUG-58JaXuLcJ4';
  const VAPID_SUBJECT = env.VAPID_SUBJECT     || 'mailto:sharath9271@gmail.com';
  const jwt = await makeVapidJWT(subscription.endpoint, VAPID_PRIVATE, VAPID_SUBJECT, VAPID_PUBLIC);
  const { ciphertext, salt, serverPub } = await encryptPush(subscription, JSON.stringify(payload));
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    `vapid t=${jwt},k=${VAPID_PUBLIC}`,
      'Content-Encoding': 'aesgcm',
      'Content-Type':     'application/octet-stream',
      'Encryption':       `salt=${b64uEncode(salt)}`,
      'Crypto-Key':       `dh=${b64uEncode(serverPub)}`,
      'TTL':              '86400',
    },
    body: ciphertext,
  });
}

function fI(n) {
  if (!n || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e7) return '₹' + (n/1e7).toFixed(2) + 'Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n/1e5).toFixed(1) + 'L';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function buildBrief(portfolio) {
  const holdings = portfolio.holdings || [];
  if (!holdings.length) return null;

  const invested = holdings.reduce((s,h) => s + (h.qty||0)*(h.avgPrice||0), 0);
  const current  = holdings.reduce((s,h) => s + (h.qty||0)*(h.ltp||h.avgPrice||0), 0);
  const dayPL    = holdings.reduce((s,h) => s + (h.qty||0)*(h.chg||0), 0);
  const totalPL  = current - invested;
  const totalPLp = invested > 0 ? (totalPL / invested * 100) : 0;
  const dayPLp   = current > 0 ? (dayPL / current * 100) : 0;

  // Top movers today
  const movers = [...holdings]
    .filter(h => h.chgP != null)
    .sort((a,b) => Math.abs(b.chgP||0) - Math.abs(a.chgP||0))
    .slice(0, 3)
    .map(h => `${h.symbol} ${(h.chgP||0) >= 0 ? '+' : ''}${(h.chgP||0).toFixed(1)}%`);

  // SL breaches
  const breaches = holdings.filter(h => h.stopLoss && h.ltp && h.ltp <= h.stopLoss)
    .map(h => h.symbol);

  // Urgency actions
  const actToday = holdings.filter(h => h.urgency === 'ACT TODAY')
    .map(h => `${h.symbol} (${h.signal||'check'})`);

  // Build notification body
  const dayEmoji = dayPL >= 0 ? '📈' : '📉';
  const lines = [
    `${dayEmoji} Day: ${dayPL >= 0 ? '+' : ''}${fI(dayPL)} (${dayPLp >= 0 ? '+' : ''}${dayPLp.toFixed(2)}%)`,
    `💼 Portfolio: ${fI(current)} · Total P&L ${totalPLp >= 0 ? '+' : ''}${totalPLp.toFixed(1)}%`,
  ];
  if (movers.length) lines.push(`🔥 Movers: ${movers.join(' · ')}`);
  if (breaches.length) lines.push(`🚨 SL Breach: ${breaches.join(', ')} — review now!`);
  if (actToday.length) lines.push(`⚡ Act Today: ${actToday.join(', ')}`);

  const title = breaches.length
    ? `🚨 StockSense — SL Breach Alert`
    : actToday.length
      ? `⚡ StockSense — Action Required`
      : `☀️ StockSense Morning Brief`;

  return { title, body: lines.join('\n'), tag: 'ss-morning-brief', data: { url: '/' } };
}

export async function onRequestPost({ request, env }) {
  try {
    // Auth check
    const body = await request.json().catch(() => ({}));
    const token = request.headers.get('X-SS-Token') || body.token;
    const expected = env.MORNING_BRIEF_TOKEN;
    if (expected && token !== expected) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS });
    }

    if (!env.STOCKSENSE_KV) {
      return Response.json({ ok: false, error: 'KV not configured' }, { status: 500, headers: CORS });
    }

    // Load portfolio from KV
    const raw = await env.STOCKSENSE_KV.get('portfolio');
    const portfolio = raw ? JSON.parse(raw) : null;
    if (!portfolio) {
      return Response.json({ ok: false, error: 'No portfolio data in KV' }, { status: 404, headers: CORS });
    }

    // Get push subscription
    const sub = portfolio.pushSubscription;
    if (!sub?.endpoint) {
      return Response.json({ ok: false, error: 'No push subscription stored — enable push in Settings first' }, { status: 404, headers: CORS });
    }

    // Build morning brief
    const brief = buildBrief(portfolio);
    if (!brief) {
      return Response.json({ ok: false, error: 'No holdings to brief' }, { status: 400, headers: CORS });
    }

    // Send push
    const pushResp = await sendPush(sub, brief, env);
    if (!pushResp.ok && pushResp.status !== 201) {
      const err = await pushResp.text().catch(() => pushResp.status.toString());
      return Response.json({ ok: false, error: err, status: pushResp.status }, { headers: CORS });
    }

    return Response.json({ ok: true, title: brief.title, lines: brief.body.split('\n') }, { headers: CORS });
  } catch(e) {
    return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
