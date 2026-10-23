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
  const call = (path, { method = 'GET', body, raw, cookie, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
    const req = request(`${base}${path}`, { method, headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let data = null; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data, headers: res.headers }); });
    });
    req.on('error', reject); req.end(payload);
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
  // An early save (no stock/variations yet) keeps what the database already has.
  assert.equal((await call('/api/cache', { method: 'PUT', cookie: admin, body: { catalog: { ...catalog, stock: [], children: [], grade: [], variationsDone: [] } } })).status, 200);
  const kept = repo.tables.olist_products.find(p => p.id === 2);
  assert.equal(kept.stock_available, 4); assert.equal(kept.parent_id, 1); assert.equal(kept.grade, 'Tamanho: 37');
  assert.deepEqual(cached.catalog.children, [[1, [2, 3]]]);
  assert.equal(tenant.catalog_synced_at, '2026-10-21 01:00:00');

  // Admin hides product 4 and sets a 50% margin on product 2.
  assert.equal((await call('/api/products/settings', { method: 'PATCH', cookie: admin, body: { ids: [4], visible: false } })).status, 200);
  assert.equal((await call('/api/products/settings', { method: 'PATCH', cookie: admin, body: { ids: [2], margin: 50 } })).status, 200);
  // Fixed cost (R$): product 2 has its own, the others use the tenant default.
  assert.equal((await call('/api/products/settings', { method: 'PATCH', cookie: admin, body: { ids: [2], fixed: -1 } })).status, 400);
  assert.equal((await call('/api/products/settings', { method: 'PATCH', cookie: admin, body: { ids: [2], fixed: 2 } })).status, 200);
  assert.equal((await call('/api/tenant', { method: 'PATCH', cookie: admin, body: { defaultFixedCost: 5 } })).status, 200);
  assert.equal(repo.tables.tenants[0].default_margin, 10);

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
  assert.equal(view.products.find(p => p.id === 2).precoFinal, 62); // 40 + 50% + fixed 2
  assert.equal(view.products.find(p => p.id === 3).precoFinal, 38); // average cost 30 + default 10% + default fixed 5
  assert.ok(!JSON.stringify(view).includes('precoComprador'));
  assert.ok(!JSON.stringify(view).includes('precoCusto'));
  for (const path of ['/api/cache', '/api/users', '/api/session', '/api/products?limit=1', '/auth/login']) assert.equal((await call(path, { cookie: buyer })).status, 403, path);

  // Orders: parent and hidden products are rejected; a valid order is saved and created in Olist.
  assert.equal((await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 1, quantity: 1 }] } })).status, 400);
  assert.equal((await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 4, quantity: 1 }] } })).status, 400);
  assert.equal((await call('/api/orders', { method: 'POST', cookie: admin, body: { items: [{ id: 2, quantity: 1 }] } })).status, 403);
  const order = await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 2, quantity: 3 }, { id: 3, quantity: 1 }], notes: 'Entregar rápido' } });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.equal(order.data.total, 224);
  assert.equal(order.data.status, 'enviado_olist'); assert.equal(order.data.olistOrderNumber, '321');
  assert.equal(contactCreated.cpfCnpj, '12.345.678/0001-90'); assert.equal(contactCreated.inscricaoEstadual, '123');
  assert.equal(orderSent.idContato, 555);
  assert.deepEqual(orderSent.itens, [{ produto: { id: 2, tipo: 'P' }, quantidade: 3, valorUnitario: 62 }, { produto: { id: 3, tipo: 'P' }, quantidade: 1, valorUnitario: 38 }]);
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
  assert.equal(detail.precoFinal, 41.8); // no fixed cost in this tenant
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

test('buyer onboarding: confirms profile, saves own Olist app, authenticates with own credentials', async t => {
  const tokenCalls = [];
  const { repo, call, loginAs } = await setup(t, async (url, init) => {
    if (url.endsWith('/token')) { const body = new URLSearchParams(init.body); tokenCalls.push(body.get('client_id')); return json({ access_token: 'cust-tok', refresh_token: 'cust-ref', expires_in: 14400 }); }
    if (url.endsWith('/info')) return json({ razaoSocial: 'CLIENTE LTDA', cpfCnpj: '11222333000181' });
    return json({ itens: [] });
  });
  repo.tables.customers.push({ id: 'cust-1', tenant_id: TENANT, cnpj: '11222333000181', legal_name: 'CLIENTE LTDA', email: null, phone: null });
  repo.tables.app_users.push({ id: 'buyer-1', tenant_id: TENANT, customer_id: 'cust-1', name: 'Comprador', username: 'comprador', password_hash: await hashPassword('senha-buyer'), role: 'buyer', active: true });
  const buyer = await loginAs('comprador', 'senha-buyer');

  let me = (await call('/api/me', { cookie: buyer })).data;
  assert.equal(me.onboarded, false);
  assert.equal(me.customer.legalName, 'CLIENTE LTDA');
  assert.equal(me.tenant.webhookUrl, undefined);
  const adminMe = (await call('/api/me', { cookie: await loginAs('admin', 'senha-admin') })).data;
  assert.equal(adminMe.onboarded, false);
  assert.match(adminMe.tenant.webhookUrl, /\/api\/webhooks\/estoque\?token=hook$/);
  assert.deepEqual(me.customer.olist, { configured: false, connected: false, company: null, connectedAt: null });

  assert.equal((await call('/api/me', { method: 'PATCH', cookie: buyer, body: { name: 'João', email: 'x' } })).status, 400);
  assert.equal((await call('/api/me', { method: 'PATCH', cookie: buyer, body: { name: 'João', email: 'joao@cliente.com', phone: '11 99999-0000' } })).status, 200);
  assert.equal(repo.tables.customers[0].phone, '11 99999-0000');

  // Buyer cannot start the master (admin) OAuth flow.
  assert.equal((await call('/auth/login', { cookie: buyer })).status, 403);
  assert.equal((await call('/auth/customer-login', { cookie: buyer })).headers.location, '/?auth=customer-missing');

  assert.equal((await call('/api/customer/olist-app', { method: 'PUT', cookie: buyer, body: { clientId: 'x', clientSecret: 'y' } })).status, 400);
  assert.equal((await call('/api/customer/olist-app', { method: 'PUT', cookie: buyer, body: { clientId: 'tiny-api-cliente-123', clientSecret: 'segredo-do-cliente' } })).status, 200);
  assert.ok(!repo.tables.customers[0].olist_app.includes('segredo'));

  const start = await call('/auth/customer-login', { cookie: buyer });
  const target = new URL(start.headers.location);
  assert.equal(target.searchParams.get('client_id'), 'tiny-api-cliente-123');
  const session = start.headers['set-cookie'][0].split(';')[0];
  const cb = await call(`/auth/callback?code=abc&state=${target.searchParams.get('state')}`, { cookie: `${buyer}; ${session}` });
  assert.equal(cb.headers.location, '/?auth=customer');
  assert.deepEqual(tokenCalls, ['tiny-api-cliente-123']);
  assert.ok(repo.tables.customers[0].olist_tokens && !repo.tables.customers[0].olist_tokens.includes('cust-tok'));
  assert.equal(repo.tables.tenants[0].olist_tokens, null);

  const status = (await call('/api/customer/olist', { cookie: buyer })).data;
  assert.equal(status.connected, true); assert.equal(status.company.razaoSocial, 'CLIENTE LTDA');

  assert.equal((await call('/api/me', { method: 'PATCH', cookie: buyer, body: { onboarded: true } })).status, 200);
  me = (await call('/api/me', { cookie: buyer })).data;
  assert.equal(me.onboarded, true); assert.equal(me.name, 'João'); assert.equal(me.customer.olist.connected, true);

  assert.equal((await call('/api/customer/olist', { method: 'DELETE', cookie: buyer })).status, 200);
  assert.equal(repo.tables.customers[0].olist_tokens, null);
  assert.ok(repo.tables.customers[0].olist_app);
});

test('order from NF-e XML keeps the invoice, stores attachments and admin push subscriptions', async t => {
  let orderSent = null;
  const { repo, call, loginAs } = await setup(t, async (url, init) => {
    if (url.endsWith('/token')) return json({ access_token: 'tok', refresh_token: 'ref', expires_in: 14400 });
    if (url.includes('/contatos?')) return json({ itens: [], paginacao: { total: 0 } });
    if (url.endsWith('/contatos') && init.method === 'POST') return json({ id: 77 });
    if (url.endsWith('/pedidos') && init.method === 'POST') { orderSent = JSON.parse(init.body); return json({ id: 1, numeroPedido: '9' }); }
    return json({ itens: [] });
  });
  const admin = await loginAs('admin', 'senha-admin');
  await connectOlist(call, admin);
  assert.equal((await call('/api/cache', { method: 'PUT', cookie: admin, body: { catalog } })).status, 200);
  repo.tables.customers.push({ id: 'cust-1', tenant_id: TENANT, cnpj: '11222333000181', legal_name: 'CLIENTE LTDA', active: true });
  repo.tables.app_users.push({ id: 'buyer-1', tenant_id: TENANT, customer_id: 'cust-1', name: 'Comprador', username: 'comprador', password_hash: await hashPassword('senha-buyer'), role: 'buyer', active: true });
  repo.tables.customers.push({ id: 'cust-2', tenant_id: TENANT, cnpj: '99888777000166', legal_name: 'OUTRO LTDA', active: true });
  repo.tables.app_users.push({ id: 'buyer-2', tenant_id: TENANT, customer_id: 'cust-2', name: 'Outro', username: 'outro', password_hash: await hashPassword('senha-outro'), role: 'buyer', active: true });
  const buyer = await loginAs('comprador', 'senha-buyer');

  const key = '35251012345678000190550010000012341000012345';
  const order = await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 4, quantity: 2 }], source: 'xml', nfe: { key, number: '1234' } } });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.ok(orderSent, JSON.stringify(order.data));
  assert.match(orderSent.observacoesInternas, /NF-e 1234 \(chave 35251012345678000190550010000012341000012345\)/);

  const raw = (cookie, type, body, name, path = `/api/orders/${order.data.id}/files`) => call(path, { method: 'POST', cookie, headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, raw: body });
  assert.equal((await raw(buyer, 'image/png', Buffer.from('x'), 'a.png')).status, 415);
  assert.equal((await raw(buyer, 'application/pdf', Buffer.from('not a pdf'), 'a.pdf')).status, 400);
  const xml = await raw(buyer, 'application/xml', Buffer.from('<?xml version="1.0"?><nfeProc/>'), 'NF 1234.xml');
  assert.equal(xml.status, 201, JSON.stringify(xml.data));
  const pdf = await raw(buyer, 'application/pdf', Buffer.from('%PDF-1.4 boleto'), 'boleto/../x.pdf');
  assert.equal(pdf.status, 201);
  assert.equal(pdf.data.name, 'boleto_.._x.pdf');
  const other = await loginAs('outro', 'senha-outro');
  assert.equal((await raw(other, 'application/pdf', Buffer.from('%PDF-1.4'), 'x.pdf')).status, 404);

  const detail = (await call(`/api/orders/${order.data.id}`, { cookie: admin })).data;
  assert.equal(detail.source, 'xml'); assert.equal(detail.nfeNumber, '1234'); assert.equal(detail.nfeKey, key);
  assert.deepEqual(detail.files.map(f => f.kind), ['xml', 'pdf']);
  const download = await call(`/api/orders/${order.data.id}/files/${pdf.data.id}`, { cookie: admin });
  assert.equal(download.status, 200); assert.equal(download.data, '%PDF-1.4 boleto');
  assert.match(download.headers['content-disposition'], /^attachment; filename\*=UTF-8''boleto_.._x.pdf$/);
  assert.equal((await call(`/api/orders/${order.data.id}/files/${pdf.data.id}`, { cookie: other })).status, 404);

  // New-order alerts: the first check starts counting from now; a new order shows up until the admin marks orders as seen.
  assert.equal((await call('/api/orders/unseen', { cookie: buyer })).status, 403);
  assert.equal((await call('/api/orders/unseen', { cookie: admin })).data.count, 0);
  const second = await call('/api/orders', { method: 'POST', cookie: buyer, body: { items: [{ id: 4, quantity: 1 }] } });
  const unseen = (await call('/api/orders/unseen', { cookie: admin })).data;
  assert.equal(unseen.count, 1); assert.equal(unseen.orders[0].id, second.data.id); assert.equal(unseen.orders[0].customer, 'CLIENTE LTDA');
  assert.equal((await call('/api/orders/seen', { method: 'POST', cookie: admin, body: {} })).status, 200);
  assert.equal((await call('/api/orders/unseen', { cookie: admin })).data.count, 0);

  // Push: only admins subscribe; the VAPID key is created once and stored sealed.
  assert.equal((await call('/api/push', { cookie: buyer })).status, 403);
  const keyA = (await call('/api/push', { cookie: admin })).data.publicKey;
  assert.ok(keyA.length > 60); assert.equal((await call('/api/push', { cookie: admin })).data.publicKey, keyA);
  assert.ok(!repo.tables.app_secrets[0].value.includes(keyA));
  assert.equal((await call('/api/push', { method: 'POST', cookie: admin, body: { endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } } })).status, 400);
  const sub = { endpoint: 'https://push.example.com/send/abcdefghij', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
  assert.equal((await call('/api/push', { method: 'POST', cookie: admin, body: sub })).status, 200);
  assert.equal((await call('/api/push', { cookie: admin })).data.devices, 1);
  const del = await call('/api/push', { method: 'DELETE', cookie: admin, body: { endpoint: sub.endpoint } }); assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(repo.tables.push_subscriptions.length, 0);
});
