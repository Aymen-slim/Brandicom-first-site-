const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const { htmlFiles, optimizeHtml, attribute, localUrl, mediaManifest } = require("./optimize-html");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const assets = new Map();
const derivatives = new Set(Object.values(mediaManifest()).flatMap(entry => [entry.mobile, entry.poster, ...(entry.variants || []).map(variant => variant.src)].filter(Boolean)));
const allowed = /\.(?:css|js|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|mp4|webm)$/i;
const digest = data => crypto.createHash("sha256").update(data).digest("hex").slice(0, 12);

function copy(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { copy(file); continue; }
    if (!allowed.test(entry.name) || /performance-.*tmp/.test(entry.name)) continue;
    const relative = path.relative(root, file);
    if (/\.[a-f0-9]{12}\.(?:mobile|poster|[0-9]+)\.(?:mp4|webp)$/.test(entry.name) && !derivatives.has("/" + relative.replace(/\\/g, "/"))) continue;
    const dest = path.join(output, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    if (/\.(?:css|js)$/.test(entry.name)) {
      const data = fs.readFileSync(file);
      const fingerprint = relative.replace(/\.(css|js)$/, "." + digest(data) + ".$1");
      fs.writeFileSync(path.join(output, fingerprint), data);
      assets.set("/" + relative.replace(/\\/g, "/"), "/" + fingerprint.replace(/\\/g, "/"));
    }
  }
}

fs.mkdirSync(output, { recursive: true });
for (const dir of ["css", "js", "images", "reels", "videos", "clients", "public"]) {
  const file = path.join(root, dir);
  if (fs.existsSync(file)) copy(file);
}
const files = htmlFiles(root);
for (const file of files) {
  let html = optimizeHtml(fs.readFileSync(file, "utf8"), file);
  html = html.replace(/<(?:script|link)\b[^>]*>/gi, tag => {
    const name = /^<script/i.test(tag) ? "src" : "href";
    const src = attribute(tag, name);
    const fingerprint = assets.get(localUrl(src, file));
    return fingerprint ? tag.replace(src, fingerprint) : tag;
  });
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=|\btype=["'](?:application\/ld\+json|application\/json)/.test(match[1])) new vm.Script(match[2], { filename: file });
  }
  const dest = path.join(output, path.relative(root, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
}
console.log("Built " + files.length + " optimized pages with fingerprinted CSS/JavaScript in dist/.");
