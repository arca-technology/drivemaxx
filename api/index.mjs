import { createApp } from '../server.mjs';

let app;
export default function handler(req, res) {
  const missing = ['OLIST_CLIENT_ID', 'OLIST_CLIENT_SECRET', 'SESSION_SECRET'].filter(key => !process.env[key]);
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (mínimo de 32 caracteres)');
  if (missing.length) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: `Configure as variáveis na Vercel e publique novamente: ${missing.join(', ')}.`, configured: false }));
  }
  app ||= createApp({
    clientId: process.env.OLIST_CLIENT_ID,
    clientSecret: process.env.OLIST_CLIENT_SECRET,
    redirectUri: process.env.OLIST_REDIRECT_URI || 'https://app.drivemaxx.com.br/',
    sessionSecret: process.env.SESSION_SECRET,
    serverless: true,
    aliases: ['drivemaxx.vercel.app', 'drivemaxx.com.br', 'www.drivemaxx.com.br', process.env.VERCEL_URL].filter(Boolean),
  });
  return app.listeners('request')[0](req, res);
}
