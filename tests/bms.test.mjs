import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server.mjs';
import { memoryRepo, hashPassword } from '../db.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const TENANT = 'tenant-1';

async function setup(t, olist, registry = async () => json({}, 404)) {
  const repo = memoryRepo({
    tenants: [{ id: TENANT, name: 'Empresa', default_margin: 10, webhook_token: 'hook', olist_tokens: null }],
    users: [{ id: 'admin-1', tenant_id: TENANT, name: 'Admin', username: 'admin', password_hash: await hashPassword('senha-admin'), role: 'admin', active: true, customer_id: null }]
  });
  const calls = [];
  const fetcher = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET', body: init.body }); return olist(String(url), init); };
  const app = createApp({ clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost:3000/auth/callback', port: 3000, repo, registryFetcher: registry }, fetcher);
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, { method = 'GET', body, cookie, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let data = null; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data, headers: res.headers }); });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const loginAs = async (username, password) => {
    const r = await call('/auth/app-login', { method: 'POST', body: { username, password } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.headers['set-cookie'][0].split(';')[0];
  };
  return { repo, call, loginAs, calls };
}
async function connectOlist(call, admin) {
  const start = await call('/auth/login', { cookie: admin });
  const state = new URL(start.headers.location).searchParams.get('state');
  const session = start.headers['set-cookie'][0].split(';')[0];
  const cb = await call(`/auth/callback?code=x&state=${state}`, { cookie: `${admin}; ${session}` });
  assert.equal(cb.headers.location, '/?auth=success');
}
const catalog = {
  v: 1, syncedAt: '2026-10-21 01:00:00', stockComplete: true,
  products: [
    { id: 1, sku: 'PAI', descricao: 'Sandália', situacao: 'A', tipoVariacao: 'P', precos: { preco: 100, precoCusto: 0, precoCustoMedio: 0 } },
    { id: 2, sku: 'PAI-37', descricao: 'Sandália 37', situacao: 'A', tipoVariacao: 'V', precos: { preco: 100, precoCusto: 40 } },
    { id: 3, sku: 'PAI-38', descricao: 'Sandália 38', situacao: 'A', tipoVariacao: 'V', precos: { preco: 100, precoCusto: 0, precoCustoMedio: 30 } },
    { id: 4, sku: 'AVULSO', descricao: 'Chinelo', situacao: 'A', tipoVariacao: 'N', precos: { preco: 50, precoCusto: 20 } }
  ],
  stock: [[2, { saldo: 5, reservado: 1, disponivel: 4 }], [3, { saldo: 2, reservado: 0, disponivel: 2 }], [4, { saldo: 9, reservado: 0, disponivel: 9 }]],
  children: [[1, [2, 3]]], grade: [[2, 'Tamanho: 37'], [3, 'Tamanho: 38']], variationsDone: [1]
};

test('database login, roles, catalog, users, orders and Olist order creation', async t => {
  let contactCreated = null, orderSent = null;
  const { repo, call, loginAs, calls } = await setup(t, async (url, init) => {
    if (url.endsWith('/token')) return json({ access_token: 'tok', refresh_token: 'ref', expires_in: 14400 });
    if (url.includes('/contatos?')) return json({ itens: [], paginacao: { total: 0 } });
    if (url.endsWith('/contatos') && init.method === 'POST') { contactCreated = JSON.parse(init.body); return json({ id: 555 }); }
    if (url.endsWith('/pedidos') && init.method === 'POST') { orderSent = JSON.parse(init.body); return json({ id: 9001, numeroPedido: '321' }); }
    return json({ itens: [] });
  }, async url => url.includes('cnpja') ? json({ company: { name: 'CLIENTE LTDA' }, alias: 'Cliente', emails: [{ address: 'a@b.com' }], phones: [{ area: '11', number: '99999999' }], address: { street: 'Rua A', number: '10', district: 'Centro', city: 'São Paulo', state: 'SP', zip: '01000000' }, status: { text: 'Ativa' } }) : json({ estabelecimento: { inscricoes_estaduais: [{ inscricao_estadual: '123', ativo: true, estado: { sigla: 'SP' } }] } }));

  assert.equal((await call('/auth/app-login', { method: 'POST', body: { username: 'admin', password: 'errada' } })).status, 401);
  const admin = await loginAs('ADMIN', 'senha-admin');
  const me = await call('/api/me', { cookie: admin });
  assert.equal(me.data.role, 'admin'); assert.equal(me.data.tenant.defaultMargin, 10);

  // Olist tokens are stored (sealed) on the tenant, not in the browser.
  await connectOlist(call, admin);
  const tenant = repo.tables.tenants[0];
  assert.ok(tenant.olist_tokens && !tenant.olist_tokens.includes('tok'));
  assert.equal((await call('/api/session', { cookie: admin })).data.authenticated, true);

  // Catalog saved to the products table and read back.
  assert.equal((await call('/api/cache', { method: 'PUT', cookie: admin, body: { catalog } })).status, 200);
  const cached = (await call('/api/cache', { cookie: admin })).data;
  assert.equal(cached.storage, 'database');
  assert.equal(cached.catalog.products.length, 4);
  assert.deepEqual(cached.catalog.children, [[1, [2, 3]]]);
  assert.equal(tenant.catalog_synced_at, '2026-10-21 01:00:00');

  // Admin hides product 4 and sets a 50% margin on product 2.
  assert.equal((await call('/api/products/settings', { method: 'PATCH', cookie: admin, body: { ids: [4], visible: false } })).status, 200);
  assert.equal((await call('/api/products/settings', { method: 'PATCH', cookie: admin, body: { ids: [2], margin: 50 } })).status, 200);

  // CNPJ lookup and buyer creation.
  const cnpj = await call('/api/cnpj/12.345.678/0001-90', { cookie: admin });
  assert.equal(cnpj.data.legal_name, 'CLIENTE LTDA');
  assert.deepEqual(cnpj.data.state_registrations, [{ uf: 'SP', ie: '123' }]);
  assert.equal((await call('/api/users', { method: 'POST', cookie: admin, body: { name: 'Comprador', username: 'compra', password: 'curta', role: 'buyer', customer: cnpj.data } })).status, 400);
  const created = await call('/api/users', { method: 'POST', cookie: admin, body: { name: 'Comprador', username: 'compra', password: 'senha-compra', role: 'buyer', customer: cnpj.data } });
  assert.equal(created.status, 201); assert.equal(created.data.password_hash, undefined);
  assert.equal((await call('/api/users', { method: 'POST', cookie: admin, body: { name: 'Outro', username: 'COMPRA', password: 'senha-compra', role: 'admin' } })).status, 409);

  // Buyer sees only visible products, priced at cost + margin, and cannot reach admin routes.
  const buyer = await loginAs('compra', 'senha-compra');
  const view = (await call('/api/catalog', { cookie: buyer })).data;
  assert.deepEqual(view.products.map(p => p.id).sort(), [1, 2, 3]);
  assert.equal(view.products.find(p => p.id === 2).precoComprador, 60); // 40 + 50%
  assert.equal(view.products.find(p => p.id === 3).precoComprador, 33); // average cost 30 + default 10%
  assert.ok(!JSON.stringify(view).includes('precoCusto'));
  for (const path of ['/api/cache', '/api/users', '/api/session', '/api/products?limit=1', '/auth/login']) assert.equal((await call(path, { cookie: buyer })).status, 403, path);

  // Orders: parent and hidden products are rejected; a valid order is saved and created in Olist.
  assert.equal((await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 1, quantity: 1 }] } })).status, 400);
  assert.equal((await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 4, quantity: 1 }] } })).status, 400);
  assert.equal((await call('/api/orders', { method: 'POST', cookie: admin, body: { items: [{ id: 2, quantity: 1 }] } })).status, 403);
  const order = await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 2, quantity: 3 }, { id: 3, quantity: 1 }], notes: 'Entregar rápido' } });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.equal(order.data.total, 213);
  assert.equal(order.data.status, 'enviado_olist'); assert.equal(order.data.olistOrderNumber, '321');
  assert.equal(contactCreated.cpfCnpj, '12.345.678/0001-90'); assert.equal(contactCreated.inscricaoEstadual, '123');
  assert.equal(orderSent.idContato, 555);
  assert.deepEqual(orderSent.itens, [{ produto: { id: 2, tipo: 'P' }, quantidade: 3, valorUnitario: 60 }, { produto: { id: 3, tipo: 'P' }, quantidade: 1, valorUnitario: 33 }]);
  assert.equal(repo.tables.customers[0].olist_contact_id, 555);

  // Admin sees the order with its buyer; the buyer sees only their customer's orders.
  const list = (await call('/api/orders', { cookie: admin })).data;
  assert.equal(list.length, 1); assert.equal(list[0].buyer.name, 'Comprador'); assert.equal(list[0].customer.legal_name, 'CLIENTE LTDA');
  const detail = (await call(`/api/orders/${list[0].id}`, { cookie: buyer })).data;
  assert.equal(detail.items.length, 2);

  // Disabling a user blocks access immediately after the cache window; self-disable is refused.
  assert.equal((await call(`/api/users/admin-1`, { method: 'PATCH', cookie: admin, body: { active: false } })).status, 400);
  assert.ok(calls.every(c => !c.url.includes('senha')));
});

test('order is kept with an error when Olist rejects it, and admin can resend', async t => {
  let fail = true;
  const { repo, call, loginAs } = await setup(t, async (url, init) => {
    if (url.endsWith('/token')) return json({ access_token: 'tok', refresh_token: 'ref', expires_in: 14400 });
    if (url.includes('/contatos?')) return json({ itens: [{ id: 77, cpfCnpj: '12.345.678/0001-90' }] });
    if (url.endsWith('/pedidos')) return fail ? json({ mensagem: 'Erro de validação', detalhes: [{ campo: 'itens', mensagem: 'produto inválido' }] }, 400) : json({ id: 1, numeroPedido: '10' });
    return json({});
  });
  const admin = await loginAs('admin', 'senha-admin');
  await connectOlist(call, admin);
  await call('/api/cache', { method: 'PUT', cookie: admin, body: { catalog } });
  await repo.upsertCustomer({ tenant_id: TENANT, cnpj: '12345678000190', legal_name: 'CLIENTE LTDA' });
  const customer = repo.tables.customers[0];
  await repo.createUser({ tenant_id: TENANT, customer_id: customer.id, name: 'B', username: 'b', password_hash: await hashPassword('senha-b123'), role: 'buyer' });
  const buyer = await loginAs('b', 'senha-b123');
  const order = await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 2, quantity: 1 }] } });
  assert.equal(order.data.status, 'erro_olist');
  assert.match(order.data.olistError, /produto inválido/);
  assert.equal(repo.tables.orders.length, 1);
  fail = false;
  const resent = await call(`/api/orders/${order.data.id}/resend`, { method: 'POST', cookie: admin });
  assert.equal(resent.data.status, 'enviado_olist');
  assert.equal(resent.data.olistOrderNumber, '10');
});

test('stock webhook updates products by tenant token and cron refreshes Olist tokens', async t => {
  let refreshes = 0;
  const { repo, call, loginAs } = await setup(t, async (url, init) => {
    if (url.endsWith('/token')) { if (String(init.body).includes('refresh_token')) refreshes++; return json({ access_token: `tok${refreshes}`, refresh_token: `ref${refreshes}`, expires_in: 14400 }); }
    return json({});
  });
  const admin = await loginAs('admin', 'senha-admin');
  await connectOlist(call, admin);
  await call('/api/cache', { method: 'PUT', cookie: admin, body: { catalog } });
  assert.equal((await call('/api/webhooks/estoque?token=errado', { method: 'POST', body: {} })).status, 401);
  const hook = await call('/api/webhooks/estoque?token=hook', { method: 'POST', body: { produtos: [{ id: 2, sku: 'PAI-37', saldo: 11 }] } });
  assert.deepEqual(hook.data, { status: 'processado' });
  const row = repo.tables.olist_products.find(p => p.id === 2);
  assert.equal(row.stock_balance, 11); assert.equal(row.stock_available, 10);
  assert.equal((await call('/api/cron/olist-refresh')).status, 401);
  const cron = await call('/api/cron/olist-refresh', { headers: { 'User-Agent': 'vercel-cron/1.0' } });
  assert.equal(cron.data.refreshed, 1); assert.equal(refreshes, 1);
});
test('login page assets load without a session and the form never sends credentials in the URL', async t => {
  const { call } = await setup(t, async () => json({}));
  for (const path of ['/', '/styles.css', '/login.js', '/favicon.svg']) assert.equal((await call(path)).status, 200, path);
  assert.equal((await call('/api/catalog')).status, 401);
  const form = await call('/auth/app-login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: undefined });
  assert.equal(form.status, 302); assert.equal(form.headers.location, '/?login=invalid');
});
test('opening a product fetches its Olist detail once, saves it and hides cost from buyers', async t => {
  let detailCalls = 0;
  const { repo, call, loginAs } = await setup(t, async (url) => {
    if (url.endsWith('/token')) return json({ access_token: 'tok', refresh_token: 'ref', expires_in: 14400 });
    if (url.endsWith('/produtos/1')) { detailCalls++; return json({ id: 1, descricao: 'Sandália', tipoVariacao: 'P', descricaoComplementar: '<p>Confortável&nbsp;e <b>leve</b></p>', marca: { nome: 'Marca X' }, categoria: { caminhoCompleto: 'Calçados > Sandálias' }, anexos: [{ url: 'https://cdn.example/img1.jpg' }, { url: 'javascript:alert(1)' }], precos: { preco: 100, precoCusto: 0, precoCustoMedio: 0 }, custos: [{ data: '2026-09-01', precoCusto: 35, custoMedio: 0 }, { data: '2026-10-01', precoCusto: 0, custoMedio: 38 }], variacoes: [{ id: 2, grade: [{ chave: 'Tamanho', valor: '37' }] }, { id: 3, grade: [] }] }); }
    return json({});
  });
  const admin = await loginAs('admin', 'senha-admin');
  await connectOlist(call, admin);
  const flat = { ...catalog, children: [], variationsDone: [] };
  await call('/api/cache', { method: 'PUT', cookie: admin, body: { catalog: flat } });
  const detail = (await call('/api/products/1/detail', { cookie: admin })).data;
  assert.equal(detail.imagem, 'https://cdn.example/img1.jpg');
  assert.deepEqual(detail.imagens, ['https://cdn.example/img1.jpg']);
  assert.equal(detail.detalhes.complemento, 'Confortável e leve');
  assert.equal(detail.precos.custoFicha, 38);
  assert.equal(detail.precoComprador, 41.8); // 38 + default 10%
  const kid = repo.tables.olist_products.find(p => p.id === 2);
  assert.equal(kid.parent_id, 1);
  await call('/api/products/1/detail', { cookie: admin });
  assert.equal(detailCalls, 1, 'cached for 10 minutes');
  const cached = (await call('/api/cache', { cookie: admin })).data.catalog;
  assert.equal(cached.products.find(p => p.id === 2).imagem, 'https://cdn.example/img1.jpg', 'variation inherits parent image');
  await repo.upsertCustomer({ tenant_id: TENANT, cnpj: '12345678000190', legal_name: 'C' });
  await repo.createUser({ tenant_id: TENANT, customer_id: repo.tables.customers[0].id, name: 'B', username: 'b', password_hash: await hashPassword('senha-b123'), role: 'buyer' });
  const buyer = await loginAs('b', 'senha-b123');
  const seen = (await call('/api/products/2/detail', { cookie: buyer })).data;
  assert.equal(seen.imagem, 'https://cdn.example/img1.jpg');
  assert.equal(seen.precos, undefined);
  assert.ok(!JSON.stringify(seen).includes('custo'));
});
