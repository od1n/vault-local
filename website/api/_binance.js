// Utilidades compartidas para Binance Pay (no es un endpoint: empieza con "_").
//
// Variables de entorno en Vercel:
//   BINANCE_PAY_API_KEY  "API Key" del panel de comerciante (va en BinancePay-Certificate-SN)
//   BINANCE_PAY_SECRET   "Secret Key" del panel de comerciante (firma HMAC-SHA512)
//
// Documentación:
//   https://developers.binance.com/docs/binance-pay/api-common
//   https://developers.binance.com/docs/binance-pay/api-order-create-v3
//   https://developers.binance.com/docs/binance-pay/api-order-query-v2
//   https://developers.binance.com/docs/binance-pay/webhook-common
//   https://developers.binance.com/docs/binance-pay/webhook-query-certificate

import crypto from 'node:crypto';

export const BINANCE_API = 'https://bpay.binanceapi.com';

// Precio en USDT por plan (mismo precio que en dólares por PayPal)
export const BINANCE_PLANS = {
  premium: { amount: '15.00', goodsName: 'Vault Local Premium - 1 year' },
  pro: { amount: '39.00', goodsName: 'Vault Local Pro - 1 year' },
};

export function binanceConfigured() {
  return Boolean(process.env.BINANCE_PAY_API_KEY && process.env.BINANCE_PAY_SECRET);
}

function nonce(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/** Firma de solicitud: HMAC-SHA512(timestamp \n nonce \n body \n), hex en mayúsculas. */
export function signRequest(timestamp, nonceStr, body, secret) {
  return crypto
    .createHmac('sha512', secret)
    .update(`${timestamp}\n${nonceStr}\n${body}\n`)
    .digest('hex')
    .toUpperCase();
}

/** POST firmado a la API de Binance Pay. Devuelve el JSON de respuesta. */
export async function binanceRequest(path, payload) {
  const body = JSON.stringify(payload);
  const ts = Date.now();
  const n = nonce();
  const r = await fetch(`${BINANCE_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'BinancePay-Timestamp': String(ts),
      'BinancePay-Nonce': n,
      'BinancePay-Certificate-SN': process.env.BINANCE_PAY_API_KEY,
      'BinancePay-Signature': signRequest(ts, n, body, process.env.BINANCE_PAY_SECRET),
    },
    body,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Binance Pay ${path} respondió ${r.status}: ${text.slice(0, 300)}`);
  }
  if (!r.ok || json.status !== 'SUCCESS') {
    throw new Error(`Binance Pay ${path} falló (${r.status}): ${json.code} ${json.errorMessage || ''}`);
  }
  return json.data;
}

// Las claves públicas cambian poco: se guardan en memoria mientras viva la instancia
let certCache = { at: 0, list: [] };

async function getCertificates() {
  if (Date.now() - certCache.at < 60 * 60 * 1000 && certCache.list.length) return certCache.list;
  const data = await binanceRequest('/binancepay/openapi/certificates', {});
  certCache = { at: Date.now(), list: Array.isArray(data) ? data : [data] };
  return certCache.list;
}

function toPem(key) {
  const k = String(key || '').trim();
  if (k.includes('BEGIN')) return k;
  const lines = k.replace(/\s+/g, '').match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Verifica la firma de un aviso (webhook): RSA-SHA256 en base64 sobre
 * "timestamp \n nonce \n cuerpo \n", con la clave pública que indica BinancePay-Certificate-SN.
 */
export async function verifyWebhook(headers, rawBody) {
  const sn = headers['binancepay-certificate-sn'];
  const n = headers['binancepay-nonce'];
  const ts = headers['binancepay-timestamp'];
  const sig = headers['binancepay-signature'];
  if (!sn || !n || !ts || !sig) return false;
  const cert = (await getCertificates()).find((c) => c.certSerial === sn);
  if (!cert) {
    console.error(`Certificado ${sn} no encontrado en Binance Pay`);
    return false;
  }
  return crypto.verify(
    'sha256',
    Buffer.from(`${ts}\n${n}\n${rawBody}\n`),
    toPem(cert.certPublic),
    Buffer.from(sig, 'base64'),
  );
}
