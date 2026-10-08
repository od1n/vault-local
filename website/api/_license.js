// Utilidades compartidas para emitir licencias v2 (Ed25519) y enviarlas por correo.
// Este archivo empieza con "_" para que Vercel NO lo publique como endpoint.
//
// Variables de entorno necesarias en Vercel:
//   LICENSE_PRIVATE_KEY  semilla Ed25519 de 32 bytes en base64 (NUNCA en el repositorio)
//   RESEND_API_KEY       clave de https://resend.com
//   RESEND_FROM          remitente verificado en Resend: "Vault Local <licencias@vinculo.dev>"
//   RESEND_REPLY_TO      (opcional) correo donde recibes las respuestas de los usuarios

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

const SITE = 'https://vault-local.vercel.app';

const EMAIL_TEXT = {
  es: {
    subject: (plan) => `Tu clave de ${plan}`,
    intro: (plan) => `Esta es tu clave de licencia para <strong>${plan}</strong>.`,
    expires: (d) => `Vence el ${d}.`,
    never: 'No vence.',
    steps: 'Cómo activarla (5 minutos)',
    list: [
      `Si todavía no tienes Vault Local, descárgalo e instálalo desde <a href="${SITE}/prueba.html#paso2">${SITE}/prueba.html#paso2</a> (ahí está explicado paso a paso, incluido el aviso azul de Windows).`,
      'Abre Vault Local. Si es la primera vez, crea tu contraseña maestra y pulsa <strong>Crear Bóveda</strong>.',
      'Selecciona <strong>todo</strong> el texto del recuadro oscuro de arriba (desde <code>VL2-</code> hasta el final) y cópialo con <strong>Ctrl+C</strong> (en Mac, ⌘+C).',
      'En Vault Local, arriba a la izquierda junto al ícono del sol o la luna, haz clic en <strong>Actualizar</strong> (o <strong>Upgrade</strong>).',
      'Haz clic en el cuadro <strong>Clave de licencia</strong>, pega con <strong>Ctrl+V</strong> (en Mac, ⌘+V) y pulsa <strong>Activar</strong>.',
    ],
    done: 'Arriba a la izquierda verás el nombre de tu plan. Haz clic ahí cuando quieras ver cuántos días te quedan.',
    keep: 'Guarda este correo o la clave dentro de tu propia bóveda: la necesitarás si reinstalas el programa o lo usas en otra computadora.',
    help: `¿Problemas? Revisa las preguntas frecuentes en <a href="${SITE}/prueba.html#faq">${SITE}/prueba.html#faq</a> o responde a este correo.`,
  },
  en: {
    subject: (plan) => `Your ${plan} key`,
    intro: (plan) => `Here is your license key for <strong>${plan}</strong>.`,
    expires: (d) => `It expires on ${d}.`,
    never: 'It does not expire.',
    steps: 'How to activate it (5 minutes)',
    list: [
      `If you don't have Vault Local yet, download and install it from <a href="${SITE}/trial.html#paso2">${SITE}/trial.html#paso2</a> (step-by-step, including the blue Windows warning).`,
      'Open Vault Local. If it is the first time, create your master password and click <strong>Create Vault</strong>.',
      'Select <strong>all</strong> the text in the dark box above (from <code>VL2-</code> to the end) and copy it with <strong>Ctrl+C</strong> (on Mac, ⌘+C).',
      'In Vault Local, at the top left next to the sun or moon icon, click <strong>Upgrade</strong>.',
      'Click the box under <strong>Clave de licencia</strong> (license key), paste with <strong>Ctrl+V</strong> (on Mac, ⌘+V) and click <strong>Activar</strong> (activate).',
    ],
    done: 'At the top left you will see your plan name. Click it any time to see how many days are left.',
    keep: 'Keep this email or store the key inside your own vault: you will need it if you reinstall or use another computer.',
    help: `Trouble? See the FAQ at <a href="${SITE}/trial.html#faq">${SITE}/trial.html#faq</a> or reply to this email.`,
  },
};

/**
 * Envía la licencia por correo con instrucciones paso a paso.
 * @param {{to:string, planName:string, licenseKey:string, expiresAt:number|null, lang?:'es'|'en'}} opts
 */
export async function sendLicenseEmail({ to, planName, licenseKey, expiresAt, lang = 'es' }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.error('RESEND_API_KEY o RESEND_FROM no configurados: la licencia no se envió por correo');
    return false;
  }
  const t = EMAIL_TEXT[lang] || EMAIL_TEXT.es;
  const date = expiresAt
    ? new Date(expiresAt * 1000).toLocaleDateString(lang === 'en' ? 'en-US' : 'es', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      // Opcional: dirección real donde quieres recibir las respuestas
      ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}),
      subject: t.subject(planName),
      html: `
        <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1f2937; line-height: 1.6;">
          <h1 style="color: #4c8dff; margin-top: 0;">Vault Local</h1>
          <p>${t.intro(escapeHtml(planName))} ${date ? t.expires(date) : t.never}</p>
          <div style="background:#0f1117;color:#e8eaed;padding:16px;border-radius:8px;font-family:Consolas,monospace;font-size:13px;word-break:break-all;margin:20px 0;">${escapeHtml(licenseKey)}</div>
          <h3>${t.steps}</h3>
          <ol>${t.list.map((x) => `<li style="margin:8px 0">${x}</li>`).join('')}</ol>
          <p>${t.done}</p>
          <p style="background:#fff7e6;border-left:3px solid #ffb74d;padding:8px 12px;">${t.keep}</p>
          <p style="color:#6b7280;font-size:13px;">${t.help}</p>
        </div>`,
    }),
  });
  if (!resp.ok) {
    console.error('Resend respondió', resp.status, await resp.text());
    return false;
  }
  return true;
}
