import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto, randomUUID } from 'node:crypto';

const crypto = webcrypto;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(ROOT, 'frontend');
const PORT = Number(process.env.PORT || 3000);
const DELIVERY_FEE = 50;
const PRODUCTS = {
  tacos: { name: 'Tacos', price: 250 },
  special_tacos: { name: 'Special Tacos', price: 300 },
  wrap: { name: 'Wrap', price: 200 },
  special_wrap: { name: 'Special Wrap', price: 250 },
  ketchup: { name: 'Ketchup', price: 40 },
  mayonnaise: { name: 'Mayonnaise', price: 40 },
  salsacos_sauce: { name: 'Salsacos Sauce', price: 50 },
  coca_cola: { name: 'Coca-Cola', price: 70 },
  fanta: { name: 'Fanta', price: 70 },
  sprite: { name: 'Sprite', price: 70 },
  water: { name: 'Bottled Water', price: 50 },
  milkshake: { name: 'Milkshake', price: 350 },
  strawberry_shake: { name: 'Strawberry Shake', price: 350 },
  strawberry_mojito: { name: 'Strawberry Mojito', price: 450 },
  mint_mojito: { name: 'Mint Mojito', price: 450 },
  dashen_beer: { name: 'Dashen Beer', price: 120, alcohol: true },
  st_george_beer: { name: 'St. George Beer', price: 120, alcohol: true },
  arada_beer: { name: 'Arada Beer', price: 120, alcohol: true }
};

function json(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extra
  });
  res.end(body);
}
function clean(value, max) {
  return String(value ?? '').replace(/[<>\u0000-\u001F]/g, ' ').trim().slice(0, max);
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyTelegramInitData(initData, botToken) {
  if (typeof initData !== 'string' || !initData || initData.length > 10000) return { ok: false };
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return { ok: false };
  params.delete('hash');
  const pairs = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join('\n');
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    encoder.encode(botToken)
  );
  const checkKey = await crypto.subtle.importKey('raw', secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const calculated = [...new Uint8Array(await crypto.subtle.sign('HMAC', checkKey, encoder.encode(dataCheckString)))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (!constantTimeEqual(calculated, receivedHash.toLowerCase())) return { ok: false };
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) return { ok: false };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { return { ok: false }; }
  return { ok: true, user };
}
async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100_000) throw new Error('Request body too large');
  }
  return JSON.parse(data || '{}');
}
async function telegramSend(token, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data.ok === true, data, status: response.status };
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const requestUrl = new URL(req.url || '/', `http://${host}`);
  const origin = req.headers.origin || '';
  const ownOrigin = `https://${host}`;
  const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const sameOrigin = !origin || origin === ownOrigin || origin === `http://${host}`;
  const corsAllowed = sameOrigin || allowedOrigins.includes(origin.replace(/\/$/, ''));
  const corsHeaders = corsAllowed && origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  } : {};

  if (req.method === 'OPTIONS') {
    if (!corsAllowed) return json(res, 403, { ok: false, error: 'Origin not allowed' });
    res.writeHead(204, corsHeaders); return res.end();
  }
  if (requestUrl.pathname === '/health' || requestUrl.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'Salsacos order API' }, corsHeaders);
  }
  if (requestUrl.pathname === '/api/orders' && req.method === 'POST') {
    if (!corsAllowed) return json(res, 403, { ok: false, error: 'Origin not allowed' });
    if (!process.env.BOT_TOKEN || !process.env.CHANNEL_ID) return json(res, 500, { ok: false, error: 'Order service is not configured. Set BOT_TOKEN and CHANNEL_ID in Render environment variables.' }, corsHeaders);
    try {
      const body = await readJson(req);
      const verified = await verifyTelegramInitData(body.initData, process.env.BOT_TOKEN);
      if (!verified.ok) return json(res, 401, { ok: false, error: 'Telegram verification failed. Reopen the Mini App from Telegram and try again.' }, corsHeaders);
      const name = clean(body.name, 100), phone = clean(body.phone, 40), address = clean(body.address, 500);
      const orderType = ['delivery', 'pickup', 'dine_in'].includes(body.order_type) ? body.order_type : '';
      const payment = ['telebirr', 'cbe', 'cash'].includes(body.payment) ? body.payment : '';
      if (name.length < 2 || phone.replace(/\D/g, '').length < 7 || !orderType || !payment) return json(res, 400, { ok: false, error: 'Please check your name, phone, order type, and payment method.' }, corsHeaders);
      if (orderType === 'delivery' && address.length < 3) return json(res, 400, { ok: false, error: 'Please enter your delivery address.' }, corsHeaders);
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return json(res, 400, { ok: false, error: 'Your cart is empty or invalid.' }, corsHeaders);
      let subtotal = 0, hasAlcohol = false;
      const lines = [], seen = new Set();
      for (const item of body.items) {
        const id = String(item?.id || ''), product = PRODUCTS[id], qty = Number(item?.qty);
        if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20 || seen.has(id)) return json(res, 400, { ok: false, error: 'One or more items are invalid. Please refresh the menu.' }, corsHeaders);
        seen.add(id); subtotal += product.price * qty; hasAlcohol ||= !!product.alcohol;
        lines.push(`• ${product.name} × ${qty} = ${product.price * qty} ETB`);
      }
      if (hasAlcohol && body.age_confirmed !== true) return json(res, 400, { ok: false, error: 'Age confirmation is required for alcohol orders.' }, corsHeaders);
      const fee = orderType === 'delivery' ? DELIVERY_FEE : 0;
      const total = subtotal + fee;
      const orderCode = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      const user = verified.user || {};
      const userLine = user.username ? `@${clean(user.username, 64)}` : (user.id ? `Telegram user ID: ${user.id}` : 'Telegram user: verified');
      const message = [
        '🛎️ NEW SALSACOS ORDER', `Order: #${orderCode}`, '', ...lines, '',
        `Subtotal: ${subtotal} ETB`, `Delivery fee: ${fee} ETB`, `TOTAL: ${total} ETB`, '',
        `Order type: ${orderType.replace('_', ' ')}`, `Payment: ${payment.toUpperCase()}`,
        `Customer: ${name}`, `Phone: ${phone}`,
        `Address: ${orderType === 'delivery' ? address : 'Not required'}`, userLine,
        hasAlcohol ? 'Age confirmation: customer checked the confirmation box' : ''
      ].filter(Boolean).join('\n');
      let channelResult;
      try { channelResult = await telegramSend(process.env.BOT_TOKEN, { chat_id: process.env.CHANNEL_ID, text: message, disable_web_page_preview: true }); }
      catch (e) { console.error('Telegram channel network error:', String(e)); return json(res, 502, { ok: false, error: 'Could not contact Telegram. Your order was not confirmed. Please try again.' }, corsHeaders); }
      if (!channelResult.ok) {
        console.error('Telegram channel send failed:', channelResult.data?.description || channelResult.status);
        return json(res, 502, { ok: false, error: 'Telegram could not accept the order. Check the bot channel permissions and CHANNEL_ID.' }, corsHeaders);
      }
      let privateConfirmationSent = false;
      if (user.id) {
        try {
          const privateResult = await telegramSend(process.env.BOT_TOKEN, { chat_id: user.id, text: `✅ ORDER RECEIVED — SALSACOS\n\nYour order number is #${orderCode}.\nTotal: ${total} ETB\n\nYour order has been sent to our team. Thank you for ordering from Salsacos!` });
          privateConfirmationSent = privateResult.ok;
          if (!privateResult.ok) console.log('Private confirmation not delivered:', privateResult.data?.description || privateResult.status);
        } catch (e) { console.log('Private confirmation failed:', String(e)); }
      }
      return json(res, 200, { ok: true, order_code: orderCode, message: `✅ Order placed successfully! Your order number is #${orderCode}. Total: ${total} ETB. Thank you for ordering from Salsacos!`, total, currency: 'ETB', customer_confirmation_sent: privateConfirmationSent }, corsHeaders);
    } catch (e) {
      console.error('Order API error:', String(e));
      return json(res, 400, { ok: false, error: 'Could not process the order. Check your details and try again.' }, corsHeaders);
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 404, { ok: false, error: 'Not found' });
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';
  const safePath = path.normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
  const filePath = path.join(FRONTEND, safePath);
  if (!filePath.startsWith(FRONTEND + path.sep)) return json(res, 403, { ok: false, error: 'Forbidden' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=300' });
    if (req.method === 'HEAD') return res.end();
    return res.end(data);
  } catch {
    return json(res, 404, { ok: false, error: 'File not found' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Salsacos server listening on port ${PORT}`));
