import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// Encrypted, authenticated cookies keep sessions available across serverless instances.
// Only tokens and OAuth state are stored, never product data or the client secret.
export function cookieSessions(req, res, secret, secure) {
  const key = createHash('sha256').update(secret).digest();
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split(/=(.*)/s).slice(0, 2)));
  const sessions = new Map();
  const sid = cookies.drive_session;
  try {
    const packed = Buffer.from(Array.from({ length: 4 }, (_, i) => cookies[`drive_data${i}`] || '').join(''), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from('drive-session-v1'));
    decipher.setAuthTag(packed.subarray(12, 28));
    const decoded = JSON.parse(inflateRawSync(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]), { maxOutputLength: 32000 }));
    if (decoded.sid === sid && decoded.expires > Date.now()) sessions.set(sid, decoded.value);
  } catch { /* Invalid, expired or missing cookies are unauthenticated. */ }
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (status, headers = {}) => {
    const outgoing = headers['Set-Cookie'];
    const nextSid = outgoing ? outgoing.split(';')[0].slice('drive_session='.length) : sid;
    const value = sessions.get(nextSid);
    let encoded = '';
    if (value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from('drive-session-v1'));
      const body = deflateRawSync(Buffer.from(JSON.stringify({ sid: nextSid, expires: Date.now() + 86400000, value })));
      const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
      encoded = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
      if (encoded.length > 12000) { sessions.clear(); throw new Error('Session exceeds cookie size limit'); }
    }
    if (sid || outgoing) {
      const parts = Array.from({ length: 4 }, (_, i) => {
        const part = encoded.slice(i * 3000, (i + 1) * 3000);
        return `drive_data${i}=${part}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${part ? 86400 : 0}${secure ? '; Secure' : ''}`;
      });
      headers['Set-Cookie'] = [...(outgoing ? [outgoing] : []), ...parts];
    }
    return writeHead(status, headers);
  };
  return sessions;
}
