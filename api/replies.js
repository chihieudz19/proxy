// Script lấy phản hồi của admin theo UserId: GET /api/replies?uid=123
import { redis, checkKey, cut } from '../lib/hz.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkKey(req, res)) return;

  const uid = String((req.query && req.query.uid) || '').replace(/\D/g, '');
  if (!uid || uid.length > 20) return res.status(400).json({ error: 'uid không hợp lệ' });

  try {
    const rows = (await redis(['LRANGE', `rp:${uid}`, 0, 29])) || [];
    const replies = [];
    for (const x of rows) {
      try {
        const r = JSON.parse(x);
        replies.push({ id: r.id, fb: cut(r.fb, 80), msg: cut(r.msg, 400), ts: r.ts });
      } catch {}
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ replies });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
