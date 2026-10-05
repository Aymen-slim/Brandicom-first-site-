const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function optimizer() {
  return require("./optimize-html");
}

function runtime(globals = {}) {
  const events = {};
  const observers = [];
  const frames = new Map();
  let id = 0;
  const document = { hidden: false, readyState: "loading", addEventListener(name, callback) { (events[name] ||= []).push(callback); }, querySelectorAll() { return []; } };
  const window = { matchMedia(query) { return { matches: query.includes("max-width"), addEventListener() {}, addListener() {} }; }, addEventListener() {} };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() {}
  }
  window.IntersectionObserver = Observer;
  vm.runInNewContext(fs.readFileSync(path.join(root, "js/site-performance.js"), "utf8"), { ...globals, window, document, IntersectionObserver: Observer, requestAnimationFrame(callback) { frames.set(++id, callback); return id; }, cancelAnimationFrame(frame) { frames.delete(frame); }, console });
  return { api: window.SitePerformance, document, events, observers, frames };
}

test("animation frames stop offscreen and in a hidden document", () => {
  const { api, document, events, observers, frames } = runtime();
  const element = {};
  api.loop(element, () => {});
  assert.equal(frames.size, 0);
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(frames.size, 1);
  document.hidden = true;
  events.visibilitychange.forEach(callback => callback());
  assert.equal(frames.size, 0);
  document.hidden = false;
  events.visibilitychange.forEach(callback => callback());
  assert.equal(frames.size, 1);
  observers[0].callback([{ isIntersecting: false }]);
  assert.equal(frames.size, 0);
});

test("lazy video sources choose the phone variant only once", () => {
  const { api } = runtime();
  const source = { dataset: { src: "/original.mp4", mobileSrc: "/phone.mp4" }, removeAttribute(name) { if (name === "data-src") delete this.dataset.src; } };
  const video = { dataset: {}, querySelectorAll() { return source.dataset.src ? [source] : []; }, loadCount: 0, load() { this.loadCount++; } };
  api.loadVideo(video);
  api.loadVideo(video);
  assert.equal(source.src, "/phone.mp4");
  assert.equal(video.loadCount, 1);
});

test("inactive or offscreen carousel videos never load or play", async () => {
  const { api } = runtime();
  const stage = { __performanceVisible: false };
  const video = { closest(selector) { return selector === ".cucina-reels-stage" ? stage : null; }, querySelectorAll() { assert.fail("inactive sources must stay inert"); } };
  await api.play(video);
  stage.__performanceVisible = true;
  await api.play(video);
});

test("hero character motion preserves its stagger while batching DOM writes", () => {
  let states, options, killed = false;
  const { api } = runtime({ gsap: { to(targets, config) { states = targets; options = config; return { kill() { killed = true; } }; } } });
  const chars = [0, 1].map(() => ({ style: { removeProperty(name) { delete this[name]; } } }));
  const animation = api.animateChars(chars, { x: 50, duration: 0.6, ease: "power3.out", stagger: 0.025 });
  assert.equal(options.duration, 0.6);
  assert.equal(options.stagger, 0.025);
  assert.equal(options.ease, "power3.out");
  assert.equal(chars[0].style.transform, "translate3d(50.000px,0,0)");
  states[0].progress = 0.5;
  options.onUpdate();
  assert.equal(chars[0].style.transform, "translate3d(25.000px,0,0)");
  assert.equal(chars[0].style.opacity, "0.5");
  animation.revert();
  assert.equal(killed, true);
  assert.equal(chars[0].style.transform, undefined);
});

test("explicit pauses are respected until the user plays the video again", async () => {
  const { api, document, events } = runtime();
  let plays = 0;
  const video = { paused: false, dataset: {}, closest() { return null; }, querySelectorAll() { return []; }, play() { plays++; this.paused = false; return Promise.resolve(); } };
  const control = { hasAttribute() { return true; }, getAttribute() { return "test-video"; }, classList: { contains() { return false; } } };
  document.getElementById = () => video;
  events.click[0]({ target: { closest() { return control; } } });
  video.paused = true;
  await api.play(video);
  assert.equal(plays, 0);
  await api.play(video, true);
  assert.equal(plays, 1);
});

test("all public pages share a media controller and deferred dependency order", () => {
  const { optimizeHtml, htmlFiles } = optimizer();
  const files = htmlFiles(root);
  assert.equal(files.length, 25);
  for (const file of files) {
    const html = optimizeHtml(fs.readFileSync(file, "utf8"), file);
    assert.match(html, /src="\/js\/site-performance\.js"/);
    for (const tag of html.matchAll(/<script\b[^>]*\bsrc=[^>]*>/gi)) assert.match(tag[0], /\bdefer\b/);
    assert.doesNotMatch(html, /fetch\('http:\/\/127\.0\.0\.1:7321/);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc=|\btype="(?:application\/ld\+json|application\/json)"/.test(match[1])) new vm.Script(match[2], { filename: file });
    }
  }
});

test("video sources stay inert until visible, with phone variants and matching posters", () => {
  const { optimizeHtml } = optimizer();
  const html = optimizeHtml('<html><head></head><body><video class="cucina-reel-video" preload="metadata"><source src="../../reels/amine/amine-reel-1.mp4" type="video/mp4"></video></body></html>', path.join(root, "case-studies/amine/index.html"));
  assert.match(html, /preload="none"/);
  assert.match(html, /data-src="\/reels\/amine\/amine-reel-1.mp4"/);
  assert.doesNotMatch(html, /<source[^>]*\ssrc=/);
});

test("existing CSS posters are reused rather than downloaded again under a second URL", () => {
  const { optimizeHtml } = optimizer();
  const html = optimizeHtml('<html><head></head><body><video style="background-image:url(&quot;reels/existing.webp&quot;)"><source src="reels/reel-1.mp4"></video></body></html>', path.join(root, "index.html"), { "/reels/reel-1.mp4": { poster: "/reels/generated.poster.webp" } });
  assert.match(html, /poster="reels\/existing\.webp"/);
  assert.doesNotMatch(html, /poster="\/reels\/generated\.poster\.webp"/);
});

test("inline dependency consumers wait until deferred dependencies are available", () => {
  const { optimizeHtml } = optimizer();
  const html = optimizeHtml('<html><head></head><body><script src="js/gsap.min.js"></script><script>gsap.registerPlugin(ScrollTrigger);</script></body></html>', path.join(root, "index.html"));
  assert.match(html, /DOMContentLoaded/);
  assert.match(html, /src="js\/gsap.min.js" defer/);
});

test("responsive candidates do not enlarge existing WebP downloads or duplicate widths", () => {
  const { mediaManifest } = optimizer();
  for (const [key, entry] of Object.entries(mediaManifest())) {
    if (!entry.variants) continue;
    assert.equal(new Set(entry.variants.map(variant => variant.width)).size, entry.variants.length, key);
    const size = fs.statSync(path.join(root, key)).size;
    for (const variant of entry.variants) assert.ok(fs.statSync(path.join(root, variant.src)).size <= size, key);
  }
});

test("the post page uses the native menu helper without unused jQuery", () => {
  const { optimizeHtml } = optimizer();
  const file = path.join(root, "post/index.html");
  const html = optimizeHtml(fs.readFileSync(file, "utf8"), file);
  assert.doesNotMatch(html, /jquery\.min\.js/);
  assert.match(html, /site-nav-fallback/);
  assert.match(html, /src="\/js\/site-performance\.js"/);
});

test("comment-prefixed ready handlers are not registered inside another ready handler", () => {
  const { optimizeHtml } = optimizer();
  const html = optimizeHtml('<html><head></head><body><script>// Existing animation\ndocument.addEventListener("DOMContentLoaded", () => { gsap.to("h1", {}); });</script></body></html>', path.join(root, "index.html"));
  assert.equal((html.match(/DOMContentLoaded/g) || []).length, 1);
  assert.match(html, /\/\/ Existing animation/);
});

test("carousel controllers cancel idle frames and never skip hidden-video cleanup", () => {
  const { optimizeHtml } = optimizer();
  const html = optimizeHtml(fs.readFileSync(path.join(root, "case-studies/amine/index.html"), "utf8"), path.join(root, "case-studies/amine/index.html"));
  assert.match(html, /function requestRender\(\)/);
  assert.match(html, /cancelAnimationFrame\(frameId\)/);
  assert.match(html, /if \(hiddenVideo\) hiddenVideo\.pause\(\)/);
  assert.doesNotMatch(html, /var inView = true/);
  assert.match(html, /SitePerformance\.watchVisibility\(stage/);
});

test("Windows line endings do not leave mixed carousel schedulers", () => {
  const { optimizeHtml } = optimizer();
  for (const name of ["brewhouse", "radiance", "radiance-2", "zitouna", "cookiezannou", "amine"]) {
    const file = path.join(root, "case-studies", name, "index.html");
    const source = fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n");
    const html = optimizeHtml(source, file);
    assert.match(html, /function requestRender\(\)/, name);
    assert.match(html, /stage\.__performanceVisible = visible/, name);
    assert.doesNotMatch(html, /(?:io|observer)\.observe\(stage\)/, name);
  }
});

test("only fingerprinted static assets have immutable Vercel cache rules", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(config.outputDirectory, "dist");
  assert.equal(config.buildCommand, "npm run build");
  for (const entry of config.headers) {
    assert.ok(!entry.source.startsWith("/api"));
    if (entry.headers.some(header => header.value.includes("immutable"))) assert.match(entry.source, /a-f0-9/);
  }
});

test("published blog summaries omit article bodies without changing default detail responses", async () => {
  const handler = require("../api/posts");
  const previousFetch = global.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
  const urls = [];
  global.fetch = async url => {
    urls.push(new URL(url));
    return { ok: true, json: async () => [{ slug: "test", title: "Test", body: "Full article", published_at: "2026-01-01" }] };
  };
  const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; } });
  try {
    const summary = response();
    await handler({ method: "GET", query: { summary: "1" } }, summary);
    assert.equal(urls[0].searchParams.get("published"), "eq.true");
    assert.ok(!urls[0].searchParams.get("select").split(",").includes("body"));
    const detail = response();
    await handler({ method: "GET", query: { slug: "test" } }, detail);
    assert.ok(urls[1].searchParams.get("select").split(",").includes("body"));
    assert.equal(detail.data.posts[0].body, "Full article");
    assert.equal(detail.headers["Cache-Control"], "no-store");
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
