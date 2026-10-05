const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { htmlFiles, attribute, localUrl } = require("./optimize-html");
const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "images/media-manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
const sources = new Set();
for (const file of htmlFiles()) {
  const html = fs.readFileSync(file, "utf8");
  for (const match of html.matchAll(/<(?:img|source|video)\b[^>]*>/gi)) {
    const tag = match[0];
    for (const name of ["src", "data-src", "poster"]) {
      const key = localUrl(attribute(tag, name), file);
      if (key && /\.(?:jpe?g|png|webp|avif|mp4)$/i.test(key)) sources.add(decodeURIComponent(key));
    }
    if (/^<source/i.test(tag)) {
      const key = localUrl(attribute(tag, "srcset"), file);
      if (key && /\.(?:jpe?g|png|webp|avif)$/i.test(key)) sources.add(decodeURIComponent(key));
    }
  }
}

function digest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12); }
function publish(temp, stem, suffix, extension) {
  const target = path.join(path.dirname(temp), `${stem}.${digest(temp)}${suffix}.${extension}`);
  if (fs.existsSync(target)) fs.unlinkSync(temp);
  else fs.renameSync(temp, target);
  return "/" + path.relative(root, target).replace(/\\/g, "/");
}
function outputExists(entry) {
  const outputs = entry.variants ? entry.variants.map(v => v.src) : [entry.mobile, entry.poster].filter(Boolean);
  return outputs.length && outputs.every(src => fs.existsSync(path.join(root, src)));
}
function run(executable, args) { return execFileSync(executable, args, { maxBuffer: 10 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).toString(); }

const imageCode = "from PIL import Image,ImageOps; import sys,json; im=ImageOps.exif_transpose(Image.open(sys.argv[1])); w=int(sys.argv[3]); im.thumbnail((w,round(im.height*w/im.width)),Image.Resampling.LANCZOS); im.save(sys.argv[2],format='WEBP',quality=82,method=6); print(json.dumps({'width':im.width,'height':im.height}))";
let totalOriginal = 0;
let totalMobile = 0;
for (const key of sources) {
  const file = path.join(root, key);
  if (!fs.existsSync(file)) continue;
  const sourceHash = digest(file);
  const previous = manifest[key];
  const stat = fs.statSync(file);
  const isVideo = /\.mp4$/i.test(file);
  const adequateVideo = !isVideo || previous && (previous.encoding === "phone540-crf28" || previous.mobile && fs.existsSync(path.join(root, previous.mobile)) && fs.statSync(path.join(root, previous.mobile)).size < stat.size * 0.75);
  if (previous && previous.sourceHash === sourceHash && outputExists(previous) && adequateVideo) continue;
  const stem = path.parse(file).name;
  if (/\.mp4$/i.test(file)) {
    if (stat.size < 1000000) continue;
    const temp = path.join(path.dirname(file), `${stem}.performance-tmp.mp4`);
    run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=w='min(540,iw)':h=-2:flags=lanczos,fps=30", "-c:v", "libx264", "-preset", "medium", "-crf", "28", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", temp]);
    const mobileSize = fs.statSync(temp).size;
    let mobile;
    if (mobileSize < stat.size) mobile = publish(temp, stem, ".mobile", "mp4");
    else fs.unlinkSync(temp);
    const posterTemp = path.join(path.dirname(file), `${stem}.performance-tmp.webp`);
    run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-ss", "0", "-i", file, "-frames:v", "1", "-vf", "scale=w='min(640,iw)':h=-2", "-quality", "82", posterTemp]);
    const poster = publish(posterTemp, stem, ".poster", "webp");
    manifest[key] = { sourceHash, mobile, poster, encoding: "phone540-crf28" };
    totalOriginal += stat.size;
    totalMobile += mobile ? mobileSize : stat.size;
    console.log(`${key}: ${(stat.size / 1048576).toFixed(2)} MB -> ${((mobile ? mobileSize : stat.size) / 1048576).toFixed(2)} MB`);
  } else if (stat.size >= 16000) {
    const info = JSON.parse(run("python", ["-c", "from PIL import Image,ImageOps; import sys,json; im=ImageOps.exif_transpose(Image.open(sys.argv[1])); print(json.dumps({'width':im.width,'height':im.height}))", file]));
    const candidates = [...new Set([480, 960, 1440, Math.min(info.width, 1440)].filter(width => width <= info.width))];
    const variants = candidates.map(width => {
      const temp = path.join(path.dirname(file), `${path.basename(file)}.performance-${width}-tmp.webp`);
      const dimensions = JSON.parse(run("python", ["-c", imageCode, file, temp, String(width)]));
      return { src: publish(temp, path.basename(file), "." + width, "webp"), ...dimensions };
    }).sort((a, b) => a.width - b.width);
    manifest[key] = { sourceHash, ...info, variants };
    console.log(`${key}: ${variants.map(v => v.width).join("/")}px`);
  }
  fs.writeFileSync(manifestPath + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(manifestPath + ".tmp", manifestPath);
}
console.log(`Video totals processed: ${(totalOriginal / 1048576).toFixed(1)} MB -> ${(totalMobile / 1048576).toFixed(1)} MB`);
