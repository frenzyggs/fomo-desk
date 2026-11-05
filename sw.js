// Service worker: caches the app shell only. Desk data (d/...) is never cached.
const SHELL = "desk-shell-v1";
const FILES = ["./", "index.html", "app.css", "app.js", "chart.js", "vapid-public.js", "manifest.json", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.pathname.includes("/d/")) return; // always network
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
