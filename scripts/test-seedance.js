const assert = require("assert");
const seedance = require("../api/seedance");

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function testParsing() {
  const parsed = seedance.parseInput({ prompt: "  A sunset  " });
  assert.strictEqual(parsed.input.prompt, "A sunset");
  assert.strictEqual(parsed.input.duration, 5);
  assert.strictEqual(parsed.input.resolution, "720p");
  assert.strictEqual(parsed.input.aspect_ratio, "16:9");
  assert.strictEqual(parsed.input.bitrate_mode, "high");
  assert.strictEqual(parsed.input.output_format, "mp4");
  assert.strictEqual(parsed.input.generate_audio, true);

  assert.ok(seedance.parseInput({}).error);
  assert.ok(seedance.parseInput({ prompt: "ok", duration: 3 }).error);
  assert.ok(seedance.parseInput({ prompt: "ok", duration: 31 }).error);
  assert.ok(seedance.parseInput({ prompt: "ok", duration: 4.5 }).error);
  assert.ok(seedance.parseInput({ prompt: "ok", resolution: "4k" }).error);
  assert.ok(seedance.parseInput({ prompt: "ok", aspect_ratio: "2:1" }).error);
  assert.ok(seedance.parseInput({ prompt: "ok", extra: true }).error);

  const custom = seedance.parseInput({
    prompt: "City night",
    duration: "8",
    resolution: "480p",
    aspect_ratio: "9:16",
    bitrate_mode: "standard",
    output_format: "mov",
    generate_audio: false,
    access_key: "ignored-by-model",
  });
  assert.deepStrictEqual(custom.input, {
    prompt: "City night",
    duration: 8,
    resolution: "480p",
    aspect_ratio: "9:16",
    bitrate_mode: "standard",
    output_format: "mov",
    generate_audio: false,
  });
}

function testPricing() {
  assert.deepStrictEqual(seedance.outputSize("480p", "16:9"), { width: 854, height: 480 });
  assert.deepStrictEqual(seedance.outputSize("720p", "16:9"), { width: 1280, height: 720 });
  assert.deepStrictEqual(seedance.outputSize("1080p", "16:9"), { width: 1920, height: 1080 });
  assert.deepStrictEqual(seedance.outputSize("720p", "9:16"), { width: 720, height: 1280 });

  const hd = seedance.estimateCost({ resolution: "720p", aspect_ratio: "16:9", duration: 5 });
  assert.strictEqual(hd.tokens, 108000);
  assert.strictEqual(hd.usd, 2.3112);

  const sd = seedance.estimateCost({ resolution: "480p", aspect_ratio: "16:9", duration: 1 });
  assert.ok(Math.abs(sd.usd - 0.2056) < 0.0001);

  const fullHd = seedance.estimateCost({ resolution: "1080p", aspect_ratio: "16:9", duration: 1 });
  assert.ok(Math.abs(fullHd.usd - 1.1372) < 0.0001);
}

function testPublicStatus() {
  const hidden = seedance.publicStatus({
    request_id: "11111111-1111-1111-1111-111111111111",
    status: "queued",
    status_url: "https://api.higgsfield.ai/secret",
    cancel_url: "https://api.higgsfield.ai/secret-cancel",
  });
  assert.deepStrictEqual(hidden, {
    request_id: "11111111-1111-1111-1111-111111111111",
    status: "queued",
  });
}

async function testRoutes() {
  const previousKey = process.env.SEEDANCE_ACCESS_KEY;
  const previousCredentials = process.env.HF_KEY;
  const previousAlt = process.env.HF_CREDENTIALS;
  process.env.SEEDANCE_ACCESS_KEY = "studio-test-key";
  process.env.HF_KEY = "key-id:key-secret";
  delete process.env.HF_CREDENTIALS;

  const preview = mockRes();
  await seedance({ method: "GET", query: { preview: "1", duration: "5", resolution: "720p", aspect_ratio: "16:9" } }, preview);
  assert.strictEqual(preview.statusCode, 200);
  assert.strictEqual(preview.payload.estimate.usd, 2.3112);

  const denied = mockRes();
  await seedance({ method: "POST", body: { prompt: "A cinematic scene at sunset" }, headers: {} }, denied, {
    fetch() {
      throw new Error("should not call Higgsfield");
    },
  });
  assert.strictEqual(denied.statusCode, 401);

  let submitted = null;
  const accepted = mockRes();
  await seedance(
    {
      method: "POST",
      headers: { "x-seedance-key": "studio-test-key" },
      body: {
        prompt: "A cinematic scene at sunset",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
        bitrate_mode: "high",
        output_format: "mp4",
        generate_audio: true,
        access_key: "studio-test-key",
      },
    },
    accepted,
    {
      fetch(url, options) {
        submitted = { url: url, options: options };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async function () {
            return JSON.stringify({
              request_id: "11111111-1111-1111-1111-111111111111",
              status: "queued",
              status_url: "https://api.higgsfield.ai/requests/11111111-1111-1111-1111-111111111111/status",
              cancel_url: "https://api.higgsfield.ai/requests/11111111-1111-1111-1111-111111111111/cancel",
            });
          },
        });
      },
    }
  );
  assert.strictEqual(accepted.statusCode, 202);
  assert.strictEqual(submitted.url, "https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video");
  assert.strictEqual(submitted.options.headers.Authorization, "Key key-id:key-secret");
  assert.deepStrictEqual(JSON.parse(submitted.options.body), {
    prompt: "A cinematic scene at sunset",
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
    bitrate_mode: "high",
    output_format: "mp4",
    generate_audio: true,
  });
  assert.strictEqual(accepted.payload.status_url, undefined);
  assert.strictEqual(accepted.payload.estimate.usd, 2.3112);

  const canceled = mockRes();
  await seedance(
    {
      method: "POST",
      headers: { "x-seedance-key": "studio-test-key" },
      body: { action: "cancel", request_id: "11111111-1111-1111-1111-111111111111" },
    },
    canceled,
    {
      fetch(url, options) {
        assert.strictEqual(url, "https://api.higgsfield.ai/requests/11111111-1111-1111-1111-111111111111/cancel");
        assert.strictEqual(options.method, "POST");
        return Promise.resolve({ ok: true, status: 202, text: async function () { return ""; } });
      },
    }
  );
  assert.strictEqual(canceled.statusCode, 202);
  assert.strictEqual(canceled.payload.status, "canceled");

  delete process.env.HF_KEY;
  const missing = mockRes();
  await seedance(
    {
      method: "GET",
      headers: { "x-seedance-key": "studio-test-key" },
      query: { request_id: "11111111-1111-1111-1111-111111111111" },
    },
    missing,
    { fetch() { throw new Error("should not call Higgsfield"); } }
  );
  assert.strictEqual(missing.statusCode, 503);
  assert.strictEqual(missing.payload.code, "credentials_missing");

  if (previousKey == null) delete process.env.SEEDANCE_ACCESS_KEY;
  else process.env.SEEDANCE_ACCESS_KEY = previousKey;
  if (previousCredentials == null) delete process.env.HF_KEY;
  else process.env.HF_KEY = previousCredentials;
  if (previousAlt == null) delete process.env.HF_CREDENTIALS;
  else process.env.HF_CREDENTIALS = previousAlt;
}

async function main() {
  testParsing();
  testPricing();
  testPublicStatus();
  await testRoutes();
  console.log("seedance tests passed");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
