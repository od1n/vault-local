// Vercel Serverless Function: crea una orden de Binance Pay y devuelve la URL de pago.
//
// Binance Pay no entrega el correo del comprador, así que la página lo pide antes de pagar y
// viaja dentro de la orden (passThroughInfo). Binance lo devuelve tal cual al consultar la orden,
// y nadie puede cambiarlo después de crearla.
//
// Si BINANCE_PAY_API_KEY / BINANCE_PAY_SECRET no están configuradas responde 503 y la página
// muestra "todavía no disponible": se puede publicar antes de que Binance apruebe la cuenta.

import crypto from 'node:crypto';
import { BINANCE_PLANS, binanceConfigured, binanceRequest } from './_binance.js';

const SITE = 'https://vault-local.vercel.app';
const PAGES = { es: '/', en: '/en.html', pt: '/pt.html', de: '/de.html' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Límite básico por IP (por instancia; frena abusos simples)
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!binanceConfigured()) return res.status(503).json({ error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ error: 'too_many_requests' });

  const { email, plan, lang } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const p = BINANCE_PLANS[plan];
  const l = PAGES[lang] ? lang : 'es';
  if (!EMAIL_RE.test(mail) || mail.length > 254) return res.status(400).json({ error: 'invalid_email' });
  if (!p) return res.status(400).json({ error: 'invalid_plan' });

  // Solo letras y dígitos, máximo 32
  const merchantTradeNo = `VL${Date.now()}${crypto.randomBytes(6).toString('hex')}`.slice(0, 32);
  const back = `${SITE}${PAGES[l]}`;
  try {
    const data = await binanceRequest('/binancepay/openapi/v3/order', {
      env: { terminalType: 'WEB' },
      merchantTradeNo,
      orderAmount: Number(p.amount),
      currency: 'USDT',
      description: p.goodsName,
      goodsDetails: [
        {
          goodsType: '02', // bien virtual
          goodsCategory: 'Z000', // otros
          referenceGoodsId: plan,
          goodsName: p.goodsName,
        },
      ],
      returnUrl: `${back}?binance=ok#payment`,
      cancelUrl: `${back}?binance=cancel#payment`,
      webhookUrl: `${SITE}/api/binance-webhook`,
      passThroughInfo: JSON.stringify({ e: mail, p: plan, l }),
    });
    console.log(`Orden Binance ${merchantTradeNo} creada: ${plan} para ${mail}`);
    return res.status(200).json({ checkoutUrl: data.checkoutUrl, universalUrl: data.universalUrl });
  } catch (err) {
    console.error('No se pudo crear la orden de Binance Pay:', err);
    return res.status(502).json({ error: 'binance_error' });
  }
}
