// Vercel Serverless Function: aviso de Binance Pay -> licencia anual firmada (Ed25519) -> correo.
//
// Mismo criterio que el webhook de PayPal:
//  1. Lo que decide es la orden consultada a Binance con nuestras credenciales (estado PAID,
//     monto, moneda y correo). Un aviso falso no consigue nada: como mucho reenvía la licencia
//     de una orden realmente pagada al correo que el comprador escribió al pagar.
//  2. La firma RSA del aviso se comprueba y se registra como defensa adicional, sin bloquear
//     (Vercel puede entregar el cuerpo ya interpretado y entonces no hay bytes exactos que verificar).
//  3. El id de licencia es la orden: si Binance reintenta, se emite exactamente la misma licencia.
//
// Binance espera HTTP 200 con {"returnCode":"SUCCESS","returnMessage":null}; con "FAIL" reintenta.
//
// Variables de entorno: BINANCE_PAY_API_KEY, BINANCE_PAY_SECRET, LICENSE_PRIVATE_KEY,
// RESEND_API_KEY, RESEND_FROM

import { BINANCE_PLANS, binanceRequest, verifyWebhook } from './_binance.js';
import { PLANS, YEAR, signLicense, sendLicenseEmail } from './_license.js';

const ok = (res) => res.status(200).json({ returnCode: 'SUCCESS', returnMessage: null });
const fail = (res, msg) => res.status(200).json({ returnCode: 'FAIL', returnMessage: msg });

async function rawBodyOf(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.readable && !req.readableEnded) {
    const chunks = [];
    const done = new Promise((resolve) => {
      req.on('data', (c) => chunks.push(c));
      req.on('end', resolve);
      req.on('error', resolve);
      setTimeout(resolve, 2000);
    });
    await done;
    if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const raw = await rawBodyOf(req);
    let event = req.body;
    if (raw && (typeof event !== 'object' || event === null)) event = JSON.parse(raw);
    event = event || {};
    console.log(`Aviso Binance recibido: ${event.bizType} ${event.bizStatus} id=${event.bizIdStr}`);

    try {
      const firmaOk = raw ? await verifyWebhook(req.headers, raw) : false;
      if (!firmaOk) console.error('Firma del aviso Binance no verificada: se continúa con la orden consultada');
    } catch (e) {
      console.error('Error verificando la firma de Binance:', e.message);
    }

    if (event.bizType !== 'PAY' || event.bizStatus !== 'PAY_SUCCESS') return ok(res);

    let info = {};
    try {
      info = typeof event.data === 'string' ? JSON.parse(event.data) : event.data || {};
    } catch {
      /* se ignora: sin número de orden no hay nada que hacer */
    }
    const tradeNo = info.merchantTradeNo;
    if (!tradeNo || !/^[A-Za-z0-9]{1,32}$/.test(tradeNo)) {
      console.error('Aviso Binance sin merchantTradeNo válido');
      return ok(res);
    }

    // Consultar la orden directamente a Binance
    const order = await binanceRequest('/binancepay/openapi/v2/order/query', { merchantTradeNo: tradeNo });
    if (order.status !== 'PAID') {
      console.error(`Orden Binance ${tradeNo} no pagada (estado ${order.status})`);
      return ok(res);
    }

    let pass = {};
    try {
      pass = JSON.parse(order.passThroughInfo || '{}');
    } catch {
      /* queda vacío */
    }
    const email = String(pass.e || '').trim();
    const planKey = pass.p;
    const amount = Number(order.orderAmount).toFixed(2);
    // El plan se decide por el monto cobrado; además debe coincidir con el elegido
    const expected = BINANCE_PLANS[planKey];
    const plan = order.currency === 'USDT' && expected && expected.amount === amount ? PLANS[amount] : undefined;

    if (!email) {
      console.error(`Orden Binance ${tradeNo} sin correo`);
      return ok(res);
    }
    if (!plan) {
      console.error(`Orden Binance ${tradeNo}: ${amount} ${order.currency} (plan ${planKey}) no corresponde a ningún plan`);
      return ok(res);
    }

    const iat = Math.floor(Number(order.transactTime || order.createTime || Date.now()) / 1000);
    const exp = iat + YEAR;
    const licenseKey = signLicense({ id: `bn-${tradeNo}`, email, tier: plan.tier, iat, exp });
    console.log(`LICENCIA ${plan.tier} | ${email} | binance ${tradeNo} | ${licenseKey}`);

    const lang = pass.l === 'es' ? 'es' : 'en';
    const sent = await sendLicenseEmail({ to: email, lang, planName: plan.name, licenseKey, expiresAt: exp });
    if (!sent) return fail(res, 'email_not_sent');
    return ok(res);
  } catch (err) {
    console.error('Error en webhook Binance:', err);
    return fail(res, 'internal_error');
  }
}
