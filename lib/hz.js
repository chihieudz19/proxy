// Hàm dùng chung: Redis (Upstash/Vercel KV qua REST), kiểm tra key, đọc body thô.
import crypto from 'crypto';

function kvConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Thiếu KV_REST_API_URL / KV_REST_API_TOKEN (chưa nối Redis vào project)');
  return { url, token };
}

// 1 lệnh: redis(['SET','k','v','EX',60])
export async function redis(cmd) {
  const { url, token } = kvConf();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// Nhiều lệnh trong 1 lần gọi: redisPipe([[...],[...]])
export async function redisPipe(cmds) {
  const { url, token } = kvConf();
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('Redis pipeline lỗi');
  const bad = j.find((x) => x && x.error);
  if (bad) throw new Error(bad.error);
  return j.map((x) => x.result);
}

// Key của script: ưu tiên FEEDBACK_KEY, nếu không có thì dùng API_KEY cũ
export function checkKey(req, res) {
  const expected = process.env.FEEDBACK_KEY || process.env.API_KEY;
  if (!expected) {
    res.status(500).json({ error: 'Server chưa cấu hình FEEDBACK_KEY (hoặc API_KEY)' });
    return false;
  }
  const got = String(req.headers['x-api-key'] || '');
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Đọc body thô (Discord ký trên đúng byte gốc). Phải đọc stream TRƯỚC, không chạm req.body
export async function rawBody(req) {
  if (req.readable && !req.readableEnded) {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    return Buffer.concat(chunks).toString('utf8');
  }
  const b = req.body;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (typeof b === 'string') return b;
  return JSON.stringify(b || {});
}

export function cut(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
                     }
