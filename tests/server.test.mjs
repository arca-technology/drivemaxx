import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { request } from 'node:http';

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
    req.on('error', reject); req.end();
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
