// FriendConnect Service Worker v2
const CACHE = 'friendconnect-v2'
const SHELL = ['/', '/manifest.json', '/friendconnect-icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  // Network-first for navigation, cache fallback
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }).catch(() => caches.match(req).then((r) => r || caches.match('/')))
    )
    return
  }
  // Cache-first for static assets
  if (req.url.includes('/_next/static/') || req.url.includes('/uploads/')) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }))
    )
  }
})

// Push notifications
self.addEventListener('push', (e) => {
  let data = { title: 'FriendConnect', body: 'New notification' }
  try { if (e.data) data = e.data.json() } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/friendconnect-icon.svg',
      badge: '/friendconnect-icon.svg',
      data: data,
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const c of clients) {
      if (c.url.includes('/') && 'focus' in c) return c.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow('/')
  }))
})
