# Project information

- This is a static Webflow-exported HTML/CSS/JavaScript site with native Node API handlers, not a framework application.
- `npm run dev` serves optimized pages at port 8765; set `PORT` to use another port. Restart the server after changing server-side JavaScript.
- `npm run build` generates the 25 optimized public pages and fingerprinted assets in `dist/`; Vercel serves that directory. Both build and local development use `scripts/optimize-html.js`.
- `npm run media` generates additional responsive WebP images, mobile MP4s, and posters using Python/Pillow and FFmpeg. Originals are retained. Commit generated derivatives and `images/media-manifest.json` along with code changes.
- `npm test` runs native Node performance/API regression checks. `npm run test:browser` checks all routes using Playwright and installed Chrome; set `CHROME_PATH` or `AUDIT_URL` when needed. Browser reports/screenshots are saved in the system temporary directory.
- Browser checks mock Blog/Post and Contact endpoints; do not send real contact submissions or change production Supabase data during verification.
- Preserve visible animations, typography, autoplay, slider geometry, and controls. Never blanket-apply CSS containment/content-visibility to sticky or ScrollTrigger sections.
- Keep dependency order when deferring Webflow, GSAP, SplitText, ScrollTrigger, and Lenis scripts. Shared video preparation must not take playback ownership away from carousel controllers.
- Only content-fingerprinted assets receive immutable browser caching. Blog API responses retain `no-store` so publishing changes stay immediately visible.
