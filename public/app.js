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
  link: '<path d="m10 13 4-4m-6 1-3 3a4 4 0 0 0 6 6l3-3m-4-6 3-3a4 4 0 0 1 6 6l-3 3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plug: '<path d="M9 2v5m6-5v5M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.box}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const $ = id => document.getElementById(id);
const state = { authenticated: false, products: [], filtered: [], total: 0, complete: false, loading: false, generation: 0, page: 1, sort: 'descricao', direction: 1 };
const money = value => value == null || value === '' ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const number = value => new Intl.NumberFormat('pt-BR').format(value);
const date = value => { if (!value) return '—'; const d = new Date(String(value).replace(' ', 'T')); return Number.isNaN(+d) ? String(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d); };

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  $('theme').setAttribute('aria-label', theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
  try { localStorage.setItem('drive-theme', theme); } catch {}
}
let preferredTheme;
try { preferredTheme = localStorage.getItem('drive-theme'); } catch {}
setTheme(preferredTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

function notice(message, error = false, retry = false) {
  $('notice').hidden = !message;
  $('notice').className = error ? 'error' : '';
  $('notice').replaceChildren(document.createTextNode(message));
  if (retry) { const button = document.createElement('button'); button.textContent = 'Tentar novamente'; button.onclick = () => loadProducts(); $('notice').append(button); }
}
function connection(authenticated) {
  state.authenticated = authenticated;
  $('connection').innerHTML = `<i></i> Olist ${authenticated ? 'conectada' : 'desconectada'}`;
  $('connection').classList.toggle('connected', authenticated);
  $('account-label').textContent = authenticated ? 'Conta conectada' : 'Conectar conta';
  $('account').title = authenticated ? 'Gerenciar conexão Olist' : 'Conectar conta Olist';
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
function render() {
  const needle = normalize($('search').value.trim()), status = $('status').value;
  state.filtered = state.products.filter(p => (!status || p.situacao === status) && (!needle || normalize(`${p.descricao} ${p.sku || ''} ${p.gtin || ''} ${p.id}`).includes(needle)));
  state.filtered.sort((a, b) => {
    if (state.sort === 'preco') return ((Number(a.precos?.preco) || 0) - (Number(b.precos?.preco) || 0)) * state.direction;
    return String(a[state.sort] ?? '').localeCompare(String(b[state.sort] ?? ''), 'pt-BR', { numeric: true }) * state.direction;
  });
  const size = Number($('page-size').value), pages = Math.max(1, Math.ceil(state.filtered.length / size));
  state.page = Math.min(pages, state.page);
  const start = (state.page - 1) * size, products = state.filtered.slice(start, start + size);
  $('count').textContent = number(state.total || state.products.length);
  $('view-count').textContent = number(state.filtered.length);
  $('rows').innerHTML = products.map(p => {
    const situation = { A: 'Ativo', I: 'Inativo', E: 'Excluído' }[p.situacao] || 'Não informado';
    return `<tr><td class="product-col" title="${escape(p.descricao)}"><div class="product-cell"><span class="product-icon">${icon('box')}</span><span class="product-text"><span class="product-name">${escape(p.descricao || 'Produto sem descrição')}</span><span class="product-sub">${escape(p.sku || `ID ${p.id}`)}</span></span></div></td><td class="mono">${escape(p.sku || '—')}</td><td><span class="status-pill ${p.situacao === 'E' ? 'deleted' : p.situacao !== 'A' ? 'inactive' : ''}"><i></i>${situation}</span></td><td class="numeric">${money(p.precos?.preco)}</td><td class="numeric">${money(p.precos?.precoPromocional)}</td><td class="numeric">${money(p.precos?.precoCusto)}</td><td>${escape(p.unidade || '—')}</td><td class="mono">${escape(p.gtin || '—')}</td><td>${escape({ P: 'Produto', S: 'Serviço', K: 'Kit', F: 'Fabricado', M: 'Matéria-prima' }[p.tipo] || p.tipo || '—')}</td><td>${escape({ N: 'Simples', P: 'Produto pai', V: 'Variação' }[p.tipoVariacao] || p.tipoVariacao || '—')}</td><td title="${escape(p.estoque?.localizacao)}">${escape(p.estoque?.localizacao || '—')}</td><td>${escape(date(p.dataAlteracao))}</td><td class="mono">${escape(p.id)}</td></tr>`;
  }).join('');
  $('empty').hidden = products.length > 0;
  if (state.authenticated) {
    $('empty-title').textContent = state.loading ? 'Buscando seus produtos...' : state.products.length ? 'Nenhum produto encontrado' : state.complete ? 'Seu catálogo está vazio' : 'Vamos carregar seu catálogo';
    $('empty-description').textContent = state.loading ? 'Estamos consultando os produtos da sua conta Olist.' : state.products.length ? 'Tente outro nome, SKU ou situação para encontrar o produto.' : state.complete ? 'Nenhum produto foi retornado pela conta Olist autenticada.' : 'Clique em Importar produtos para buscar o catálogo da sua conta Olist.';
  } else {
    $('empty-title').textContent = 'Seus produtos. Mais perto.';
    $('empty-description').innerHTML = 'Conecte sua conta Olist para visualizar, buscar e<br> organizar todos os produtos do seu catálogo.';
  }
  $('import').hidden = !state.authenticated || state.loading || state.products.length > 0;
  $('range').textContent = state.filtered.length ? `${number(start + 1)}–${number(start + products.length)} de ${number(state.filtered.length)}` : '0 produtos';
  $('page-label').textContent = `${state.page} / ${pages}`;
  $('previous').disabled = state.page <= 1;
  $('next').disabled = state.page >= pages;
  $('export').disabled = state.loading || !state.filtered.length || !state.complete;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path) {
  const response = await fetch(path, { credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir a consulta.'), { status: response.status, retryAfter: data.retryAfter });
  return data;
}
async function loadProducts() {
  if (!state.authenticated || state.loading) return;
  const generation = ++state.generation;
  state.loading = true; state.complete = false; state.products = []; state.total = 0; state.page = 1;
  $('refresh').disabled = true; $('refresh').classList.add('spinning'); notice(''); render();
  let offset = 0, retries = 0;
  const seen = new Set();
  try {
    while (generation === state.generation) {
      let data;
      try { data = await api(`/api/products?limit=100&offset=${offset}`); retries = 0; }
      catch (error) {
        if (error.status === 429 && retries++ < 3) {
          const seconds = error.retryAfter || 30;
          notice(`A Olist limitou as consultas. Retomando em ${seconds} segundos; ${number(state.products.length)} produtos já recebidos.`);
          await sleep(seconds * 1000); continue;
        }
        throw error;
      }
      if (generation !== state.generation) return;
      for (const p of data.itens) if (!seen.has(p.id)) { seen.add(p.id); state.products.push(p); }
      state.total = Number(data.paginacao?.total ?? state.products.length);
      offset += data.itens.length;
      $('sync-label').textContent = `Carregando ${number(state.products.length)} de ${number(state.total)} produtos`;
      $('footer-label').textContent = 'Sincronizando catálogo com a Olist…';
      render();
      if (offset >= state.total || !data.itens.length) {
        if (offset < state.total) throw new Error('A Olist interrompeu a paginação antes do total informado. Atualize para tentar novamente.');
        state.complete = true; break;
      }
      await sleep(1200);
    }
    if (generation !== state.generation) return;
    notice('');
    const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    $('sync-label').textContent = `Atualizado às ${time}`;
    $('footer-label').textContent = 'Todos os produtos carregados · Olist ERP';
  } catch (error) {
    if (generation !== state.generation) return;
    if (error.status === 401) { connection(false); state.products = []; state.total = 0; }
    notice(error.message, true, state.authenticated);
    $('sync-label').textContent = 'Não foi possível concluir a atualização';
    $('footer-label').textContent = state.products.length ? `${number(state.products.length)} produtos carregados · Lista incompleta` : 'Aguardando conexão com a Olist';
  } finally {
    if (generation === state.generation) { state.loading = false; $('refresh').disabled = !state.authenticated; $('refresh').classList.remove('spinning'); render(); }
  }
}
$('refresh').onclick = loadProducts;
$('import').onclick = loadProducts;
$('search').oninput = () => { state.page = 1; render(); };
$('status').onchange = () => { state.page = 1; render(); };
$('page-size').onchange = () => { state.page = 1; render(); };
function changePage(delta) { state.page += delta; render(); document.querySelector('.table-region').scrollTop = 0; }
$('previous').onclick = () => changePage(-1);
$('next').onclick = () => changePage(1);
document.querySelectorAll('[data-sort]').forEach(button => {
  button.onclick = () => {
    state.direction = state.sort === button.dataset.sort ? -state.direction : 1; state.sort = button.dataset.sort;
    document.querySelectorAll('th[aria-sort]').forEach(el => el.removeAttribute('aria-sort'));
    button.closest('th').setAttribute('aria-sort', state.direction === 1 ? 'ascending' : 'descending'); render();
  };
});
document.addEventListener('keydown', event => { if (event.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !$('account-dialog').open) { event.preventDefault(); $('search').focus(); } });
$('account').onclick = () => state.authenticated ? $('account-dialog').showModal() : location.assign('/auth/login');
$('logout').onclick = async () => {
  $('logout').disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Não foi possível desconectar. Tente novamente.');
    ++state.generation; state.loading = false; state.products = []; state.total = 0; state.complete = false;
    connection(false); $('refresh').classList.remove('spinning'); $('account-dialog').close(); notice(''); render();
    $('sync-label').textContent = 'Seu catálogo, conectado à Olist.'; $('footer-label').textContent = 'Aguardando conexão com a Olist';
  } catch (error) { notice(error.message, true); } finally { $('logout').disabled = false; }
};
$('copy-callback').onclick = async () => {
  try { await navigator.clipboard.writeText($('callback').textContent); $('copy-callback').innerHTML = '✓'; setTimeout(() => { $('copy-callback').innerHTML = icon('copy'); }, 1800); }
  catch { notice('Selecione e copie a URL de redirecionamento exibida abaixo.'); }
};
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
$('export').onclick = () => {
  const columns = ['Produto', 'SKU', 'Situação', 'Preço de venda', 'Preço promocional', 'Preço de custo', 'Unidade', 'GTIN', 'Tipo', 'Variação', 'Localização', 'Última alteração', 'ID Olist'];
  const rows = state.filtered.map(p => [p.descricao, p.sku, p.situacao, p.precos?.preco, p.precos?.precoPromocional, p.precos?.precoCusto, p.unidade, p.gtin, p.tipo, p.tipoVariacao, p.estoque?.localizacao, p.dataAlteracao, p.id]);
  const content = '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `drive-maxx-produtos-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function olistStatus(text, kind = '') {
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
const drawer = $('integrations-drawer');
function closeDrawer() {
  if (!drawer.open || drawer.classList.contains('closing')) return;
  drawer.classList.add('closing');
  setTimeout(() => { drawer.close(); drawer.classList.remove('closing'); }, 200);
}
$('integrations').onclick = () => { drawer.showModal(); checkOlist(); };
$('integrations-close').onclick = closeDrawer;
drawer.addEventListener('cancel', event => { event.preventDefault(); closeDrawer(); });
drawer.addEventListener('click', event => { if (event.target === drawer) closeDrawer(); });
$('olist-disconnect').onclick = () => $('account-dialog').showModal();
async function init() {
  const auth = new URLSearchParams(location.search).get('auth');
  if (auth) {
    const messages = { invalid: 'A tentativa de autenticação expirou ou é inválida. Clique em autenticar para iniciar novamente.', denied: 'A autorização na Olist foi cancelada. Você pode tentar novamente.', failed: 'A Olist não aceitou a autenticação. Confira as credenciais e cadastre exatamente a URL de retorno local.', success: '' };
    notice(messages[auth] || '', auth !== 'success');
    history.replaceState(null, '', '/');
  }
  try {
    const data = await api('/api/session');
    $('callback').textContent = data.redirectUri;
    connection(data.authenticated);
    if (!data.configured) { $('connect').hidden = true; notice('As credenciais Olist ainda não foram configuradas no servidor local.', true); }
    render();
  } catch { notice('Não foi possível conectar ao servidor local. Verifique se ele está em execução e recarregue a página.', true); }
}
init();
