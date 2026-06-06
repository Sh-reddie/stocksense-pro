/**
 * StockSense Pro — /api/notify
 * Sends a Web Push notification to the stored subscription.
 * Uses VAPID authentication + AES-128-GCM content encryption (RFC 8291).
 *
 * Environment variables required (set in Cloudflare Pages → Settings → Variables):
 *   VAPID_PUBLIC_KEY   = BAGwFvjEBVSieZpJCRmGeRA0xH9DLGntLVHDnG3bh88d8FjTe3b6coW5RC7xRjyUCdzFh0hDQB7axQop0mD613c
 *   VAPID_PRIVATE_KEY  = 1_Wtz2gjRAKmy3VorvlRbG4ujbLLZtUG-58JaXuLcJ4
 *   VAPID_SUBJECT      = mailto:sharath9271@gmail.com
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-SS-Token',
};

// ── Utility: base64url helpers ───────────────────────────────────────────────
const b64uDecode = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
const b64uEncode = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

// ── VAPID JWT signing ────────────────────────────────────────────────────────
async function makeVapidJWT(endpoint, privateKeyB64u, subject, pubKeyB64u) {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = b64uEncode(new TextEncoder().encode(JSON.stringify({ typ:'JWT', alg:'ES256' })));
  const payload = b64uEncode(new TextEncoder().encode(JSON.stringify({ aud: origin, exp: now + 43200, sub: subject })));
  const msg = header + '.' + payload;

  const privKey = await crypto.subtle.importKey(
    'jwk',
    { kty:'EC', crv:'P-256', d: privateKeyB64u, x: b64uEncode(b64uDecode(pubKeyB64u).slice(1,33)), y: b64uEncode(b64uDecode(pubKeyB64u).slice(33,65)), key_ops:['sign'] },
    { name:'ECDSA', namedCurve:'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, privKey, new TextEncoder().encode(msg));
  return msg + '.' + b64uEncode(sig);
}

// ── Web Push content encryption (RFC 8291 / 8188) ───────────────────────────
async function encryptPush(subscription, plaintext) {
  const clientPubKey = b64uDecode(subscription.keys.p256dh);
  const auth         = b64uDecode(subscription.keys.auth);

  // Generate ephemeral ECDH key pair
  const ephKP = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', ephKP.publicKey));

  // Import client's public key
  const clientKey = await crypto.subtle.importKey('raw', clientPubKey, { name:'ECDH', namedCurve:'P-256' }, false, []);

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits({ name:'ECDH', public: clientKey }, ephKP.privateKey, 256);

  // HKDF-SHA-256: PRK from shared secret + auth
  const prk = await crypto.subtle.importKey('raw', sharedBits, { name:'HKDF' }, false, ['deriveBits']);
  const authInfo = concat(utf8('Content-Encoding: auth\0'), new Uint8Array(1)); // 1 null byte = 0x01
  const ikm = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt: auth, info: authInfo }, prk, 256);

  // Generate salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Key material from IKM
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name:'HKDF' }, false, ['deriveBits']);

  // CEK (content encryption key)
  const cekInfo = concat(utf8('Content-Encoding: aesgcm\0'), utf8('\0'), clientPubKey, ephPub);
  const cekBits  = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info: cekInfo }, ikmKey, 128);
  const cek = await crypto.subtle.importKey('raw', cekBits, { name:'AES-GCM' }, false, ['encrypt']);

  // Nonce
  const nonceInfo = concat(utf8('Content-Encoding: nonce\0'), utf8('\0'), clientPubKey, ephPub);
  const nonceBits = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info: nonceInfo }, ikmKey, 96);

  // Pad + encrypt
  const pt = new TextEncoder().encode(plaintext);
  const padded = concat(new Uint8Array(2), pt); // 2-byte pad length = 0
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv: nonceBits }, cek, padded));

  return { ciphertext, salt, serverPub: ephPub };
}

const utf8 = s => new TextEncoder().encode(s);
const concat = (...arrays) => { const out = new Uint8Array(arrays.reduce((n,a)=>n+a.length,0)); let i=0; arrays.forEach(a=>{out.set(a,i);i+=a.length;}); return out; };

// ── Main handler ─────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { subscription, title, message, url, tag } = body;

    if (!subscription?.endpoint || !subscription?.keys) {
      return Response.json({ ok: false, error: 'No subscription provided' }, { status: 400, headers: CORS });
    }

    const VAPID_PUBLIC  = env.VAPID_PUBLIC_KEY  || 'BAGwFvjEBVSieZpJCRmGeRA0xH9DLGntLVHDnG3bh88d8FjTe3b6coW5RC7xRjyUCdzFh0hDQB7axQop0mD613c';
    const VAPID_PRIVATE = env.VAPID_PRIVATE_KEY || '1_Wtz2gjRAKmy3VorvlRbG4ujbLLZtUG-58JaXuLcJ4';
    const VAPID_SUBJECT = env.VAPID_SUBJECT     || 'mailto:sharath9271@gmail.com';

    const jwt     = await makeVapidJWT(subscription.endpoint, VAPID_PRIVATE, VAPID_SUBJECT, VAPID_PUBLIC);
    const payload = JSON.stringify({ title: title || 'StockSense Alert', body: message || '', icon: '/icon-192.png', tag: tag || 'ss-alert', data: { url: url || '/' } });

    const { ciphertext, salt, serverPub } = await encryptPush(subscription, payload);

    const resp = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Authorization':  `vapid t=${jwt},k=${VAPID_PUBLIC}`,
        'Content-Encoding': 'aesgcm',
        'Content-Type':   'application/octet-stream',
        'Encryption':     `salt=${b64uEncode(salt)}`,
        'Crypto-Key':     `dh=${b64uEncode(serverPub)};p256ecdsa=${VAPID_PUBLIC}`,
        'TTL':            '86400',
      },
      body: ciphertext,
    });

    if (resp.ok || resp.status === 201) {
      return Response.json({ ok: true }, { headers: CORS });
    }
    const errText = await resp.text().catch(() => resp.status.toString());
    return Response.json({ ok: false, error: errText, status: resp.status }, { status: 500, headers: CORS });
  } catch(e) {
    return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
