import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

// ── Passwords (scrypt) ───────────────────────────────────────
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64url'), hash.toString('base64url')].join('$');
}
export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) { await scrypt('x', 'dummy-salt-value', 32); return false; }
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

// ── Sealed text (Olist tokens at rest) ───────────────────────
export function sealer(secret) {
  const key = createHash('sha256').update(`drive-tokens-v1.${secret}`).digest();
  return {
    seal(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    open(text) {
      try {
        const raw = Buffer.from(String(text), 'base64url');
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
      } catch { return null; }
    }
  };
}

// ── Supabase PostgREST repository ────────────────────────────
// Server-only: uses the project secret key, which bypasses RLS. Never sent to the browser.
export function supabaseRepo({ url, key, fetcher = fetch }) {
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const auth = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
  async function rest(method, path, { body, prefer } = {}) {
    let response;
    try {
      response = await fetcher(`${base}/${path}`, { method, headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch (error) { console.error('[db] rede', method, path.split('?')[0], error?.message); throw Object.assign(new Error('Banco de dados indisponível. Tente novamente.'), { status: 503 }); }
    const text = await response.text();
    if (!response.ok) {
      console.error('[db]', method, path.split('?')[0], response.status, text.slice(0, 300));
      const duplicate = response.status === 409 || text.includes('23505');
      throw Object.assign(new Error(duplicate ? 'Registro já existe.' : 'Falha ao acessar o banco de dados.'), { status: duplicate ? 409 : 502 });
    }
    return text ? JSON.parse(text) : null;
  }
  const eq = value => `eq.${encodeURIComponent(value)}`;
  const inList = values => `in.(${values.map(v => encodeURIComponent(v)).join(',')})`;
  const userCols = 'id,tenant_id,customer_id,name,username,email,password_hash,role,active,last_login_at,created_at';
  const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
  return {
    kind: 'supabase',
    async findUserByUsername(username) { return (await rest('GET', `app_users?select=${userCols}&username=ilike.${encodeURIComponent(String(username).replace(/[%_\\]/g, '\\$&'))}&limit=1`))[0] || null; },
    async getUser(id) { return (await rest('GET', `app_users?select=${userCols}&id=${eq(id)}&limit=1`))[0] || null; },
    async listUsers(tenantId) { return rest('GET', `app_users?select=id,customer_id,name,username,email,role,active,last_login_at,created_at,customers(id,cnpj,legal_name,trade_name)&tenant_id=${eq(tenantId)}&order=created_at.desc`); },
    async createUser(row) { return (await rest('POST', 'app_users', { body: row, prefer: 'return=representation' }))[0]; },
    async updateUser(tenantId, id, patch) { return (await rest('PATCH', `app_users?tenant_id=${eq(tenantId)}&id=${eq(id)}`, { body: patch, prefer: 'return=representation' }))[0] || null; },
    async touchLogin(id) { await rest('PATCH', `app_users?id=${eq(id)}`, { body: { last_login_at: new Date().toISOString() }, prefer: 'return=minimal' }); },
    async getTenant(id) { return (await rest('GET', `tenants?select=*&id=${eq(id)}&limit=1`))[0] || null; },
    async listTenants() { return rest('GET', 'tenants?select=id,olist_tokens'); },
    async tenantByWebhook(token) { return (await rest('GET', `tenants?select=id,webhook_token&webhook_token=${eq(token)}&limit=1`))[0] || null; },
    async updateTenant(id, patch) { await rest('PATCH', `tenants?id=${eq(id)}`, { body: patch, prefer: 'return=minimal' }); },
    async listCustomers(tenantId) { return rest('GET', `customers?select=*&tenant_id=${eq(tenantId)}&order=legal_name.asc`); },
    async getCustomer(tenantId, id) { return (await rest('GET', `customers?select=*&tenant_id=${eq(tenantId)}&id=${eq(id)}&limit=1`))[0] || null; },
    async upsertCustomer(row) { return (await rest('POST', 'customers?on_conflict=tenant_id,cnpj', { body: row, prefer: 'return=representation,resolution=merge-duplicates' }))[0]; },
    async updateCustomer(tenantId, id, patch) { await rest('PATCH', `customers?tenant_id=${eq(tenantId)}&id=${eq(id)}`, { body: patch, prefer: 'return=minimal' }); },
    async listProducts(tenantId, { buyer = false } = {}) {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await rest('GET', `olist_products?select=*&tenant_id=${eq(tenantId)}&in_catalog=is.true${buyer ? '&visible=is.true&situation=eq.A' : ''}&order=id.asc&limit=1000&offset=${offset}`);
        rows.push(...page);
        if (page.length < 1000) return rows;
      }
    },
    async productsByIds(tenantId, ids) {
      const rows = [];
      for (const part of chunk(ids, 150)) rows.push(...await rest('GET', `olist_products?select=*&tenant_id=${eq(tenantId)}&id=${inList(part)}`));
      return rows;
    },
    async upsertProducts(rows) { for (const part of chunk(rows, 500)) await rest('POST', 'olist_products?on_conflict=tenant_id,id', { body: part, prefer: 'return=minimal,resolution=merge-duplicates' }); },
    async retireProductsBefore(tenantId, isoTime) { await rest('PATCH', `olist_products?tenant_id=${eq(tenantId)}&synced_at=lt.${encodeURIComponent(isoTime)}&in_catalog=is.true`, { body: { in_catalog: false }, prefer: 'return=minimal' }); },
    async updateProducts(tenantId, ids, patch) { for (const part of chunk(ids, 150)) await rest('PATCH', `olist_products?tenant_id=${eq(tenantId)}&id=${inList(part)}`, { body: patch, prefer: 'return=minimal' }); },
    async createOrder(order, items) {
      const created = (await rest('POST', 'orders', { body: order, prefer: 'return=representation' }))[0];
      try { await rest('POST', 'order_items', { body: items.map(i => ({ ...i, order_id: created.id })), prefer: 'return=minimal' }); }
      catch (error) { await rest('DELETE', `orders?id=${eq(created.id)}`, { prefer: 'return=minimal' }).catch(() => {}); throw error; }
      return created;
    },
    async updateOrder(tenantId, id, patch) { return (await rest('PATCH', `orders?tenant_id=${eq(tenantId)}&id=${eq(id)}`, { body: patch, prefer: 'return=representation' }))[0] || null; },
    async listOrders(tenantId, { customerId } = {}) { return rest('GET', `orders?select=*,customers(id,cnpj,legal_name,trade_name),app_users(id,name,username),order_items(id)&tenant_id=${eq(tenantId)}${customerId ? `&customer_id=${eq(customerId)}` : ''}&order=created_at.desc&limit=500`); },
    async getOrder(tenantId, id) { return (await rest('GET', `orders?select=*,customers(*),app_users(id,name,username),order_items(*)&tenant_id=${eq(tenantId)}&id=${eq(id)}&limit=1`))[0] || null; }
  };
}

// ── In-memory repository (tests and local development) ───────
export function memoryRepo(seed = {}) {
  const uuid = () => crypto.randomUUID();
  const tables = { tenants: [...(seed.tenants || [])], customers: [], app_users: [...(seed.users || [])], olist_products: [], orders: [], order_items: [] };
  let orderNumber = 1000, itemId = 1;
  const strip = ({ password_hash, ...rest }) => rest;
  const customerOf = id => { const c = tables.customers.find(x => x.id === id); return c ? { id: c.id, cnpj: c.cnpj, legal_name: c.legal_name, trade_name: c.trade_name } : null; };
  const userOf = id => { const u = tables.app_users.find(x => x.id === id); return u ? { id: u.id, name: u.name, username: u.username } : null; };
  return {
    kind: 'memory', tables,
    async findUserByUsername(username) { return tables.app_users.find(u => u.username.toLowerCase() === String(username).toLowerCase()) || null; },
    async getUser(id) { return tables.app_users.find(u => u.id === id) || null; },
    async listUsers(tenantId) { return tables.app_users.filter(u => u.tenant_id === tenantId).map(u => ({ ...strip(u), customers: customerOf(u.customer_id) })); },
    async createUser(row) {
      if (tables.app_users.some(u => u.username.toLowerCase() === row.username.toLowerCase())) throw Object.assign(new Error('Registro já existe.'), { status: 409 });
      const user = { id: uuid(), active: true, created_at: new Date().toISOString(), last_login_at: null, email: null, customer_id: null, ...row };
      tables.app_users.push(user); return user;
    },
    async updateUser(tenantId, id, patch) { const u = tables.app_users.find(x => x.tenant_id === tenantId && x.id === id); if (u) Object.assign(u, patch); return u || null; },
    async touchLogin(id) { const u = tables.app_users.find(x => x.id === id); if (u) u.last_login_at = new Date().toISOString(); },
    async getTenant(id) { return tables.tenants.find(t => t.id === id) || null; },
    async listTenants() { return tables.tenants; },
    async tenantByWebhook(token) { return tables.tenants.find(t => t.webhook_token && t.webhook_token === token) || null; },
    async updateTenant(id, patch) { const t = tables.tenants.find(x => x.id === id); if (t) Object.assign(t, patch); },
    async listCustomers(tenantId) { return tables.customers.filter(c => c.tenant_id === tenantId); },
    async getCustomer(tenantId, id) { return tables.customers.find(c => c.tenant_id === tenantId && c.id === id) || null; },
    async upsertCustomer(row) {
      const found = tables.customers.find(c => c.tenant_id === row.tenant_id && c.cnpj === row.cnpj);
      if (found) return Object.assign(found, row);
      const customer = { id: uuid(), active: true, olist_contact_id: null, created_at: new Date().toISOString(), ...row };
      tables.customers.push(customer); return customer;
    },
    async updateCustomer(tenantId, id, patch) { const c = tables.customers.find(x => x.tenant_id === tenantId && x.id === id); if (c) Object.assign(c, patch); },
    async listProducts(tenantId, { buyer = false } = {}) { return tables.olist_products.filter(p => p.tenant_id === tenantId && p.in_catalog && (!buyer || (p.visible && p.situation === 'A'))); },
    async productsByIds(tenantId, ids) { return tables.olist_products.filter(p => p.tenant_id === tenantId && ids.includes(p.id)); },
    async upsertProducts(rows) {
      for (const row of rows) {
        const found = tables.olist_products.find(p => p.tenant_id === row.tenant_id && p.id === row.id);
        if (found) Object.assign(found, row); else tables.olist_products.push({ visible: true, margin_percent: null, in_catalog: true, ...row });
      }
    },
    async retireProductsBefore(tenantId, isoTime) { tables.olist_products.forEach(p => { if (p.tenant_id === tenantId && p.synced_at < isoTime) p.in_catalog = false; }); },
    async updateProducts(tenantId, ids, patch) { tables.olist_products.forEach(p => { if (p.tenant_id === tenantId && ids.includes(p.id)) Object.assign(p, patch); }); },
    async createOrder(order, items) {
      const created = { id: uuid(), number: ++orderNumber, status: 'novo', created_at: new Date().toISOString(), olist_order_id: null, olist_order_number: null, olist_error: null, ...order };
      tables.orders.push(created);
      items.forEach(i => tables.order_items.push({ id: itemId++, order_id: created.id, ...i }));
      return created;
    },
    async updateOrder(tenantId, id, patch) { const o = tables.orders.find(x => x.tenant_id === tenantId && x.id === id); if (o) Object.assign(o, patch); return o || null; },
    async listOrders(tenantId, { customerId } = {}) {
      return tables.orders.filter(o => o.tenant_id === tenantId && (!customerId || o.customer_id === customerId)).sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(o => ({ ...o, customers: customerOf(o.customer_id), app_users: userOf(o.user_id), order_items: tables.order_items.filter(i => i.order_id === o.id).map(i => ({ id: i.id })) }));
    },
    async getOrder(tenantId, id) {
      const o = tables.orders.find(x => x.tenant_id === tenantId && x.id === id);
      return o ? { ...o, customers: tables.customers.find(c => c.id === o.customer_id), app_users: userOf(o.user_id), order_items: tables.order_items.filter(i => i.order_id === o.id) } : null;
    }
  };
}
