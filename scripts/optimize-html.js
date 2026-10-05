const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const manifestFile = path.join(root, "images/media-manifest.json");
let manifestTime = 0;
let manifest = {};

function htmlFiles(dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".") || ["node_modules", "dist", "scripts"].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(file) : entry.name === "index.html" ? [file] : [];
  });
}

function mediaManifest() {
  if (!fs.existsSync(manifestFile)) return {};
  const time = fs.statSync(manifestFile).mtimeMs;
  if (time !== manifestTime) {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    for (const [key, entry] of Object.entries(manifest)) {
      if (!entry.variants) continue;
      const original = path.join(root, key);
      const bytes = fs.statSync(original).size;
      entry.variants = entry.variants.filter(variant => fs.statSync(path.join(root, variant.src)).size < bytes);
      if (/\.webp$/i.test(key)) entry.variants.push({ src: key, width: entry.width, height: entry.height });
      entry.variants = entry.variants.sort((a, b) => a.width - b.width).filter((variant, index, list) => !index || variant.width !== list[index - 1].width);
      if (!entry.variants.length) delete entry.variants;
    }
    manifestTime = time;
  }
  return manifest;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp('(?:^|\\s)' + name + '(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+)))?(?=\\s|/?>)', "i"));
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : null;
}

function setAttribute(tag, name, value) {
  const pattern = new RegExp('\\s' + name + '(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?(?=\\s|/?>)', "i");
  const text = value === null ? "" : " " + name + (value === "" ? "" : '="' + String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"');
  return pattern.test(tag) ? tag.replace(pattern, text) : tag.replace(/\s*\/?>$/, text + ">");
}

function localUrl(value, file) {
  if (!value || /^(?:https?:|data:|blob:|\/\/|#)/i.test(value)) return null;
  return decodeURIComponent(new URL(value.replace(/&amp;/g, "&"), "http://site/" + path.relative(root, file).replace(/\\/g, "/")).pathname);
}

function comments(code) {
  return (code.match(/^\s*\/\/[^\n]*|\/\*[\s\S]*?\*\//gm) || []).join("\n");
}

function optimizeInline(code) {
  if (code.includes("High-Performance Lazy Loader")) return comments(code);
  if (/fetch\(['"]http:\/\/127\.0\.0\.1:7321\//.test(code)) return comments(code);
  if (code.includes('document.querySelectorAll(".section_bts video")')) {
    code = code.replace(/  var videos = document\.querySelectorAll\("\.section_bts video"\);[\s\S]*?(?=  function initScroll\()/, "");
  }
  code = code.replace(/function raf\(time\) \{\s*lenis\.raf\(time\);\s*requestAnimationFrame\(raf\);\s*\}\s*requestAnimationFrame\(raf\);/g, "SitePerformance.smoothScroll(lenis);");
  code = code.replace(/(\b(?:video|v|heroVideo))\.play\(\)/g, "SitePerformance.play($1)");
  code = code.replace(/var halfWidth = strip\.scrollWidth \/ 2;/g, "var halfWidth = SitePerformance.width(strip, 2);");
  code = code.replace(/function getStripWidth\(\) \{ return strip\.scrollWidth; \}/g, "function getStripWidth() { return SitePerformance.width(strip); }");
  code = code.replace(/var stageWidth = stage\.offsetWidth;/g, "var stageWidth = stage.clientWidth;");
  code = code.replace(/gsap\.ticker\.add\(function \(time, deltaTime\)/g, "SitePerformance.ticker(wrapper, function (time, deltaTime)");
  if (code.includes('document.querySelector(".section-hero .banner-marque")')) {
    code = code.replace("const width = track.scrollWidth / 3;", "const width = SitePerformance.width(track, 3);");
    code = code.replace("return width > 1 ? width : track.scrollWidth;", "return width > 1 ? width : SitePerformance.width(track);");
    code = code.replace(/    requestAnimationFrame\(tick\);/g, "");
    code = code.replace("  requestAnimationFrame(tick);", "  SitePerformance.loop(stage, tick);");
  }
  if (code.includes("function getStripWidth()") && code.includes("function animate()")) {
    code = code.replace("    raf = requestAnimationFrame(animate);", "");
    code = code.replace("  animate();", "  SitePerformance.loop(wrapper, animate);");
    code = code.replace(/    cancelAnimationFrame\(raf\);\n    raf = requestAnimationFrame\(animate\);/g, "");
  }
  if (code.includes("hero-split-title") && code.includes("resizeTimer")) {
    code = code.replace("animation = gsap.from(split.chars,", "animation = SitePerformance.animateChars(split.chars,");
    code = code.replace("  let resizeTimer;", "  let resizeTimer;\n  let titleWidth = window.innerWidth;");
    code = code.replace('  window.addEventListener("resize", () => {', '  window.addEventListener("resize", () => {\n    if (window.innerWidth === titleWidth) return;\n    titleWidth = window.innerWidth;');
  }
  if (code.includes("var curProgress = 0.0;") && code.includes("function render()")) {
    code = code.replace("var inView = true;", 'var inView = !("IntersectionObserver" in window) && !document.hidden;');
    code = code.replace(/      if \(absDiff > ([^\n]+)\) \{\n/, '$&        var hiddenVideo = card.__performanceVideo;\n        if (hiddenVideo) hiddenVideo.pause();\n        card.classList.remove("is-active");\n');
    code = code.replace(/  function render\(\) \{[\s\S]*?\n  \}\n  requestAnimationFrame\(render\);\n/, `  var frameId = 0;
  function requestRender() {
    if (!frameId && inView && !document.hidden) frameId = requestAnimationFrame(render);
  }
  function render() {
    frameId = 0;
    if (!inView || document.hidden) return;
    var diff = targetProgress - curProgress;
    if (Math.abs(diff) > 0.0004) {
      curProgress += diff * 0.14;
      updateCards(curProgress);
      requestRender();
    }
  }
`);
    code = code.replace(/^(\s*)(targetProgress\s*(?:\+=|-=|=)[^\n;]+;)/gm, "$1$2\n$1requestRender();");
    code = code.replace("  function startAutoScroll() {\n    stopAutoScroll();", "  function startAutoScroll() {\n    stopAutoScroll();\n    if (!inView || document.hidden || isUserInteracting) return;");
    code = code.replace(/  if \('IntersectionObserver' in window\) \{[\s\S]*?    (?:observer|io)\.observe\(stage\);\n  \}/, `  SitePerformance.watchVisibility(stage, function (visible) {
    inView = visible;
    stage.__performanceVisible = visible;
    if (visible) {
      startAutoScroll();
      updateCards(curProgress);
      requestRender();
    } else {
      stopAutoScroll();
      cancelAnimationFrame(frameId);
      frameId = 0;
      cards.forEach(function (card) { if (card.__performanceVideo) card.__performanceVideo.pause(); });
    }
  });`);
  }
  if (code.includes("var stage =") && code.includes(".cucina-reel-card")) {
    code = code.replace(/(  var cards = Array\.from\(stage\.querySelectorAll\('\.cucina-reel-card'\)\);)/, "$1\n  cards.forEach(function (card) { card.__performanceVideo = card.querySelector('.cucina-reel-video'); });");
    code = code.replace(/(card|c)\.querySelector\('\.cucina-reel-video'\)/g, "$1.__performanceVideo");
    code = code.replace("card.__performanceVideo = card.__performanceVideo", "card.__performanceVideo = card.querySelector('.cucina-reel-video')");
    if (!code.includes("SitePerformance.watchVisibility(stage,")) {
      code = code.replace(/  updateCards\(curProgress\);\n/, `  updateCards(curProgress);
  SitePerformance.watchVisibility(stage, function (visible) {
    stage.__performanceVisible = visible;
    if (visible) updateCards(curProgress);
    else cards.forEach(function (card) { if (card.__performanceVideo) card.__performanceVideo.pause(); });
  });
`);
    }
  }
  return code;
}

function optimizeHtml(html, file, media = mediaManifest()) {
  html = html.replace(/\r\n?/g, "\n");
  let insideHead = true;
  html = html.replace(/<\/head>|<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, body) => {
    if (/^<\/head>/i.test(tag)) { insideHead = false; return tag; }
    if (/\btype=["'](?:application\/ld\+json|application\/json)/i.test(attrs)) return tag;
    if (attribute("<script" + attrs + ">", "src") !== null) {
      if (/post[\\/]index\.html$/.test(file) && /jquery\.min\.js/.test(attrs)) return "";
      return setAttribute("<script" + attrs + ">", "defer", "") + body + "</script>";
    }
    if (insideHead) return tag;
    body = optimizeInline(body);
    if (!body.trim()) return "<script></script>";
    const executable = body.replace(/^\s*\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//gm, "").trim();
    if (executable && !/^(?:document|window)\.addEventListener\(["']DOMContentLoaded/.test(executable)) {
      body = 'document.addEventListener("DOMContentLoaded", function () {\n' + body + '\n}, { once: true });';
    }
    return "<script" + attrs + ">" + body + "</script>";
  });
  html = html.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, block => {
    let opening = block.match(/^<video\b[^>]*>/i)[0];
    const wasAutoplay = attribute(opening, "autoplay") !== null;
    const cls = attribute(opening, "class") || "";
    const sourceUrls = [...block.matchAll(/<source\b[^>]*>/gi)].map(match => attribute(match[0], "src") || attribute(match[0], "data-src"));
    const url = localUrl(attribute(opening, "src") || sourceUrls.find(Boolean), file);
    const entry = media[url];
    opening = setAttribute(opening, "preload", "none");
    opening = setAttribute(opening, "autoplay", null);
    if (wasAutoplay) opening = setAttribute(opening, "data-performance-autoplay", "true");
    let poster = attribute(opening, "poster");
    if (!poster) {
      const background = (attribute(opening, "style") || "").match(/background-image:\s*url\((?:&quot;|["'])?([^\)"']+?)(?:&quot;|["'])?\)/);
      poster = background && background[1].replace(/&quot;/g, "") || entry && entry.poster;
      if (poster) opening = setAttribute(opening, "poster", poster);
    }
    const direct = attribute(opening, "src");
    if (direct) {
      opening = setAttribute(opening, "src", null);
      opening = setAttribute(opening, "data-src", localUrl(direct, file) || direct);
      if (entry && entry.mobile) opening = setAttribute(opening, "data-mobile-src", entry.mobile);
    }
    block = opening + block.slice(block.match(/^<video\b[^>]*>/i)[0].length);
    return block.replace(/<source\b[^>]*>/gi, tag => {
      const source = attribute(tag, "src") || attribute(tag, "data-src");
      if (!source) return tag;
      const local = localUrl(source, file);
      tag = setAttribute(tag, "src", null);
      tag = setAttribute(tag, "data-src", local || source);
      if (local && media[local] && media[local].mobile) tag = setAttribute(tag, "data-mobile-src", media[local].mobile);
      return tag;
    });
  });
  html = html.replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, block => {
    const image = block.match(/<img\b[^>]*>/i);
    const key = image && localUrl(attribute(image[0], "src"), file);
    if (!key || !media[key] || !media[key].variants) return block;
    return block.replace(/<source\b[^>]*>/gi, tag => {
      const sourceKey = localUrl(attribute(tag, "srcset"), file);
      const entry = media[sourceKey] && media[sourceKey].variants ? media[sourceKey] : media[key];
      const cls = attribute(image[0], "class") || "";
      const sizes = /team|testimonials|avatar/.test(cls) ? "(max-width: 767px) 100vw, 400px" : /gallery|cucina/.test(cls) ? "(max-width: 767px) 80vw, 600px" : "(max-width: 767px) 100vw, 1200px";
      return setAttribute(setAttribute(tag, "srcset", entry.variants.map(v => v.src + " " + v.width + "w").join(", ")), "sizes", sizes);
    });
  });
  let criticalCover = false;
  html = html.replace(/<img\b[^>]*>/gi, tag => {
    const cls = attribute(tag, "class") || "";
    const key = localUrl(attribute(tag, "src"), file);
    const entry = media[key];
    tag = setAttribute(tag, "decoding", "async");
    if (cls.includes("nav_logo")) {
      tag = setAttribute(tag, "loading", "eager");
    } else if (!criticalCover && cls.includes("detail_bg-video")) {
      criticalCover = true;
      tag = setAttribute(setAttribute(tag, "loading", "eager"), "fetchpriority", "high");
    } else if (attribute(tag, "loading") === null && !cls.includes("ig-avatar")) {
      tag = setAttribute(tag, "loading", "lazy");
    }
    if (entry && entry.variants) {
      tag = setAttribute(setAttribute(tag, "width", entry.width), "height", entry.height);
      tag = setAttribute(tag, "srcset", entry.variants.map(v => v.src + " " + v.width + "w").join(", "));
      const size = /team|testimonials|avatar/.test(cls) ? "(max-width: 767px) 100vw, 400px" : /gallery|cucina/.test(cls) ? "(max-width: 767px) 80vw, 600px" : "(max-width: 767px) 100vw, 1200px";
      tag = setAttribute(tag, "sizes", size);
    }
    return tag;
  });
  html = html.replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?[^>]*>/gi, tag => {
    let href = attribute(tag, "href");
    href = href.replace(/family=(?:DM\+Sans|Inter):[^&]+&(?:amp;)?/g, "");
    if (!/family=/.test(href)) return "";
    tag = setAttribute(tag, "href", href);
    if (/post[\\/]index\.html$/.test(file) && attribute(tag, "rel") === "stylesheet" && attribute(tag, "media") === null) {
      const noscript = "<noscript>" + tag + "</noscript>";
      tag = setAttribute(setAttribute(tag, "media", "print"), "onload", "this.media='all'") + noscript;
    }
    return tag;
  });
  const fallback = '<style>:where(img[width][height]){height:auto}html.site-interactions-fallback :is([slide-up],[title-anim],[fade-up],[fade],[text-anim],.section-label-icon,.section-label-text,.text-size-small.secondary-btn-text,.primary-btn-bg,.footer_social-link){visibility:visible!important}.site-nav-fallback[data-nav-menu-open]{background:transparent}.site-nav-fallback[data-nav-menu-open] .nav-manue-in{background:#000;color:#fff}</style>';
  html = html.replace(/<\/head>/i, fallback + '<script src="/js/site-performance.js" defer></script></head>');
  return html;
}

module.exports = { optimizeHtml, optimizeInline, htmlFiles, attribute, localUrl, mediaManifest };
