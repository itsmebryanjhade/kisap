import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const requiredFiles = [
  "index.html",
  "privacy.html",
  "404.html",
  "site.webmanifest",
  "sw.js",
  "robots.txt",
  "_headers",
  "favicon.svg",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "og-image.png",
];

for (const filename of requiredFiles) {
  await access(path.join(dist, filename));
}

const [indexHtml, privacyHtml, serviceWorker, robots, manifestSource] = await Promise.all([
  readFile(path.join(dist, "index.html"), "utf8"),
  readFile(path.join(dist, "privacy.html"), "utf8"),
  readFile(path.join(dist, "sw.js"), "utf8"),
  readFile(path.join(dist, "robots.txt"), "utf8"),
  readFile(path.join(dist, "site.webmanifest"), "utf8"),
]);

function assert(condition, message) {
  if (!condition) throw new Error(`Build verification failed: ${message}`);
}

const combined = `${indexHtml}\n${privacyHtml}\n${serviceWorker}`;
assert(!combined.includes("KISAP_SEO_BUILD"), "SEO marker was not replaced.");
assert(!combined.includes("KISAP_STRUCTURED_DATA"), "structured-data marker was not replaced.");
assert(!combined.includes("__BUILD_ID__"), "service-worker build ID was not replaced.");
assert(indexHtml.includes("Free Online Photo Booth"), "production title is missing.");
assert(indexHtml.includes('rel="manifest"'), "web app manifest link is missing.");
assert(indexHtml.includes("viewport-fit=cover"), "safe-area viewport support is missing.");
assert(indexHtml.includes('property="og:image"'), "Open Graph image is missing.");
assert(/CACHE_NAME\s*=\s*`\$\{CACHE_PREFIX\}v0\.1\.0-[a-f0-9]{12}`/.test(serviceWorker), "versioned service-worker cache is missing.");

const manifest = JSON.parse(manifestSource);
assert(manifest.name === "kisap.", "manifest name is incorrect.");
assert(manifest.start_url === "/", "manifest start URL is incorrect.");
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest icons are incomplete.");

if (process.env.SITE_URL?.trim()) {
  await access(path.join(dist, "sitemap.xml"));
  assert(indexHtml.includes('rel="canonical"'), "canonical URL is missing.");
  assert(indexHtml.includes('type="application/ld+json"'), "structured data is missing.");
  assert(robots.includes("Sitemap:"), "robots.txt does not reference the sitemap.");
} else {
  assert(indexHtml.includes('content="noindex, nofollow"'), "preview build is not protected by noindex.");
  assert(robots.includes("Disallow: /"), "preview robots.txt does not block crawling.");
}

console.log(`Verified Kisap build: ${requiredFiles.length} required public files are ready.`);
