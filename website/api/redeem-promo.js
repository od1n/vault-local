// Vercel Serverless Function: canje de código promocional -> licencia completa (Pro) de prueba por 30 días.
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

// Límite básico de solicitudes por IP y por correo. Es por instancia de la función
// (Vercel puede tener varias), así que frena abusos simples pero no ataques distribuidos.
// Para un límite global haría falta un almacén compartido (por ejemplo Vercel KV).
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PER_EMAIL = 2;
const hits = new Map();

function tooMany(key, max) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parsePromoCodes() {
  const map = new Map();
  for (const item of (process.env.PROMO_CODES || '').split(',')) {
    const [code, until] = item.split(':').map((s) => (s || '').trim());
    if (!code) continue;
    const limit = until ? Date.parse(`${until}T23:59:59Z`) : Infinity;
    // Una fecha mal escrita invalida el código (antes lo dejaba sin vencimiento)
    if (Number.isNaN(limit)) {
      console.error(`PROMO_CODES: fecha inválida para ${code}; el código queda desactivado`);
      continue;
    }
    map.set(code.toUpperCase(), limit);
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
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconocida';
    if (tooMany(`ip:${ip}`, MAX_PER_IP) || tooMany(`mail:${email}`, MAX_PER_EMAIL)) {
      return res.status(429).json({ error: 'too_many' });
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
      tier: 'pro',
      trial: true,
      iat,
      exp,
    });

    const sent = await sendLicenseEmail({
      to: email,
      planName: `Vault Local Pro (prueba de ${TRIAL_DAYS} días, todas las funciones)`,
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
