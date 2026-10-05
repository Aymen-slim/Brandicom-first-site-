const crypto = require("crypto");

const API_BASE = "https://api.higgsfield.ai";
const MODEL_PATH = "/bytedance/seedance-2.5/text-to-video";

const RESOLUTIONS = ["480p", "720p", "1080p"];
const ASPECT_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const BITRATE_MODES = ["standard", "high"];
const OUTPUT_FORMATS = ["mp4", "mov"];
const MODEL_FIELDS = [
  "prompt",
  "duration",
  "resolution",
  "aspect_ratio",
  "bitrate_mode",
  "output_format",
  "generate_audio",
];
const TRANSPORT_FIELDS = new Set(["access_key", "action", "request_id"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHORT_SIDE = { "480p": 480, "720p": 720, "1080p": 1080 };
const TOKEN_RATE = { "480p": 0.0214, "720p": 0.0214, "1080p": 0.0234 };

function even(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function outputSize(resolution, aspectRatio) {
  const shortSide = SHORT_SIDE[resolution];
  const parts = String(aspectRatio).split(":");
  const widthRatio = Number(parts[0]);
  const heightRatio = Number(parts[1]);
  if (!shortSide || !widthRatio || !heightRatio) return null;

  if (widthRatio >= heightRatio) {
    return { width: even((shortSide * widthRatio) / heightRatio), height: shortSide };
  }
  return { width: shortSide, height: even((shortSide * heightRatio) / widthRatio) };
}

function estimateCost(input) {
  const size = outputSize(input.resolution, input.aspect_ratio);
  if (!size) return null;
  const tokens = Math.ceil((size.height * size.width * input.duration * 24) / 1024);
  const usd = (tokens / 1000) * TOKEN_RATE[input.resolution];
  return {
    width: size.width,
    height: size.height,
    tokens: tokens,
    usd: Math.round(usd * 10000) / 10000,
    currency: "USD",
  };
}

function asInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function parseInput(body, options) {
  const allowMissingPrompt = options && options.allowMissingPrompt;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Send a JSON object." };
  }

  const unknown = Object.keys(body).filter(function (key) {
    return MODEL_FIELDS.indexOf(key) === -1 && !TRANSPORT_FIELDS.has(key);
  });
  if (unknown.length) return { error: "Unsupported field: " + unknown[0] + "." };

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!allowMissingPrompt) {
    if (!prompt) return { error: "Write a prompt." };
    if (prompt.length > 4000) return { error: "Prompt must be 4000 characters or fewer." };
  }

  const duration = body.duration == null || body.duration === "" ? 5 : asInteger(body.duration);
  if (duration == null || duration < 4 || duration > 30) {
    return { error: "Duration must be a whole number from 4 to 30." };
  }

  const resolution = body.resolution == null || body.resolution === "" ? "720p" : body.resolution;
  if (RESOLUTIONS.indexOf(resolution) === -1) return { error: "Choose 480p, 720p, or 1080p." };

  const aspectRatio = body.aspect_ratio == null || body.aspect_ratio === "" ? "16:9" : body.aspect_ratio;
  if (ASPECT_RATIOS.indexOf(aspectRatio) === -1) {
    return { error: "Choose a supported aspect ratio." };
  }

  const bitrateMode = body.bitrate_mode == null || body.bitrate_mode === "" ? "high" : body.bitrate_mode;
  if (BITRATE_MODES.indexOf(bitrateMode) === -1) return { error: "Choose standard or high bitrate." };

  const outputFormat = body.output_format == null || body.output_format === "" ? "mp4" : body.output_format;
  if (OUTPUT_FORMATS.indexOf(outputFormat) === -1) return { error: "Choose mp4 or mov." };

  let generateAudio = true;
  if (body.generate_audio != null && body.generate_audio !== "") {
    if (typeof body.generate_audio === "boolean") generateAudio = body.generate_audio;
    else if (body.generate_audio === "true") generateAudio = true;
    else if (body.generate_audio === "false") generateAudio = false;
    else return { error: "Audio generation must be true or false." };
  }

  const input = {
    duration: duration,
    resolution: resolution,
    aspect_ratio: aspectRatio,
    bitrate_mode: bitrateMode,
    output_format: outputFormat,
    generate_audio: generateAudio,
  };
  if (!allowMissingPrompt) input.prompt = prompt;
  return { input: input };
}

function headerValue(req, name) {
  const headers = (req && req.headers) || {};
  const value = headers[name] || headers[name.toLowerCase()] || "";
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function keysMatch(provided, expected) {
  const left = crypto.createHash("sha256").update(String(provided)).digest();
  const right = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

function authorize(req) {
  const expected = process.env.SEEDANCE_ACCESS_KEY || "";
  if (expected.length < 8) {
    return {
      status: 503,
      error: "Set SEEDANCE_ACCESS_KEY on the server before generating video.",
      code: "access_unconfigured",
    };
  }
  const provided = headerValue(req, "x-seedance-key") || (req.body && req.body.access_key) || "";
  if (!keysMatch(provided, expected)) {
    return { status: 401, error: "Enter a valid studio access key.", code: "access_denied" };
  }
  return null;
}

function requireCredentials() {
  const key = process.env.HF_KEY || process.env.HF_CREDENTIALS || "";
  if (!key) {
    return {
      status: 503,
      error: "Set HF_KEY or HF_CREDENTIALS on the server.",
      code: "credentials_missing",
    };
  }
  if (!key.includes(":") || key.startsWith(":") || key.endsWith(":")) {
    return {
      status: 503,
      error: "HF_KEY must be KEY_ID:KEY_SECRET.",
      code: "credentials_invalid",
    };
  }
  return { key: key };
}

function requestIdFrom(req) {
  const query = (req && req.query) || {};
  const body = (req && req.body) || {};
  return String(query.request_id || body.request_id || "").trim();
}

function publicStatus(payload) {
  const status = {
    request_id: payload.request_id,
    status: payload.status,
  };
  if (payload.error) status.error = String(payload.error).slice(0, 500);
  if (payload.video && payload.video.url) status.video = { url: payload.video.url };
  if (payload.mov && payload.mov.url) status.mov = { url: payload.mov.url };
  return status;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { detail: text.slice(0, 300) };
  }
}

function higgsfieldError(response, payload) {
  if (response.status === 401) return "Higgsfield rejected the API credentials.";
  if (response.status === 404) return "That generation request was not found.";
  if (response.status === 400) {
    return (payload && (payload.detail || payload.error)) || "Higgsfield rejected the request.";
  }
  return (payload && (payload.detail || payload.error)) || "Higgsfield could not complete the request.";
}

async function handler(req, res, deps) {
  const method = req.method || "GET";
  const doFetch = (deps && deps.fetch) || fetch;

  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const query = req.query || {};
  const preview = query.preview === "1" || query.preview === "true";
  if (method === "GET" && preview) {
    const parsed = parseInput(
      {
        duration: query.duration,
        resolution: query.resolution,
        aspect_ratio: query.aspect_ratio,
        bitrate_mode: query.bitrate_mode,
        output_format: query.output_format,
        generate_audio: query.generate_audio,
      },
      { allowMissingPrompt: true }
    );
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.status(200).json({ estimate: estimateCost(parsed.input) });
    return;
  }

  const denied = authorize(req);
  if (denied) {
    res.status(denied.status).json({ error: denied.error, code: denied.code });
    return;
  }

  const credentials = requireCredentials();
  if (credentials.error) {
    res.status(credentials.status).json({ error: credentials.error, code: credentials.code });
    return;
  }

  const action = (req.body && req.body.action) || "";
  const isCancel = method === "POST" && action === "cancel";
  const isStatus = method === "GET";
  if (isStatus || isCancel) {
    const requestId = requestIdFrom(req);
    if (!UUID_RE.test(requestId)) {
      res.status(400).json({ error: "Enter a valid request id." });
      return;
    }
    const path = isCancel ? "/requests/" + requestId + "/cancel" : "/requests/" + requestId + "/status";
    let response;
    try {
      response = await doFetch(API_BASE + path, {
        method: isCancel ? "POST" : "GET",
        headers: { Authorization: "Key " + credentials.key },
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      res.status(502).json({ error: "Unable to reach Higgsfield.", code: "upstream_unreachable" });
      return;
    }
    const payload = await readJson(response);
    if (isCancel && response.status === 202) {
      res.status(202).json({ request_id: requestId, status: "canceled" });
      return;
    }
    if (!response.ok) {
      res.status(response.status === 404 ? 404 : 502).json({
        error: higgsfieldError(response, payload),
        code: "upstream_error",
      });
      return;
    }
    res.status(200).json(publicStatus(payload));
    return;
  }

  if (method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const parsed = parseInput(req.body || {});
  if (parsed.error) {
    res.status(400).json({ error: parsed.error, code: "validation_failed" });
    return;
  }

  let response;
  try {
    response = await doFetch(API_BASE + MODEL_PATH, {
      method: "POST",
      headers: {
        Authorization: "Key " + credentials.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.input),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    res.status(502).json({ error: "Unable to reach Higgsfield.", code: "upstream_unreachable" });
    return;
  }

  const payload = await readJson(response);
  if (!response.ok) {
    res.status(response.status === 401 ? 502 : 502).json({
      error: higgsfieldError(response, payload),
      code: "upstream_error",
    });
    return;
  }

  res.status(202).json(Object.assign(publicStatus(payload), { estimate: estimateCost(parsed.input) }));
}

module.exports = handler;
module.exports.parseInput = parseInput;
module.exports.estimateCost = estimateCost;
module.exports.outputSize = outputSize;
module.exports.publicStatus = publicStatus;
