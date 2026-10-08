// Utilidades compartidas para emitir licencias v2 (Ed25519) y enviarlas por correo.
// Este archivo empieza con "_" para que Vercel NO lo publique como endpoint.
//
// Variables de entorno necesarias en Vercel:
//   LICENSE_PRIVATE_KEY  semilla Ed25519 de 32 bytes en base64 (NUNCA en el repositorio)
//   RESEND_API_KEY       clave de https://resend.com
//   RESEND_FROM          remitente verificado en Resend, p. ej. "Vault Local <licencias@tudominio.com>"

import crypto from 'node:crypto';

// Prefijo DER PKCS#8 para una clave privada Ed25519 de 32 bytes
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export const DAY = 86400;
export const YEAR = 365 * DAY;

// Planes válidos: precio en USD -> nivel de licencia. Duración: 1 año.
export const PLANS = {
  '15.00': { tier: 'premium', name: 'Vault Local Premium' },
  '39.00': { tier: 'pro', name: 'Vault Local Pro' },
};

export function loadPrivateKey() {
  const b64 = (process.env.LICENSE_PRIVATE_KEY || '').trim();
  const seed = Buffer.from(b64, 'base64');
  if (seed.length !== 32) {
    throw new Error('LICENSE_PRIVATE_KEY no configurada o inválida');
  }
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Firma una licencia v2.
 * @param {{id:string,email:string,tier:'premium'|'pro'|'owner',trial?:boolean,iat:number,exp:number|null}} data
 */
export function signLicense(data, privateKey = loadPrivateKey()) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 2,
      id: String(data.id),
      email: String(data.email),
      tier: data.tier,
      trial: Boolean(data.trial),
      iat: Math.floor(data.iat),
      exp: data.exp == null ? null : Math.floor(data.exp),
    }),
  );
  const sig = crypto.sign(null, payload, privateKey);
  return `VL2-${payload.toString('base64url')}.${sig.toString('base64url')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function sendLicenseEmail({ to, planName, licenseKey, expiresAt, extraNote = '' }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.error('RESEND_API_KEY o RESEND_FROM no configurados: la licencia no se envió por correo');
    return false;
  }
  const vence = expiresAt ? new Date(expiresAt * 1000).toISOString().slice(0, 10) : 'sin vencimiento';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `Tu clave de ${planName}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #4c8dff;">Vault Local</h1>
          <p>Tu clave de licencia para <strong>${escapeHtml(planName)}</strong> (vence: ${vence}):</p>
          <div style="background:#0f1117;color:#e8eaed;padding:16px;border-radius:8px;font-family:monospace;font-size:12px;word-break:break-all;margin:20px 0;">${escapeHtml(licenseKey)}</div>
          <h3>Cómo activarla</h3>
          <ol>
            <li>Abre Vault Local y desbloquea tu bóveda.</li>
            <li>En la barra lateral izquierda, haz clic en <strong>Actualizar</strong>.</li>
            <li>Copia la clave completa de arriba y pégala en el campo <strong>Clave de licencia</strong>.</li>
            <li>Haz clic en <strong>Activar</strong>.</li>
          </ol>
          ${extraNote}
          <p style="color:#888;font-size:12px;">Guarda esta clave dentro de tu propia bóveda por si reinstalas la aplicación.</p>
        </div>`,
    }),
  });
  if (!resp.ok) {
    console.error('Resend respondió', resp.status, await resp.text());
    return false;
  }
  return true;
}
