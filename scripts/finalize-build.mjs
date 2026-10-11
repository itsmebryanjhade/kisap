import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function getSiteUrl(value) {
  if (!value?.trim()) return null;

  const url = new URL(value.trim());
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localHost && url.protocol === "http:")) {
    throw new Error("SITE_URL must use HTTPS (HTTP is allowed only for localhost).\n");
  }
  if (url.search || url.hash) {
    throw new Error("SITE_URL cannot include a query string or hash.\n");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function replaceRequired(source, searchValue, replacement, filename) {
  if (!source.includes(searchValue)) {
    throw new Error(`Missing build marker ${searchValue} in ${filename}.`);
  }
  return source.replace(searchValue, replacement);
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const siteUrl = getSiteUrl(process.env.SITE_URL);
const indexPath = path.join(dist, "index.html");
const privacyPath = path.join(dist, "privacy.html");
const swPath = path.join(dist, "sw.js");

let indexHtml = await readFile(indexPath, "utf8");
let privacyHtml = await readFile(privacyPath, "utf8");
let serviceWorker = await readFile(swPath, "utf8");

if (siteUrl) {
  const homeUrl = `${siteUrl}/`;
  const privacyUrl = `${siteUrl}/privacy.html`;
  const socialImageUrl = `${siteUrl}/og-image.png`;
  const homeSeo = [
    '<meta name="robots" content="index, follow, max-image-preview:large" />',
    `<link rel="canonical" href="${homeUrl}" />`,
    `<meta property="og:url" content="${homeUrl}" />`,
  ].join("\n    ");
  const privacySeo = [
    '<meta name="robots" content="index, follow, max-image-preview:large" />',
    `<link rel="canonical" href="${privacyUrl}" />`,
  ].join("\n    ");
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Kisap",
    url: homeUrl,
    description:
      "A free, private online photo booth for creating four-photo strips and moving memories directly in your browser.",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and camera access",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Four-photo strip capture",
      "Motion photo booth export",
      "On-device editing",
      "No account or uploads required",
    ],
    creator: {
      "@type": "Person",
      name: "Bryan Jhade Ebuan",
    },
  };

  indexHtml = replaceRequired(indexHtml, "<!-- KISAP_SEO_BUILD -->", homeSeo, "index.html");
  indexHtml = replaceRequired(
    indexHtml,
    "<!-- KISAP_STRUCTURED_DATA -->",
    `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`,
    "index.html",
  );
  indexHtml = indexHtml.replaceAll('content="/og-image.png"', `content="${socialImageUrl}"`);
  privacyHtml = replaceRequired(privacyHtml, "<!-- KISAP_SEO_BUILD -->", privacySeo, "privacy.html");

  await writeFile(
    path.join(dist, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
  );
  await writeFile(
    path.join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${xmlEscape(homeUrl)}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>\n  <url>\n    <loc>${xmlEscape(privacyUrl)}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>\n</urlset>\n`,
  );
} else {
  const noIndex = '<meta name="robots" content="noindex, nofollow" />';
  indexHtml = replaceRequired(indexHtml, "<!-- KISAP_SEO_BUILD -->", noIndex, "index.html");
  indexHtml = replaceRequired(indexHtml, "<!-- KISAP_STRUCTURED_DATA -->", "", "index.html");
  privacyHtml = replaceRequired(privacyHtml, "<!-- KISAP_SEO_BUILD -->", noIndex, "privacy.html");

  await writeFile(path.join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
  await rm(path.join(dist, "sitemap.xml"), { force: true });
}

await writeFile(indexPath, indexHtml);
await writeFile(privacyPath, privacyHtml);

const buildFingerprint = createHash("sha256")
  .update(packageJson.version)
  .update(indexHtml)
  .digest("hex")
  .slice(0, 12);
const buildId = `v${packageJson.version}-${buildFingerprint}`;
serviceWorker = replaceRequired(serviceWorker, "__BUILD_ID__", buildId, "sw.js");
await writeFile(swPath, serviceWorker);

console.log(
  siteUrl
    ? `Prepared indexed production build for ${siteUrl} (${buildId}).`
    : `Prepared protected preview build with noindex (${buildId}).`,
);
