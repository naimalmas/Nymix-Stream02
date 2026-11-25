self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Ignore malformed payloads. */ }
  if (data.type !== 'incoming-call') return;

  const name = data.name || 'Your friend';
  const kind = data.kind === 'video' ? 'video' : 'audio';
  event.waitUntil(self.registration.showNotification(`${name} is calling`, {
    body: `Incoming ${kind} call on Nymix`,
    icon: '/favicon.svg?v=20261125-1',
    badge: '/favicon.svg?v=20261125-1',
    tag: 'nymix-incoming-call',
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 600],
    data: { url: data.url || '/?call=1' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus().then(() => existing.navigate(target));
    return self.clients.openWindow(target);
  }));
});
