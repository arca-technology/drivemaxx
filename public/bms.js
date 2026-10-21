// DRIVE MAXX modules: roles, product settings, buyer bag, orders and users.
// Loaded after app.js and reuses its helpers ($, state, api, render, icon, escape, money, qty, notice...).
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patchJson = body => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const cnpjMask = value => String(value || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
document.querySelectorAll('[data-icon]').forEach(el => { if (!el.innerHTML) el.innerHTML = icon(el.dataset.icon); });

// ── Roles ────────────────────────────────────────────────────
function applyRole(me) {
  const admin = me.role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !admin || (el.hasAttribute('data-database-only') && !me.database); });
  document.querySelector('[data-view="orders"]').hidden = !me.database;
  document.querySelector('[data-view="users"]').hidden = !(me.database && admin);
  $('orders-tab-label').textContent = admin ? 'PEDIDOS' : 'MEUS PEDIDOS';
  document.body.classList.toggle('role-buyer', !admin);
  $('default-margin').value = String(state.defaultMargin);
  if (!admin) {
    ['refresh', 'import', 'connect', 'connect-hint', 'setup'].forEach(id => { $(id).hidden = true; });
    $('search').placeholder = 'Buscar por nome, SKU ou GTIN...';
  }
}
async function initBuyer() {
  try {
    const data = await api('/api/catalog');
    resetCatalog();
    for (const p of data.products) { state.byId.set(p.id, p); state.products.push(p); }
    state.stock = new Map(data.stock || []);
    state.children = new Map(data.children || []);
    state.children.forEach((kids, pid) => kids.forEach(k => state.parentOf.set(k, pid)));
    state.grade = new Map(data.grade || []);
    state.variationsDone = new Set(state.children.keys());
    state.products.forEach(p => state.stockDone.add(p.id));
    state.stockComplete = true; state.complete = true; state.authenticated = true; state.total = state.products.length;
    $('footer-label').textContent = `${number(state.products.length)} produtos disponíveis${data.savedAt ? ` · atualizado em ${dateTime(data.savedAt)}` : ''}`;
    document.querySelector('.footer-status').classList.add('ready');
    render();
  } catch (error) { notice(error.message, true); }
}
function afterRender() {
  const buyer = state.role === 'buyer';
  $('bag').hidden = !buyer;
  if (buyer) {
    const items = bagProducts();
    $('bag').disabled = !items.length;
    $('bag-count').textContent = number(items.length);
    $('import').hidden = $('refresh').hidden = true;
    $('enrich-label').textContent = '';
  }
  $('admin-bulk').hidden = !(state.role === 'admin' && state.database && state.selected.size > 0);
}

// ── Admin: product visibility and margin ─────────────────────
async function saveSettings(ids, patch) {
  try {
    await api('/api/products/settings', patchJson({ ids, ...patch }));
    for (const id of ids) {
      const current = state.settings.get(id) || { visible: true, margin: null };
      state.settings.set(id, { ...current, ...('visible' in patch ? { visible: patch.visible } : {}), ...('margin' in patch ? { margin: patch.margin === null || patch.margin === '' ? null : Number(patch.margin) } : {}) });
    }
    render();
  } catch (error) { notice(error.message, true); render(); }
}
$('rows').addEventListener('click', event => {
  const toggle = event.target.closest('[data-visible]');
  if (!toggle) return;
  const id = Number(toggle.dataset.visible);
  saveSettings([id], { visible: !(state.settings.get(id)?.visible ?? true) });
});
$('rows').addEventListener('change', event => {
  const input = event.target.closest('[data-margin]');
  if (!input) return;
  saveSettings([Number(input.dataset.margin)], { margin: input.value === '' ? null : Number(input.value) });
});
$('rows').addEventListener('keydown', event => { if (event.target.matches('[data-margin]') && event.key === 'Enter') event.target.blur(); });
$('bulk-hide').onclick = () => saveSettings([...state.selected], { visible: false });
$('bulk-show').onclick = () => saveSettings([...state.selected], { visible: true });
$('bulk-margin').onclick = () => {
  const pop = openPopover($('bulk-margin'), `<div class="popover-head"><b>MARGEM PARA ${number(state.selected.size)} PRODUTOS</b></div><div class="popover-row"><input id="bulk-margin-value" type="number" step="0.01" placeholder="% sobre o custo (vazio = padrão)"></div><div class="popover-actions"><button id="bulk-margin-clear" class="pop-btn" type="button">Usar padrão</button><button id="bulk-margin-apply" class="pop-btn primary-btn" type="button">Aplicar</button></div>`, 280);
  const input = pop.querySelector('#bulk-margin-value');
  const apply = value => { closePopover(); saveSettings([...state.selected], { margin: value }); };
  pop.querySelector('#bulk-margin-apply').onclick = () => apply(input.value === '' ? null : Number(input.value));
  pop.querySelector('#bulk-margin-clear').onclick = () => apply(null);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') apply(input.value === '' ? null : Number(input.value)); });
  setTimeout(() => input.focus(), 20);
};
$('default-margin').addEventListener('change', async () => {
  const value = Number($('default-margin').value);
  try { await api('/api/tenant', patchJson({ defaultMargin: value })); state.defaultMargin = value; render(); }
  catch (error) { notice(error.message, true); $('default-margin').value = String(state.defaultMargin); }
});

// ── Buyer: bag and order creation ────────────────────────────
function bagProducts() { return [...state.selected].map(id => state.byId.get(id)).filter(p => p && !kidsOf(p.id).length); }
function bagTotal() {
  return [...$('bag-rows').querySelectorAll('tr[data-id]')].reduce((sum, tr) => {
    const p = state.byId.get(Number(tr.dataset.id)), q = Number(tr.querySelector('input').value) || 0;
    const line = (p.precoComprador || 0) * q;
    tr.querySelector('.line-total').textContent = money(line);
    return sum + line;
  }, 0);
}
$('bag').onclick = () => {
  const items = bagProducts();
  if (!items.length) return;
  $('bag-rows').innerHTML = items.map(p => {
    const stock = stockOf(p), priced = p.precoComprador != null;
    return `<tr data-id="${p.id}"><td><b>${escape(p.descricao)}</b><small>${escape(state.grade.get(p.id) || p.sku || '')}</small></td><td class="numeric">${qty(stock)}</td><td class="numeric">${priced ? money(p.precoComprador) : '<span class="stock-out">sem preço</span>'}</td><td class="numeric"><input class="qty-input" type="number" min="1" step="1" value="1" aria-label="Quantidade de ${escape(p.descricao)}"${priced ? '' : ' disabled'}></td><td class="numeric line-total">—</td></tr>`;
  }).join('');
  $('bag-notes').value = ''; $('bag-error').hidden = true;
  $('bag-save').disabled = items.some(p => p.precoComprador == null);
  if ($('bag-save').disabled) { $('bag-error').textContent = 'Há produtos sem preço definido. Remova-os da seleção para fazer o pedido.'; $('bag-error').hidden = false; }
  $('bag-total').textContent = money(bagTotal());
  openDrawer($('bag-dialog'));
  $('bag-rows').querySelector('input:not([disabled])')?.focus();
};
$('bag-form').addEventListener('submit', event => event.preventDefault());
$('bag-rows').addEventListener('input', () => { $('bag-total').textContent = money(bagTotal()); });
$('bag-save').onclick = async () => {
  const items = [...$('bag-rows').querySelectorAll('tr[data-id]')].map(tr => ({ id: Number(tr.dataset.id), quantity: Number(tr.querySelector('input').value) }));
  if (items.some(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) { $('bag-error').textContent = 'Informe quantidades maiores que zero.'; $('bag-error').hidden = false; return; }
  $('bag-save').disabled = true; $('bag-save').textContent = 'Salvando…'; $('bag-error').hidden = true;
  try {
    const order = await api('/api/orders', json({ items, notes: $('bag-notes').value.trim() }));
    closeDrawer($('bag-dialog'));
    state.selected.clear(); render();
    notice(order.status === 'enviado_olist' ? `Pedido #${order.number} criado (Olist nº ${order.olistOrderNumber || '—'}). Total ${money(order.total)}.` : `Pedido #${order.number} salvo, mas não foi enviado à Olist: ${order.olistError || 'tente novamente mais tarde'}. O fornecedor foi avisado pelo painel.`, order.status !== 'enviado_olist');
  } catch (error) { $('bag-error').textContent = error.message; $('bag-error').hidden = false; }
  finally { $('bag-save').disabled = false; $('bag-save').textContent = 'Salvar pedido'; }
};

// ── Module tabs ──────────────────────────────────────────────
document.querySelectorAll('.page-tab[data-view]').forEach(tab => {
  tab.onclick = () => {
    const view = tab.dataset.view;
    document.querySelectorAll('.page-tab[data-view]').forEach(t => { t.classList.toggle('active', t === tab); t.toggleAttribute('aria-current', t === tab); });
    ['products', 'orders', 'users'].forEach(v => { $(`view-${v}`).hidden = v !== view; });
    if (view === 'orders') loadOrders();
    if (view === 'users') loadUsers();
  };
});
function moduleNotice(id, message, error = false) { $(id).hidden = !message; $(id).textContent = message || ''; $(id).classList.toggle('error', error); }

// ── Orders ───────────────────────────────────────────────────
let orders = [];
const ORDER_STATUS = { enviado_olist: ['ok', 'Enviado'], erro_olist: ['error', 'Erro'], novo: ['', 'Enviando'], cancelado: ['muted', 'Cancelado'] };
async function loadOrders() {
  moduleNotice('orders-notice', '');
  $('orders-refresh').classList.add('spinning');
  try { orders = await api('/api/orders'); renderOrders(); }
  catch (error) { moduleNotice('orders-notice', error.message, true); }
  finally { $('orders-refresh').classList.remove('spinning'); }
}
function renderOrders() {
  const needle = normalize($('orders-search').value.trim());
  const list = orders.filter(o => !needle || normalize(`${o.number} ${o.customer?.legal_name} ${o.customer?.trade_name} ${o.customer?.cnpj} ${o.buyer?.name} ${o.buyer?.username} ${o.olistOrderNumber}`).includes(needle));
  $('orders-count').textContent = number(orders.length);
  $('orders-rows').innerHTML = list.map(o => {
    const [kind, label] = ORDER_STATUS[o.status] || ['', o.status];
    return `<tr data-order="${o.id}"><td><b>#${o.number}</b></td><td>${dateTime(o.createdAt)}</td><td><b>${escape(o.customer?.trade_name || o.customer?.legal_name || '—')}</b><small>${escape(cnpjMask(o.customer?.cnpj))}</small></td><td>${escape(o.buyer?.name || '—')}<small>${escape(o.buyer?.username || '')}</small></td><td class="numeric">${o.items ?? '—'}</td><td class="numeric"><b>${money(o.total)}</b></td><td><span class="status-tag ${kind}" title="${escape(o.olistError || '')}">${label}${o.olistOrderNumber ? ` · nº ${escape(o.olistOrderNumber)}` : ''}</span></td><td class="numeric"><button class="integration-action" type="button" data-open-order="${o.id}">VER</button></td></tr>`;
  }).join('');
  $('orders-empty').hidden = list.length > 0;
  $('orders-empty').textContent = orders.length ? 'Nenhum pedido encontrado.' : 'Nenhum pedido ainda.';
  $('orders-footer').textContent = `${number(orders.length)} pedidos · ${money(orders.reduce((s, o) => s + (o.total || 0), 0))}`;
}
$('orders-search').oninput = renderOrders;
$('orders-refresh').onclick = loadOrders;
$('orders-rows').addEventListener('click', event => { const row = event.target.closest('[data-order]'); if (row) openOrder(row.dataset.order); });
let openedOrder = null;
async function openOrder(id) {
  try {
    const o = await api(`/api/orders/${id}`);
    openedOrder = o;
    const [kind, label] = ORDER_STATUS[o.status] || ['', o.status];
    $('order-title').textContent = `Pedido #${o.number}`;
    $('order-meta').innerHTML = `<div><span>Cliente</span><b>${escape(o.customer?.legal_name || '—')}</b><small>${escape(cnpjMask(o.customer?.cnpj))}</small></div><div><span>Comprador</span><b>${escape(o.buyer?.name || '—')}</b><small>${escape(o.buyer?.username || '')}</small></div><div><span>Data</span><b>${dateTime(o.createdAt)}</b></div><div><span>Olist</span><b><span class="status-tag ${kind}">${label}${o.olistOrderNumber ? ` · nº ${escape(o.olistOrderNumber)}` : ''}</span></b>${o.olistError ? `<small class="stock-out">${escape(o.olistError)}</small>` : ''}</div>${o.notes ? `<div class="wide"><span>Observações</span><b>${escape(o.notes)}</b></div>` : ''}`;
    $('order-items').innerHTML = o.items.map(i => `<tr><td>${escape(i.description)}</td><td class="mono">${escape(i.sku || '')}</td><td class="numeric">${qty(i.quantity)}</td><td class="numeric">${money(i.unitPrice)}</td><td class="numeric"><b>${money(i.total)}</b></td></tr>`).join('');
    $('order-total').textContent = money(o.total);
    $('order-resend').hidden = !(state.role === 'admin' && o.status !== 'enviado_olist' && o.status !== 'cancelado');
    openDrawer($('order-dialog'));
  } catch (error) { moduleNotice('orders-notice', error.message, true); }
}
$('order-resend').onclick = async () => {
  if (!openedOrder) return;
  $('order-resend').disabled = true; $('order-resend').textContent = 'Enviando…';
  try {
    const r = await api(`/api/orders/${openedOrder.id}/resend`, json({}));
    closeDrawer($('order-dialog')); await loadOrders();
    moduleNotice('orders-notice', r.status === 'enviado_olist' ? `Pedido #${openedOrder.number} enviado à Olist (nº ${r.olistOrderNumber || '—'}).` : `A Olist recusou novamente: ${r.olistError}`, r.status !== 'enviado_olist');
  } catch (error) { moduleNotice('orders-notice', error.message, true); }
  finally { $('order-resend').disabled = false; $('order-resend').textContent = 'Reenviar para a Olist'; }
};

// ── Users (admin) ────────────────────────────────────────────
let users = [], companyLookup = null;
async function loadUsers() {
  moduleNotice('users-notice', '');
  try { users = await api('/api/users'); renderUsers(); }
  catch (error) { moduleNotice('users-notice', error.message, true); }
}
function renderUsers() {
  const needle = normalize($('users-search').value.trim());
  const list = users.filter(u => !needle || normalize(`${u.name} ${u.username} ${u.email} ${u.customers?.legal_name} ${u.customers?.trade_name} ${u.customers?.cnpj}`).includes(needle));
  $('users-count').textContent = number(users.length);
  $('users-rows').innerHTML = list.map(u => `<tr><td><b>${escape(u.name)}</b><small>${escape(u.email || '')}</small></td><td class="mono">${escape(u.username)}</td><td><span class="status-tag ${u.role === 'admin' ? 'muted' : ''}">${u.role === 'admin' ? 'Administrador' : 'Comprador'}</span></td><td>${escape(u.customers?.trade_name || u.customers?.legal_name || '—')}</td><td class="mono">${escape(cnpjMask(u.customers?.cnpj) || '—')}</td><td>${dateTime(u.last_login_at)}</td><td><span class="status-tag ${u.active ? 'ok' : 'error'}">${u.active ? 'Ativo' : 'Desativado'}</span></td><td class="numeric actions"><button class="integration-action" type="button" data-user-password="${u.id}">SENHA</button><button class="integration-action ${u.active ? 'danger' : ''}" type="button" data-user-active="${u.id}" data-active="${u.active}">${u.active ? 'DESATIVAR' : 'ATIVAR'}</button></td></tr>`).join('');
  $('users-empty').hidden = list.length > 0;
}
$('users-search').oninput = renderUsers;
$('users-rows').addEventListener('click', async event => {
  const toggle = event.target.closest('[data-user-active]');
  if (toggle) {
    try { await api(`/api/users/${toggle.dataset.userActive}`, patchJson({ active: toggle.dataset.active !== 'true' })); await loadUsers(); }
    catch (error) { moduleNotice('users-notice', error.message, true); }
    return;
  }
  const pass = event.target.closest('[data-user-password]');
  if (!pass) return;
  const pop = openPopover(pass, `<div class="popover-head"><b>NOVA SENHA</b></div><div class="popover-row"><input id="new-password" type="password" minlength="8" placeholder="Mínimo de 8 caracteres" autocomplete="new-password"></div><div class="popover-actions"><button id="new-password-save" class="pop-btn primary-btn" type="button">Salvar</button></div>`, 260);
  const save = async () => {
    try { await api(`/api/users/${pass.dataset.userPassword}`, patchJson({ password: pop.querySelector('#new-password').value })); closePopover(); moduleNotice('users-notice', 'Senha alterada.'); }
    catch (error) { closePopover(); moduleNotice('users-notice', error.message, true); }
  };
  pop.querySelector('#new-password-save').onclick = save;
  pop.querySelector('#new-password').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  setTimeout(() => pop.querySelector('#new-password').focus(), 20);
});
function userFormError(message) { $('user-error').textContent = message || ''; $('user-error').hidden = !message; }
function syncUserRole() { $('user-customer').hidden = $('user-role').value !== 'buyer'; }
$('user-role').onchange = syncUserRole;
$('user-new').onclick = () => {
  $('user-form').reset(); companyLookup = null; $('user-company').hidden = true; userFormError(''); syncUserRole();
  openDrawer($('user-dialog')); $('user-cnpj').focus();
};
const closeUser = () => closeDrawer($('user-dialog'));
$('user-cancel').onclick = closeUser; $('user-cancel-x').onclick = closeUser;
$('user-cnpj').addEventListener('input', () => { const d = $('user-cnpj').value.replace(/\D/g, '').slice(0, 14); if (d.length === 14) $('user-cnpj').value = cnpjMask(d); });
$('user-cnpj').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('user-cnpj-search').click(); } });
$('user-cnpj-search').onclick = async () => {
  const cnpj = $('user-cnpj').value.replace(/\D/g, '');
  if (cnpj.length !== 14) return userFormError('Informe um CNPJ com 14 dígitos.');
  userFormError(''); $('user-cnpj-search').disabled = true;
  try {
    companyLookup = await api(`/api/cnpj/${cnpj}`);
    const a = companyLookup.address || {};
    $('user-company').innerHTML = `<b>${escape(companyLookup.legal_name)}</b>${companyLookup.trade_name ? `<span>${escape(companyLookup.trade_name)}</span>` : ''}<small>${escape([a.municipio, a.uf].filter(Boolean).join(' / '))}${companyLookup.registry?.status ? ` · ${escape(companyLookup.registry.status)}` : ''}${companyLookup.state_registrations?.length ? ` · IE ${escape(companyLookup.state_registrations.map(r => `${r.uf} ${r.ie}`).join(', '))}` : ''}</small>`;
    $('user-company').hidden = false;
    if (!$('user-email').value && companyLookup.email) $('user-email').value = companyLookup.email;
    if (!$('user-username').value && companyLookup.email) $('user-username').value = companyLookup.email.toLowerCase();
    $('user-name').focus();
  } catch (error) { companyLookup = null; $('user-company').hidden = true; userFormError(error.message); }
  finally { $('user-cnpj-search').disabled = false; }
};
$('user-form').addEventListener('submit', async event => {
  event.preventDefault();
  const role = $('user-role').value;
  if (role === 'buyer' && !companyLookup) return userFormError('Busque o CNPJ do cliente antes de criar o comprador.');
  $('user-save').disabled = true; userFormError('');
  try {
    await api('/api/users', json({ role, name: $('user-name').value.trim(), username: $('user-username').value.trim(), email: $('user-email').value.trim(), password: $('user-password').value, ...(role === 'buyer' ? { customer: companyLookup } : {}) }));
    closeUser(); await loadUsers(); moduleNotice('users-notice', 'Usuário criado.');
  } catch (error) { userFormError(error.message); }
  finally { $('user-save').disabled = false; }
});


// ── Right-side modals: every modal slides in like the drawers and closes with the same animation ──
document.querySelectorAll('dialog.modal').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (event.target.closest('button[value="cancel"]')) { event.preventDefault(); closeDrawer(dialog); }
  });
});
// Broken product images fall back to the box icon (no inline handlers under the CSP).
document.addEventListener('error', event => {
  const img = event.target;
  if (img.tagName !== 'IMG' || !img.closest('.thumb, .gallery-main, .gallery-thumbs')) return;
  const holder = img.parentElement; img.remove(); if (!holder.querySelector('svg')) holder.insertAdjacentHTML('beforeend', icon('box'));
}, true);

// ── Product detail (fed from Olist on open, saved to the database) ──
let detailId = null;
const fmtDim = (v, unit) => v ? `${qty(v)} ${unit}` : null;
function applyDetail(d) {
  const p = state.byId.get(d.id);
  if (p) {
    p.imagem = d.imagem || p.imagem || null;
    if (d.precos) { p.precos = { ...p.precos, ...d.precos }; p.custoFicha = d.precos.custoFicha; }
    if (state.role !== 'admin') p.precoComprador = d.precoComprador;
  }
  const kids = (d.detalhes?.variacoes || []).map(v => Number(v.id)).filter(id => state.byId.has(id));
  if (kids.length) {
    state.children.set(d.id, kids);
    kids.forEach(k => { state.parentOf.set(k, d.id); const kid = state.byId.get(k); if (kid && !kid.imagem) kid.imagem = d.imagem; });
    (d.detalhes.variacoes || []).forEach(v => { if (v.grade) state.grade.set(Number(v.id), v.grade); });
    state.variationsDone.add(d.id);
  }
  render();
}
function renderDetail(d, loading = false) {
  const p = state.byId.get(d.id) || {};
  const images = d.imagens?.length ? d.imagens : (d.imagem || p.imagem ? [d.imagem || p.imagem] : []);
  const det = d.detalhes || {};
  const dims = det.dimensoes || {};
  const kids = kidsOf(d.id).map(id => state.byId.get(id));
  const admin = state.role === 'admin';
  const stock = stockOf(p.id ? p : { id: d.id });
  const cells = [
    ['Preço comprador', d.precoComprador != null ? money(d.precoComprador) : 'Sem preço', 'highlight'],
    ['Estoque disponível', stock == null ? '—' : qty(stock)],
    ['Unidade', d.unidade || p.unidade || '—'],
    ...(admin && d.precos ? [['Preço de venda', money(d.precos.preco)], ['Custo', money(d.precos.precoCusto)], ['Custo médio', money(d.precos.precoCustoMedio)], ['Custo (ficha Olist)', money(d.precos.custoFicha)], ['Margem', d.margem == null ? `${qty(d.margemPadrao)}% (padrão)` : `${qty(d.margem)}%`], ['Visível ao comprador', d.visivel ? 'Sim' : 'Não']] : [])
  ];
  const info = [['Marca', det.marca], ['Categoria', det.categoria], ['NCM', det.ncm], ['Garantia', det.garantia], ['Dimensões (L × A × C)', [dims.largura, dims.altura, dims.comprimento].some(Boolean) ? `${qty(dims.largura || 0)} × ${qty(dims.altura || 0)} × ${qty(dims.comprimento || 0)} cm` : null], ['Peso bruto', fmtDim(dims.pesoBruto, 'kg')], ['Peso líquido', fmtDim(dims.pesoLiquido, 'kg')]].filter(([, v]) => v);
  $('product-body').innerHTML = `
    ${d.aviso ? `<div class="detail-warning">Não foi possível atualizar pela Olist agora: ${escape(d.aviso)}. Mostrando os dados salvos.</div>` : ''}
    <div class="gallery"><div class="gallery-main">${images[0] ? `<img src="${escape(images[0])}" alt="${escape(d.descricao || p.descricao || '')}" referrerpolicy="no-referrer">` : icon('box')}</div>
      ${images.length > 1 ? `<div class="gallery-thumbs">${images.map((u, i) => `<button type="button" class="${i ? '' : 'active'}" data-image="${escape(u)}"><img src="${escape(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}</div>
    <h3 class="detail-title">${escape(d.descricao || p.descricao || '')}</h3>
    <div class="detail-chips">${[d.sku || p.sku ? `SKU ${d.sku || p.sku}` : '', d.gtin || p.gtin ? `GTIN ${d.gtin || p.gtin}` : '', state.grade.get(d.id) || '', SITUATION[d.situacao || p.situacao] || ''].filter(Boolean).map(t => `<span>${escape(t)}</span>`).join('')}</div>
    ${loading ? '<div class="skeleton"></div><div class="skeleton"></div>' : `<div class="detail-grid">${cells.map(([l, v, cls]) => `<div class="${cls || ''}"><span>${l}</span><b>${escape(v)}</b></div>`).join('')}</div>`}
    ${det.complemento ? `<section class="detail-section"><h3>Descrição</h3><p>${escape(det.complemento)}</p></section>` : ''}
    ${info.length ? `<section class="detail-section"><h3>Informações</h3><dl class="detail-list">${info.map(([k, v]) => `<dt>${k}</dt><dd>${escape(v)}</dd>`).join('')}</dl></section>` : ''}
    ${kids.length ? `<section class="detail-section"><h3>Variações (${kids.length})</h3><dl class="detail-list">${kids.map(k => `<dt>${escape(state.grade.get(k.id) || k.sku || k.id)}</dt><dd>${qty(stockOf(k))} em estoque${state.role === 'buyer' && k.precoComprador != null ? ` · ${money(k.precoComprador)}` : ''}</dd>`).join('')}</dl></section>` : ''}`;
  $('product-updated').textContent = d.atualizadoEm ? `Atualizado da Olist em ${dateTime(d.atualizadoEm)}` : loading ? 'Buscando na Olist…' : '';
  $('product-add').hidden = state.role !== 'buyer';
  $('product-add').disabled = loading || (d.precoComprador == null && !kids.some(k => k.precoComprador != null));
}
async function openProduct(id, refresh = false) {
  detailId = id;
  const p = state.byId.get(id) || { id };
  renderDetail({ id, descricao: p.descricao, sku: p.sku, gtin: p.gtin, situacao: p.situacao, imagem: p.imagem, precoComprador: buyerPriceOf(p) }, true);
  openDrawer($('product-dialog'));
  try {
    const d = await api(`/api/products/${id}/detail${refresh ? '?refresh=1' : ''}`);
    if (detailId !== id) return;
    applyDetail(d); renderDetail(d);
  } catch (error) { if (detailId === id) $('product-body').insertAdjacentHTML('afterbegin', `<div class="detail-warning">${escape(error.message)}</div>`); }
}
$('rows').addEventListener('click', event => { const el = event.target.closest('[data-detail]'); if (el) openProduct(Number(el.dataset.detail)); });
$('product-body').addEventListener('click', event => {
  const thumb = event.target.closest('[data-image]');
  if (!thumb) return;
  $('product-body').querySelectorAll('[data-image]').forEach(b => b.classList.toggle('active', b === thumb));
  $('product-body').querySelector('.gallery-main').innerHTML = `<img src="${escape(thumb.dataset.image)}" alt="" referrerpolicy="no-referrer">`;
});
$('product-refresh').onclick = () => { if (detailId) openProduct(detailId, true); };
$('product-add').onclick = () => {
  const ids = kidsOf(detailId).length ? kidsOf(detailId) : [detailId];
  ids.forEach(id => state.selected.add(id));
  closeDrawer($('product-dialog')); render();
  notice(`${ids.length === 1 ? 'Produto adicionado' : `${ids.length} variações adicionadas`} à seleção. Clique em Sacola para informar as quantidades.`);
};
