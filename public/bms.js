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
  state.me = me;
  $('integrations').hidden = !admin && !me.database;
  $('olist-item').hidden = !admin;
  $('customer-olist-item').hidden = admin || !me.customer;
  $('settings-integrations-group').hidden = !admin && !me.customer;
  $('settings-help').hidden = !me.database;
  if (me.database) setTimeout(() => startOnboarding(me), 0);
  document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !admin || (el.hasAttribute('data-database-only') && !me.database); });
  document.querySelector('[data-view="orders"]').hidden = !me.database;
  document.querySelector('[data-view="users"]').hidden = !(me.database && admin);
  $('orders-tab-label').textContent = admin ? 'PEDIDOS' : 'MEUS PEDIDOS';
  document.body.classList.toggle('role-buyer', !admin);
  $('default-margin').value = String(state.defaultMargin);
  // Buyers see the price they pay as their sale price.
  COLUMNS.find(c => c.key === 'precoComprador').label = admin ? 'PREÇO COMPRADOR' : 'PREÇO DE VENDA';
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

// ── Product detail: full-screen panel (Analytrick style), fed from Olist on open and saved to the database ──
let detailId = null, detailData = null, leftTab = 'media';
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
function detailList() { const ids = allViewIds(); return ids.length ? ids : state.products.map(p => p.id); }
function renderDetail(d, loading = false) {
  detailData = d;
  const p = state.byId.get(d.id) || {};
  const det = d.detalhes || {};
  const admin = state.role === 'admin';
  const list = detailList(), pos = list.indexOf(d.id);
  $('product-pos').textContent = pos >= 0 ? `#${pos + 1}` : '';
  $('product-title').textContent = d.descricao || p.descricao || 'Produto';
  const kids = kidsOf(d.id).map(id => state.byId.get(id));
  $('product-meta').textContent = [kids.length ? `${kids.length} variações` : '', d.sku || p.sku, det.marca, det.categoria].filter(Boolean).join(' · ');
  $('product-prev').disabled = pos <= 0; $('product-next').disabled = pos < 0 || pos >= list.length - 1;
  $('product-warning').hidden = !d.aviso; $('product-warning').textContent = d.aviso ? `Não foi possível atualizar pela Olist agora: ${d.aviso}. Mostrando os dados salvos.` : '';
  $('product-updated').textContent = loading ? 'Buscando dados na Olist…' : d.atualizadoEm ? `Atualizado da Olist em ${dateTime(d.atualizadoEm)} · ← → navegam entre produtos` : '← → navegam entre produtos';
  // Left: media / description / attributes
  const images = d.imagens?.length ? d.imagens : (d.imagem || p.imagem ? [d.imagem || p.imagem] : []);
  const dims = det.dimensoes || {};
  const attrs = [['Marca', det.marca], ['Categoria', det.categoria], ['NCM', det.ncm], ['Origem', det.origem], ['Garantia', det.garantia], ['Unidade', d.unidade || p.unidade], ['GTIN / EAN', d.gtin || p.gtin], ['Largura', fmtDim(dims.largura, 'cm')], ['Altura', fmtDim(dims.altura, 'cm')], ['Comprimento', fmtDim(dims.comprimento, 'cm')], ['Peso bruto', fmtDim(dims.pesoBruto, 'kg')], ['Peso líquido', fmtDim(dims.pesoLiquido, 'kg')]].filter(([, v]) => v != null && v !== '');
  document.querySelectorAll('#product-dialog [data-left]').forEach(b => b.classList.toggle('active', b.dataset.left === leftTab));
  $('pd-left').innerHTML = leftTab === 'media'
    ? `<div class="pd-main">${images[0] ? `<img src="${escape(images[0])}" alt="${escape(d.descricao || '')}" referrerpolicy="no-referrer">` : `${icon('box')}<span>Sem imagem</span>`}</div>
       <div class="pd-thumbs">${Array.from({ length: 12 }, (_, i) => images[i] ? `<button type="button" class="${i ? '' : 'active'}" data-image="${escape(images[i])}"><b>${i + 1}</b><img src="${escape(images[i])}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>` : `<span class="empty">${i + 1}</span>`).join('')}</div>`
    : leftTab === 'desc'
      ? (det.complemento ? `<p class="pd-text">${escape(det.complemento)}</p>` : `<p class="pd-empty">${loading ? 'Carregando…' : 'Sem descrição na Olist.'}</p>`)
      : (attrs.length ? `<table class="pd-table">${attrs.map(([k, v]) => `<tr><th>${k}</th><td>${escape(v)}</td></tr>`).join('')}</table>` : `<p class="pd-empty">${loading ? 'Carregando…' : 'Sem atributos.'}</p>`);
  // Middle: data
  const stock = stockOf(p.id ? p : { id: d.id });
  // A parent is sold through its variations: show their price range and summed stock.
  const kidPrices = kids.map(k => buyerPriceOf(k)).filter(v => v != null);
  const priceLabel = kids.length ? (kidPrices.length ? (Math.min(...kidPrices) === Math.max(...kidPrices) ? money(kidPrices[0]) : `${money(Math.min(...kidPrices))} – ${money(Math.max(...kidPrices))}`) : 'Sem preço') : d.precoComprador != null ? money(d.precoComprador) : 'Sem preço';
  const own = (field, fallback) => kids.length ? qty(stockOf(p, field)) : qty(fallback ?? stockOf(p, field));
  const rows = [
    [`${admin ? 'Preço comprador' : 'Preço de venda'}${kids.length ? ' (variações)' : ''}`, priceLabel, 'accent'],
    ['Estoque disponível', stock == null ? '—' : qty(stock), stock != null && stock <= 0 ? 'danger' : ''],
    ...(admin ? [
      ['Saldo em estoque', own('saldo', d.estoque?.saldo)], ['Reservado', own('reservado', d.estoque?.reservado)],
      ['Preço de venda', money(d.precos?.preco ?? p.precos?.preco)], ['Preço promocional', money(d.precos?.precoPromocional ?? p.precos?.precoPromocional)],
      ['Preço de custo', money(d.precos?.precoCusto ?? p.precos?.precoCusto)], ['Custo médio', money(d.precos?.precoCustoMedio ?? p.precos?.precoCustoMedio)], ['Custo (histórico Olist)', money(d.precos?.custoFicha ?? p.custoFicha)],
      ['Margem %', `<input class="margin-input" type="number" step="0.01" data-margin="${d.id}" value="${settingOf({ id: d.id }).margin ?? ''}" placeholder="${escape(String(state.defaultMargin))}">`, 'raw'],
      ['Visível ao comprador', `<button class="toggle${settingOf({ id: d.id }).visible ? ' on' : ''}" type="button" role="switch" aria-checked="${settingOf({ id: d.id }).visible}" data-visible="${d.id}"><i></i></button>`, 'raw']
    ] : []),
    ['SKU', d.sku || p.sku || '—'], ['GTIN / EAN', d.gtin || p.gtin || '—'], ['Unidade', d.unidade || p.unidade || '—'],
    ['Situação', SITUATION[d.situacao || p.situacao] || '—'], ['Tipo', VARIATION[p.tipoVariacao] || '—'],
    ...(state.parentOf.has(d.id) ? [['Grade', state.grade.get(d.id) || '—'], ['Produto pai', state.byId.get(state.parentOf.get(d.id))?.descricao || '—']] : []),
    ...(admin ? [['ID Olist', String(d.id)]] : [])
  ];
  $('pd-data').innerHTML = `<table class="pd-table data">${rows.map(([k, v, cls]) => `<tr class="${cls || ''}"><th>${k}</th><td>${cls === 'raw' ? v : escape(v)}</td></tr>`).join('')}</table>`;
  // Right: variations
  $('pd-variations').innerHTML = kids.length
    ? `<table class="pd-table vars"><thead><tr>${state.role === 'buyer' ? '<th></th>' : ''}<th>GRADE</th><th>SKU</th><th class="numeric">ESTOQUE</th><th class="numeric">${state.role === 'admin' ? 'PREÇO COMPRADOR' : 'PREÇO DE VENDA'}</th></tr></thead><tbody>${kids.map(k => { const s = stockOf(k), price = buyerPriceOf(k); return `<tr data-variation="${k.id}">${state.role === 'buyer' ? `<td><input type="checkbox" data-pick="${k.id}"${state.selected.has(k.id) ? ' checked' : ''}${price == null ? ' disabled' : ''} aria-label="Selecionar ${escape(state.grade.get(k.id) || k.sku || '')}"></td>` : ''}<td><b>${escape(state.grade.get(k.id) || k.descricao)}</b></td><td class="mono">${escape(k.sku || '')}</td><td class="numeric${s != null && s <= 0 ? ' danger' : ''}">${qty(s)}</td><td class="numeric">${price != null ? money(price) : '—'}</td></tr>`; }).join('')}</tbody></table>`
    : `<p class="pd-empty">${loading && p.tipoVariacao === 'P' ? 'Carregando variações…' : 'Produto sem variações.'}</p>`;
  $('product-add').hidden = state.role !== 'buyer';
  $('product-add').disabled = loading || (d.precoComprador == null && !kids.some(k => buyerPriceOf(k) != null));
}
async function openProduct(id, refresh = false) {
  detailId = id;
  const p = state.byId.get(id) || { id };
  renderDetail({ id, descricao: p.descricao, sku: p.sku, gtin: p.gtin, situacao: p.situacao, imagem: p.imagem, precoComprador: buyerPriceOf(p) }, true);
  if (!$('product-dialog').open) openDrawer($('product-dialog'));
  try {
    const d = await api(`/api/products/${id}/detail${refresh ? '?refresh=1' : ''}`);
    if (detailId !== id) return;
    applyDetail(d); renderDetail(d);
  } catch (error) { if (detailId === id) { $('product-warning').hidden = false; $('product-warning').textContent = error.message; } }
}
function stepProduct(delta) {
  const list = detailList(), pos = list.indexOf(detailId);
  const next = list[pos + delta];
  if (next != null) openProduct(next);
}
$('rows').addEventListener('click', event => { const el = event.target.closest('[data-detail]'); if (el) openProduct(Number(el.dataset.detail)); });
$('product-prev').onclick = () => stepProduct(-1);
$('product-next').onclick = () => stepProduct(1);
document.addEventListener('keydown', event => {
  if (!$('product-dialog').open || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); stepProduct(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); stepProduct(1); }
});
document.querySelectorAll('#product-dialog [data-left]').forEach(tab => { tab.onclick = () => { leftTab = tab.dataset.left; if (detailData) renderDetail(detailData); }; });
$('pd-left').addEventListener('click', event => {
  const thumb = event.target.closest('[data-image]');
  if (!thumb) return;
  $('pd-left').querySelectorAll('[data-image]').forEach(b => b.classList.toggle('active', b === thumb));
  $('pd-left').querySelector('.pd-main').innerHTML = `<img src="${escape(thumb.dataset.image)}" alt="" referrerpolicy="no-referrer">`;
});
// Admin edits inside the panel reuse the same settings calls as the table.
$('pd-data').addEventListener('click', async event => {
  const toggle = event.target.closest('[data-visible]');
  if (!toggle) return;
  const id = Number(toggle.dataset.visible);
  await saveSettings([id], { visible: !(state.settings.get(id)?.visible ?? true) });
  if (detailData) renderDetail({ ...detailData, visivel: state.settings.get(id)?.visible });
});
$('pd-data').addEventListener('change', async event => {
  const input = event.target.closest('[data-margin]');
  if (!input) return;
  const id = Number(input.dataset.margin);
  await saveSettings([id], { margin: input.value === '' ? null : Number(input.value) });
  if (detailData) renderDetail({ ...detailData, precoComprador: buyerPriceOf(state.byId.get(id) || {}) });
});
$('pd-variations').addEventListener('change', event => {
  const box = event.target.closest('[data-pick]');
  if (!box) return;
  const id = Number(box.dataset.pick);
  box.checked ? state.selected.add(id) : state.selected.delete(id);
  render();
});
$('product-refresh').onclick = () => { if (detailId) openProduct(detailId, true); };
$('product-add').onclick = () => {
  const ids = kidsOf(detailId).length ? kidsOf(detailId).filter(id => buyerPriceOf(state.byId.get(id)) != null) : [detailId];
  ids.forEach(id => state.selected.add(id));
  render(); if (detailData) renderDetail(detailData);
  notice(`${ids.length === 1 ? 'Produto adicionado' : `${ids.length} variações adicionadas`} à seleção. Clique em Sacola para informar as quantidades.`);
};


// ── Buyer onboarding and own Olist integration ───────────────
const OB = {
  buyer: { flow: ['welcome', 'modules', 'profile', 'olist', 'guide', 'keys', 'done'], rail: [['welcome', 'Boas-vindas'], ['modules', 'Conheça o sistema'], ['profile', 'Seus dados'], ['olist', 'Integração Olist'], ['done', 'Pronto']] },
  admin: { flow: ['welcome', 'modules', 'profile', 'master', 'webhook', 'done'], rail: [['welcome', 'Boas-vindas'], ['modules', 'Conheça o sistema'], ['profile', 'Dados e margem'], ['master', 'Conta Olist'], ['webhook', 'Estoque em tempo real'], ['done', 'Pronto']] }
};
const obRole = () => (state.me?.role === 'admin' ? 'admin' : 'buyer');
const OB_RAIL = { guide: 'olist', keys: 'olist' };
const OB_NEXT = { welcome: 'Começar', modules: 'Próximo', profile: 'Confirmar dados', olist: 'Próximo', guide: 'Já criei o aplicativo', keys: 'Salvar e autenticar na Olist', master: 'Próximo', webhook: 'Próximo', done: 'Ir para os produtos' };
let obStep = 'welcome', obOlistChoice = null;
const obError = message => { $('ob-error').hidden = !message; $('ob-error').textContent = message || ''; };
function obShow(step) {
  obStep = step; obError('');
  document.querySelectorAll('#onboarding-dialog .ob-step').forEach(el => { el.hidden = el.dataset.step !== step; });
  const rail = OB_RAIL[step] || step, order = OB[obRole()].rail.map(r => r[0]), at = order.indexOf(rail);
  document.querySelectorAll('#ob-steps li').forEach((li, i) => { li.classList.toggle('active', i === at); li.classList.toggle('done', i < at); });
  $('ob-progress').firstElementChild.style.width = `${Math.round(((at + 1) / order.length) * 100)}%`;
  $('ob-back').hidden = step === 'welcome';
  const olist = state.me?.customer?.olist || {};
  $('ob-next').hidden = step === 'olist' && !olist.connected;
  $('ob-next').textContent = OB_NEXT[step];
  if (step === 'master') checkMasterOlist();
  if (step === 'done' && obRole() === 'admin') {
    $('ob-done-text').textContent = 'Painel configurado. Agora importe o catálogo em Produtos, defina visibilidade e margens e cadastre seus compradores em Usuários.';
    $('ob-done-olist').hidden = true;
  } else if (step === 'done') {
    $('ob-done-text').textContent = olist.connected ? 'Seu acesso está configurado e a sua conta Olist está conectada.' : 'Seu acesso está configurado. Quando quiser, conecte a sua Olist em Integrações (ícone de tomada no topo).';
    $('ob-done-olist').hidden = !olist.connected;
    $('ob-done-olist').textContent = olist.connected ? `Olist conectada · ${olist.company?.razaoSocial || 'conta autorizada'}` : '';
  }
  if (step === 'olist') {
    $('ob-olist-connected').hidden = !olist.connected;
    $('ob-olist-connected').textContent = olist.connected ? `Olist conectada · ${olist.company?.razaoSocial || 'conta autorizada'}` : '';
    document.querySelector('#onboarding-dialog .ob-choice').hidden = !!olist.connected;
  }
  const focus = document.querySelector(`#onboarding-dialog [data-step="${step}"] input`);
  if (focus) setTimeout(() => focus.focus(), 50);
}
function fillOnboarding(me) {
  const role = obRole(), c = me.customer || {};
  document.querySelectorAll('#onboarding-dialog [data-role]').forEach(el => { el.hidden = el.dataset.role !== role; });
  $('ob-steps').replaceChildren(...OB[role].rail.map(([, label]) => { const li = document.createElement('li'); li.textContent = label; return li; }));
  $('ob-margin').value = String(me.tenant?.defaultMargin ?? state.defaultMargin ?? 0);
  $('ob-webhook').textContent = me.tenant?.webhookUrl || 'Webhook indisponível: gere a chave da conta no banco.';
  $('ob-master-redirect').textContent = me.redirectUri || `${location.origin}/`;
  $('ob-name').textContent = (me.name || me.user || '').split(' ')[0] || 'tudo bem';
  $('ob-tenant').textContent = me.tenant?.name || 'Boas-vindas';
  $('ob-tenant-name').textContent = me.tenant?.name || 'o fornecedor';
  $('ob-legal').textContent = role === 'admin' ? (me.tenant?.name || '—') : (c.legalName || c.tradeName || '—');
  $('ob-cnpj').textContent = role === 'admin' ? '' : (cnpjMask(c.cnpj) || '—');
  $('ob-user-name').value = me.name || '';
  $('ob-user-email').value = me.email || '';
  $('ob-phone').value = c.phone || '';
  $('ob-company-email').value = c.email || '';
  $('ob-redirect').textContent = me.redirectUri || `${location.origin}/`;
}
function openOnboarding(step = 'welcome') {
  fillOnboarding(state.me);
  obShow(step);
  openDrawer($('onboarding-dialog'));
}
async function finishOnboarding() {
  if (state.me.onboarded) return;
  state.me.onboarded = true;
  try { await api('/api/me', patchJson({ onboarded: true })); } catch { /* best effort: asked again next login */ }
}
async function refreshMe() { const me = await api('/api/me'); state.me = me; return me; }
async function startOnboarding(me) {
  const auth = state.authReturn || '';
  if (me.role === 'admin') {
    if (!me.onboarded) openOnboarding(['success', 'invalid', 'denied', 'failed'].includes(auth) ? 'master' : 'welcome');
    return;
  }
  if (auth.startsWith('customer')) {
    if (auth === 'customer') { try { await api('/api/customer/olist'); await refreshMe(); } catch { /* status shown below */ } }
    if (!state.me.onboarded) { openOnboarding(auth === 'customer' ? 'olist' : 'keys'); if (auth !== 'customer') obError($('notice').textContent); return; }
    return openCustomerIntegrations();
  }
  if (!me.onboarded) openOnboarding();
}
async function obNext() {
  const button = $('ob-next');
  try {
    if (obStep === 'profile') {
      const name = $('ob-user-name').value.trim();
      if (!name) { $('ob-user-name').focus(); return obError('Informe seu nome.'); }
      const admin = obRole() === 'admin', margin = Number($('ob-margin').value);
      if (admin && ($('ob-margin').value === '' || !Number.isFinite(margin))) { $('ob-margin').focus(); return obError('Informe a margem padrão (pode ser 0).'); }
      button.disabled = true;
      await api('/api/me', patchJson(admin ? { name, email: $('ob-user-email').value.trim() } : { name, email: $('ob-user-email').value.trim(), phone: $('ob-phone').value.trim(), customerEmail: $('ob-company-email').value.trim() }));
      if (admin && margin !== state.defaultMargin) {
        await api('/api/tenant', patchJson({ defaultMargin: margin }));
        state.defaultMargin = margin; $('default-margin').value = String(margin); render();
      }
      state.me.name = name; $('app-user').textContent = name;
      return obShow(admin ? 'master' : 'olist');
    }
    if (obStep === 'keys') {
      const clientId = $('ob-client-id').value.trim(), clientSecret = $('ob-client-secret').value.trim();
      if (!clientId || !clientSecret) return obError('Cole o Client ID e o Client Secret do aplicativo.');
      button.disabled = true;
      await api('/api/customer/olist-app', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
      $('ob-client-secret').value = '';
      location.href = '/auth/customer-login';
      return;
    }
    if (obStep === 'done') { await finishOnboarding(); return closeDrawer($('onboarding-dialog')); }
    if (obStep === 'olist') return obShow('done');
    const flow = OB[obRole()].flow;
    obShow(flow[flow.indexOf(obStep) + 1]);
  } catch (error) { obError(error.message); } finally { button.disabled = false; }
}
function obBack() {
  const flow = OB[obRole()].flow;
  if (obRole() === 'admin') return obShow(flow[flow.indexOf(obStep) - 1]);
  if (obStep === 'done') return obShow(obOlistChoice === 'yes' && !state.me?.customer?.olist?.connected ? 'keys' : 'olist');
  if (obStep === 'olist') return obShow('profile');
  obShow(flow[flow.indexOf(obStep) - 1]);
}
$('ob-next').onclick = obNext;
$('ob-back').onclick = obBack;
$('ob-profile').addEventListener('submit', event => { event.preventDefault(); obNext(); });
$('ob-keys').addEventListener('submit', event => { event.preventDefault(); obNext(); });
$('ob-olist-yes').onclick = () => { obOlistChoice = 'yes'; obShow('guide'); };
$('ob-olist-later').onclick = () => { obOlistChoice = 'later'; obShow('done'); };
$('ob-skip').onclick = () => closeDrawer($('onboarding-dialog'));
$('onboarding-dialog').addEventListener('close', () => { finishOnboarding(); });
document.querySelectorAll('#onboarding-dialog [data-copy]').forEach(button => {
  button.onclick = async () => {
    const source = $(button.dataset.copy);
    try { await navigator.clipboard.writeText(source.textContent); button.textContent = 'Copiado'; setTimeout(() => { button.textContent = 'Copiar'; }, 1600); }
    catch { getSelection().selectAllChildren(source); }
  };
});
function masterStatus(text, kind = '') {
  const label = document.createElement('span'); label.textContent = text;
  $('ob-master-status').className = `ob-status ${kind}`.trim();
  $('ob-master-status').replaceChildren(document.createElement('i'), label);
}
async function checkMasterOlist() {
  masterStatus('Verificando…'); $('ob-master-hint').hidden = true;
  try {
    const session = await api('/api/session');
    if (!session.configured) { $('ob-master-connect').hidden = true; return masterStatus('As credenciais Olist ainda não foram configuradas no servidor (OLIST_CLIENT_ID e OLIST_CLIENT_SECRET).', 'error'); }
    $('ob-master-connect').hidden = false;
    if (!session.authenticated) { $('ob-master-connect').textContent = 'Conectar Olist'; return masterStatus('Não conectada'); }
    const company = await api('/api/company');
    $('ob-master-connect').hidden = true;
    masterStatus(`Conectada · ${company.razaoSocial || 'conta Olist'}`, 'ok');
  } catch (error) {
    $('ob-master-connect').textContent = 'Reconectar'; $('ob-master-hint').hidden = false;
    masterStatus(error.message, 'error');
  }
}
$('settings-tour').onclick = () => { closeDrawer($('settings-drawer')); setTimeout(() => openOnboarding(), 220); };

function customerStatus(text, kind = '') {
  $('customer-olist-error').hidden = kind !== 'error';
  $('customer-olist-error').textContent = kind === 'error' ? text : '';
  const label = document.createElement('span'); label.textContent = kind === 'error' ? 'Falha na conexão' : text;
  $('customer-olist-status').className = `integration-status ${kind}`.trim();
  $('customer-olist-status').replaceChildren(document.createElement('i'), label);
}
async function checkCustomerOlist() {
  customerStatus('Verificando…');
  ['customer-olist-auth', 'customer-olist-disconnect'].forEach(id => { $(id).hidden = true; });
  try {
    const s = await api('/api/customer/olist');
    $('customer-olist-setup').textContent = s.configured ? 'ALTERAR CHAVES' : 'CONFIGURAR';
    $('customer-olist-auth').hidden = !s.configured || (s.connected && !s.error);
    $('customer-olist-auth').textContent = s.connected ? 'RECONECTAR' : 'AUTENTICAR';
    $('customer-olist-disconnect').hidden = !s.connected;
    $('customer-olist-setup').hidden = s.connected && !s.error;
    if (s.error) { $('customer-olist-auth').hidden = false; $('customer-olist-auth').textContent = 'RECONECTAR'; return customerStatus(s.error, 'error'); }
    if (s.connected) return customerStatus(`Conectada · ${s.company?.razaoSocial || 'conta autorizada'}`, 'ok');
    customerStatus(s.configured ? 'Chaves salvas · falta autenticar' : 'Não conectada');
  } catch (error) { customerStatus(error.message, 'error'); }
}
function openCustomerIntegrations() { openDrawer($('integrations-drawer')); checkCustomerOlist(); }
$('customer-olist-setup').onclick = () => { closeDrawer($('integrations-drawer')); setTimeout(() => openOnboarding('guide'), 220); obOlistChoice = 'yes'; };
$('customer-olist-disconnect').onclick = async () => {
  try { await api('/api/customer/olist', { method: 'DELETE' }); await refreshMe(); checkCustomerOlist(); } catch (error) { customerStatus(error.message, 'error'); }
};
for (const id of ['integrations', 'settings-integrations']) {
  const adminOpen = $(id).onclick;
  $(id).onclick = () => (state.role === 'admin' ? adminOpen() : (closeDrawer($('settings-drawer')), openCustomerIntegrations()));
}
