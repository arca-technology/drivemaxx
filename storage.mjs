import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Encrypted JSON storage. Vercel Blob (private) in production, a local folder or memory otherwise.
// Everything is gzip-compressed and sealed with AES-256-GCM, so the store never holds plain data.
export function createStorage({ secret, blobToken, dir } = {}) {
  const key = createHash('sha256').update(`drive-cache-v1.${secret || randomBytes(32).toString('hex')}`).digest();
  const seal = value => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value)))), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const open = buffer => {
    const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return JSON.parse(gunzipSync(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]), { maxOutputLength: 200 * 1024 * 1024 }));
  };
  const backend = blobToken ? blobBackend(blobToken) : dir ? folderBackend(dir) : memoryBackend();
  return {
    kind: blobToken ? 'blob' : dir ? 'folder' : 'memory',
    async get(name) { const raw = await backend.read(name); if (!raw) return null; try { return open(raw); } catch { return null; } },
    async put(name, value) { await backend.write(name, seal(value)); },
    list: prefix => backend.list(prefix),
    remove: names => names.length ? backend.remove(names) : undefined
  };
}

function memoryBackend() {
  const files = new Map();
  return {
    async read(name) { return files.get(name) || null; },
    async write(name, data) { files.set(name, data); },
    async list(prefix) { return [...files.keys()].filter(n => n.startsWith(prefix)).sort(); },
    async remove(names) { names.forEach(n => files.delete(n)); }
  };
}

function folderBackend(dir) {
  const path = name => join(dir, name.replace(/[^a-zA-Z0-9._/-]/g, '_'));
  return {
    async read(name) { return readFile(path(name)).catch(() => null); },
    async write(name, data) { await mkdir(dirname(path(name)), { recursive: true }); await writeFile(path(name), data); },
    async list(prefix) {
      const folder = dirname(path(`${prefix}x`));
      const names = await readdir(folder).catch(() => []);
      return names.map(n => `${prefix.slice(0, prefix.lastIndexOf('/') + 1)}${n}`).filter(n => n.startsWith(prefix)).sort();
    },
    async remove(names) { await Promise.all(names.map(n => rm(path(n), { force: true }))); }
  };
}

function blobBackend(token) {
  const sdk = import('@vercel/blob');
  return {
    async read(name) {
      const { get } = await sdk;
      const result = await get(name, { access: 'private', token, useCache: false });
      return result?.statusCode === 200 ? Buffer.from(await new Response(result.stream).arrayBuffer()) : null;
    },
    async write(name, data) {
      const { put } = await sdk;
      await put(name, data, { access: 'private', token, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/octet-stream' });
    },
    async list(prefix) {
      const { list } = await sdk;
      const names = [];
      let cursor;
      do { const page = await list({ prefix, token, cursor, limit: 1000 }); names.push(...page.blobs.map(b => b.pathname)); cursor = page.hasMore ? page.cursor : undefined; } while (cursor && names.length < 5000);
      return names.sort();
    },
    async remove(names) { const { del } = await sdk; await del(names, { token }); }
  };
}
