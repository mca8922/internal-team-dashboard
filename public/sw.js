// Mahesh Chandra & Associates service worker — handles Web Push events so notifications arrive
// even when the dashboard tab is closed.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Mahesh Chandra & Associates', body: event.data?.text() ?? '' };
  }

  const title = data.title ?? 'Mahesh Chandra & Associates';
  const options = {
    body: data.body ?? '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: { url: data.url ?? '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Focus an existing tab if one is open, otherwise open a new one.
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      }),
  );
});
