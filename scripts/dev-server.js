const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { optimizeHtml } = require("./optimize-html");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8765;
const contactHandler = require("../api/contact");
const postsHandler = require("../api/posts");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const index = trimmed.indexOf("=");
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    });
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (chunk) {
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function createVercelResponse(nodeRes) {
  let statusCode = 200;
  const headers = {};

  return {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      nodeRes.writeHead(statusCode, {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
      });
      nodeRes.end(JSON.stringify(payload));
    },
  };
}

async function handleContact(req, res) {
  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid JSON body." }));
    return;
  }

  await contactHandler(
    { method: req.method, body: body },
    createVercelResponse(res)
  );
}

function resolveStaticPath(urlPath) {
  let pathname = decodeURIComponent(urlPath.split("?")[0]);
  if (pathname === "/") pathname = "/index.html";
  if (pathname.endsWith("/")) pathname += "index.html";

  const relative = pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT + path.sep) || relative.split(/[\\/]/).some(part => part.startsWith(".")) || /^(?:node_modules|api|supabase|scripts|dist)(?:[\\/]|$)/i.test(relative)) return null;
  return filePath;
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");
  if (requestUrl.pathname.endsWith("/index.html") || requestUrl.pathname === "/index.html") {
    const clean = requestUrl.pathname.replace(/index\.html$/, "") || "/";
    res.writeHead(301, { Location: clean + requestUrl.search });
    res.end();
    return;
  }

  const filePath = resolveStaticPath(requestUrl.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, function (error, stat) {
    if (error || !stat.isFile()) {
      const missing = !error || error.code === "ENOENT";
      res.writeHead(missing ? 404 : 500);
      res.end(missing ? "Not found" : "Server error");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[extension] || "application/octet-stream", "Cache-Control": "no-cache" };
    if (extension === ".html") {
      fs.readFile(filePath, "utf8", function (readError, html) {
        if (readError) { res.writeHead(500); res.end("Server error"); return; }
        const data = Buffer.from(process.env.RAW_HTML === "1" ? html : optimizeHtml(html, filePath));
        res.writeHead(200, { ...headers, "Content-Length": data.length });
        res.end(req.method === "HEAD" ? undefined : data);
      });
      return;
    }
    const range = req.headers.range && req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = stat.size - 1;
    if (range) {
      start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { "Content-Range": "bytes */" + stat.size }); res.end(); return;
      }
      headers["Content-Range"] = "bytes " + start + "-" + end + "/" + stat.size;
    }
    res.writeHead(range ? 206 : 200, { ...headers, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    if (req.method === "HEAD" || stat.size === 0) { res.end(); return; }
    fs.createReadStream(filePath, { start, end }).on("error", () => res.destroy()).pipe(res);
  });
}

loadEnv();

const server = http.createServer(function (req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname === "/api/posts") {
    const requestUrl = new URL(req.url, "http://localhost");
    postsHandler(
      { method: req.method, query: { slug: requestUrl.searchParams.get("slug") || "", summary: requestUrl.searchParams.get("summary") || "" } },
      createVercelResponse(res)
    ).catch(function (error) {
      console.error("Posts API failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unable to load posts.", posts: [] }));
      }
    });
    return;
  }

  if (pathname === "/api/contact") {
    handleContact(req, res).catch(function (error) {
      console.error("Contact API failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unable to send your message." }));
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.on("error", function (error) {
  if (error.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use.");
    console.error("Stop the other server, or run: $env:PORT=3000; npm run dev");
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, function () {
  console.log("Brandicom dev server running at http://localhost:" + PORT);
  console.log("Contact page: http://localhost:" + PORT + "/contact/");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing (.env).");
  }
});
