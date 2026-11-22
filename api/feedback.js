import { redis, checkKey, cut } from '../lib/hz.js';

const DAY = 86400;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkKey(req, res)) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Bad JSON' });
  }
  if (!body || !Array.isArray(body.embeds) || !body.embeds[0]) {
    return res.status(400).json({ error: 'Bad payload' });
  }
  if (JSON.stringify(body).length > 6000) return res.status(413).json({ error: 'Too large' });

  try {
    const meta = body.meta || {};
    const uid = String(meta.uid || '').replace(/\D/g, '').slice(0, 20);
    const embeds = body.embeds.slice(0, 1);

    // chống spam phía server: 1 góp ý / 30 giây / UserId
    if (uid) {
      const ok = await redis(['SET', `rl:${uid}`, '1', 'NX', 'EX', 30]);
      if (!ok) return res.status(429).json({ error: 'Gửi quá nhanh' });
    }

    const id = newId();
    if (uid) {
      await redis(['SET', `fb:${id}`, JSON.stringify({ uid, user: cut(meta.user, 40), text: cut(meta.text, 500), ts: Date.now() }), 'EX', 30 * DAY]);
      const f = embeds[0].footer || {};
      embeds[0].footer = { ...f, text: cut(`${f.text || 'Support'} • #${id}`, 200) };
    }

    const BOT = process.env.DISCORD_BOT_TOKEN;
    const CH = process.env.DISCORD_CHANNEL_ID;
    const HOOK = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
    let r;

    if (BOT && CH) {
      // Bot: gửi được nút bấm (bản script cũ không gửi uid thì đăng không nút)
      r = await fetch(`https://discord.com/api/v10/channels/${CH}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${BOT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds,
          allowed_mentions: { parse: [] },
          ...(uid ? { components: [{ type: 1, components: [{ type: 2, style: 1, label: '💬 Trả lời', custom_id: `reply:${id}` }] }] } : {}),
        }),
        signal: AbortSignal.timeout(8000),
      });
    } else if (HOOK) {
      // Dự phòng: webhook cũ (không có nút trả lời)
      r = await fetch(HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(8000),
      });
    } else {
      return res.status(500).json({ error: 'Misconfigured' });
    }

    return res.status(r.ok ? 200 : r.status === 429 ? 429 : 502).json({ ok: r.ok, id });
  } catch {
    return res.status(504).json({ ok: false });
  }
}
