function mapPost(row) {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt || "",
    body: row.body || "",
    coverImage: row.cover_image_url || "",
    secondImage: row.second_image_url || "",
    readMinutes: Number(row.read_minutes) || 1,
    publishedAt: row.published_at,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(503).json({ error: "Post storage is not configured.", posts: [] });
    return;
  }

  const slug = String((req.query && req.query.slug) || "").trim();
  const base = supabaseUrl.replace(/\/$/, "") + "/rest/v1/site_posts?select=slug,title,excerpt,body,cover_image_url,second_image_url,read_minutes,published_at&published=eq.true&order=published_at.desc";
  const url = slug ? base + "&slug=eq." + encodeURIComponent(slug) : base;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
      },
    });
  } catch (error) {
    console.error("Posts fetch failed:", error);
    res.status(502).json({ error: "Unable to load posts.", posts: [] });
    return;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Posts query failed:", response.status, detail);
    res.status(502).json({ error: "Unable to load posts.", posts: [] });
    return;
  }

  const rows = await response.json();
  const posts = Array.isArray(rows) ? rows.map(mapPost) : [];
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ posts: posts });
};
