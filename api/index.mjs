import { createApp } from '../server.mjs';

let app;
export default function handler(req, res) {
  // Users come from Supabase when configured; otherwise a single admin from APP_USERNAME/APP_PASSWORD.
  const database = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const missing = ['OLIST_CLIENT_ID', 'OLIST_CLIENT_SECRET', 'SESSION_SECRET', ...(database ? [] : ['APP_USERNAME', 'APP_PASSWORD'])].filter(key => !process.env[key]);
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (mínimo de 32 caracteres)');
  if (missing.length) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: `Configure as variáveis na Vercel e publique novamente: ${missing.join(', ')}.`, configured: false }));
  }
  app ||= createApp({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SECRET_KEY,
    cronSecret: process.env.CRON_SECRET,
    appUser: process.env.APP_USERNAME,
    webhookSecret: process.env.WEBHOOK_SECRET,
    // Accepts a custom prefix chosen when connecting the Blob store (e.g. DRIVEMAXX_READ_WRITE_TOKEN).
    blobStoreId: process.env.BLOB_STORE_ID,
    blobToken: process.env.BLOB_READ_WRITE_TOKEN || Object.entries(process.env).find(([key, value]) => key.endsWith('READ_WRITE_TOKEN') && String(value).startsWith('vercel_blob_rw_'))?.[1],
    appPassword: process.env.APP_PASSWORD,
    clientId: process.env.OLIST_CLIENT_ID,
    clientSecret: process.env.OLIST_CLIENT_SECRET,
    redirectUri: process.env.OLIST_REDIRECT_URI || 'https://app.drivemaxx.com.br/',
    sessionSecret: process.env.SESSION_SECRET,
    serverless: true,
    aliases: ['drivemaxx.vercel.app', 'drivemaxx.com.br', 'www.drivemaxx.com.br', process.env.VERCEL_URL].filter(Boolean),
  });
  return app.listeners('request')[0](req, res);
}
