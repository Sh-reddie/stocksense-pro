// StockSense Pro Service Worker — v2 (push notifications)
const CACHE_NAME = 'stocksense-v2';
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
