// Vercel Serverless Function: canje de código promocional -> licencia Premium de prueba por 30 días.
//
// Los códigos válidos NO están en el repositorio: se configuran en la variable de entorno
//   PROMO_CODES = "PRODUCTHUNT2026:2026-12-31,OTROCODIGO:2027-03-01"
// (código : última fecha en que se puede canjear). La licencia se envía por correo,
// así que la persona debe tener acceso real a ese correo.
//
// Limitación conocida: sin base de datos no se puede impedir que alguien canjee el mismo
// código con varios correos distintos. Cada canje solo da 30 días.

import crypto from 'node:crypto';
import { DAY, signLicense, sendLicenseEmail } from './_license.js';

const TRIAL_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parsePromoCodes() {
  const map = new Map();
  for (const item of (process.env.PROMO_CODES || '').split(',')) {
    const [code, until] = item.split(':').map((s) => (s || '').trim());
    if (code) map.set(code.toUpperCase(), until ? Date.parse(`${until}T23:59:59Z`) : Infinity);
  }
  return map;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();

    if (!EMAIL_RE.test(email) || email.length > 200) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    const until = parsePromoCodes().get(code);
    if (until === undefined || Date.now() > until) {
      return res.status(400).json({ error: 'invalid_code' });
    }

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + TRIAL_DAYS * DAY;
    const licenseKey = signLicense({
      id: `promo-${code}-${crypto.randomUUID()}`,
      email,
      tier: 'premium',
      trial: true,
      iat,
      exp,
    });

    const sent = await sendLicenseEmail({
      to: email,
      planName: `Vault Local Premium (prueba de ${TRIAL_DAYS} días)`,
      licenseKey,
      expiresAt: exp,
    });
    if (!sent) {
      return res.status(502).json({ error: 'email_failed' });
    }
    // La clave NO se devuelve en la respuesta: solo llega al correo indicado.
    return res.status(200).json({ status: 'sent' });
  } catch (err) {
    console.error('Error en canje de promoción:', err);
    return res.status(500).json({ error: 'internal' });
  }
}
