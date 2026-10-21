import { hashPassword } from './db.mjs';

// ── Catalog mapping between the app (Olist-shaped objects) and olist_products rows ──
const num = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function rowsFromCatalog(catalog, tenantId) {
  const now = new Date().toISOString();
  const parentOf = new Map(), stock = new Map(catalog.stock || []), grade = new Map(catalog.grade || []), done = new Set(catalog.variationsDone || []);
  for (const [pid, kids] of catalog.children || []) for (const kid of kids || []) parentOf.set(kid, pid);
  return catalog.products.filter(p => Number.isSafeInteger(Number(p?.id))).map(p => {
    const s = stock.get(p.id);
    return {
      tenant_id: tenantId, id: Number(p.id), parent_id: parentOf.get(p.id) ?? null,
      sku: p.sku ?? null, description: String(p.descricao ?? ''), situation: p.situacao ?? null, type: p.tipo ?? null, variation_type: p.tipoVariacao ?? null,
      grade: grade.get(p.id) ?? null, unit: p.unidade ?? null, gtin: p.gtin ?? null,
      price: num(p.precos?.preco), promo_price: num(p.precos?.precoPromocional), cost_price: num(p.precos?.precoCusto), avg_cost_price: num(p.precos?.precoCustoMedio),
      location: p.estoque?.localizacao ?? null, olist_updated_at: p.dataAlteracao ?? null,
      stock_balance: num(s?.saldo), stock_reserved: num(s?.reservado), stock_available: num(s?.disponivel), stock_updated_at: s ? now : null,
      variations_loaded: done.has(p.id), in_catalog: true, synced_at: now
    };
  });
}
export function catalogFromRows(rows, tenant) {
  const products = [], stock = [], grade = [], children = new Map(), settings = [], done = [];
  for (const r of rows) {
    products.push({ id: Number(r.id), sku: r.sku, descricao: r.description, situacao: r.situation, tipo: r.type, tipoVariacao: r.variation_type, unidade: r.unit, gtin: r.gtin, dataAlteracao: r.olist_updated_at, precos: { preco: num(r.price), precoPromocional: num(r.promo_price), precoCusto: num(r.cost_price), precoCustoMedio: num(r.avg_cost_price) }, estoque: { localizacao: r.location } });
    if (r.stock_updated_at || r.stock_available != null) stock.push([Number(r.id), { saldo: num(r.stock_balance), reservado: num(r.stock_reserved), disponivel: num(r.stock_available) }]);
    if (r.grade) grade.push([Number(r.id), r.grade]);
    if (r.parent_id != null) { const pid = Number(r.parent_id); if (!children.has(pid)) children.set(pid, []); children.get(pid).push(Number(r.id)); }
    if (r.variations_loaded || children.has(Number(r.id))) done.push(Number(r.id));
    settings.push([Number(r.id), { visible: r.visible !== false, margin: r.margin_percent == null ? null : Number(r.margin_percent) }]);
  }
  for (const pid of children.keys()) if (!done.includes(pid)) done.push(pid);
  return { v: 1, syncedAt: tenant?.catalog_synced_at || null, savedAt: tenant?.catalog_saved_at || null, stockComplete: true, products, stock, grade, children: [...children], variationsDone: done, settings, defaultMargin: Number(tenant?.default_margin || 0) };
}

// Buyer price: cost (or average cost when cost is empty) plus the product margin (or the tenant default).
export function buyerPrice(row, defaultMargin) {
  const cost = num(row.cost_price) > 0 ? num(row.cost_price) : num(row.avg_cost_price) > 0 ? num(row.avg_cost_price) : null;
  if (cost == null) return null;
  const margin = row.margin_percent == null ? Number(defaultMargin || 0) : Number(row.margin_percent);
  return Math.round(cost * (1 + margin / 100) * 100) / 100;
}

const digits = value => String(value ?? '').replace(/\D/g, '');
const formatCnpj = cnpj => cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const text = (value, max = 200) => value == null ? null : String(value).trim().slice(0, max) || null;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export function bmsRoutes({ repo, send, readJson, fault, olist, tenantSession, fetcher, origin }) {
  const requireAdmin = who => { if (who.role !== 'admin') throw fault(403, 'Acesso restrito ao administrador.'); };
  const sameOrigin = req => { if (req.headers.origin && req.headers.origin !== origin) throw fault(403, 'Origem inválida.'); };

  async function lookupCnpj(cnpj) {
    if (cnpj.length !== 14) throw fault(400, 'Informe um CNPJ com 14 dígitos.');
    let response;
    try { response = await fetcher(`https://open.cnpja.com/office/${cnpj}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }); }
    catch { throw fault(502, 'Não foi possível consultar o CNPJ agora. Tente novamente.'); }
    if (response.status === 429) throw fault(429, 'Limite de consultas de CNPJ atingido. Aguarde alguns segundos.', { retryAfter: 20 });
    if (!response.ok) throw fault(404, `CNPJ não encontrado (${response.status}).`);
    const data = await response.json();
    const address = data.address || {};
    const phone = (data.phones || [])[0];
    const result = {
      cnpj, legal_name: data.company?.name || '', trade_name: data.alias || '',
      email: (data.emails || []).map(e => typeof e === 'string' ? e : e.address).filter(Boolean)[0] || '',
      phone: phone ? `${phone.area || ''}${phone.number || ''}` : '',
      address: { endereco: address.street || '', numero: address.number || '', complemento: address.details || '', bairro: address.district || '', municipio: address.city || '', uf: address.state || '', cep: address.zip || '' },
      registry: { status: data.status?.text || '', founded: data.founded || '', headquarters: data.head === false ? 'Filial' : 'Matriz', activity: data.mainActivity ? `${data.mainActivity.id} — ${data.mainActivity.text}` : '' },
      state_registrations: []
    };
    // State registrations (IE) from CNPJ.ws; optional, failure does not block.
    try {
      const ie = await fetcher(`https://publica.cnpj.ws/cnpj/${cnpj}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (ie.ok) {
        const body = await ie.json();
        result.state_registrations = (body?.estabelecimento?.inscricoes_estaduais || []).filter(i => i?.inscricao_estadual && i.ativo !== false).map(i => ({ uf: String(i.estado?.sigla || '').toUpperCase(), ie: String(i.inscricao_estadual).trim() })).filter(i => i.uf);
      }
    } catch {}
    return result;
  }

  async function sendOrderToOlist(tenantId, orderId) {
    const order = await repo.getOrder(tenantId, orderId);
    if (!order) throw fault(404, 'Pedido não encontrado.');
    try {
      const session = await tenantSession(tenantId);
      if (!session.tokens) throw fault(401, 'A conta Olist da empresa não está conectada.');
      const customer = order.customers;
      let contactId = customer.olist_contact_id;
      if (!contactId) {
        for (const query of [customer.cnpj, formatCnpj(customer.cnpj)]) {
          const found = await olist(session, `/contatos?${new URLSearchParams({ cpfCnpj: query, limit: 5 })}`, '/contatos', d => Array.isArray(d.itens));
          contactId = found.itens.find(c => digits(c.cpfCnpj) === customer.cnpj)?.id;
          if (contactId) break;
        }
        if (!contactId) {
          const a = customer.address || {};
          const ie = (customer.state_registrations || []).find(r => r.uf === a.uf)?.ie || '';
          const created = await olist(session, '/contatos', 'o cadastro do contato', d => d && d.id, { method: 'POST', body: {
            nome: customer.legal_name, fantasia: customer.trade_name || undefined, tipoPessoa: 'J', cpfCnpj: formatCnpj(customer.cnpj), inscricaoEstadual: ie || undefined,
            email: customer.email || undefined, telefone: customer.phone || undefined, situacao: 'B',
            endereco: { endereco: a.endereco || '', numero: a.numero || '', complemento: a.complemento || '', bairro: a.bairro || '', municipio: a.municipio || '', cep: a.cep || '', uf: a.uf || '', pais: 'Brasil' }
          } });
          contactId = created.id;
        }
        await repo.updateCustomer(tenantId, customer.id, { olist_contact_id: contactId });
      }
      const created = await olist(session, '/pedidos', 'o pedido', d => d && d.id, { method: 'POST', body: {
        data: today(), idContato: Number(contactId), situacao: 0, numeroOrdemCompra: `DMX-${order.number}`,
        observacoes: order.notes || undefined, observacoesInternas: `Pedido DRIVE MAXX #${order.number} — comprador: ${order.app_users?.name || ''}`,
        itens: order.order_items.map(i => ({ produto: { id: Number(i.product_id), tipo: 'P' }, quantidade: Number(i.quantity), valorUnitario: Number(i.unit_price) }))
      } });
      return repo.updateOrder(tenantId, orderId, { status: 'enviado_olist', olist_order_id: created.id, olist_order_number: created.numeroPedido == null ? null : String(created.numeroPedido), olist_error: null, olist_synced_at: new Date().toISOString() });
    } catch (error) {
      console.warn('[pedido] olist', order.number, error.message);
      return repo.updateOrder(tenantId, orderId, { status: 'erro_olist', olist_error: String(error.message || 'Falha ao enviar para a Olist.').slice(0, 500) });
    }
  }

  return {
    async applyStockWebhook(tenantId, items) {
      const latest = new Map(items.map(i => [Number(i.id), i.saldo]));
      const rows = await repo.productsByIds(tenantId, [...latest.keys()]);
      const now = new Date().toISOString();
      for (const row of rows) {
        const saldo = num(latest.get(Number(row.id)));
        if (saldo == null) continue;
        await repo.updateProducts(tenantId, [Number(row.id)], { stock_balance: saldo, stock_available: saldo - (num(row.stock_reserved) || 0), stock_updated_at: now });
      }
    },
    async handle(req, res, url, who) {
      const path = url.pathname, method = req.method, tenantId = who.tenantId;
      if (!tenantId) return false;

      // Buyer catalog: visible, active products with cost + margin price. No cost or internal data.
      if (method === 'GET' && path === '/api/catalog') {
        const [tenant, rows] = await Promise.all([repo.getTenant(tenantId), repo.listProducts(tenantId)]);
        const byId = new Map(rows.map(r => [Number(r.id), r]));
        const shown = rows.filter(r => r.visible !== false && r.situation === 'A' && (r.parent_id == null || byId.get(Number(r.parent_id))?.visible !== false));
        const children = new Map();
        shown.forEach(r => { if (r.parent_id != null && byId.has(Number(r.parent_id))) { const pid = Number(r.parent_id); if (!children.has(pid)) children.set(pid, []); children.get(pid).push(Number(r.id)); } });
        const products = shown.map(r => ({ id: Number(r.id), sku: r.sku, descricao: r.description, situacao: r.situation, tipo: r.type, tipoVariacao: r.variation_type, unidade: r.unit, gtin: r.gtin, precoComprador: buyerPrice(r, tenant?.default_margin) }));
        const stock = shown.filter(r => r.stock_available != null).map(r => [Number(r.id), { disponivel: num(r.stock_available) }]);
        return send(res, 200, { products, stock, children: [...children], grade: shown.filter(r => r.grade).map(r => [Number(r.id), r.grade]), savedAt: tenant?.catalog_saved_at }), true;
      }

      // Product settings (admin): visibility for buyers and margin.
      if (method === 'PATCH' && path === '/api/products/settings') {
        requireAdmin(who); sameOrigin(req);
        const body = await readJson(req, 64 * 1024);
        const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number).filter(n => Number.isSafeInteger(n) && n > 0))] : [];
        if (!ids.length || ids.length > 5000) throw fault(400, 'Selecione os produtos.');
        const patch = {};
        if (typeof body.visible === 'boolean') patch.visible = body.visible;
        if ('margin' in body) {
          if (body.margin === null || body.margin === '') patch.margin_percent = null;
          else { const m = Number(body.margin); if (!Number.isFinite(m) || m < -100 || m > 10000) throw fault(400, 'Margem inválida.'); patch.margin_percent = Math.round(m * 100) / 100; }
        }
        if (!Object.keys(patch).length) throw fault(400, 'Nada para alterar.');
        await repo.updateProducts(tenantId, ids, patch);
        return send(res, 200, { ok: true, updated: ids.length }), true;
      }
      if (method === 'PATCH' && path === '/api/tenant') {
        requireAdmin(who); sameOrigin(req);
        const body = await readJson(req);
        const m = Number(body.defaultMargin);
        if (!Number.isFinite(m) || m < -100 || m > 10000) throw fault(400, 'Margem inválida.');
        await repo.updateTenant(tenantId, { default_margin: Math.round(m * 100) / 100 });
        return send(res, 200, { ok: true }), true;
      }

      // Users and customers (admin).
      if (method === 'GET' && path.startsWith('/api/cnpj/')) {
        requireAdmin(who);
        return send(res, 200, await lookupCnpj(digits(path.slice('/api/cnpj/'.length)))), true;
      }
      if (method === 'GET' && path === '/api/customers') { requireAdmin(who); return send(res, 200, await repo.listCustomers(tenantId)), true; }
      if (method === 'GET' && path === '/api/users') { requireAdmin(who); return send(res, 200, await repo.listUsers(tenantId)), true; }
      if (method === 'POST' && path === '/api/users') {
        requireAdmin(who); sameOrigin(req);
        const body = await readJson(req, 32 * 1024);
        const username = String(body.username || '').trim().toLowerCase(), name = text(body.name, 120), role = body.role === 'admin' ? 'admin' : 'buyer';
        if (!name) throw fault(400, 'Informe o nome.');
        if (!/^[a-z0-9._@-]{3,80}$/.test(username)) throw fault(400, 'Usuário inválido: use de 3 a 80 caracteres (letras, números, ponto, hífen, @).');
        if (String(body.password || '').length < 8) throw fault(400, 'A senha precisa ter pelo menos 8 caracteres.');
        let customerId = null;
        if (role === 'buyer') {
          if (body.customerId) { const c = await repo.getCustomer(tenantId, String(body.customerId)); if (!c) throw fault(400, 'Cliente não encontrado.'); customerId = c.id; }
          else {
            const c = body.customer || {}, cnpj = digits(c.cnpj);
            if (cnpj.length !== 14) throw fault(400, 'Informe o CNPJ do cliente.');
            if (!text(c.legal_name)) throw fault(400, 'Busque o CNPJ para preencher a razão social.');
            const address = c.address && typeof c.address === 'object' ? Object.fromEntries(['endereco', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep'].map(k => [k, text(c.address[k], 120) || ''])) : null;
            const customer = await repo.upsertCustomer({ tenant_id: tenantId, cnpj, legal_name: text(c.legal_name), trade_name: text(c.trade_name), email: text(c.email, 160), phone: text(c.phone, 40), address, state_registrations: Array.isArray(c.state_registrations) ? c.state_registrations.slice(0, 30).map(r => ({ uf: text(r.uf, 2), ie: text(r.ie, 30) })) : null, registry: c.registry && typeof c.registry === 'object' ? c.registry : null });
            customerId = customer.id;
          }
        }
        const user = await repo.createUser({ tenant_id: tenantId, customer_id: customerId, name, username, email: text(body.email, 160), password_hash: await hashPassword(body.password), role });
        const { password_hash, ...safe } = user;
        return send(res, 201, safe), true;
      }
      const userMatch = path.match(/^\/api\/users\/([\w-]+)$/);
      if (method === 'PATCH' && userMatch) {
        requireAdmin(who); sameOrigin(req);
        const body = await readJson(req);
        const patch = {};
        if (typeof body.active === 'boolean') { if (userMatch[1] === who.id && !body.active) throw fault(400, 'Você não pode desativar o próprio usuário.'); patch.active = body.active; }
        if (body.name) patch.name = text(body.name, 120);
        if ('email' in body) patch.email = text(body.email, 160);
        if (body.password) { if (String(body.password).length < 8) throw fault(400, 'A senha precisa ter pelo menos 8 caracteres.'); patch.password_hash = await hashPassword(body.password); }
        if (!Object.keys(patch).length) throw fault(400, 'Nada para alterar.');
        const user = await repo.updateUser(tenantId, userMatch[1], patch);
        if (!user) throw fault(404, 'Usuário não encontrado.');
        return send(res, 200, { ok: true }), true;
      }

      // Orders.
      if (method === 'GET' && path === '/api/orders') {
        const rows = await repo.listOrders(tenantId, who.role === 'admin' ? {} : { customerId: who.customerId || '00000000-0000-0000-0000-000000000000' });
        return send(res, 200, rows.map(o => ({ id: o.id, number: o.number, status: o.status, total: num(o.total), notes: o.notes, createdAt: o.created_at, olistOrderNumber: o.olist_order_number, olistError: o.olist_error, customer: o.customers, buyer: o.app_users, items: Array.isArray(o.order_items) ? o.order_items.length : null }))), true;
      }
      const orderMatch = path.match(/^\/api\/orders\/([\w-]+)$/);
      if (method === 'GET' && orderMatch) {
        const order = await repo.getOrder(tenantId, orderMatch[1]);
        if (!order || (who.role !== 'admin' && order.customer_id !== who.customerId)) throw fault(404, 'Pedido não encontrado.');
        return send(res, 200, { id: order.id, number: order.number, status: order.status, total: num(order.total), notes: order.notes, createdAt: order.created_at, olistOrderNumber: order.olist_order_number, olistError: order.olist_error, customer: { cnpj: order.customers?.cnpj, legal_name: order.customers?.legal_name, trade_name: order.customers?.trade_name }, buyer: order.app_users, items: (order.order_items || []).map(i => ({ productId: Number(i.product_id), sku: i.sku, description: i.description, quantity: num(i.quantity), unitPrice: num(i.unit_price), total: num(i.total) })) }), true;
      }
      if (method === 'POST' && path === '/api/orders') {
        sameOrigin(req);
        if (who.role !== 'buyer' || !who.customerId) throw fault(403, 'Somente usuários compradores fazem pedidos.');
        const body = await readJson(req, 64 * 1024);
        const wanted = new Map();
        for (const item of Array.isArray(body.items) ? body.items : []) {
          const pid = Number(item?.id), qty = Number(item?.quantity);
          if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(qty) || qty <= 0 || qty > 100000) throw fault(400, 'Quantidade inválida.');
          wanted.set(pid, (wanted.get(pid) || 0) + qty);
        }
        if (!wanted.size || wanted.size > 300) throw fault(400, 'Selecione de 1 a 300 produtos.');
        const [tenant, customer, rows, all] = await Promise.all([repo.getTenant(tenantId), repo.getCustomer(tenantId, who.customerId), repo.productsByIds(tenantId, [...wanted.keys()]), repo.listProducts(tenantId)]);
        if (!customer?.active) throw fault(403, 'Cliente inativo. Fale com o fornecedor.');
        const byId = new Map(all.map(r => [Number(r.id), r]));
        const parents = new Set(all.filter(r => r.parent_id != null).map(r => Number(r.parent_id)));
        const items = [];
        for (const [pid, qty] of wanted) {
          const row = rows.find(r => Number(r.id) === pid);
          const parent = row?.parent_id != null ? byId.get(Number(row.parent_id)) : null;
          if (!row || !row.in_catalog || row.visible === false || row.situation !== 'A' || parent?.visible === false) throw fault(400, `Produto ${pid} indisponível.`);
          if (parents.has(pid)) throw fault(400, `Escolha as variações de "${row.description}".`);
          const price = buyerPrice(row, tenant?.default_margin);
          if (!price) throw fault(400, `"${row.description}" está sem preço definido.`);
          items.push({ tenant_id: tenantId, product_id: pid, sku: row.sku, description: row.description, quantity: qty, unit_price: price, total: Math.round(price * qty * 100) / 100 });
        }
        const total = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
        const order = await repo.createOrder({ tenant_id: tenantId, customer_id: customer.id, user_id: who.id, status: 'novo', total, notes: text(body.notes, 1000) }, items);
        const sent = await sendOrderToOlist(tenantId, order.id);
        return send(res, 201, { id: order.id, number: order.number, total, status: sent?.status || order.status, olistOrderNumber: sent?.olist_order_number || null, olistError: sent?.olist_error || null }), true;
      }
      const resendMatch = path.match(/^\/api\/orders\/([\w-]+)\/resend$/);
      if (method === 'POST' && resendMatch) {
        requireAdmin(who); sameOrigin(req);
        const order = await repo.getOrder(tenantId, resendMatch[1]);
        if (!order) throw fault(404, 'Pedido não encontrado.');
        if (order.status === 'enviado_olist') throw fault(400, 'Pedido já enviado para a Olist.');
        const sent = await sendOrderToOlist(tenantId, order.id);
        return send(res, 200, { status: sent?.status, olistOrderNumber: sent?.olist_order_number || null, olistError: sent?.olist_error || null }), true;
      }
      return false;
    }
  };
}
