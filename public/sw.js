const CACHE_PREFIX = "kisap-shell-";
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_ID__`;
const APP_SHELL = [
  "/",
  "/404.html",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/og-image.png",
  "/site.webmanifest",
  "/privacy.html",
  "/fonts/Manrope-Variable.ttf",
  "/fonts/DMMono-Light.ttf",
  "/fonts/DMMono-Regular.ttf",
  "/fonts/DMMono-Medium.ttf",
  "/fonts/Newsreader-Italic-Variable.ttf",
];

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
  if (results[0].status === "rejected") throw results[0].reason;
  const response = await fetch("/", { cache: "no-cache" });
  const html = await response.clone().text();
  await cache.put("/", response);
  const builtAssets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g), (match) => match[1]);
  if (builtAssets.length) await cache.addAll(builtAssets);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("/")),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      }
      return response;
    })),
  );
});
