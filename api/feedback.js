export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Kiểm tra key
  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || !Array.isArray(body.embeds)) {
    return res.status(400).json({ error: "Bad payload" });
  }

  // Chỉ chuyển tiếp embeds, chặn @everyone/@here
  const payload = { embeds: body.embeds.slice(0, 1), allowed_mentions: { parse: [] } };

  const r = await fetch(process.env.DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
}
