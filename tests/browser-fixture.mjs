// Isolated browser QA server. No Olist credentials or external calls.
import { createApp } from '../server.mjs';
const products = Array.from({ length: 125 }, (_, index) => ({
  id: index + 1, descricao: `Produto de teste ${String(index + 1).padStart(3, '0')}`,
  sku: `QA-${String(index + 1).padStart(4, '0')}`, situacao: index % 3 === 0 ? 'I' : 'A',
  precos: { preco: 25 + index, precoPromocional: null, precoCusto: 12.5 + index },
  unidade: 'UN', gtin: `789000000${String(index).padStart(4, '0')}`,
  tipo: 'P', tipoVariacao: 'N', estoque: { localizacao: 'Depósito QA' }, dataAlteracao: '2026-10-20 12:00:00'
}));
const app = createApp({ clientId: 'fixture-only', clientSecret: 'fixture-only', redirectUri: 'http://localhost:3001/auth/callback', port: 3001 }, async url => {
  if (url.endsWith('/token')) return Response.json({ access_token: 'fixture', refresh_token: 'fixture', expires_in: 3600 });
  const offset = Number(new URL(url).searchParams.get('offset'));
  return Response.json({ itens: products.slice(offset, offset + 100), paginacao: { total: products.length, limit: 100, offset } });
});
const handler = app.listeners('request')[0];
app.removeAllListeners('request');
app.on('request', (req, res) => {
  if (req.url === '/auth/login') {
    const original = res.writeHead;
    res.writeHead = function (status, headers) {
      const auth = new URL(headers.Location);
      return original.call(this, status, { ...headers, Location: `/auth/callback?code=fixture&state=${auth.searchParams.get('state')}` });
    };
  }
  handler(req, res);
});
app.listen(3001, '127.0.0.1', () => console.log('QA fixture: http://localhost:3001 (dados simulados)'));
