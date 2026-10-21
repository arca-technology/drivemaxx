import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';

const config = () => ({ clientId: 'test-client', clientSecret: 'test-secret-never-public', redirectUri: 'http://localhost:3000/auth/callback', port: 3000 });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
async function setup(t, upstream = async () => { throw new Error('Unexpected upstream call'); }, overrides = {}) {
  const app = createApp({ ...config(), ...overrides }, upstream);
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.address().port}`;
  const get = (path, options = {}) => new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { ...options, headers: { Host: 'localhost:3000', ...options.headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value != null) for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on('error', reject); req.end(options.body);
  });
  return { get };
}
async function login(get) {
  const start = await get('/auth/login');
  const auth = new URL(start.headers.get('location'));
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const callback = await get(`/auth/callback?state=${auth.searchParams.get('state')}&code=test-code`, { headers: { Cookie: cookie } });
  assert.equal(callback.headers.get('location'), '/?auth=success');
  return callback.headers.get('set-cookie').split(';')[0];
}
test('private API requires authentication; config and secret never served', async t => {
  const { get } = await setup(t);
  assert.equal((await get('/api/products')).status, 401);
  assert.equal((await get('/config.local.json')).status, 404);
  assert.equal((await get('/server.mjs')).status, 404);
  const status = await (await get('/api/session')).json();
  assert.equal(status.authenticated, false);
  assert.ok(!JSON.stringify(status).includes('test-secret'));
  const html = await get('/'); assert.equal(html.status, 200);
  assert.ok(!(await html.text()).includes('test-secret'));
});
test('OAuth uses state, PKCE and HttpOnly cookies; rejects forged callbacks', async t => {
  const { get } = await setup(t);
  const response = await get('/auth/login');
  const auth = new URL(response.headers.get('location'));
  assert.equal(auth.origin, 'https://accounts.tiny.com.br');
  assert.equal(auth.searchParams.get('redirect_uri'), config().redirectUri);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(auth.searchParams.get('state'));
  assert.ok(!auth.searchParams.has('client_secret'));
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const rejected = await get('/auth/callback?state=forged&code=bad');
  assert.equal(rejected.headers.get('location'), '/?auth=invalid');
});
test('successful OAuth rotates session, paginates products and rejects callback replay', async t => {
  const calls = [];
  const { get } = await setup(t, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) {
      assert.equal(options.body.get('client_secret'), config().clientSecret);
      assert.ok(options.body.get('code_verifier'));
      return json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer private-access');
    return json({ itens: [{ id: 1, descricao: 'Produto real do fixture' }], paginacao: { total: 101, limit: 100, offset: 100 } });
  });
  const cookie = await login(get);
  assert.equal((await (await get('/api/session', { headers: { Cookie: cookie } })).json()).authenticated, true);
  const response = await get('/api/products?offset=100&limit=100', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.paginacao.total, 101);
  assert.match(calls[1].url, /produtos\?limit=100&offset=100$/);
  assert.ok(!JSON.stringify(data).includes('private-access'));
  assert.equal((await get('/auth/callback?code=test-code', { headers: { Cookie: cookie } })).headers.get('location'), '/?auth=invalid');
});
test('refreshes expired access tokens on the server', async t => {
  let tokenCalls = 0;
  const { get } = await setup(t, async (url, options) => {
    if (url.endsWith('/token')) {
      tokenCalls++;
      if (tokenCalls === 1) return json({ access_token: 'old', refresh_token: 'refresh', expires_in: 1 });
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      return json({ access_token: 'new', refresh_token: 'next-refresh', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer new');
    return json({ itens: [], paginacao: { total: 0 } });
  });
  const cookie = await login(get);
  assert.equal((await get('/api/products', { headers: { Cookie: cookie } })).status, 200);
  assert.equal(tokenCalls, 2);
});
test('handles rate limiting and invalid pagination without leaking upstream responses', async t => {
  const { get } = await setup(t, async url => url.endsWith('/token') ? json({ access_token: 'secret', expires_in: 3600 }) : json({ private: 'upstream-details' }, 429, { 'retry-after': '12' }));
  const cookie = await login(get);
  const response = await get('/api/products', { headers: { Cookie: cookie } });
  assert.equal(response.status, 429);
  const data = await response.json(); assert.equal(data.retryAfter, 12);
  assert.ok(!JSON.stringify(data).includes('upstream-details'));
  for (const query of ['offset=-1', 'limit=101', 'offset=NaN']) assert.equal((await get(`/api/products?${query}`, { headers: { Cookie: cookie } })).status, 400);
});
test('logout requires same origin and clears server session', async t => {
  const { get } = await setup(t, async () => json({ access_token: 'secret', expires_in: 3600 }));
  const cookie = await login(get);
  assert.equal((await get('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://other.example' } })).status, 403);
  assert.equal((await get('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost:3000' } })).status, 200);
  assert.equal((await get('/api/products', { headers: { Cookie: cookie } })).status, 401);
});

test('HTTPS preview redirects localhost and uses a secure cookie on its canonical host', async t => {
  const redirectUri = 'https://preview.example/auth/callback';
  const { get } = await setup(t, undefined, { redirectUri });
  const local = await get('/');
  assert.equal(local.status, 302);
  assert.equal(local.headers.get('location'), 'https://preview.example/');
  const login = await get('/auth/login', { headers: { Host: 'preview.example' } });
  assert.equal(login.status, 302);
  assert.equal(new URL(login.headers.get('location')).searchParams.get('redirect_uri'), redirectUri);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  assert.equal((await get('/api/products', { headers: { Host: 'preview.example' } })).status, 401);
  assert.equal((await get('/', { headers: { Host: 'untrusted.example' } })).status, 400);
});

test('company diagnostic uses /info and can run immediately after OAuth', async t => {
  const { get } = await setup(t, async (url, options) => {
    if (url.endsWith('/token')) return json({ access_token: 'private-token', expires_in: 3600 });
    assert.equal(url, 'https://erp.tiny.com.br/public-api/v3/info');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    return json({ razaoSocial: 'Empresa teste' });
  });
  assert.equal((await get('/api/company')).status, 401);
  const start = await get('/auth/login?next=company');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const callback = await get(`/auth/callback?code=test&state=${state}`, { headers: { Cookie: start.headers.get('set-cookie').split(';')[0] } });
  assert.equal(callback.headers.get('location'), '/api/company');
  const result = await get('/api/company', { headers: { Cookie: callback.headers.get('set-cookie').split(';')[0] } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { razaoSocial: 'Empresa teste' });
});

function cookieJar(response, previous = '') {
  const jar = new Map(previous.split('; ').filter(Boolean).map(s => s.split(/=(.*)/s).slice(0, 2)));
  for (const cookie of response.headers.getSetCookie()) {
    const [name, value] = cookie.split(';')[0].split(/=(.*)/s);
    if (cookie.includes('Max-Age=0')) jar.delete(name); else jar.set(name, value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

test('serverless OAuth survives cold starts, refreshes, rejects tampering and clears cookies on logout', async t => {
  const options = { serverless: true, sessionSecret: randomBytes(32).toString('hex'), redirectUri: 'http://localhost:3000/' };
  const privateToken = randomBytes(2800).toString('base64url');
  let exchanges = 0;
  const upstream = async (url, request) => {
    if (url.endsWith('/token')) {
      exchanges++;
      if (exchanges === 2) assert.equal(request.body.get('grant_type'), 'refresh_token');
      return json({ access_token: privateToken, refresh_token: 'private-refresh', expires_in: exchanges === 1 ? 1 : 3600 });
    }
    assert.equal(request.headers.Authorization, `Bearer ${privateToken}`);
    return json({ itens: [], paginacao: { total: 0 } });
  };
  const a = await setup(t, upstream, options);
  const start = await a.get('/auth/login');
  let jar = cookieJar(start);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const b = await setup(t, upstream, options);
  const callback = await b.get(`/?code=test-code&state=${state}`, { headers: { Cookie: jar } });
  assert.equal(callback.headers.get('location'), '/?auth=success');
  jar = cookieJar(callback, jar);
  assert.ok(!jar.includes(privateToken));
  assert.ok(jar.includes('drive_data1='), 'large sessions are split into cookies');
  const c = await setup(t, upstream, options);
  const products = await c.get('/api/products', { headers: { Cookie: jar } });
  assert.equal(products.status, 200);
  jar = cookieJar(products, jar);
  const d = await setup(t, upstream, options);
  assert.equal((await d.get('/api/products', { headers: { Cookie: jar } })).status, 200);
  assert.equal(exchanges, 2, 'refresh result persists across instances');
  const forged = jar.replace(/drive_data0=./, 'drive_data0=!');
  assert.equal((await d.get('/api/products', { headers: { Cookie: forged } })).status, 401);
  const logout = await d.get('/auth/logout', { method: 'POST', headers: { Cookie: jar, Origin: 'http://localhost:3000' } });
  jar = cookieJar(logout, jar);
  assert.equal(jar, '');
  assert.equal((await c.get('/api/products', { headers: { Cookie: jar } })).status, 401);
});

test('Vercel alias redirects to the canonical OAuth domain', async t => {
  const { get } = await setup(t, undefined, { redirectUri: 'https://app.drivemaxx.com.br/', aliases: ['drivemaxx.vercel.app'] });
  const response = await get('/auth/login', { headers: { Host: 'drivemaxx.vercel.app' } });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://app.drivemaxx.com.br/auth/login');
});

test('app login gate blocks API and Olist routes until valid credentials', async t => {
  const { get } = await setup(t, async () => json({ access_token: 'secret', expires_in: 3600 }), { appUser: 'drivemaxx', appPassword: 'senha-teste' });
  const page = await get('/');
  assert.equal(page.status, 200); assert.match(await page.text(), /login-form/);
  assert.equal((await get('/api/session')).status, 401);
  assert.equal((await get('/auth/login')).status, 401);
  const post = (body, origin = 'http://localhost:3000') => get('/auth/app-login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ username: 'drivemaxx', password: 'errada' })).status, 401);
  assert.equal((await post({ username: 'drivemaxx', password: 'senha-teste' }, 'https://evil.example')).status, 403);
  const ok = await post({ username: 'drivemaxx', password: 'senha-teste' });
  assert.equal(ok.status, 200);
  const app = ok.headers.get('set-cookie').split(';')[0];
  assert.match(app, /^drive_app=/);
  assert.equal((await get('/api/session', { headers: { Cookie: app } })).status, 200);
  assert.match(await (await get('/', { headers: { Cookie: app } })).text(), /products-table/);
  const forged = app.replace(/.$/, c => c === 'A' ? 'B' : 'A');
  assert.equal((await get('/api/session', { headers: { Cookie: forged } })).status, 401);
  const out = await get('/auth/app-logout', { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: app } });
  assert.match(out.headers.get('set-cookie'), /drive_app=;.*Max-Age=0/);
});
test('stock and variations are fetched per id and stop on rate limit', async t => {
  let stockCalls = 0;
  const { get } = await setup(t, async url => {
    url = String(url);
    if (url.endsWith('/token')) return json({ access_token: 'secret', expires_in: 3600 });
    if (url.includes('/estoque/')) { stockCalls++; return stockCalls > 2 ? json({}, 429, { 'retry-after': '9' }) : json({ saldo: 10, reservado: 2, disponivel: 8, depositos: [] }); }
    if (url.endsWith('/produtos/7')) return json({ id: 7, variacoes: [{ id: 71, grade: [{ chave: 'Cor', valor: 'Azul' }] }, { id: 72, grade: null }] });
    return json({}, 404);
  });
  const cookie = await login(get);
  const stock = await (await get('/api/stock?ids=1,2,3', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(stock.items, { 1: { saldo: 10, reservado: 2, disponivel: 8 }, 2: { saldo: 10, reservado: 2, disponivel: 8 } });
  assert.equal(stock.retryAfter, 9);
  const variations = await (await get('/api/variations?ids=7,8', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(variations.items, { 7: [{ id: 71, grade: 'Cor: Azul' }, { id: 72, grade: '' }], 8: null });
  for (const ids of ['', 'a', '0', Array.from({ length: 21 }, (_, i) => i + 1).join(',')]) assert.equal((await get(`/api/stock?ids=${ids}`, { headers: { Cookie: cookie } })).status, 400);
});
test('serverless app login keeps the encrypted Olist session cookies', async t => {
  const options = { serverless: true, sessionSecret: randomBytes(32).toString('hex'), redirectUri: 'http://localhost:3000/', appUser: 'u', appPassword: 'p' };
  const { get } = await setup(t, async () => json({ access_token: 'secret', expires_in: 3600 }), options);
  const ok = await get('/auth/app-login', { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: 'drive_session=abc' }, body: JSON.stringify({ username: 'u', password: 'p' }) });
  assert.equal(ok.status, 200);
  const cookies = ok.headers.getSetCookie();
  assert.ok(cookies.some(c => c.startsWith('drive_app=') && !c.startsWith('drive_app=;')));
  assert.ok(cookies.some(c => c.startsWith('drive_data0=')));
});
test('products accept active-only filter and stock list maps Olist pages', async t => {
  const seen = [];
  const { get } = await setup(t, async url => {
    url = String(url); seen.push(url);
    if (url.endsWith('/token')) return json({ access_token: 'secret', expires_in: 3600 });
    if (url.includes('/estoque?')) return json({ itens: [{ idProduto: 5, sku: 'A', nome: 'x', saldo: 4, reservado: 1, disponivel: 3, depositos: [] }], paginacao: { limit: 100, offset: 0, total: 1 } });
    return json({ itens: [], paginacao: { total: 0 } });
  });
  const cookie = await login(get);
  assert.equal((await get('/api/products?situacao=A', { headers: { Cookie: cookie } })).status, 200);
  assert.ok(seen.some(u => u.includes('/produtos?') && u.includes('situacao=A')));
  assert.equal((await get('/api/products?situacao=X', { headers: { Cookie: cookie } })).status, 400);
  const stock = await (await get('/api/stock-list?offset=0', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(stock.itens, [{ id: 5, saldo: 4, reservado: 1, disponivel: 3 }]);
  assert.equal(stock.paginacao.total, 1);
});
test('stock webhook requires the secret token and queues events for the cache', async t => {
  const { get } = await setup(t, async () => json({ access_token: 'secret', expires_in: 3600 }), { webhookSecret: 'hook-secret', appUser: 'u', appPassword: 'p' });
  const hook = (token, body) => get(`/api/webhooks/estoque?token=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await hook('wrong', {})).status, 401);
  const payload = { tipo: 'atualizacao_estoque', dados: '01/01/2026 10:00:00', produtos: [{ id: 11, sku: 'A', saldo: 5, saldo_anterior: 7, deposito_id: 3 }, { id: 12, sku: 'B', saldo: 0 }] };
  const ok = await hook('hook-secret', payload);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 'processado' });
  const app = (await get('/auth/app-login', { method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: JSON.stringify({ username: 'u', password: 'p' }) })).headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/api/cache')).status, 401);
  const cache = await (await get('/api/cache', { headers: { Cookie: app } })).json();
  assert.equal(cache.catalog, null);
  assert.equal(cache.events.length, 1);
  assert.deepEqual(cache.events[0].ids, [11, 12]);
});
test('catalog cache round-trips gzip bodies and removes consumed events', async t => {
  const { gzipSync } = await import('node:zlib');
  const { get } = await setup(t, async () => json({ access_token: 'secret', expires_in: 3600 }), { webhookSecret: 'k' });
  await get('/api/webhooks/estoque?token=k', { method: 'POST', body: JSON.stringify({ produtos: [{ id: 1, saldo: 2 }] }) });
  const before = await (await get('/api/cache')).json();
  const catalog = { v: 1, products: [{ id: 1, descricao: 'Teste' }], stock: [[1, { disponivel: 2 }]] };
  const put = await get('/api/cache', { method: 'PUT', headers: { 'X-Body-Encoding': 'gzip', 'Content-Type': 'application/octet-stream' }, body: gzipSync(JSON.stringify({ catalog, consumed: before.events.map(e => e.key) })) });
  assert.equal(put.status, 200);
  const after = await (await get('/api/cache')).json();
  assert.deepEqual(after.catalog.products, catalog.products);
  assert.ok(after.catalog.savedAt);
  assert.equal(after.events.length, 0);
  assert.equal((await get('/api/cache', { method: 'PUT', body: '{"catalog":{}}' })).status, 400);
});
