// Service worker: caches the app shell only. Desk data (d/...) is never cached.
const SHELL = "desk-shell-v5";
const FILES = ["./", "index.html", "app.css", "app.js", "chart.js", "vapid-public.js", "manifest.json", "icons/apple-touch-icon.png", "icons/icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.pathname.includes("/d/")) return; // always network
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
// Web push (Plan A only; Plan B has no /api/push so nothing is ever sent here).
// The payload carries the coin_url built by links.py on the desk; tapping opens it.
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Grok Bot · now", {
    body: d.body || "", icon: d.icon || "icons/apple-touch-icon.png", data: { url: d.url || null } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = e.notification.data && e.notification.data.url;
  if (target) e.waitUntil(clients.openWindow(target));
});
