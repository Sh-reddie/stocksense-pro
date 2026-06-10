// StockSense Pro Service Worker — v3
// Changes: bump cache version, add pushsubscriptionchange handler so Chrome's
// silent subscription rotation never silently breaks price alerts.
const CACHE_NAME = 'stocksense-v3';
const OFFLINE_URL = '/';

const PRECACHE = ['/', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response('{"error":"offline"}', {headers:{'Content-Type':'application/json'}})));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resp.clone()));
          return resp;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, resp.clone()));
        return resp;
      });
    })
  );
});

// ── Push notification handler ────────────────────────────────────────────────
self.addEventListener('push', event => {
  let payload = { title: 'StockSense Alert', body: '', icon: '/icon-192.png', tag: 'ss-alert', data: {} };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body:    payload.body,
      icon:    payload.icon || '/icon-192.png',
      badge:   '/icon-192.png',
      tag:     payload.tag || 'ss-alert',
      data:    payload.data || {},
      vibrate: [200, 100, 200],
      actions: payload.actions || [],
    })
  );
});

// ── Notification click handler ───────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const existing = wins.find(w => w.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.postMessage({ type: 'SS_ALERT_CLICK', data: event.notification.data }); }
      else clients.openWindow(url);
    })
  );
});

// ── Periodic Background Sync ─────────────────────────────────────────────────
// Fires ~every hour when the tab is closed (browser-controlled, not guaranteed).
// Fetches the KV price cache (written by GitHub Actions) and broadcasts to
// any open clients so the Market Scanner is pre-populated on next open.
self.addEventListener('periodicsync', event => {
  if (event.tag !== 'price-refresh') return;
  event.waitUntil(
    fetch('/api/prices', { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.prices || !Object.keys(data.prices).length) return;
        return clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(wins => wins.forEach(w => w.postMessage({ type: 'SS_PRICES_UPDATE', data })));
      })
      .catch(() => {})
  );
});

// ── One-shot Background Sync (fires when connectivity returns) ────────────────
self.addEventListener('sync', event => {
  if (event.tag !== 'price-sync') return;
  event.waitUntil(
    fetch('/api/prices', { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.prices || !Object.keys(data.prices).length) return;
        return clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(wins => wins.forEach(w => w.postMessage({ type: 'SS_PRICES_UPDATE', data })));
      })
      .catch(() => {})
  );
});

// ── Push subscription renewal ────────────────────────────────────────────────
// Chrome silently rotates push subscriptions every ~60 days. Without this
// handler the old endpoint becomes invalid and all price alerts stop working.
// We re-subscribe with the same VAPID key and post the new sub to the app page
// so it can persist it to KV. The app listens for SS_PUSH_RENEWED messages.
self.addEventListener('pushsubscriptionchange', event => {
  const VAPID_PUBLIC_KEY = 'BAGwFvjEBVSieZpJCRmGeRA0xH9DLGntLVHDnG3bh88d8FjTe3b6coW5RC7xRjyUCdzFh0hDQB7axQop0mD613c';

  function b64uToUint8(b64u) {
    const pad = b64u.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
  }

  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uToUint8(VAPID_PUBLIC_KEY),
    })
    .then(newSub => {
      // Notify all open pages so they can persist the new sub to KV
      return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
        wins.forEach(w => w.postMessage({ type: 'SS_PUSH_RENEWED', subscription: newSub.toJSON() }));
        // Also persist directly via /api/data if no clients are open
        if (!wins.length) {
          return fetch('/api/data', {
            method: 'GET',
            signal: AbortSignal.timeout(6000),
          }).then(r => r.json()).then(({ data }) => {
            if (!data) return;
            return fetch('/api/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...data, pushSubscription: newSub.toJSON() }),
            });
          }).catch(() => {});
        }
      });
    })
    .catch(() => {})
  );
});
