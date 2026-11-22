// Discord gọi vào đây khi admin bấm nút "Trả lời" và khi gửi form.
// Đặt URL này vào Developer Portal -> General Information -> Interactions Endpoint URL.
import crypto from 'crypto';
import { redis, redisPipe, rawBody, cut } from '../lib/hz.js';

// Discord ký trên body thô nên không để Vercel parse trước
export const config = { api: { bodyParser: false } };

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

function verify(raw, sig, ts, pubHex) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519, Buffer.from(pubHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(ts + raw), key, Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

const ephemeral = (content) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await rawBody(req);
  const sig = req.headers['x-signature-ed25519'];
  const ts = req.headers['x-signature-timestamp'];
  const pub = process.env.DISCORD_PUBLIC_KEY;
  if (!pub || !sig || !ts || !verify(raw, sig, ts, pub)) {
    return res.status(401).send('invalid request signature');
  }

  let i;
  try { i = JSON.parse(raw); } catch { return res.status(400).end(); }

  // Discord kiểm tra endpoint bằng PING
  if (i.type === 1) return res.status(200).json({ type: 1 });

  // Chỉ cho phép admin trong danh sách (nếu có đặt ADMIN_IDS = id1,id2,...)
  const who = (i.member && i.member.user && i.member.user.id) || (i.user && i.user.id);
  const allow = (process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (allow.length && !allow.includes(who)) {
    return res.status(200).json(ephemeral('Bạn không có quyền trả lời góp ý.'));
  }

  try {
    // Bấm nút "Trả lời" -> mở form nhập
    if (i.type === 3 && String(i.data.custom_id).startsWith('reply:')) {
      const id = i.data.custom_id.slice(6);
      return res.status(200).json({
        type: 9,
        data: {
          custom_id: `replymodal:${id}`,
          title: 'Trả lời góp ý',
          components: [{
            type: 1,
            components: [{ type: 4, custom_id: 'text', style: 2, label: 'Nội dung phản hồi', min_length: 1, max_length: 400, required: true, placeholder: 'Người chơi sẽ thấy trong tab Góp ý của hub' }],
          }],
        },
      });
    }

    // Gửi form -> lưu phản hồi theo UserId
    if (i.type === 5 && String(i.data.custom_id).startsWith('replymodal:')) {
      const id = i.data.custom_id.slice(11);
      const msg = cut((((i.data.components || [])[0] || {}).components || [])[0]?.value || '', 400).trim();
      if (!msg) return res.status(200).json(ephemeral('Nội dung trống.'));

      const stored = await redis(['GET', `fb:${id}`]);
      if (!stored) return res.status(200).json(ephemeral('Không tìm thấy góp ý này (có thể đã quá 30 ngày).'));
      const fb = JSON.parse(stored);

      const rec = { id: `${id}-${Date.now().toString(36)}`, fb: cut(fb.text, 80), msg, ts: Date.now() };
      const key = `rp:${fb.uid}`;
      await redisPipe([
        ['LPUSH', key, JSON.stringify(rec)],
        ['LTRIM', key, 0, 29],
        ['EXPIRE', key, 90 * 86400],
      ]);

      // Đổi nút trên tin gốc thành "Đã trả lời" (không bắt buộc, lỗi thì bỏ qua)
      try {
        if (i.message && i.channel_id && process.env.DISCORD_BOT_TOKEN) {
          await fetch(`https://discord.com/api/v10/channels/${i.channel_id}/messages/${i.message.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ components: [{ type: 1, components: [{ type: 2, style: 3, label: '✅ Đã trả lời · bấm để trả lời thêm', custom_id: `reply:${id}` }] }] }),
            signal: AbortSignal.timeout(2000),
          });
        }
      } catch {}

      return res.status(200).json(ephemeral(`✅ Đã gửi phản hồi cho ${fb.user || 'người chơi'}.`));
    }

    return res.status(200).json(ephemeral('Không hiểu thao tác này.'));
  } catch (e) {
    return res.status(200).json(ephemeral('Lỗi: ' + String(e.message || e).slice(0, 150)));
  }
  }
