import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { cookieSessions } from './session.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const AUTH = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth';
const TOKEN = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token';
const API = 'https://api.tiny.com.br/public-api/v3';
const id = () => randomBytes(32).toString('base64url');
const fault = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function createApp(config, fetcher = fetch) {
  const localSessions = new Map();
  if (config.serverless && !config.sessionSecret) throw new Error('SESSION_SECRET is required');
  const origin = new URL(config.redirectUri).origin;
  const secure = origin.startsWith('https:');
  const cookie = (value, age = 86400) => `drive_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  }
  function redirect(res, location, headers = {}) { res.writeHead(302, { Location: location, ...headers }); res.end(); }
  async function tokenRequest(fields) {
    let response;
    try {
      response = await fetcher(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }), signal: AbortSignal.timeout(25000) });
    } catch { throw fault(502, 'Não foi possível conectar à Olist. Verifique a conexão e tente novamente.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw fault(response.status === 400 || response.status === 401 ? 401 : 502, 'A Olist não aceitou a autenticação. Confira as credenciais e a URL de redirecionamento e conecte novamente.');
    return data;
  }
  function saveTokens(session, data) {
    session.tokens = { access_token: data.access_token, refresh_token: data.refresh_token || session.tokens?.refresh_token, expiresAt: Date.now() + Number(data.expires_in || 300) * 1000 };
  }
  async function refresh(session) {
    if (!session.tokens?.refresh_token) { session.tokens = null; throw fault(401, 'Sua sessão expirou. Conecte sua conta Olist novamente.'); }
    if (!session.refreshing) session.refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token }).then(data => saveTokens(session, data)).catch(error => { if (error.status === 401) session.tokens = null; throw error; }).finally(() => { session.refreshing = null; });
    await session.refreshing;
  }
  async function olist(session, path) {
    if (!session?.tokens) throw fault(401, 'Conecte sua conta Olist para consultar os produtos.');
    if (session.tokens.expiresAt < Date.now() + 30000) await refresh(session);
    const request = () => fetcher(`${API}${path}`, { headers: { Authorization: `Bearer ${session.tokens.access_token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    let response;
    try { response = await request(); if (response.status === 401) { await refresh(session); response = await request(); } }
    catch (error) { if (error.status) throw error; throw fault(502, 'A Olist não respondeu. Tente atualizar a lista em instantes.'); }
    if (response.status === 401) { session.tokens = null; throw fault(401, 'Sua sessão expirou. Conecte novamente.'); }
    if (response.status === 403) throw fault(403, 'Acesso negado. Habilite a permissão de leitura de Produtos no aplicativo da Olist e autentique novamente.');
    if (response.status === 429) throw fault(429, 'Limite de consultas da Olist atingido. A lista será retomada automaticamente.', { retryAfter: Math.min(120, Math.max(5, Number(response.headers.get('retry-after')) || 30)) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw fault(502, 'Não foi possível consultar os produtos na Olist. Tente novamente.');
    if (!data || !Array.isArray(data.itens)) throw fault(502, 'A Olist retornou uma lista de produtos em formato inesperado.');
    return data;
  }
  return http.createServer(async (req, res) => {
    const sessions = config.serverless ? cookieSessions(req, res, config.sessionSecret, secure) : localSessions;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, origin);
      const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (!isLocal && url.origin !== origin) throw fault(400, 'Host inválido.');
      const localHosts = [`localhost:${config.port}`, `127.0.0.1:${config.port}`];
      if (req.headers.host && ![new URL(origin).host, ...localHosts, ...(config.aliases || [])].includes(req.headers.host)) throw fault(400, 'Host inválido.');
      // Login and callback must use the same HTTPS hostname so the session cookie returns.
      if (secure && req.headers.host !== new URL(origin).host) return redirect(res, `${origin}${url.pathname}${url.search}`);
      const sid = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('drive_session='))?.slice('drive_session='.length);
      const session = sessions.get(sid);
      if (session) session.lastSeen = Date.now();
      for (const [key, value] of sessions) if (Date.now() - value.lastSeen > 86400000) sessions.delete(key);
      if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { authenticated: !!session?.tokens, redirectUri: config.redirectUri, configured: !!(config.clientId && config.clientSecret) });
      if (req.method === 'GET' && url.pathname === '/auth/login') {
        if (!config.clientId || !config.clientSecret) throw fault(503, 'Configure OLIST_CLIENT_ID e OLIST_CLIENT_SECRET no servidor.');
        const sessionId = id(), state = id(), verifier = id();
        sessions.set(sessionId, { state, verifier, authStarted: Date.now(), lastSeen: Date.now(), tokens: null });
        const target = new URL(AUTH);
        target.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, scope: 'openid', response_type: 'code', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        return redirect(res, target.href, { 'Set-Cookie': cookie(sessionId) });
      }
      if (req.method === 'GET' && (url.pathname === '/auth/callback' || (url.pathname === new URL(config.redirectUri).pathname && (url.searchParams.has('code') || url.searchParams.has('error'))))) {
        if (!session?.state || url.searchParams.get('state') !== session.state || Date.now() - session.authStarted > 600000) return redirect(res, '/?auth=invalid');
        const verifier = session.verifier;
        delete session.state; delete session.verifier;
        if (url.searchParams.has('error')) return redirect(res, '/?auth=denied');
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, '/?auth=invalid');
        try {
          const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: verifier });
          const nextSid = id(); sessions.delete(sid);
          const nextSession = { lastSeen: Date.now() }; saveTokens(nextSession, tokens); sessions.set(nextSid, nextSession);
          return redirect(res, '/?auth=success', { 'Set-Cookie': cookie(nextSid) });
        } catch { return redirect(res, '/?auth=failed'); }
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        if (req.headers.origin !== origin) throw fault(403, 'Origem inválida.');
        sessions.delete(sid); return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
      }
      if (req.method === 'GET' && url.pathname === '/api/products') {
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fault(400, 'Paginação inválida.');
        return send(res, 200, await olist(session, `/produtos?${new URLSearchParams({ limit, offset })}`));
      }
      const files = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/styles.css': ['public/styles.css', 'text/css'], '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'] };
      if (req.method === 'GET' && files[url.pathname]) {
        const [file, type] = files[url.pathname];
        const body = await readFile(resolve(root, file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(body);
      }
      send(res, 404, { error: 'Página não encontrada.' });
    } catch (error) { send(res, error.status || 500, { error: error.status ? error.message : 'Ocorreu um erro interno. Tente novamente.', ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = await readFile(resolve(root, 'config.local.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  const port = Number(process.env.PORT || local.port || 3000);
  const config = { clientId: process.env.OLIST_CLIENT_ID || local.clientId, clientSecret: process.env.OLIST_CLIENT_SECRET || local.clientSecret, redirectUri: process.env.OLIST_REDIRECT_URI || local.redirectUri || `http://localhost:${port}/auth/callback`, port };
  createApp(config).listen(port, '127.0.0.1', () => console.log(`DRIVE MAXX disponível em http://localhost:${port}\nRetorno OAuth: ${config.redirectUri}`));
}
