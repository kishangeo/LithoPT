// Offline support for LithoPT: network-first (so updates are picked up), cache fallback when offline.
const CACHE = "lithopt-v4.3.2-gtm";
const ASSETS = ["./", "index.html", "styles.css", "lithopt-domains.js", "lithopt-core.js", "lithopt-report.js", "theme.js", "gtm.js", "app.js", "logo.svg", "favicon.svg", "manifest.webmanifest", "docs/LithoPT_User_Manual.pdf", "docs/manual.html", "docs/glossary.json"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && new URL(e.request.url).origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
