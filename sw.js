// Keeps a copy of the app on this device so it can open with no internet (it then shows the music saved here).
// Network first: online you always get the latest version; the saved copy is only used when the network fails.
const SHELL = 'hos-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const own = u.origin === self.location.origin && u.pathname !== '/sw.js' && !u.pathname.startsWith('/__listen-audio/')
    && !/^\/(oauth|api|mcp|\.well-known)(\/|$)/.test(u.pathname); // the Claude connector: never cached
  const lib = u.hostname === 'cdn.jsdelivr.net' && u.pathname.startsWith('/npm/@supabase/');
  if (!own && !lib) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) { const copy = res.clone(); e.waitUntil(caches.open(SHELL).then(c => c.put(r, copy)).catch(() => {})); }
    return res;
  }).catch(async () => (await caches.match(r)) || (r.mode === 'navigate' ? (await caches.match('/')) : null) || Response.error()));
});
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Hamid OS', {
    body: d.body || '', tag: d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.startsWith(self.location.origin)) {
        await c.focus();
        if (c.url !== url && 'navigate' in c) { try { await c.navigate(url); } catch (err) {} }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
