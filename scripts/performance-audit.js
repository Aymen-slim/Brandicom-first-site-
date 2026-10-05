const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const base = process.env.AUDIT_URL || "http://localhost:8765";
const desktop = args.includes("--desktop");
const verify = args.includes("--verify");
const smoke = args.includes("--smoke");
const label = process.env.AUDIT_LABEL || "audit";
const post = { slug: "audit-post", title: "Performance audit post", excerpt: "A synthetic published article.", body: "Article content for browser verification.", coverImage: "/images/about-story.webp", secondImage: "/images/about-story.webp", readMinutes: 2, publishedAt: "2026-01-01" };

function routes(dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".") || ["node_modules", "dist", "scripts"].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return routes(file);
    return entry.name === "index.html" ? ["/" + path.relative(root, path.dirname(file)).replace(/\\/g, "/") + (dir === root ? "" : "/")] : [];
  });
}

async function audit(browser, route, warm = false, context = null) {
  context ||= await browser.newContext({ viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: desktop ? 1 : 2, isMobile: !desktop, hasTouch: !desktop });
  await context.route("**/api/posts*", r => r.fulfill({ json: { posts: [post] } }));
  let contactStatus = 200;
  await context.route("**/api/contact", r => r.fulfill({ status: contactStatus, json: contactStatus === 200 ? { ok: true } : { error: "Synthetic audit failure." } }));
  await context.route("http://127.0.0.1:7321/**", r => r.abort());
  const page = await context.newPage();
  const errors = [];
  const missing = [];
  const videos = new Set();
  let bytes = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const expectedContactFailure = response.url() === base + "/api/contact" && response.status() === 503 && contactStatus === 503;
    if (response.status() >= 400 && response.url().startsWith(base) && !expectedContactFailure) missing.push(response.url());
  });
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  if (!desktop && !smoke) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await client.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: 1125000, uploadThroughput: 500000 });
  }
  if (args.includes("--profile")) {
    await client.send("Profiler.enable");
    await client.send("Profiler.setSamplingInterval", { interval: 5000 });
    await client.send("Profiler.start");
  }
  client.on("Network.dataReceived", event => { bytes += event.encodedDataLength; });
  page.on("request", request => { if (/\.(mp4|webm|mov)(?:\?|$)/i.test(request.url())) videos.add(request.url().replace(base, "")); });
  await page.addInitScript(() => {
    window.auditMetrics = { lcp: 0, cls: 0, blocking: 0 };
    for (const type of ["largest-contentful-paint", "layout-shift", "longtask"]) {
      new PerformanceObserver(list => list.getEntries().forEach(entry => {
        if (type === "largest-contentful-paint") window.auditMetrics.lcp = entry.startTime;
        if (type === "layout-shift" && !entry.hadRecentInput) window.auditMetrics.cls += entry.value;
        if (type === "longtask") window.auditMetrics.blocking += Math.max(0, entry.duration - 50);
      })).observe({ type, buffered: true });
    }
  });
  const started = Date.now();
  await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(smoke ? 1000 : 3000);
  const initial = await page.evaluate(() => ({ ...window.auditMetrics, playing: [...document.querySelectorAll("video")].filter(v => !v.paused).length, fonts: [...new Set([...document.querySelectorAll("h1,h2,h3,p,.text-size-medium,.text-small,.nav_text")].map(el => getComputedStyle(el).fontFamily))], overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  const result = { route, viewport: desktop ? "desktop" : "phone", throttled: !desktop && !smoke, warm, elapsed: Date.now() - started, bytes, videoRequests: videos.size, videos: [...videos], ...initial, errors, missing };
  if (args.includes("--profile")) {
    const { profile } = await client.send("Profiler.stop");
    const counts = new Map();
    for (const sample of profile.samples || []) counts.set(sample, (counts.get(sample) || 0) + 1);
    result.cpu = profile.nodes.map(node => ({ function: node.callFrame.functionName, url: node.callFrame.url.replace(base, ""), line: node.callFrame.lineNumber + 1, samples: counts.get(node.id) || 0 })).filter(node => node.samples).sort((a, b) => b.samples - a.samples).slice(0, 15);
    result.title = await page.evaluate(() => {
      const title = document.querySelector(".hero-split-title");
      return title && { attributes: [...title.attributes].map(attribute => [attribute.name, attribute.value]), descendants: title.querySelectorAll("*").length, text: title.textContent };
    });
  }
  if (["/", "/about-us/", "/case-studies/amine/", "/case-studies/novatech/", "/service/"].includes(route)) await page.screenshot({ path: path.join(os.tmpdir(), `redha-${label}-${desktop ? "desktop" : "phone"}-${route.replace(/\W/g, "_")}.png`) });
  if (verify) {
    const stage = page.locator(".cucina-reels-stage");
    if (await stage.count()) {
      await stage.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll(".cucina-reel-card.is-active video")].some(video => !video.paused && video.readyState >= 2), null, { timeout: 10000 }).catch(() => {});
      result.slider = await page.evaluate(() => {
        const stage = document.querySelector(".cucina-reels-stage");
        const video = stage.querySelector(".is-active video");
        return { active: stage.querySelectorAll(".is-active").length, playing: [...stage.querySelectorAll("video")].filter(v => !v.paused).length, visible: stage.__performanceVisible, currentSrc: video && video.currentSrc, readyState: video && video.readyState, sources: video && [...video.querySelectorAll("source")].map(source => ({ src: source.src, lazy: source.dataset.src })), rect: stage.getBoundingClientRect().toJSON() };
      });
      const mute = stage.locator(".is-active .reel-mute-btn").first();
      if (await mute.count()) await mute.click({ force: true });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(700);
      result.offscreenPlaying = await page.evaluate(() => [...document.querySelectorAll(".cucina-reel-video")].filter(v => !v.paused).length);
    }
    const arrow = page.locator(".services_card-arrow-wrap").first();
    if (await arrow.count()) {
      await arrow.click({ force: true });
      result.serviceOpened = await page.locator(".services_card.is-open").count();
    }
    const menu = page.locator(".nav_menu-button").first();
    if (!desktop && await menu.count() && await menu.isVisible()) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await menu.click({ force: true });
      await page.waitForTimeout(500);
      result.menuOpened = await menu.getAttribute("aria-expanded") === "true";
      await menu.click({ force: true });
    }
    if (route === "/blog/") result.livePosts = await page.locator("[data-live-post]").count();
    if (route.startsWith("/post/")) result.articleTitle = await page.locator("#live-post-title").textContent();
    if (route === "/contact/") {
      await page.locator("#name").fill("Browser Audit");
      await page.locator("#mail").fill("audit@example.invalid");
      await page.locator("#phone").fill("12345678");
      const budget = page.locator("#social-budgeyt");
      if (await budget.evaluate(element => element.tagName) === "SELECT") await budget.selectOption({ index: 1 });
      else await budget.fill("1000");
      await page.locator("#checkbox").check({ force: true });
      contactStatus = 503;
      await page.locator('.contac_from [type="submit"]').click();
      await page.waitForTimeout(300);
      const failure = await page.locator(".w-form-fail").isVisible();
      contactStatus = 200;
      await page.locator('.contac_from [type="submit"]').click();
      await page.waitForTimeout(300);
      result.contactHandling = failure && await page.locator(".w-form-done").isVisible();
    }
  }
  await page.close();
  if (!warm) await context.close();
  return result;
}

(async () => {
  const executablePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const browser = await chromium.launch({ executablePath, headless: true });
  const selected = args.includes("--home") ? ["/"] : args.includes("--all") ? routes().map(route => route === "/post/" ? route + "?slug=audit-post" : route) : (process.env.AUDIT_ROUTES ? process.env.AUDIT_ROUTES.split(",") : args.filter(arg => !arg.startsWith("--"))).map(route => "/" + route.replace(/^\/+/, ""));
  const results = [];
  try {
    for (const route of selected.length ? selected : ["/", "/about-us/", "/service/", "/case-studies/amine/", "/case-studies/novatech/", "/blog/", "/post/?slug=audit-post"]) {
      const result = await audit(browser, route);
      results.push(result);
      console.log(JSON.stringify(result));
    }
    if (args.includes("--warm")) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await audit(browser, "/", true, context);
      results.push(await audit(browser, "/", true, context));
      await context.close();
    }
    const report = path.join(os.tmpdir(), `redha-${label}.json`);
    fs.writeFileSync(report, JSON.stringify(results, null, 2));
    console.log("Report: " + report);
    if (verify && results.some(row => row.errors.length || row.missing.length || row.offscreenPlaying > 0 || row.slider && row.slider.playing !== 1 || row.menuOpened === false || row.serviceOpened === 0 || row.contactHandling === false)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
