// DRIVE MAXX service worker: makes the app installable and shows push notifications (new orders for admins).
// No offline cache: the app always talks to the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Tell open windows right away (they show their own popup and sound).
    windows.forEach(client => client.postMessage({ type: 'push', data }));
    // If the app is on screen, its popup is enough; otherwise show the system notification.
    if (data.orderId && windows.some(client => client.visibilityState === 'visible' && client.focused)) return;
    await self.registration.showNotification(data.title || 'DRIVE MAXX', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-badge.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      requireInteraction: !!data.sticky,
      vibrate: data.sticky ? [200, 100, 200] : undefined,
      data: { url: data.url || '/' }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => client.url.startsWith(self.location.origin));
    if (open) { await open.navigate(target).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(target);
  })());
});
