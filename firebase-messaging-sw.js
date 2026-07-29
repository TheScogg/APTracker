importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyABjasNBbJnsqq4M_UxKruKrN6-O2FXCwc",
  authDomain: "press-tracker-9d9c9.firebaseapp.com",
  projectId: "press-tracker-9d9c9",
  storageBucket: "press-tracker-9d9c9.firebasestorage.app",
  messagingSenderId: "943200266003",
  appId: "1:943200266003:web:4d24eab551a3fb145c1ce6"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload?.notification?.title || payload?.data?.title || 'AP Tracker';
  const options = {
    body: payload?.notification?.body || payload?.data?.body || '',
    icon: '/bookmarklet-fixed.png',
    badge: '/bookmarklet-fixed.png',
    data: payload?.data || {}
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  if (payload?.from || payload?.fcmMessageId || payload?.notification) return;

  const title = payload?.title || payload?.data?.title || 'AP Tracker';
  const options = {
    body: payload?.body || payload?.data?.body || '',
    icon: payload?.icon || '/icons/icon-192.png',
    badge: payload?.badge || '/icons/icon-192.png',
    data: payload?.data || {}
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    })
  );
});
