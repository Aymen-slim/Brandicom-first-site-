const ALLOWED_SERVICES = ["Content Creation", "Social Management", "Paid Ads"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function parseBody(body) {
  const name = clean(body && body.name, 120);
  const email = clean(body && body.email, 254).toLowerCase();
  const budget = clean(body && body.budget, 80);
  const message = clean(body && body.message, 5000);
  const rawServices = Array.isArray(body && body.services) ? body.services : [];
  const services = ALLOWED_SERVICES.filter((service) => rawServices.includes(service));

  if (body && body.company_website) {
    return { error: "Unable to send your message.", code: "spam_blocked" };
  }
  if (name.length < 2) return { error: "Enter your name." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (budget.length < 1) return { error: "Enter your social budget." };
  if (!services.length) return { error: "Choose at least one service." };

  return { row: { name, email, budget, services, message } };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const parsed = parseBody(req.body || {});
  if (parsed.error) {
    res.status(400).json({ error: parsed.error, code: parsed.code || "validation_failed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(503).json({ error: "Contact storage is not configured." });
    return;
  }

  let response;
  try {
    response = await fetch(supabaseUrl.replace(/\/$/, "") + "/rest/v1/contact_submissions", {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(parsed.row),
    });
  } catch (fetchError) {
    console.error("Supabase fetch failed:", fetchError);
    res.status(502).json({ error: "Unable to send your message.", code: "storage_fetch_failed" });
    return;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Supabase insert failed:", response.status, detail);
    res.status(502).json({ error: "Unable to send your message.", code: "storage_insert_failed" });
    return;
  }

  res.status(200).json({ ok: true });
};

module.exports.parseBody = parseBody;
