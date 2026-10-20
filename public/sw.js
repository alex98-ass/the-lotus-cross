// The Lotus Cross — service worker
// Goal: the app opens instantly and still opens when the signal drops.
// Strategy: network-first for pages and data (so nothing is ever stale),
// cache-first for the shell (icons, fonts, legal pages, offline page).

const VERSION = 'lotus-v11';
const SHELL = [
  '/offline.html',
  '/legal.css',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
  '/privacy.html',
  '/terms.html',
  '/cookies.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // fonts/CDN: leave alone
  if (url.pathname.startsWith('/api/')) return;          // never cache personal data

  const isPage = req.mode === 'navigate' || /\.html$/.test(url.pathname);
  // Scripts and styles are fetched fresh first, so every visitor always gets the current
  // version of the app — a stale script is worse than a slow one.
  const isCode = /\.(js|css)$/.test(url.pathname);

  if (isPage || isCode) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/offline.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('/offline.html'));
    })
  );
});
