// sw.js - Service Worker for MEV Bot Dashboard

self.addEventListener('push', function(event) {
    if (event.data) {
        const data = event.data.json();
        console.log('Push received:', data);

        const options = {
            body: data.body,
            icon: data.icon || '/favicon.ico',
            badge: data.badge || '/badge.png',
            vibrate: [100, 50, 100],
            data: data.data || {}
        };

        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    // In a real SaaS, this would open the dashboard or a specific trade detail page
    event.waitUntil(
        clients.openWindow('/')
    );
});
