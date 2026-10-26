export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!process.env.DISCORD_WEBHOOK) return res.status(500).json({ error: "Misconfigured" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Bad JSON" });
  }
  if (!body || !Array.isArray(body.embeds) || !body.embeds[0]) {
    return res.status(400).json({ error: "Bad payload" });
  }
  if (JSON.stringify(body).length > 6000) return res.status(413).json({ error: "Too large" });

  const payload = { embeds: body.embeds.slice(0, 1), allowed_mentions: { parse: [] } };

  try {
    const r = await fetch(process.env.DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return res.status(r.ok ? 200 : r.status === 429 ? 429 : 502).json({ ok: r.ok });
  } catch {
    return res.status(504).json({ ok: false });
  }
}
