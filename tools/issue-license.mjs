#!/usr/bin/env node
// Emite una licencia v2 de Vault Local firmada con Ed25519.
//
// La clave privada NUNCA va en el repositorio. Este script la lee de un archivo externo:
//   --key-file "D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\license-private-key.txt"
//
// Ejemplos:
//   node tools/issue-license.mjs --key-file <ruta> --email tu@correo.com --tier owner
//   node tools/issue-license.mjs --key-file <ruta> --email cliente@correo.com --tier pro --days 365
//   node tools/issue-license.mjs --key-file <ruta> --email x@y.com --tier premium --days 30 --trial
//
// --tier: premium | pro | owner     --days: duración (omitir = sin vencimiento)

import crypto from 'node:crypto';
import fs from 'node:fs';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const keyFile = arg('key-file');
const email = arg('email');
const tier = arg('tier', 'premium');
const days = arg('days');
const trial = arg('trial', false) === true;

if (!keyFile || keyFile === true) fail('falta --key-file <ruta al archivo de clave privada>');
if (!email || email === true) fail('falta --email <correo>');
if (!['premium', 'pro', 'owner'].includes(tier)) fail('--tier debe ser premium, pro u owner');
if (days !== undefined && !(Number(days) > 0)) fail('--days debe ser un número mayor que 0');

const seed = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
if (seed.length !== 32) fail('el archivo de clave privada no contiene una semilla Ed25519 válida');

const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
  format: 'der',
  type: 'pkcs8',
});

const iat = Math.floor(Date.now() / 1000);
const exp = days === undefined ? null : iat + Math.round(Number(days) * 86400);
const payload = Buffer.from(
  JSON.stringify({ v: 2, id: `manual-${crypto.randomUUID()}`, email, tier, trial, iat, exp }),
);
const sig = crypto.sign(null, payload, privateKey);

// Comprobación: la firma debe validar con la clave pública derivada
const publicKey = crypto.createPublicKey(privateKey);
if (!crypto.verify(null, payload, publicKey, sig)) fail('la firma generada no valida');
const pubHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');

console.log(`VL2-${payload.toString('base64url')}.${sig.toString('base64url')}`);
console.error(`\nNivel: ${tier}${trial ? ' (prueba)' : ''} | Correo: ${email} | Vence: ${exp ? new Date(exp * 1000).toISOString().slice(0, 10) : 'nunca'}`);
console.error(`Clave pública usada: ${pubHex}`);
