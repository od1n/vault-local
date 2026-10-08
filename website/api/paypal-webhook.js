// Vercel Serverless Function: webhook de PayPal -> licencia anual firmada (Ed25519) -> correo.
//
// Seguridad:
//  1. Se verifica la firma del aviso con la API de PayPal (verify-webhook-signature).
//     Sin esto cualquiera podía enviar un aviso falso y recibir una licencia.
//  2. Solo se acepta PAYMENT.CAPTURE.COMPLETED (dinero realmente cobrado).
//  3. El correo y el monto se leen de la orden consultada directamente a PayPal,
//     no del cuerpo del aviso.
//  4. El id de licencia es el id de la orden: si PayPal reenvía el aviso, se emite la misma licencia.
//
// Variables de entorno en Vercel:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID
//   PAYPAL_API_BASE (opcional; por defecto https://api-m.paypal.com, en pruebas https://api-m.sandbox.paypal.com)
//   LICENSE_PRIVATE_KEY, RESEND_API_KEY, RESEND_FROM

import { PLANS, YEAR, signLicense, sendLicenseEmail } from './_license.js';

const API = process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`OAuth PayPal falló: ${r.status}`);
  return (await r.json()).access_token;
}

async function verifySignature(req, token) {
  const h = (name) => req.headers[name];
  const r = await fetch(`${API}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: h('paypal-auth-algo'),
      cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: req.body,
    }),
  });
  if (!r.ok) return false;
  return (await r.json()).verification_status === 'SUCCESS';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const token = await getAccessToken();
    if (!(await verifySignature(req, token))) {
      console.error('Aviso de PayPal con firma inválida: ignorado');
      return res.status(400).json({ error: 'invalid signature' });
    }

    const event = req.body;
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      return res.status(200).json({ status: 'ignored', event_type: event.event_type });
    }

    const capture = event.resource || {};
    const orderId = capture.supplementary_data?.related_ids?.order_id;
    if (!orderId || capture.status !== 'COMPLETED') {
      return res.status(200).json({ status: 'not_completed' });
    }

    // Consultar la orden directamente a PayPal
    const r = await fetch(`${API}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`No se pudo leer la orden ${orderId}: ${r.status}`);
    const order = await r.json();

    const email = order.payer?.email_address;
    const amount = capture.amount?.value;
    const currency = capture.amount?.currency_code;
    const plan = currency === 'USD' ? PLANS[amount] : undefined;

    if (!email) {
      console.error(`Orden ${orderId} sin correo del pagador`);
      return res.status(200).json({ status: 'no_email' });
    }
    if (!plan) {
      console.error(`Orden ${orderId}: monto ${amount} ${currency} no corresponde a ningún plan`);
      return res.status(200).json({ status: 'unknown_amount' });
    }

    const iat = Math.floor(new Date(capture.create_time || Date.now()).getTime() / 1000);
    const exp = iat + YEAR;
    const licenseKey = signLicense({ id: `pp-${orderId}`, email, tier: plan.tier, iat, exp });

    // Respaldo en los registros de Vercel por si el correo falla
    console.log(`LICENCIA ${plan.tier} | ${email} | orden ${orderId} | ${licenseKey}`);

    // Idioma del correo según la descripción de la orden (la página en español dice "año"/"anual")
    const desc = String(order.purchase_units?.[0]?.description || '').toLowerCase();
    const lang = /año|anual/.test(desc) ? 'es' : 'en';
    const sent = await sendLicenseEmail({ to: email, lang, planName: plan.name, licenseKey, expiresAt: exp });
    return res.status(200).json({ status: 'success', email_sent: sent });
  } catch (err) {
    console.error('Error en webhook:', err);
    // 500 hace que PayPal reintente más tarde
    return res.status(500).json({ error: 'Internal error' });
  }
}
