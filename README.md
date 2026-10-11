# kisap.

Kisap is a private, browser-based photo booth built around four still and moving moments. The finished 1200 × 1800 strip duplicates those four captures into two matching columns for easy saving and sharing.

## Release status

Kisap now includes the complete capture, review, edit, download, motion, native-share, private recovery, responsive mobile, and installable/offline flows. The live preview and exported media share the same two-strip geometry, colors, filters, typography, and sticker coordinates. Motion export prefers H.264 in an MP4 container when the browser provides it, with standards-based WebM recording as the fallback.

## Local development

```sh
pnpm install
pnpm dev
```

## Product principles

- Photos and motion clips stay on the user’s device.
- No account, upload, gallery, or backend is required.
- One signature format: four unique moments, duplicated side by side.
- Printing is intentionally out of scope.

## Production deployment

Kisap is ready for static hosting. Cloudflare Pages is the recommended host because it provides HTTPS, preview deployments, custom domains, and edge caching without requiring a backend.

For a safe preview build:

```sh
pnpm build
```

Preview builds automatically use `noindex` so temporary hosting URLs do not compete with the final domain in search results.

For the public production build, set the final HTTPS address first:

```sh
SITE_URL=https://your-domain.example pnpm build
```

On Windows PowerShell:

```powershell
$env:SITE_URL="https://your-domain.example"
pnpm build
```

The production build generates the canonical URL, absolute social image URL, `robots.txt`, `sitemap.xml`, and WebApplication structured data. It also creates a unique service-worker cache version so returning visitors receive new releases reliably.

### Cloudflare Pages settings

- Framework preset: `Vite`
- Build command: `pnpm build`
- Build output directory: `dist`
- Production environment variable: `SITE_URL=https://your-final-domain`
- Preview environment: leave `SITE_URL` unset

Deploy the contents of `dist/` at the root of an HTTPS domain. HTTPS is required for camera access, native file sharing, installation, and the service worker. After deploying, test at least one real iPhone in Safari and one Android phone in Chrome.

Kisap does not require a database, authentication, object storage, or a server runtime. `SITE_URL` is public build configuration, not a secret.

## Launch checklist

1. Deploy a preview and complete the capture, retake, edit, single-strip, double-strip, motion, and share flows on real phones.
2. Connect the purchased domain in Cloudflare Pages and set the production `SITE_URL` to that exact origin.
3. Trigger one new production deployment after the domain and environment variable are saved.
4. Confirm `/robots.txt`, `/sitemap.xml`, `/privacy.html`, and the social preview image load from the public domain.
5. Add the domain to Google Search Console, submit `/sitemap.xml`, and request indexing for the home page.
6. Keep the temporary Pages address out of public promotion; its preview builds remain `noindex` by default.

## Privacy and offline behavior

- Fonts, icons, and brand artwork are served locally.
- No analytics, advertising trackers, or third-party font requests are included.
- Unfinished sessions are kept locally in IndexedDB for up to six hours.
- Successful export, starting over, or expiration clears the recovery copy.
- The service worker caches the app shell and production assets for repeat and offline use.
- The public privacy notice is available at `/privacy.html`.
