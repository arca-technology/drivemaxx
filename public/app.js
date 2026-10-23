const paths = {
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
  moon: '<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  sort: '<path d="m8 8 4-4 4 4m-8 8 4 4 4-4"/>',
  up: '<path d="m8 14 4-4 4 4"/>',
  down: '<path d="m8 10 4 4 4-4"/>',
  link: '<path d="m10 13 4-4m-6 1-3 3a4 4 0 0 0 6 6l3-3m-4-6 3-3a4 4 0 0 1 6 6l-3 3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  first: '<path d="m12 6-6 6 6 6M18 6l-6 6 6 6"/>',
  last: '<path d="m12 6 6 6-6 6M6 6l6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plug: '<path d="M9 2v5m6-5v5M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v5"/>',
  settings: '<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 5.8V20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.box}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const $ = id => document.getElementById(id);
const store = { get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} } };
const state = {
  authenticated: false, products: [], byId: new Map(), total: 0, complete: false, loading: false, generation: 0, page: 1, sort: 'descricao', direction: 1,
  filters: {}, selected: new Set(), expanded: new Set(), hierarchy: new Set(['parent', 'variations']),
  stock: new Map(), children: new Map(), parentOf: new Map(), grade: new Map(), variationsDone: new Set(), stockDone: new Set(),
  visibleIds: [], enriching: false, enrichNote: '',
  role: 'admin', database: false, settings: new Map(), defaultMargin: 0, defaultFixed: 0, booting: true
};
const money = value => value == null || value === '' ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
const number = value => new Intl.NumberFormat('pt-BR').format(value);
const qty = value => value == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
const date = value => { if (!value) return '—'; const d = new Date(String(value).replace(' ', 'T')); return Number.isNaN(+d) ? String(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Stock (parents use the sum of their variations) ──────────
const kidsOf = id => (state.children.get(id) || []).filter(k => state.byId.has(k));
function stockOf(p, field = 'disponivel') {
  const kids = kidsOf(p.id);
  if (kids?.length) {
    const known = kids.map(id => state.stock.get(id)).filter(Boolean);
    return known.length ? known.reduce((sum, s) => sum + (Number(s[field]) || 0), 0) : null;
  }
  const own = state.stock.get(p.id);
  return own ? own[field] : null;
}

// ── Buyer price (cost + margin) and admin product settings ───
const settingOf = p => state.settings.get(p.id) || { visible: true, margin: null, fixed: null };
const fixedOf = p => Number(settingOf(p).fixed ?? state.defaultFixed ?? 0);
function buyerPriceOf(p) {
  if (state.role === 'buyer') return null;
  const cost = Number(p.precos?.precoCusto) > 0 ? Number(p.precos.precoCusto) : Number(p.precos?.precoCustoMedio) > 0 ? Number(p.precos.precoCustoMedio) : Number(p.custoFicha) > 0 ? Number(p.custoFicha) : null;
  if (cost == null) return null;
  const margin = settingOf(p).margin ?? state.defaultMargin;
  return Math.round(cost * (1 + Number(margin) / 100) * 100) / 100;
}
// Final price (what the buyer sees and pays): buyer price + fixed cost (R$).
function priceOf(p) {
  if (state.role === 'buyer') return p.precoFinal ?? null;
  const base = buyerPriceOf(p);
  return base == null ? null : Math.round((base + fixedOf(p)) * 100) / 100;
}

// ── Columns ──────────────────────────────────────────────────
const SITUATION = { A: 'Ativo', I: 'Inativo', E: 'Excluído' };
const TYPE = { S: 'Simples', K: 'Kit', V: 'Com variações', F: 'Fabricado', M: 'Matéria-prima', P: 'Produto' };
const VARIATION = { N: 'Simples', P: 'Produto pai', V: 'Variação' };
const COLUMNS = [
  { key: 'imagem', label: 'IMAGEM', width: 72, pinLeft: true, database: true, value: p => p.imagem ? 'Com imagem' : 'Sem imagem', render: p => `<button class="thumb" type="button" data-detail="${p.id}" aria-label="Ver detalhes de ${escape(p.descricao)}">${p.imagem ? `<img src="${escape(p.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('box')}</button>` },
  { key: 'descricao', label: 'PRODUTO', width: 340, fixed: true, value: p => p.descricao || '', render: p => {
    const sub = state.parentOf.has(p.id) ? (state.grade.get(p.id) || p.sku || `ID ${p.id}`) : (p.sku || `ID ${p.id}`);
    const kids = state.children.get(p.id)?.length;
    const name = state.database ? `<button class="product-name link" type="button" data-detail="${p.id}">${escape(p.descricao || 'Produto sem descrição')}</button>` : `<span class="product-name">${escape(p.descricao || 'Produto sem descrição')}</span>`;
    return `<div class="product-cell">${state.database ? '' : `<span class="product-icon">${icon('box')}</span>`}<span class="product-text">${name}<span class="product-sub">${escape(sub)}${kids ? ` · ${kids} variações` : ''}</span></span></div>`;
  } },
  { key: 'sku', label: 'CÓDIGO / SKU', width: 160, mono: true, value: p => p.sku || '' },
  { key: 'situacao', roles: ['admin'], label: 'SITUAÇÃO', width: 120, value: p => SITUATION[p.situacao] || 'Não informado', render: p => `<span class="status-pill ${p.situacao === 'E' ? 'deleted' : p.situacao !== 'A' ? 'inactive' : ''}"><i></i>${SITUATION[p.situacao] || 'Não informado'}</span>` },
  { key: 'disponivel', label: 'ESTOQUE DISPONÍVEL', width: 150, numeric: true, value: p => stockOf(p), render: p => { const v = stockOf(p), kids = kidsOf(p.id); const done = kids.length ? kids.every(k => state.stockDone.has(k)) : state.stockDone.has(p.id); return v == null ? `<span class="pending" title="${done ? 'Sem estoque informado' : 'Carregando estoque'}">${done ? '—' : '···'}</span>` : `<b class="${v <= 0 ? 'stock-out' : ''}">${qty(v)}</b>`; } },
  { key: 'precoComprador', label: 'PREÇO COMPRADOR', width: 150, numeric: true, roles: ['admin'], database: true, value: p => buyerPriceOf(p), render: p => { const v = buyerPriceOf(p); return v == null ? '<span class="pending" title="Sem custo cadastrado na Olist">—</span>' : `<b>${money(v)}</b>`; } },
  { key: 'visivel', label: 'VISÍVEL', width: 90, roles: ['admin'], database: true, pinRight: true, value: p => settingOf(p).visible ? 'Sim' : 'Não', render: p => { const on = settingOf(p).visible; return `<button class="toggle${on ? ' on' : ''}" type="button" role="switch" aria-checked="${on}" data-visible="${p.id}" title="${on ? 'Visível para compradores' : 'Oculto para compradores'}"><i></i></button>`; } },
  { key: 'margem', label: 'MARGEM %', width: 120, numeric: true, roles: ['admin'], database: true, value: p => settingOf(p).margin, render: p => { const m = settingOf(p).margin; return `<input class="margin-input" type="number" step="0.01" data-margin="${p.id}" value="${m ?? ''}" placeholder="${escape(String(state.defaultMargin))}" aria-label="Margem de ${escape(p.descricao)}">`; } },
  { key: 'custoFixo', label: 'CUSTO FIXO R$', width: 130, numeric: true, roles: ['admin'], database: true, value: p => settingOf(p).fixed, render: p => { const f = settingOf(p).fixed; return `<input class="margin-input" type="number" step="0.01" min="0" data-fixed="${p.id}" value="${f ?? ''}" placeholder="${escape(String(state.defaultFixed))}" aria-label="Custo fixo de ${escape(p.descricao)}">`; } },
  { key: 'precoFinal', label: 'PREÇO', width: 140, numeric: true, database: true, value: p => priceOf(p), render: p => { const v = priceOf(p); return v == null ? '<span class="pending" title="Sem custo cadastrado na Olist">—</span>' : `<b>${money(v)}</b>`; } },
  { key: 'saldo', roles: ['admin'], label: 'SALDO EM ESTOQUE', width: 140, numeric: true, hidden: true, value: p => stockOf(p, 'saldo'), render: p => qty(stockOf(p, 'saldo')) },
  { key: 'reservado', roles: ['admin'], label: 'RESERVADO', width: 120, numeric: true, hidden: true, value: p => stockOf(p, 'reservado'), render: p => qty(stockOf(p, 'reservado')) },
  { key: 'preco', roles: ['admin'], label: 'PREÇO DE VENDA', width: 145, numeric: true, value: p => p.precos?.preco ?? null, render: p => money(p.precos?.preco) },
  { key: 'precoPromocional', roles: ['admin'], label: 'PREÇO PROMOCIONAL', width: 150, numeric: true, value: p => p.precos?.precoPromocional ?? null, render: p => money(p.precos?.precoPromocional) },
  { key: 'precoCusto', roles: ['admin'], label: 'PREÇO DE CUSTO', width: 140, numeric: true, value: p => p.precos?.precoCusto ?? null, render: p => money(p.precos?.precoCusto) },
  { key: 'unidade', label: 'UNIDADE', width: 100, value: p => p.unidade || '' },
  { key: 'gtin', label: 'GTIN / EAN', width: 160, mono: true, value: p => p.gtin || '' },
  { key: 'tipo', roles: ['admin'], label: 'TIPO', width: 130, value: p => TYPE[p.tipo] || p.tipo || '' },
  { key: 'tipoVariacao', roles: ['admin'], label: 'VARIAÇÃO', width: 120, value: p => VARIATION[p.tipoVariacao] || p.tipoVariacao || '' },
  { key: 'localizacao', roles: ['admin'], label: 'LOCALIZAÇÃO', width: 140, value: p => p.estoque?.localizacao || '' },
  { key: 'dataAlteracao', roles: ['admin'], label: 'ÚLTIMA ALTERAÇÃO', width: 150, value: p => p.dataAlteracao || '', render: p => escape(date(p.dataAlteracao)) },
  { key: 'id', roles: ['admin'], label: 'ID OLIST', width: 130, mono: true, value: p => p.id }
];
const columnByKey = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
let visibility = store.get('drive-cols-v1', {});
const allowedColumns = () => COLUMNS.filter(c => (!c.roles || c.roles.includes(state.role)) && (!c.database || state.database));
// Pinned columns are always shown: image and product on the left, visibility on the right edge.
const locked = c => c.fixed || c.pinLeft || c.pinRight;
const visibleColumns = () => { const cols = allowedColumns().filter(c => locked(c) || (c.key in visibility ? visibility[c.key] : !c.hidden)); return [...cols.filter(c => !c.pinRight), ...cols.filter(c => c.pinRight)]; };
const colClass = c => `${c.fixed ? 'product-col ' : ''}${c.pinLeft ? 'image-col ' : ''}${c.pinRight ? 'pin-right ' : ''}${c.numeric ? 'numeric ' : ''}`;
const cellText = (p, c) => { const v = c.value(p); return v == null ? '' : String(v); };

// ── Theme ────────────────────────────────────────────────────
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  $('theme').setAttribute('aria-label', theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
  document.querySelectorAll('[data-theme-option]').forEach(b => b.classList.toggle('active', b.dataset.themeOption === theme));
  try { localStorage.setItem('drive-theme', theme); } catch {}
}
let preferredTheme;
try { preferredTheme = localStorage.getItem('drive-theme'); } catch {}
setTheme(preferredTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
document.querySelectorAll('[data-theme-option]').forEach(b => { b.onclick = () => setTheme(b.dataset.themeOption); });

// ── Notices and connection ───────────────────────────────────
function notice(message, error = false, retry = false) {
  $('notice').hidden = !message;
  $('notice').className = error ? 'error' : '';
  $('notice').replaceChildren(document.createTextNode(message));
  if (retry) { const button = document.createElement('button'); button.textContent = 'Tentar novamente'; button.onclick = () => loadProducts(); $('notice').append(button); }
}
function connection(authenticated) {
  state.authenticated = authenticated;
  $('refresh').disabled = !authenticated || state.loading;
  document.querySelector('.footer-status').classList.toggle('ready', authenticated);
  $('connect').hidden = authenticated;
  $('connect-hint').hidden = authenticated;
  $('setup').hidden = authenticated;
  $('olist-auth').hidden = authenticated;
  $('olist-auth').textContent = 'AUTENTICAR';
  $('olist-disconnect').hidden = !authenticated;
  if (!authenticated) olistStatus('Não autenticada');
}

// ── View model: filters, groups, sort, pagination ────────────
function passesFilters(p, ignore = '') {
  for (const [key, f] of Object.entries(state.filters)) {
    if (key === ignore) continue;
    const c = columnByKey[key];
    if (f.type === 'set') { if (!f.values.has(cellText(p, c))) return false; continue; }
    const n = c.value(p);
    if (n == null || !Number.isFinite(Number(n))) return false;
    const v = Number(n);
    if (f.op === 'gt' && !(v > f.a)) return false;
    if (f.op === 'gte' && !(v >= f.a)) return false;
    if (f.op === 'lt' && !(v < f.a)) return false;
    if (f.op === 'lte' && !(v <= f.a)) return false;
    if (f.op === 'eq' && v !== f.a) return false;
    if (f.op === 'between' && !(v >= Math.min(f.a, f.b) && v <= Math.max(f.a, f.b))) return false;
  }
  return true;
}
function passesSearch(p, needle) {
  if (!needle) return true;
  return normalize(`${p.descricao} ${p.sku || ''} ${p.gtin || ''} ${p.id} ${state.grade.get(p.id) || ''}`).includes(needle);
}
function compare(a, b) {
  const c = columnByKey[state.sort];
  const av = c.value(a), bv = c.value(b);
  if (c.numeric) return ((av ?? -Infinity) - (bv ?? -Infinity)) * state.direction || 0;
  return String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR', { numeric: true }) * state.direction;
}
function buildView() {
  const needle = normalize($('search').value.trim());
  const criteria = !!needle || Object.keys(state.filters).length > 0;
  const match = p => passesSearch(p, needle) && passesFilters(p);
  const showParents = state.hierarchy.has('parent'), showKids = state.hierarchy.has('variations');
  const groups = [];
  for (const p of state.products) {
    if (state.parentOf.has(p.id)) continue;
    const kids = kidsOf(p.id).map(id => state.byId.get(id));
    if (!kids.length) { if (match(p)) groups.push({ row: p, kids: [] }); continue; }
    const matchingKids = criteria ? kids.filter(match) : kids;
    if (!match(p) && !matchingKids.length) continue;
    if (!showParents) { if (showKids) (criteria && !match(p) ? matchingKids : kids).forEach(k => groups.push({ row: k, kids: [] })); continue; }
    groups.push({ row: p, kids: showKids ? (criteria && !match(p) ? matchingKids : kids).sort(compare) : [], total: kids.length });
  }
  // Variations whose parent is not in the list are shown on their own.
  for (const p of state.products) if (state.parentOf.has(p.id) && !state.byId.has(state.parentOf.get(p.id)) && match(p)) groups.push({ row: p, kids: [] });
  groups.sort((a, b) => compare(a.row, b.row));
  return groups;
}

// ── Rendering ────────────────────────────────────────────────
let view = [];
function renderHead() {
  const cols = visibleColumns();
  // CSP forbids inline style attributes; widths are set through the DOM.
  $('cols').replaceChildren(...[44, 44, ...cols.map(c => c.width)].map(width => { const col = document.createElement('col'); col.style.width = `${width}px`; return col; }));
  $('products-table').style.minWidth = `${88 + cols.reduce((s, c) => s + c.width, 0)}px`;
  $('products-table').style.setProperty('--product-left', `${88 + cols.filter(c => c.pinLeft).reduce((s, c) => s + c.width, 0)}px`);
  $('head-row').innerHTML = `<th class="select-col" scope="col"><input id="select-all" type="checkbox" aria-label="Selecionar todos os produtos filtrados"></th><th class="expand-col${state.hierarchy.size !== 2 ? ' filtered' : ''}" scope="col" data-key="__group" title="Expandir ou recolher todos · Ctrl + clique para filtrar o agrupamento"><button id="expand-all" class="expand-btn" type="button" aria-label="Expandir todos">▸</button></th>` + cols.map(c => {
    const sorted = state.sort === c.key, filtered = !!state.filters[c.key];
    return `<th scope="col" data-key="${c.key}" class="${colClass(c)}${filtered ? 'filtered' : ''}" aria-sort="${sorted ? (state.direction === 1 ? 'ascending' : 'descending') : 'none'}" title="Clique para ordenar · Ctrl + clique para filtrar"><span class="th-inner"><span>${c.label}</span>${filtered ? icon('filter') : icon(sorted ? (state.direction === 1 ? 'up' : 'down') : 'sort')}</span></th>`;
  }).join('');
}
function rowHtml(p, cols, kind, group) {
  const checked = state.selected.has(p.id) ? ' checked' : '';
  let expand = '';
  if (kind === 'parent') { const open = state.expanded.has(p.id); expand = `<button class="expand-btn" type="button" data-expand="${p.id}" aria-expanded="${open}" aria-label="${open ? 'Recolher' : 'Expandir'} variações">${open ? '▾' : '▸'}</button>`; }
  else if (kind === 'parent-empty') expand = `<span class="expand-count" title="Variações ocultas pelo filtro">${group.total}</span>`;
  return `<tr class="${kind === 'child' ? 'child-row' : kind.startsWith('parent') ? 'parent-row' : ''}" data-id="${p.id}"${kind === 'child' ? ` data-parent="${state.parentOf.get(p.id)}"` : ''}><td class="select-col"><input type="checkbox" data-select="${p.id}" aria-label="Selecionar ${escape(p.descricao)}"${checked}></td><td class="expand-col">${expand}</td>${cols.map(c => `<td class="${colClass(c)}${c.mono ? 'mono' : ''}" data-key="${c.key}" data-label="${escape(c.label)}"${c.fixed ? ` title="${escape(p.descricao)}"` : ''}>${c.render ? c.render(p) : escape(c.value(p) || '—')}</td>`).join('')}</tr>`;
}
function render() {
  view = buildView();
  const size = Number($('page-size').value), pages = Math.max(1, Math.ceil(view.length / size));
  state.page = Math.min(pages, Math.max(1, state.page));
  const start = (state.page - 1) * size, slice = view.slice(start, start + size);
  const cols = visibleColumns();
  renderHead();
  state.visibleIds = [];
  $('rows').innerHTML = slice.map(group => {
    state.visibleIds.push(group.row.id);
    if (!group.kids.length) return rowHtml(group.row, cols, group.total ? 'parent-empty' : 'single', group);
    const open = state.expanded.has(group.row.id);
    if (open) group.kids.forEach(k => state.visibleIds.push(k.id));
    return rowHtml(group.row, cols, 'parent', group) + (open ? group.kids.map(k => rowHtml(k, cols, 'child', group)).join('') : '');
  }).join('');
  const expandable = slice.filter(g => g.kids.length);
  const allOpen = expandable.length > 0 && expandable.every(g => state.expanded.has(g.row.id));
  $('expand-all').disabled = !expandable.length;
  $('expand-all').textContent = allOpen ? '▾' : '▸';
  $('expand-all').setAttribute('aria-label', allOpen ? 'Recolher todos' : 'Expandir todos');
  const ids = allViewIds();
  const selectedInView = ids.filter(id => state.selected.has(id)).length;
  $('select-all').checked = ids.length > 0 && selectedInView === ids.length;
  $('select-all').indeterminate = selectedInView > 0 && selectedInView < ids.length;
  $('selection').hidden = !state.selected.size;
  $('selection-count').textContent = number(state.selected.size);
  $('count').textContent = number(state.total || state.products.length);
  $('empty').hidden = slice.length > 0;
  // While the session and the saved catalog load, show a loader; the "connect Olist" art only when Olist is not connected.
  const booting = state.booting || (state.loading && !state.products.length);
  $('empty').classList.toggle('booting', booting);
  $('empty').classList.toggle('connected', state.authenticated);
  if (state.authenticated) {
    const criteria = $('search').value.trim() || Object.keys(state.filters).length;
    $('empty-title').textContent = state.loading ? 'Buscando seus produtos...' : state.products.length ? 'Nenhum produto encontrado' : state.complete ? 'Seu catálogo está vazio' : 'Vamos carregar seu catálogo';
    $('empty-description').textContent = state.loading ? 'Estamos consultando os produtos da sua conta Olist.' : state.products.length ? (criteria ? 'Ajuste a busca ou remova filtros para ver mais produtos.' : 'Nenhum produto corresponde ao agrupamento selecionado.') : state.complete ? 'Nenhum produto foi retornado pela conta Olist autenticada.' : 'Clique em Importar produtos para buscar o catálogo da sua conta Olist.';
  } else {
    $('empty-title').textContent = 'Seus produtos. Mais perto.';
    $('empty-description').innerHTML = 'Conecte sua conta Olist para visualizar, buscar e<br> organizar todos os produtos do seu catálogo.';
  }
  if (booting) { $('empty-title').textContent = 'Carregando…'; $('empty-description').textContent = state.loading ? 'Buscando seus produtos na Olist.' : 'Preparando seu catálogo.'; }
  $('import').hidden = !state.authenticated || state.loading || state.products.length > 0;
  $('range').textContent = view.length ? `${number(start + 1)}–${number(start + slice.length)} de ${number(view.length)}` : '0 produtos';
  $('page-label').textContent = `${state.page} / ${pages}`;
  $('first').disabled = $('previous').disabled = state.page <= 1;
  $('next').disabled = $('last').disabled = state.page >= pages;
  $('export').disabled = state.loading || !state.complete || (!view.length && !state.selected.size);
  renderFilterBar();
  renderEnrichLabel();
  if (typeof afterRender === 'function') afterRender();
}
function allViewIds() { return view.flatMap(g => [g.row.id, ...g.kids.map(k => k.id)]); }

// ── Filter bar (chips) ───────────────────────────────────────
function filterText(key, f) {
  if (key === '__group') return state.hierarchy.has('parent') ? 'Somente pais' : 'Somente variações';
  if (f.type === 'set') { const [first] = f.values; return f.values.size === 1 ? (first === '' ? '(em branco)' : first) : `${f.values.size} valores`; }
  const ops = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
  return f.op === 'between' ? `${qty(f.a)} – ${qty(f.b)}` : `${ops[f.op]} ${qty(f.a)}`;
}
function renderFilterBar() {
  const entries = COLUMNS.filter(c => state.filters[c.key]).map(c => [c.key, c.label, state.filters[c.key]]);
  if (state.hierarchy.size !== 2) entries.unshift(['__group', 'AGRUPAMENTO', null]);
  const slot = $('active-filters');
  if (!entries.length) { slot.innerHTML = '<span class="filter-hint">Ctrl + clique no cabeçalho de uma coluna para filtrar</span>'; $('clear-filters').hidden = true; return; }
  slot.innerHTML = entries.map(([key, label, f]) => {
    const text = String(filterText(key, f));
    return `<button type="button" class="filter-chip" data-remove-filter="${key}" title="Remover filtro"><b>${escape(label)}:</b> ${escape(text.length > 26 ? `${text.slice(0, 24)}…` : text)} <span aria-hidden="true">✕</span></button>`;
  }).join('');
  $('clear-filters').hidden = entries.length < 2;
}
$('active-filters').addEventListener('click', event => {
  const chip = event.target.closest('[data-remove-filter]');
  if (!chip) return;
  if (chip.dataset.removeFilter === '__group') state.hierarchy = new Set(['parent', 'variations']);
  else delete state.filters[chip.dataset.removeFilter];
  state.page = 1; render();
});
$('clear-filters').onclick = () => { state.filters = {}; state.hierarchy = new Set(['parent', 'variations']); state.page = 1; render(); };

// ── Popovers (column filter, columns, grouping) ──────────────
let popover = null;
function closePopover() { if (!popover) return; popover.remove(); popover = null; document.removeEventListener('pointerdown', outsidePopover, true); }
function outsidePopover(event) { if (popover && !popover.contains(event.target)) closePopover(); }
function openPopover(anchor, html, width = 280) {
  closePopover();
  popover = document.createElement('div');
  popover.className = 'popover'; popover.setAttribute('role', 'dialog');
  popover.style.width = `${width}px`;
  popover.innerHTML = html;
  document.body.append(popover);
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  popover.style.top = `${Math.max(8, Math.min(rect.bottom + 4, innerHeight - popover.offsetHeight - 8))}px`;
  popover.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closePopover(); anchor.focus?.(); } });
  setTimeout(() => document.addEventListener('pointerdown', outsidePopover, true), 0);
  return popover;
}
function openColumnFilter(th, key) {
  const c = columnByKey[key];
  const counts = new Map();
  for (const p of state.products) if (passesFilters(p, key)) { const v = cellText(p, c); counts.set(v, (counts.get(v) || 0) + 1); }
  const values = [...counts.keys()].sort((a, b) => c.numeric ? (a === '' ? -1 : b === '' ? 1 : Number(a) - Number(b)) : a.localeCompare(b, 'pt-BR', { numeric: true }));
  const current = state.filters[key];
  const temp = new Set(current?.type === 'set' ? current.values : values);
  const label = v => v === '' ? '<em>(em branco)</em>' : escape(c.numeric && key !== 'id' ? (['preco', 'precoPromocional', 'precoCusto'].includes(key) ? money(v) : qty(Number(v))) : v);
  const pop = openPopover(th, `
    <div class="popover-head"><b>${escape(c.label)}</b><span>${number(values.length)} valores</span></div>
    ${c.numeric ? `<div class="popover-row num-filter"><select id="nf-op"><option value="gte">≥ maior ou igual</option><option value="gt">> maior que</option><option value="lte">≤ menor ou igual</option><option value="lt">< menor que</option><option value="eq">= igual a</option><option value="between">↔ entre</option></select><input id="nf-a" type="number" step="any" placeholder="valor"><input id="nf-b" type="number" step="any" placeholder="e" hidden><button id="nf-go" class="pop-btn primary-btn" type="button">Filtrar</button></div>` : ''}
    <div class="popover-row"><input id="pf-search" class="pop-search" placeholder="Buscar valor..." autocomplete="off"></div>
    <div id="pf-list" class="pop-list"></div>
    <div class="popover-actions"><button id="pf-all" class="pop-btn" type="button">Todos</button><button id="pf-apply" class="pop-btn primary-btn" type="button">Aplicar</button><button id="pf-clear" class="pop-btn danger" type="button">Limpar</button></div>`);
  const list = pop.querySelector('#pf-list');
  const draw = () => {
    const q = normalize(pop.querySelector('#pf-search').value);
    const shown = values.filter(v => !q || normalize(v).includes(q)).slice(0, 400);
    list.innerHTML = shown.map(v => `<label class="pop-item"><input type="checkbox" value="${escape(v)}"${temp.has(v) ? ' checked' : ''}><span>${label(v)}</span><small>${number(counts.get(v))}</small></label>`).join('') || '<p class="pop-empty">Nenhum valor encontrado</p>';
  };
  draw();
  list.addEventListener('change', event => { const v = event.target.value; event.target.checked ? temp.add(v) : temp.delete(v); });
  pop.querySelector('#pf-search').addEventListener('input', draw);
  pop.querySelector('#pf-all').onclick = () => { const all = values.every(v => temp.has(v)); values.forEach(v => all ? temp.delete(v) : temp.add(v)); draw(); };
  const apply = filter => { if (filter) state.filters[key] = filter; else delete state.filters[key]; state.page = 1; closePopover(); render(); };
  pop.querySelector('#pf-apply').onclick = () => apply(temp.size === values.length ? null : { type: 'set', values: new Set(temp) });
  pop.querySelector('#pf-clear').onclick = () => apply(null);
  if (c.numeric) {
    const op = pop.querySelector('#nf-op'), a = pop.querySelector('#nf-a'), b = pop.querySelector('#nf-b');
    if (current?.type === 'range') { op.value = current.op; a.value = current.a; if (current.op === 'between') { b.hidden = false; b.value = current.b; } }
    op.onchange = () => { b.hidden = op.value !== 'between'; };
    const go = () => { if (a.value === '' || (op.value === 'between' && b.value === '')) return a.focus(); apply({ type: 'range', op: op.value, a: Number(a.value), b: Number(b.value) }); };
    pop.querySelector('#nf-go').onclick = go;
    [a, b].forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') go(); }));
  }
  setTimeout(() => pop.querySelector(c.numeric ? '#nf-a' : '#pf-search')?.focus(), 20);
}
function openGroupFilter(th) {
  const pop = openPopover(th, `<div class="popover-head"><b>AGRUPAMENTO</b></div><div class="pop-list">${[['parent', 'Produtos pai'], ['variations', 'Variações']].map(([v, l]) => `<label class="pop-item"><input type="checkbox" value="${v}"${state.hierarchy.has(v) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`, 220);
  pop.addEventListener('change', event => {
    event.target.checked ? state.hierarchy.add(event.target.value) : state.hierarchy.delete(event.target.value);
    if (!state.hierarchy.size) { state.hierarchy.add(event.target.value === 'parent' ? 'variations' : 'parent'); pop.querySelectorAll('input').forEach(i => { i.checked = state.hierarchy.has(i.value); }); }
    state.page = 1; render();
  });
  setTimeout(() => pop.querySelector('input')?.focus(), 20);
}
function openColumnManager(anchor) {
  const pop = openPopover(anchor, `<div class="popover-head"><b>COLUNAS</b><span>${visibleColumns().length} visíveis</span></div><div class="pop-list tall">${allowedColumns().map(c => `<label class="pop-item"><input type="checkbox" value="${c.key}"${visibleColumns().includes(c) ? ' checked' : ''}${locked(c) ? ' disabled' : ''}><span>${escape(c.label)}</span></label>`).join('')}</div><div class="popover-actions"><button id="cols-reset" class="pop-btn" type="button">Restaurar padrão</button></div>`, 250);
  pop.addEventListener('change', event => { visibility[event.target.value] = event.target.checked; store.set('drive-cols-v1', visibility); pop.querySelector('.popover-head span').textContent = `${visibleColumns().length} visíveis`; render(); });
  pop.querySelector('#cols-reset').onclick = () => { visibility = {}; store.set('drive-cols-v1', visibility); closePopover(); render(); };
}
$('columns').onclick = event => { event.stopPropagation(); popover ? closePopover() : openColumnManager($('columns')); };

// Header: click sorts, Ctrl/⌘ + click or right click filters.
$('head-row').addEventListener('click', event => {
  const th = event.target.closest('th[data-key]');
  if (!th) return;
  const key = th.dataset.key;
  if (key === '__group') {
    if (event.ctrlKey || event.metaKey) return openGroupFilter(th);
    if (!event.target.closest('#expand-all') || $('expand-all').disabled) return;
    const size = Number($('page-size').value), parents = view.slice((state.page - 1) * size, state.page * size).filter(g => g.kids.length).map(g => g.row.id);
    const open = parents.every(id => state.expanded.has(id));
    parents.forEach(id => open ? state.expanded.delete(id) : state.expanded.add(id));
    return render();
  }
  if (event.ctrlKey || event.metaKey) return openColumnFilter(th, key);
  state.direction = state.sort === key ? -state.direction : 1; state.sort = key; state.page = 1; render();
});
$('head-row').addEventListener('contextmenu', event => {
  const th = event.target.closest('th[data-key]');
  if (!th) return;
  event.preventDefault();
  th.dataset.key === '__group' ? openGroupFilter(th) : openColumnFilter(th, th.dataset.key);
});
$('head-row').addEventListener('change', event => {
  if (event.target.id !== 'select-all') return;
  const ids = allViewIds();
  ids.forEach(id => event.target.checked ? state.selected.add(id) : state.selected.delete(id));
  render();
});
$('rows').addEventListener('click', event => {
  const expand = event.target.closest('[data-expand]');
  if (!expand) return;
  const id = Number(expand.dataset.expand);
  state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
  render(); prioritizeEnrichment();
});
$('rows').addEventListener('change', event => {
  const box = event.target.closest('[data-select]');
  if (!box) return;
  const id = Number(box.dataset.select);
  box.checked ? state.selected.add(id) : state.selected.delete(id);
  // Selecting a parent selects its variations.
  (state.children.get(id) || []).forEach(k => box.checked ? state.selected.add(k) : state.selected.delete(k));
  render();
});
$('selection').onclick = () => { state.selected.clear(); render(); };

// ── API ──────────────────────────────────────────────────────
async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (data.login) { location.replace('/'); throw new Error('Sessão encerrada.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir a consulta.'), { status: response.status, retryAfter: data.retryAfter });
  return data;
}
function resetCatalog() {
  state.products = []; state.byId = new Map(); state.total = 0; state.complete = false; state.page = 1;
  state.stock = new Map(); state.children = new Map(); state.parentOf = new Map(); state.grade = new Map();
  state.variationsDone = new Set(); state.stockDone = new Set(); state.selected.clear(); state.expanded.clear(); state.enrichNote = ''; state.stockPages = null;
  state.stockComplete = false; state.syncedAt = null;
}
async function loadProducts() {
  if (!state.authenticated || state.loading) return;
  const generation = ++state.generation;
  state.loading = true; resetCatalog();
  const importStartedAt = olistNow();
  $('refresh').disabled = true; $('refresh').classList.add('spinning'); notice(''); render();
  let offset = 0, retries = 0;
  try {
    while (generation === state.generation) {
      let data;
      try { data = await api(`/api/products?limit=100&offset=${offset}${store.get('drive-only-active', true) ? '&situacao=A' : ''}`); retries = 0; }
      catch (error) {
        if (error.status === 429 && retries++ < 3) {
          const seconds = error.retryAfter || 30;
          notice(`A Olist limitou as consultas. Retomando em ${seconds} segundos; ${number(state.products.length)} produtos já recebidos.`);
          await sleep(seconds * 1000); continue;
        }
        throw error;
      }
      if (generation !== state.generation) return;
      for (const p of data.itens) if (!state.byId.has(p.id)) { state.byId.set(p.id, p); state.products.push(p); }
      state.total = Number(data.paginacao?.total ?? state.products.length);
      offset += data.itens.length;
      $('footer-label').textContent = `Importando ${number(state.products.length)} de ${number(state.total)} produtos…`;
      render();
      if (offset >= state.total || !data.itens.length) {
        if (offset < state.total) throw new Error('A Olist interrompeu a paginação antes do total informado. Importe novamente para tentar outra vez.');
        state.complete = true; break;
      }
      await sleep(1200);
    }
    if (generation !== state.generation) return;
    notice('');
    const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    $('footer-label').textContent = `${number(state.products.length)} produtos importados às ${time} · Olist ERP`;
  } catch (error) {
    if (generation !== state.generation) return;
    if (error.status === 401) { connection(false); resetCatalog(); }
    notice(error.message, true, state.authenticated);
    $('footer-label').textContent = state.products.length ? `${number(state.products.length)} produtos carregados · Lista incompleta` : 'Aguardando conexão com a Olist';
  } finally {
    if (generation === state.generation) {
      state.loading = false; $('refresh').disabled = !state.authenticated; $('refresh').classList.remove('spinning'); render();
      // Save right away so the catalog survives the page closing while stock/variations load; enrichment saves again when done.
      if (state.complete) { state.syncedAt = importStartedAt; saveCache().finally(() => { if (generation === state.generation && store.get('drive-auto-enrich', true)) runEnrichment(generation, true); }); }
    }
  }
}

// ── Enrichment: variations (grouping) then stock ─────────────
let wake = null;
function prioritizeEnrichment() { wake?.(); }
function nextIds(candidates, limit) {
  const visible = new Set(state.visibleIds);
  return [...candidates.filter(id => visible.has(id)), ...candidates.filter(id => !visible.has(id))].slice(0, limit);
}
async function enrichStep(generation, phase) {
  const pending = phase === 'variations'
    ? state.products.filter(p => p.tipoVariacao === 'P' && !state.variationsDone.has(p.id)).map(p => p.id)
    : state.products.filter(p => !state.stockDone.has(p.id) && !kidsOf(p.id).length && (p.tipoVariacao !== 'P' || state.variationsDone.has(p.id))).map(p => p.id);
  if (!pending.length) return false;
  const ids = nextIds(pending, phase === 'variations' ? 8 : 15);
  const data = await api(`/api/${phase === 'variations' ? 'variations' : 'stock'}?ids=${ids.join(',')}`);
  if (generation !== state.generation) return false;
  for (const [key, value] of Object.entries(data.items || {})) {
    const pid = Number(key);
    if (phase === 'variations') {
      state.variationsDone.add(pid);
      const kids = (value || []).filter(v => Number.isSafeInteger(v.id));
      state.children.set(pid, kids.map(v => v.id));
      kids.forEach(v => { state.parentOf.set(v.id, pid); if (v.grade) state.grade.set(v.id, v.grade); });
    } else {
      state.stockDone.add(pid);
      if (value) state.stock.set(pid, value);
    }
  }
  if (data.retryAfter) { state.enrichNote = `Limite da Olist atingido — retomando em ${data.retryAfter}s`; render(); await sleep(data.retryAfter * 1000); state.enrichNote = ''; }
  else if (data.error) { state.enrichNote = data.error; ids.forEach(id => (phase === 'variations' ? state.variationsDone : state.stockDone).add(id)); }
  render();
  return true;
}
// Whole-catalog stock in pages of 100. Falls back to per-product calls if the endpoint is unavailable.
async function stockListPass(generation) {
  let offset = 0;
  while (generation === state.generation) {
    let data;
    try { data = await api(`/api/stock-list?offset=${offset}`); }
    catch (error) {
      if (error.status === 429) { state.enrichNote = `Limite da Olist atingido — retomando em ${error.retryAfter || 30}s`; render(); await sleep((error.retryAfter || 30) * 1000); state.enrichNote = ''; continue; }
      if (error.status === 404 || error.status === 400) return false;
      throw error;
    }
    if (generation !== state.generation) return true;
    for (const item of data.itens) if (state.byId.has(item.id)) { state.stock.set(item.id, item); state.stockDone.add(item.id); }
    offset += data.itens.length;
    state.stockPages = { done: offset, total: Number(data.paginacao?.total ?? offset) };
    render();
    if (!data.itens.length || offset >= state.stockPages.total) break;
    await sleep(400);
  }
  if (generation === state.generation) { state.products.forEach(p => state.stockDone.add(p.id)); state.stockPages = null; state.stockComplete = true; }
  return true;
}
async function runEnrichment(generation, full = false) {
  while (state.enriching) { await sleep(200); if (generation !== state.generation) return; }
  state.enriching = true; render();
  try {
    const listed = full ? await stockListPass(generation) : false;
    // Save early: if the page closes while variations load, the next visit resumes from here.
    if (listed && generation === state.generation) await saveCache(cache.events.map(e => e.key));
    for (const phase of listed ? ['variations'] : ['variations', 'stock']) {
      while (generation === state.generation && await enrichStep(generation, phase)) await new Promise(done => { wake = done; setTimeout(done, 350); });
    }
    if (generation === state.generation) {
      if (!full || !listed) state.stockComplete = state.products.every(p => state.stockDone.has(p.id) || kidsOf(p.id).length);
      // A full import already reflects every pending webhook event.
      if (full) await saveCache(cache.events.map(e => e.key));
    }
  } catch (error) {
    if (generation === state.generation) {
      if (error.status === 401) connection(false);
      state.enrichNote = `Estoque/variações interrompidos: ${error.message}`;
    }
  } finally { wake = null; state.enriching = false; if (generation === state.generation) render(); }
}
function renderEnrichLabel() {
  const parents = state.products.filter(p => p.tipoVariacao === 'P').length;
  const stockTarget = state.products.filter(p => !kidsOf(p.id).length).length;
  const parts = [];
  if (state.complete && parents) parts.push(`Variações ${number(state.variationsDone.size)}/${number(parents)}`);
  if (state.stockPages) parts.push(`Estoque ${number(state.stockPages.done)}/${number(state.stockPages.total)}`);
  else if (state.complete && stockTarget) parts.push(`Estoque ${number(Math.min(state.stockDone.size, stockTarget))}/${number(stockTarget)}`);
  if (state.syncing) parts.push('Sincronizando alterações da Olist…');
  else if (state.savedAt) parts.push(`Cache salvo às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(state.savedAt)}${state.lastChanges != null ? ` · ${number(state.lastChanges)} alterações aplicadas` : ''}`);
  if (cache.events.length && !state.syncing) parts.push(`${number(cache.events.length)} avisos de estoque pendentes`);
  if (cache.storage === 'memory') parts.push('Cache desativado (configure o Vercel Blob)');
  if (state.enrichNote) parts.push(state.enrichNote);
  $('enrich-label').textContent = parts.join(' · ');
  $('enrich-label').classList.toggle('busy', state.enriching || !!state.syncing);
}

// ── Cache (Vercel Blob) and incremental sync ─────────────────
const cache = { events: [], storage: '' };
function olistNow(minusMinutes = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(Date.now() - minusMinutes * 60000)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`;
}
function hydrate(c) {
  resetCatalog();
  for (const p of c.products) if (p && !state.byId.has(p.id)) { state.byId.set(p.id, p); state.products.push(p); }
  state.stock = new Map(c.stock || []);
  state.children = new Map(c.children || []);
  state.children.forEach((kids, pid) => kids.forEach(k => state.parentOf.set(k, pid)));
  state.grade = new Map(c.grade || []);
  state.variationsDone = new Set(c.variationsDone || []);
  state.stockComplete = !!c.stockComplete;
  (state.stockComplete ? state.products.map(p => p.id) : [...state.stock.keys()]).forEach(id => state.stockDone.add(id));
  state.total = state.products.length; state.complete = true; state.syncedAt = c.syncedAt || null;
  state.settings = new Map(c.settings || []);
  if (c.defaultMargin != null) state.defaultMargin = Number(c.defaultMargin) || 0;
  if (c.defaultFixedCost != null) state.defaultFixed = Number(c.defaultFixedCost) || 0;
}
function removeProduct(id) {
  state.byId.delete(id); state.products = state.products.filter(p => p.id !== id);
  state.stock.delete(id); state.stockDone.delete(id); state.selected.delete(id); state.grade.delete(id);
  (state.children.get(id) || []).forEach(k => state.parentOf.delete(k));
  state.children.delete(id); state.parentOf.delete(id);
}
async function saveCache(consumed = []) {
  if (!state.complete || !state.products.length || cache.storage === 'memory') return;
  const catalog = { v: 1, onlyActive: store.get('drive-only-active', true), syncedAt: state.syncedAt, stockComplete: !!state.stockComplete, products: state.products, stock: [...state.stock], children: [...state.children], grade: [...state.grade], variationsDone: [...state.variationsDone] };
  const json = JSON.stringify({ catalog, consumed });
  let body = json, headers = { 'Content-Type': 'application/json' };
  if ('CompressionStream' in window) {
    body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    headers = { 'Content-Type': 'application/octet-stream', 'X-Body-Encoding': 'gzip' };
  }
  try {
    await api('/api/cache', { method: 'PUT', headers, body });
    cache.events = cache.events.filter(e => !consumed.includes(e.key));
    state.savedAt = new Date(); render();
  } catch (error) { state.enrichNote = `Não foi possível salvar o cache: ${error.message}`; render(); }
}
// Applies what changed in Olist since the last sync, plus products flagged by the stock webhook.
async function syncIncremental() {
  if (!state.authenticated || !state.syncedAt || state.loading || state.enriching) return;
  const generation = ++state.generation, startedAt = olistNow();
  const consumed = cache.events.map(e => e.key);
  state.syncing = true; render();
  try {
    const changed = [];
    let offset = 0;
    while (generation === state.generation) {
      let data;
      try { data = await api(`/api/products?limit=100&offset=${offset}&dataAlteracao=${encodeURIComponent(state.syncedAt)}`); }
      catch (error) { if (error.status === 429) { await sleep((error.retryAfter || 30) * 1000); continue; } throw error; }
      changed.push(...data.itens); offset += data.itens.length;
      if (!data.itens.length || offset >= Number(data.paginacao?.total ?? 0)) break;
      await sleep(800);
    }
    if (generation !== state.generation) return;
    const onlyActive = store.get('drive-only-active', true);
    for (const p of changed) {
      if (onlyActive && p.situacao !== 'A') { removeProduct(p.id); continue; }
      if (state.byId.has(p.id)) state.products[state.products.findIndex(x => x.id === p.id)] = p; else state.products.push(p);
      state.byId.set(p.id, p); state.stockDone.delete(p.id);
      if (p.tipoVariacao === 'P') state.variationsDone.delete(p.id);
    }
    cache.events.forEach(e => e.ids.forEach(id => state.stockDone.delete(id)));
    state.total = state.products.length; state.lastChanges = changed.length + cache.events.reduce((n, e) => n + e.ids.length, 0);
    render();
    state.syncing = false;
    await runEnrichment(generation);
    if (generation === state.generation) { state.syncedAt = startedAt; await saveCache(consumed); }
  } catch (error) {
    if (generation === state.generation) { if (error.status === 401) connection(false); state.enrichNote = `Sincronização interrompida: ${error.message}`; }
  } finally { state.syncing = false; if (generation === state.generation) render(); }
}

// ── Toolbar, pagination, keyboard ────────────────────────────
$('refresh').onclick = loadProducts;
$('import').onclick = loadProducts;
$('search').oninput = () => { state.page = 1; render(); };
$('page-size').value = String(store.get('drive-page-size', 50));
$('default-page-size').value = $('page-size').value;
$('page-size').onchange = () => { state.page = 1; render(); prioritizeEnrichment(); };
$('default-page-size').onchange = () => { store.set('drive-page-size', Number($('default-page-size').value)); $('page-size').value = $('default-page-size').value; state.page = 1; render(); };
$('only-active').checked = store.get('drive-only-active', true);
$('only-active').onchange = () => store.set('drive-only-active', $('only-active').checked);
$('auto-enrich').checked = store.get('drive-auto-enrich', true);
$('auto-enrich').onchange = () => { store.set('drive-auto-enrich', $('auto-enrich').checked); if ($('auto-enrich').checked && state.complete) runEnrichment(state.generation); };
function goTo(page) { state.page = page; render(); document.querySelector('.table-region').scrollTop = 0; prioritizeEnrichment(); }
$('first').onclick = () => goTo(1);
$('previous').onclick = () => goTo(state.page - 1);
$('next').onclick = () => goTo(state.page + 1);
$('last').onclick = () => goTo(Infinity);
document.addEventListener('keydown', event => { if (event.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search').focus(); } });
$('logout').onclick = async () => {
  $('logout').disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Não foi possível desconectar. Tente novamente.');
    ++state.generation; state.loading = false; resetCatalog();
    connection(false); $('refresh').classList.remove('spinning'); closeDrawer($('account-dialog')); notice(''); render();
    $('footer-label').textContent = 'Aguardando conexão com a Olist';
  } catch (error) { notice(error.message, true); } finally { $('logout').disabled = false; }
};
async function appLogout() {
  try { await fetch('/auth/app-logout', { method: 'POST' }); } finally { location.replace('/'); }
}
$('app-logout').onclick = appLogout;
$('settings-logout').onclick = appLogout;
$('copy-callback').onclick = async () => {
  try { await navigator.clipboard.writeText($('callback').textContent); $('copy-callback').innerHTML = '✓'; setTimeout(() => { $('copy-callback').innerHTML = icon('copy'); }, 1800); }
  catch { notice('Selecione e copie a URL de redirecionamento exibida abaixo.'); }
};

// ── Export ───────────────────────────────────────────────────
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
$('export').onclick = () => {
  const ids = state.selected.size ? [...state.selected] : allViewIds();
  const products = ids.map(id => state.byId.get(id)).filter(Boolean);
  if (state.role !== 'admin') {
    const cols = visibleColumns();
    const content = '\uFEFF' + [cols.map(c => c.label), ...products.map(p => cols.map(c => c.value(p)))].map(row => row.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `catalogo-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const columns = ['Produto', 'SKU', 'Situação', 'Estoque disponível', 'Saldo em estoque', 'Reservado', 'Preço de venda', 'Preço promocional', 'Preço de custo', 'Unidade', 'GTIN', 'Tipo', 'Variação', 'ID produto pai', 'Grade', 'Localização', 'Última alteração', 'ID Olist'];
  const rows = products.map(p => [p.descricao, p.sku, p.situacao, stockOf(p), stockOf(p, 'saldo'), stockOf(p, 'reservado'), p.precos?.preco, p.precos?.precoPromocional, p.precos?.precoCusto, p.unidade, p.gtin, p.tipo, p.tipoVariacao, state.parentOf.get(p.id), state.grade.get(p.id), p.estoque?.localizacao, p.dataAlteracao, p.id]);
  const content = '﻿' + [columns, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `drive-maxx-produtos-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ── Drawers: integrations and settings ───────────────────────
function olistStatus(text, kind = '') {
  $('olist-error').hidden = kind !== 'error';
  $('olist-error').textContent = kind === 'error' ? text : '';
  if (kind === 'error') text = 'Falha na conexão';
  const label = document.createElement('span'); label.textContent = text;
  $('olist-status').className = `integration-status ${kind}`.trim();
  $('olist-status').title = text;
  $('olist-status').replaceChildren(document.createElement('i'), label);
}
async function checkOlist() {
  olistStatus('Verificando…');
  try {
    const session = await api('/api/session');
    if (session.authenticated !== state.authenticated) connection(session.authenticated);
    if (!session.authenticated) return olistStatus('Não autenticada');
    const company = await api('/api/company');
    olistStatus(`Autenticada · ${company.razaoSocial || 'conta Olist'}`, 'ok');
  } catch (error) {
    if (error.status === 401) connection(false);
    olistStatus(error.message, 'error');
    $('olist-auth').textContent = 'RECONECTAR'; $('olist-auth').hidden = false;
  }
}
function openDrawer(drawer) { closePopover(); document.querySelectorAll('dialog.drawer[open]').forEach(d => d !== drawer && d.close()); if (!drawer.open) drawer.showModal(); }
function closeDrawer(drawer) {
  if (!drawer.open || drawer.classList.contains('closing')) return;
  drawer.classList.add('closing');
  setTimeout(() => { drawer.close(); drawer.classList.remove('closing'); }, 200);
}
document.querySelectorAll('dialog.drawer').forEach(drawer => {
  drawer.querySelector('.drawer-close').onclick = () => closeDrawer(drawer);
  drawer.addEventListener('cancel', event => { event.preventDefault(); closeDrawer(drawer); });
  drawer.addEventListener('click', event => { if (event.target === drawer) closeDrawer(drawer); });
});
const integrations = () => { openDrawer($('integrations-drawer')); checkOlist(); };
$('integrations').onclick = integrations;
$('settings-integrations').onclick = integrations;
$('settings').onclick = () => openDrawer($('settings-drawer'));
$('settings-columns').onclick = () => { closeDrawer($('settings-drawer')); setTimeout(() => openColumnManager($('columns')), 220); };
$('olist-disconnect').onclick = () => $('account-dialog').showModal();

// ── Start ────────────────────────────────────────────────────
async function init() {
  const auth = new URLSearchParams(location.search).get('auth');
  if (auth) {
    const messages = { invalid: 'A tentativa de autenticação expirou ou é inválida. Clique em autenticar para iniciar novamente.', denied: 'A autorização na Olist foi cancelada. Você pode tentar novamente.', failed: 'A Olist não aceitou a autenticação. Confira as credenciais e a URL de retorno cadastrada.', success: '', customer: '', 'customer-denied': 'A autorização na sua Olist foi cancelada. Você pode tentar novamente em Integrações.', 'customer-failed': 'A Olist não aceitou a autenticação. Confira o Client ID, o Client Secret e a URL de redirecionamento do aplicativo.', 'customer-missing': 'Cadastre as chaves do aplicativo Olist antes de autenticar.' };
    state.authReturn = auth;
    notice(messages[auth] || '', !!messages[auth]);
    history.replaceState(null, '', '/');
  }
  try {
    const me = await api('/api/me');
    state.role = me.role || 'admin'; state.database = !!me.database; state.defaultMargin = Number(me.tenant?.defaultMargin || 0); state.defaultFixed = Number(me.tenant?.defaultFixedCost || 0);
    if (typeof applyRole === 'function') applyRole(me);
    $('app-user').textContent = me.name || me.user || '—';
    $('app-logout').hidden = $('settings-logout').hidden = !me.gate;
    if (state.role !== 'admin') return await initBuyer();
    const [data, saved] = await Promise.all([api('/api/session'), api('/api/cache').catch(() => null)]);
    if (saved) {
      cache.storage = saved.storage; cache.events = saved.events || [];
      if (saved.catalog?.products?.length) {
        hydrate(saved.catalog);
        state.savedAt = saved.catalog.savedAt ? new Date(saved.catalog.savedAt) : null;
        $('footer-label').textContent = `${number(state.products.length)} produtos do cache · Olist ERP`;
      }
    }
    $('callback').textContent = data.redirectUri;
    connection(data.authenticated);
    if (!state.products.length) $('footer-label').textContent = data.authenticated ? 'Olist conectada · importe os produtos' : 'Aguardando conexão com a Olist';
    if (!data.configured) { $('connect').hidden = true; notice('As credenciais Olist ainda não foram configuradas no servidor.', true); }
    render();
    if (state.complete && data.authenticated) syncIncremental();
  } catch (error) { if (error.message !== 'Sessão encerrada.') notice('Não foi possível conectar ao servidor. Verifique a conexão e recarregue a página.', true); }
  finally { state.booting = false; render(); }
}
render();
init();
