import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { cookieSessions } from './session.mjs';
import { createStorage } from './storage.mjs';
import { supabaseRepo, memoryRepo, verifyPassword, sealer } from './db.mjs';
import { bmsRoutes, catalogFromRows, rowsFromCatalog } from './bms.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const AUTH = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth';
const TOKEN = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token';
const API = 'https://erp.tiny.com.br/public-api/v3';
const id = () => randomBytes(32).toString('base64url');
const fault = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
// Routes a buyer may use; everything else is admin-only.
const BUYER_ROUTES = [/^\/api\/customer\/olist(-app)?$/, /^\/auth\/customer-login$/, /^\/auth\/callback$/, /^\/api\/me$/, /^\/api\/catalog$/, /^\/api\/products\/\d+\/detail$/, /^\/api\/orders(\/[\w-]+)?$/, /^\/auth\/app-logout$/];

export function createApp(config, fetcher = fetch) {
  const localSessions = new Map();
  if (config.serverless && !config.sessionSecret) throw new Error('SESSION_SECRET is required');
  const origin = new URL(config.redirectUri).origin;
  const secure = origin.startsWith('https:');
  const cookie = (value, age = 86400) => `drive_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  // Users live in the database when configured; otherwise a single admin from env (APP_USERNAME/APP_PASSWORD).
  const repo = config.repo || (config.supabaseUrl && config.supabaseKey ? supabaseRepo({ url: config.supabaseUrl, key: config.supabaseKey }) : null);
  const gate = !!repo || !!(config.appUser && config.appPassword);
  const appSecret = config.sessionSecret || randomBytes(32).toString('hex');
  const tokenBox = sealer(config.sessionSecret || config.clientSecret || appSecret);
  const appCookie = (value, age = 7 * 86400) => `drive_app=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const sign = data => createHmac('sha256', appSecret).update(`drive-app-v1.${data}`).digest('base64url');
  const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
  function appToken(user) {
    const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + 7 * 86400000 })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }
  function appUser(req) {
    const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('drive_app='))?.slice('drive_app='.length) || '';
    const [payload, signature] = raw.split('.');
    if (!payload || !signature || !same(signature, sign(payload))) return null;
    try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return data.exp > Date.now() ? data.u : null; } catch { return null; }
  }
  // Resolves the signed-in user. In database mode the user is re-read (30s cache) so disabling takes effect.
  const userCache = new Map();
  async function whoAmI(req) {
    if (!gate) return { id: 'local', role: 'admin', name: 'local', username: 'local', tenantId: null };
    const ref = appUser(req);
    if (!ref) return null;
    if (!repo) return { id: ref, role: 'admin', name: ref, username: ref, tenantId: null };
    const cached = userCache.get(ref);
    let user = cached && Date.now() - cached.at < 30000 ? cached.user : null;
    if (!user) { user = await repo.getUser(ref); userCache.set(ref, { user, at: Date.now() }); }
    if (!user || !user.active) return null;
    return { id: user.id, role: user.role, name: user.name, username: user.username, tenantId: user.tenant_id, customerId: user.customer_id };
  }
  async function readRaw(req, limit) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw fault(413, 'Requisição muito grande.'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function readJson(req, limit = 4096) {
    const body = (await readRaw(req, limit)).toString('utf8');
    try { return JSON.parse(body || '{}'); } catch { throw fault(400, 'Requisição inválida.'); }
  }
  let oidcToken = process.env.VERCEL_OIDC_TOKEN || '';
  const storage = config.storage || createStorage({ secret: config.sessionSecret || config.clientSecret, blobToken: config.blobToken, blobStoreId: config.blobStoreId, oidcToken: () => oidcToken, dir: config.cacheDir });
  const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const idList = value => {
    const ids = String(value || '').split(',').filter(Boolean).map(Number);
    if (!ids.length || ids.length > 20 || !ids.every(n => Number.isSafeInteger(n) && n > 0)) throw fault(400, 'Lista de produtos inválida.');
    return [...new Set(ids)];
  };
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  }
  function redirect(res, location, headers = {}) { res.writeHead(302, { Location: location, ...headers }); res.end(); }
  async function tokenRequest(fields, creds = { clientId: config.clientId, clientSecret: config.clientSecret }) {
    let response;
    try {
      response = await fetcher(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...fields }), signal: AbortSignal.timeout(25000) });
    } catch { throw fault(502, 'Não foi possível conectar à Olist. Verifique a conexão e tente novamente.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw fault(response.status === 400 || response.status === 401 ? 401 : 502, 'A Olist não aceitou a autenticação. Confira as credenciais e a URL de redirecionamento e conecte novamente.');
    return data;
  }
  function saveTokens(session, data) {
    session.tokens = { access_token: data.access_token, refresh_token: data.refresh_token || session.tokens?.refresh_token, expiresAt: Date.now() + Number(data.expires_in || 300) * 1000 };
  }
  async function refresh(session) {
    if (session.reload) { await session.reload(); if (session.tokens?.expiresAt > Date.now() + 60000 && !session.forceRefresh) return; }
    if (!session.tokens?.refresh_token) { session.tokens = null; throw fault(401, 'Sua sessão expirou. Conecte sua conta Olist novamente.'); }
    if (!session.refreshing) session.refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token }, session.creds)
      .then(async data => { saveTokens(session, data); await session.persist?.(session.tokens); })
      .catch(async error => { if (error.status === 401) { session.tokens = null; await session.persist?.(null); } throw error; })
      .finally(() => { session.refreshing = null; });
    await session.refreshing;
  }
  // Olist connection of a tenant, stored encrypted in the database (shared by admins and buyers' orders).
  async function tenantSession(tenantId) {
    const session = { tenantId };
    session.reload = async () => { const tenant = await repo.getTenant(tenantId); session.tokens = tenant?.olist_tokens ? tokenBox.open(tenant.olist_tokens) : null; };
    session.persist = async tokens => repo.updateTenant(tenantId, { olist_tokens: tokens ? tokenBox.seal(tokens) : null, ...(tokens ? {} : { olist_connected_at: null }) });
    await session.reload();
    return session;
  }
  // A customer's own Olist account (their private app credentials + tokens, both sealed on the customer).
  async function customerSession(tenantId, customerId) {
    const session = { tenantId, customerId };
    session.reload = async () => {
      const customer = await repo.getCustomer(tenantId, customerId);
      session.creds = customer?.olist_app ? tokenBox.open(customer.olist_app) : null;
      session.tokens = customer?.olist_tokens && session.creds ? tokenBox.open(customer.olist_tokens) : null;
    };
    session.persist = async tokens => repo.updateCustomer(tenantId, customerId, { olist_tokens: tokens ? tokenBox.seal(tokens) : null, ...(tokens ? {} : { olist_connected_at: null }) });
    await session.reload();
    return session;
  }
  // Logs why Olist rejected a call. Never logs the token, only its public claims.
  async function rejection(response, session, path) {
    const body = (await response.text().catch(() => '')).slice(0, 500);
    let claims = null;
    try { const c = JSON.parse(Buffer.from(session.tokens.access_token.split('.')[1], 'base64url')); claims = { iss: c.iss, aud: c.aud, azp: c.azp, scope: c.scope, iat: c.iat && new Date(c.iat * 1000).toISOString(), exp: c.exp && new Date(c.exp * 1000).toISOString() }; } catch {}
    console.warn('[olist] rejected', JSON.stringify({ path, status: response.status, wwwAuthenticate: response.headers.get('www-authenticate'), body, claims }));
    let reason = '';
    try { const d = JSON.parse(body); reason = d.mensagem || d.message || d.error_description || d.error || d.detalhes?.[0]?.mensagem || ''; } catch {}
    return typeof reason === 'string' && reason ? `: ${reason.slice(0, 200)}` : '';
  }
  async function olist(session, path, label, valid, { method = 'GET', body } = {}) {
    if (!session?.tokens) throw fault(401, 'Conecte sua conta Olist para consultar os produtos.');
    if (session.tokens.expiresAt < Date.now() + 30000) await refresh(session);
    const request = () => fetcher(`${API}${path}`, { method, headers: { Authorization: `Bearer ${session.tokens.access_token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    let response;
    try { response = await request(); if (response.status === 401) { await refresh(session); response = await request(); } }
    catch (error) { if (error.status) throw error; throw fault(502, 'A Olist não respondeu. Tente atualizar a lista em instantes.'); }
    // Keep the session: a 401 here can be endpoint permission, not an invalid login.
    if (response.status === 401) throw fault(403, `A Olist recusou o token no endpoint ${label} (HTTP 401)${await rejection(response, session, path)}.`);
    if (response.status === 403) throw fault(403, `Acesso negado pela Olist ao endpoint ${label} (HTTP 403)${await rejection(response, session, path)}.`);
    if (response.status === 429) throw fault(429, 'Limite de consultas da Olist atingido. A lista será retomada automaticamente.', { retryAfter: Math.min(120, Math.max(5, Number(response.headers.get('retry-after')) || 30)) });
    const data = await response.json().catch(() => null);
    if (response.status === 404) throw fault(404, `Registro não encontrado na Olist (${label}).`);
    if (response.status === 400 || response.status === 422) {
      const details = Array.isArray(data?.detalhes) ? data.detalhes.map(d => [d.campo, d.mensagem].filter(Boolean).join(': ')).join('; ') : '';
      throw fault(422, `A Olist recusou ${label}: ${data?.mensagem || 'dados inválidos'}${details ? ` (${details})` : ''}`.slice(0, 500));
    }
    if (!response.ok) throw fault(502, `Não foi possível consultar ${label} na Olist. Tente novamente.`);
    if (!data || !valid(data)) throw fault(502, 'A Olist retornou dados em formato inesperado.');
    return data;
  }
  // Fetches one Olist record per id, stopping early on rate limit so the client can resume.
  async function batch(session, ids, path, label, pick) {
    const items = {};
    for (const pid of ids) {
      try { items[pid] = pick(await olist(session, path(pid), label, data => typeof data === 'object')); }
      catch (error) {
        if (error.status === 429) return { items, retryAfter: error.retryAfter };
        if (error.status === 404) { items[pid] = null; continue; }
        if (Object.keys(items).length) return { items, error: error.message };
        throw error;
      }
    }
    return { items };
  }
  const bms = repo ? bmsRoutes({ repo, send, readJson, fault, olist, tenantSession, fetcher: config.registryFetcher || fetcher, origin }) : null;
  return http.createServer(async (req, res) => {
    if (req.headers['x-vercel-oidc-token']) oidcToken = req.headers['x-vercel-oidc-token'];
    const sessions = config.serverless ? cookieSessions(req, res, config.sessionSecret, secure) : localSessions;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, origin);
      const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (!isLocal && url.origin !== origin) throw fault(400, 'Host inválido.');
      const localHosts = [`localhost:${config.port}`, `127.0.0.1:${config.port}`];
      if (req.headers.host && ![new URL(origin).host, ...localHosts, ...(config.aliases || [])].includes(req.headers.host)) throw fault(400, 'Host inválido.');
      // Login and callback must use the same HTTPS hostname so the session cookie returns.
      if (secure && req.headers.host !== new URL(origin).host) return redirect(res, `${origin}${url.pathname}${url.search}`);
      const sid = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('drive_session='))?.slice('drive_session='.length);
      const session = sessions.get(sid);
      if (session) session.lastSeen = Date.now();
      for (const [key, value] of sessions) if (Date.now() - value.lastSeen > 86400000) sessions.delete(key);

      // Olist webhook (stock movements). Authenticated by a secret token in the URL, not by the app login.
      if (url.pathname === '/api/webhooks/estoque') {
        if (req.method !== 'POST') throw fault(405, 'Método não permitido.');
        const token = url.searchParams.get('token') || '';
        const tenant = repo ? await repo.tenantByWebhook(token) : null;
        if (!tenant && !(config.webhookSecret && same(token, config.webhookSecret))) throw fault(config.webhookSecret || repo ? 401 : 503, config.webhookSecret || repo ? 'Token inválido.' : 'Webhook não configurado.');
        const raw = await readRaw(req, 2 * 1024 * 1024);
        let payload = {};
        try { payload = JSON.parse(raw.toString('utf8') || '{}'); } catch { try { payload = Object.fromEntries(new URLSearchParams(raw.toString('utf8'))); if (typeof payload.dados === 'string') payload.dados = JSON.parse(payload.dados); } catch { payload = {}; } }
        const items = [];
        const collect = node => {
          if (Array.isArray(node)) return node.forEach(collect);
          if (!node || typeof node !== 'object') return;
          const pid = Number(node.idProduto ?? node.id_produto ?? node.id);
          if (Number.isSafeInteger(pid) && pid > 0 && ('saldo' in node || 'sku' in node || 'idProduto' in node)) items.push({ id: pid, saldo: node.saldo ?? null });
          Object.values(node).forEach(value => { if (value && typeof value === 'object') collect(value); });
        };
        collect(payload);
        console.log('[webhook] estoque', JSON.stringify({ keys: Object.keys(payload).slice(0, 10), produtos: items.length }));
        if (items.length) {
          if (tenant) await bms.applyStockWebhook(tenant.id, items.slice(0, 5000));
          else await storage.put(`events/${Date.now()}-${randomBytes(6).toString('hex')}.bin`, { receivedAt: new Date().toISOString(), items: items.slice(0, 5000) });
        }
        return send(res, 200, { status: 'processado' });
      }
      // Scheduled renewal of every tenant's Olist token (refresh tokens expire after one day).
      if (req.method === 'GET' && url.pathname === '/api/cron/olist-refresh') {
        if (config.cronSecret ? req.headers.authorization !== `Bearer ${config.cronSecret}` : !/vercel-cron/i.test(req.headers['user-agent'] || '')) throw fault(401, 'Não autorizado.');
        if (!repo) return send(res, 200, { ok: true, refreshed: 0 });
        let refreshed = 0;
        for (const tenant of await repo.listTenants()) {
          if (!tenant.olist_tokens) continue;
          const tenantOlist = await tenantSession(tenant.id);
          tenantOlist.forceRefresh = true;
          try { await refresh(tenantOlist); refreshed++; } catch (error) { console.warn('[cron] refresh', tenant.id, error.message); }
        }
        for (const customer of await repo.listConnectedCustomers()) {
          const customerOlist = await customerSession(customer.tenant_id, customer.id);
          customerOlist.forceRefresh = true;
          try { await refresh(customerOlist); refreshed++; } catch (error) { console.warn('[cron] refresh cliente', customer.id, error.message); }
        }
        return send(res, 200, { ok: true, refreshed });
      }

      if (req.method === 'POST' && url.pathname === '/auth/app-login') {
        if (req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        // Plain form posts (JavaScript unavailable) are accepted too and answered with a redirect.
        const form = String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded');
        const body = form ? Object.fromEntries(new URLSearchParams((await readRaw(req, 4096)).toString('utf8'))) : await readJson(req);
        let ok = false, ref = null;
        if (repo) {
          const user = await repo.findUserByUsername(String(body.username ?? '').trim());
          ok = await verifyPassword(body.password ?? '', user?.password_hash) && !!user?.active;
          if (ok) { ref = user.id; await repo.touchLogin(user.id).catch(() => {}); }
        } else if (gate) {
          ok = (same(body.username ?? '', config.appUser) & same(body.password ?? '', config.appPassword)) === 1; // no short-circuit: constant time
          ref = config.appUser;
        }
        if (!ok) { await new Promise(done => setTimeout(done, 600)); if (form) return redirect(res, '/?login=invalid'); throw fault(401, 'Usuário ou senha inválidos.'); }
        res.setHeader('Set-Cookie', appCookie(appToken(ref)));
        if (form) return redirect(res, '/');
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/auth/app-logout') {
        if (req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        res.setHeader('Set-Cookie', appCookie('', 0));
        return send(res, 200, { ok: true });
      }
      const pages = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/bms.js': ['public/bms.js', 'text/javascript'], '/login.js': ['public/login.js', 'text/javascript'], '/styles.css': ['public/styles.css', 'text/css'], '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'] };
      const who = await whoAmI(req);
      if (!who) {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(await readFile(resolve(root, 'public/login.html')));
        }
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname === '/') throw fault(401, 'Faça login para continuar.', { login: true });
      }
      if (who && who.role !== 'admin' && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) && !BUYER_ROUTES.some(r => r.test(url.pathname))) throw fault(403, 'Acesso restrito ao administrador.');
      if (req.method === 'GET' && url.pathname === '/api/me') {
        const tenant = repo && who.tenantId ? await repo.getTenant(who.tenantId) : null;
        const me = repo && who.tenantId ? await repo.getUser(who.id) : null;
        const customer = repo && who.customerId ? await repo.getCustomer(who.tenantId, who.customerId) : null;
        return send(res, 200, {
          user: who.username, name: who.name, email: me?.email || null, role: who.role, gate, database: !!repo, onboarded: !repo || !!me?.onboarded_at, redirectUri: config.redirectUri,
          tenant: tenant ? { name: tenant.name, defaultMargin: Number(tenant.default_margin || 0), webhook: !!tenant.webhook_token, ...(who.role === 'admin' && tenant.webhook_token ? { webhookUrl: `${origin}/api/webhooks/estoque?token=${encodeURIComponent(tenant.webhook_token)}` } : {}) } : null,
          customer: customer ? { cnpj: customer.cnpj, legalName: customer.legal_name, tradeName: customer.trade_name, email: customer.email, phone: customer.phone, address: customer.address, olist: { configured: !!customer.olist_app, connected: !!customer.olist_tokens, company: customer.olist_company || null, connectedAt: customer.olist_connected_at || null } } : null
        });
      }
      // Profile confirmation and onboarding completion.
      if (req.method === 'PATCH' && url.pathname === '/api/me' && repo && who.tenantId) {
        if (req.headers.origin && req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        const body = await readJson(req);
        const clean = (v, max) => v == null ? null : String(v).trim().slice(0, max) || null;
        const userPatch = {};
        if (body.name !== undefined) { const name = clean(body.name, 120); if (!name) throw fault(400, 'Informe seu nome.'); userPatch.name = name; }
        if (body.email !== undefined) { const email = clean(body.email, 160); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fault(400, 'E-mail inválido.'); userPatch.email = email; }
        if (body.onboarded === true) userPatch.onboarded_at = new Date().toISOString();
        if (body.onboarded === false) userPatch.onboarded_at = null;
        if (Object.keys(userPatch).length) { await repo.updateUser(who.tenantId, who.id, userPatch); userCache.delete(who.id); }
        if (who.customerId && (body.phone !== undefined || body.customerEmail !== undefined)) await repo.updateCustomer(who.tenantId, who.customerId, { ...(body.phone !== undefined ? { phone: clean(body.phone, 40) } : {}), ...(body.customerEmail !== undefined ? { email: clean(body.customerEmail, 160) } : {}) });
        return send(res, 200, { ok: true });
      }
      // Customer's own Olist integration (buyers): private app credentials, OAuth and status.
      if (url.pathname === '/api/customer/olist-app' && req.method === 'PUT' && repo && who.customerId) {
        if (req.headers.origin && req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        const body = await readJson(req);
        const clientId = String(body.clientId || '').trim(), clientSecret = String(body.clientSecret || '').trim();
        if (!/^[\w.-]{8,200}$/.test(clientId)) throw fault(400, 'Client ID inválido. Copie exatamente como aparece no aplicativo da Olist.');
        if (clientSecret.length < 8 || clientSecret.length > 300 || /\s/.test(clientSecret)) throw fault(400, 'Client Secret inválido.');
        await repo.updateCustomer(who.tenantId, who.customerId, { olist_app: tokenBox.seal({ clientId, clientSecret }), olist_tokens: null, olist_connected_at: null, olist_company: null });
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/customer/olist' && repo && who.customerId) {
        if (req.method === 'DELETE') {
          if (req.headers.origin && req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
          await repo.updateCustomer(who.tenantId, who.customerId, { olist_tokens: null, olist_connected_at: null, ...(url.searchParams.get('app') === '1' ? { olist_app: null, olist_company: null } : {}) });
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET') {
          const customerOlist = await customerSession(who.tenantId, who.customerId);
          if (!customerOlist.creds) return send(res, 200, { configured: false, connected: false });
          if (!customerOlist.tokens) return send(res, 200, { configured: true, connected: false });
          try {
            const company = await olist(customerOlist, '/info', '/info (dados da empresa)', data => typeof data.razaoSocial === 'string');
            const info = { razaoSocial: company.razaoSocial, cpfCnpj: company.cpfCnpj ?? company.cnpj ?? null };
            await repo.updateCustomer(who.tenantId, who.customerId, { olist_company: info });
            return send(res, 200, { configured: true, connected: true, company: info });
          } catch (error) { return send(res, 200, { configured: true, connected: !!customerOlist.tokens, error: error.message }); }
        }
      }
      if (req.method === 'GET' && url.pathname === '/auth/customer-login' && repo && who.customerId) {
        const customerOlist = await customerSession(who.tenantId, who.customerId);
        if (!customerOlist.creds) return redirect(res, '/?auth=customer-missing');
        const sessionId = id(), state = id(), verifier = id();
        sessions.set(sessionId, { kind: 'customer', customerId: who.customerId, state, verifier, authStarted: Date.now(), lastSeen: Date.now(), tokens: null });
        const target = new URL(AUTH);
        target.search = new URLSearchParams({ client_id: customerOlist.creds.clientId, redirect_uri: config.redirectUri, scope: 'openid', response_type: 'code', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        return redirect(res, target.href, { 'Set-Cookie': cookie(sessionId) });
      }
      if (bms && who && await bms.handle(req, res, url, who)) return;

      // Olist connection: per tenant in the database, per browser cookie otherwise.
      const olistSession = repo && who?.tenantId ? await tenantSession(who.tenantId) : session;
      if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { authenticated: !!olistSession?.tokens, redirectUri: config.redirectUri, configured: !!(config.clientId && config.clientSecret) });
      if (req.method === 'GET' && url.pathname === '/auth/login') {
        if (!config.clientId || !config.clientSecret) throw fault(503, 'Configure OLIST_CLIENT_ID e OLIST_CLIENT_SECRET no servidor.');
        const sessionId = id(), state = id(), verifier = id();
        sessions.set(sessionId, { state, verifier, returnTo: url.searchParams.get('next') === 'company' ? '/api/company' : '/?auth=success', authStarted: Date.now(), lastSeen: Date.now(), tokens: null });
        const target = new URL(AUTH);
        target.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, scope: 'openid', response_type: 'code', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        return redirect(res, target.href, { 'Set-Cookie': cookie(sessionId) });
      }
      if (req.method === 'GET' && (url.pathname === '/auth/callback' || (url.pathname === new URL(config.redirectUri).pathname && (url.searchParams.has('code') || url.searchParams.has('error'))))) {
        if (!session?.state || url.searchParams.get('state') !== session.state || Date.now() - session.authStarted > 600000) return redirect(res, '/?auth=invalid');
        const verifier = session.verifier;
        delete session.state; delete session.verifier;
        // Customer connecting their own Olist account.
        if (session.kind === 'customer') {
          if (!repo || who?.customerId !== session.customerId) return redirect(res, '/?auth=invalid');
          if (url.searchParams.has('error')) return redirect(res, '/?auth=customer-denied');
          try {
            const customerOlist = await customerSession(who.tenantId, who.customerId);
            const tokens = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: config.redirectUri, code_verifier: verifier }, customerOlist.creds);
            saveTokens(customerOlist, tokens);
            await repo.updateCustomer(who.tenantId, who.customerId, { olist_tokens: tokenBox.seal(customerOlist.tokens), olist_connected_at: new Date().toISOString() });
            sessions.delete(sid);
            return redirect(res, '/?auth=customer', { 'Set-Cookie': cookie('', 0) });
          } catch { return redirect(res, '/?auth=customer-failed'); }
        }
        if (who?.role !== 'admin') return redirect(res, '/?auth=invalid');
        if (url.searchParams.has('error')) return redirect(res, '/?auth=denied');
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, '/?auth=invalid');
        try {
          const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: verifier });
          const nextSid = id(); sessions.delete(sid);
          const nextSession = { lastSeen: Date.now() }; saveTokens(nextSession, tokens);
          if (repo && who?.tenantId) {
            await repo.updateTenant(who.tenantId, { olist_tokens: tokenBox.seal(nextSession.tokens), olist_connected_at: new Date().toISOString() });
            delete nextSession.tokens;
          }
          sessions.set(nextSid, nextSession);
          return redirect(res, session.returnTo === '/api/company' ? '/api/company' : '/?auth=success', { 'Set-Cookie': cookie(nextSid) });
        } catch { return redirect(res, '/?auth=failed'); }
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        if (req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        if (repo && who?.tenantId) await repo.updateTenant(who.tenantId, { olist_tokens: null, olist_connected_at: null });
        sessions.delete(sid); return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
      }
      if (req.method === 'GET' && url.pathname === '/api/company') {
        const company = await olist(olistSession, '/info', '/info (dados da empresa)', data => typeof data.razaoSocial === 'string');
        if (repo && who?.tenantId) await repo.updateTenant(who.tenantId, { olist_company: { razaoSocial: company.razaoSocial, cpfCnpj: company.cpfCnpj ?? company.cnpj ?? null } }).catch(() => {});
        return send(res, 200, company);
      }
      if (req.method === 'GET' && url.pathname === '/api/products') {
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fault(400, 'Paginação inválida.');
        const situacao = url.searchParams.get('situacao'), dataAlteracao = url.searchParams.get('dataAlteracao');
        if (situacao && !['A', 'I', 'E'].includes(situacao)) throw fault(400, 'Situação inválida.');
        if (dataAlteracao && !DATE.test(dataAlteracao)) throw fault(400, 'Data inválida.');
        return send(res, 200, await olist(olistSession, `/produtos?${new URLSearchParams({ limit, offset, ...(situacao ? { situacao } : {}), ...(dataAlteracao ? { dataAlteracao } : {}) })}`, '/produtos', data => Array.isArray(data.itens)));
      }
      // Catalog cache: database table in database mode, encrypted Blob otherwise.
      if (req.method === 'GET' && url.pathname === '/api/cache') {
        if (repo && who?.tenantId) {
          const [tenant, rows] = await Promise.all([repo.getTenant(who.tenantId), repo.listProducts(who.tenantId)]);
          return send(res, 200, { catalog: rows.length ? catalogFromRows(rows, tenant) : null, events: [], storage: 'database' });
        }
        const [catalog, names] = await Promise.all([storage.get('catalog.bin'), storage.list('events/')]);
        const events = [];
        for (const name of names.slice(0, 300)) { const event = await storage.get(name); if (event) events.push({ key: name, ids: event.items.map(i => i.id) }); }
        return send(res, 200, { catalog, events, storage: storage.kind });
      }
      if (req.method === 'PUT' && url.pathname === '/api/cache') {
        if (req.headers.origin && req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        let body = await readRaw(req, 4 * 1024 * 1024);
        if (req.headers['x-body-encoding'] === 'gzip') { try { body = gunzipSync(body, { maxOutputLength: 150 * 1024 * 1024 }); } catch { throw fault(400, 'Cache inválido.'); } }
        let data;
        try { data = JSON.parse(body.toString('utf8')); } catch { throw fault(400, 'Cache inválido.'); }
        if (!data.catalog || !Array.isArray(data.catalog.products)) throw fault(400, 'Cache inválido.');
        if (repo && who?.tenantId) {
          const startedAt = new Date(Date.now() - 1000).toISOString();
          await repo.upsertProducts(rowsFromCatalog(data.catalog, who.tenantId));
          await repo.retireProductsBefore(who.tenantId, startedAt);
          await repo.updateTenant(who.tenantId, { catalog_synced_at: DATE.test(data.catalog.syncedAt || '') ? data.catalog.syncedAt : null, catalog_saved_at: new Date().toISOString() });
          return send(res, 200, { ok: true, removed: 0 });
        }
        await storage.put('catalog.bin', { ...data.catalog, savedAt: new Date().toISOString() });
        const consumed = (Array.isArray(data.consumed) ? data.consumed : []).filter(name => typeof name === 'string' && /^events\/[\w.-]+$/.test(name));
        await storage.remove(consumed);
        return send(res, 200, { ok: true, removed: consumed.length });
      }
      if (req.method === 'DELETE' && url.pathname === '/api/cache') {
        if (req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        await storage.remove(['catalog.bin', ...await storage.list('events/')]);
        return send(res, 200, { ok: true });
      }
      // Stock for the whole catalog in pages of 100 (one call per page, not per product).
      if (req.method === 'GET' && url.pathname === '/api/stock-list') {
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw fault(400, 'Paginação inválida.');
        const data = await olist(olistSession, `/estoque?${new URLSearchParams({ limit: 100, offset })}`, '/estoque', data => Array.isArray(data.itens));
        return send(res, 200, { itens: data.itens.map(i => ({ id: i.idProduto, saldo: i.saldo ?? null, reservado: i.reservado ?? null, disponivel: i.disponivel ?? null })), paginacao: data.paginacao });
      }
      if (req.method === 'GET' && url.pathname === '/api/stock') {
        return send(res, 200, await batch(olistSession, idList(url.searchParams.get('ids')), pid => `/estoque/${pid}`, '/estoque', data => ({ saldo: data.saldo ?? null, reservado: data.reservado ?? null, disponivel: data.disponivel ?? null })));
      }
      if (req.method === 'GET' && url.pathname === '/api/variations') {
        return send(res, 200, await batch(olistSession, idList(url.searchParams.get('ids')), pid => `/produtos/${pid}`, '/produtos/{id}', data => (Array.isArray(data.variacoes) ? data.variacoes : []).map(v => ({ id: v.id, grade: Array.isArray(v.grade) ? v.grade.map(g => `${g.chave}: ${g.valor}`).join(' · ') : '' }))));
      }
      if (req.method === 'GET' && pages[url.pathname]) {
        const [file, type] = pages[url.pathname];
        const body = await readFile(resolve(root, file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(body);
      }
      send(res, 404, { error: 'Página não encontrada.' });
    } catch (error) { if (!error.status) console.error('[erro]', req.method, req.url?.split('?')[0], error?.message); send(res, error.status || 500, { error: error.status ? error.message : 'Ocorreu um erro interno. Tente novamente.', ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}), ...(error.login ? { login: true } : {}) }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = await readFile(resolve(root, 'config.local.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  const port = Number(process.env.PORT || local.port || 3000);
  const config = { cacheDir: resolve(root, '.local/cache'), supabaseUrl: process.env.SUPABASE_URL || local.supabaseUrl, supabaseKey: process.env.SUPABASE_SECRET_KEY || local.supabaseKey, webhookSecret: process.env.WEBHOOK_SECRET || local.webhookSecret, appUser: process.env.APP_USERNAME || local.appUser, appPassword: process.env.APP_PASSWORD || local.appPassword, clientId: process.env.OLIST_CLIENT_ID || local.clientId, clientSecret: process.env.OLIST_CLIENT_SECRET || local.clientSecret, redirectUri: process.env.OLIST_REDIRECT_URI || local.redirectUri || `http://localhost:${port}/auth/callback`, port };
  createApp(config).listen(port, '127.0.0.1', () => console.log(`DRIVE MAXX disponível em http://localhost:${port}\nRetorno OAuth: ${config.redirectUri}`));
}
export { memoryRepo };
