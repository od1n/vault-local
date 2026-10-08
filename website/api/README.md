# Funciones del servidor (Vercel): licencias v2

Dos funciones en esta carpeta:

| Archivo | Dirección pública | Qué hace |
|---|---|---|
| `paypal-webhook.js` | https://vault-local.vercel.app/api/paypal-webhook | Recibe el aviso de PayPal, lo verifica con PayPal y envía por correo una licencia de 1 año |
| `redeem-promo.js` | https://vault-local.vercel.app/api/redeem-promo | Canjea un código promocional y envía por correo una licencia Pro de prueba de 30 días (todas las funciones) |
| `_license.js` | (no se publica) | Funciones compartidas: firmar licencias Ed25519 y enviar el correo |

Planes (monto exacto en USD → nivel; duración 1 año): `15.00` → Premium, `39.00` → Pro.
Cualquier otro monto se ignora y queda registrado en los registros de Vercel.

## Variables de entorno

Se configuran en Vercel: abre https://vercel.com/dashboard, entra al proyecto **vault-local**,
pestaña **Settings** (arriba) → **Environment Variables** (menú izquierdo). Para cada variable:
escribe el nombre en **Key**, el valor en **Value**, deja marcados Production/Preview/Development
y pulsa **Save**. Al terminar, vuelve a desplegar: pestaña **Deployments** → menú **⋯** del
último despliegue → **Redeploy**.

| Nombre | Valor | De dónde sale |
|---|---|---|
| `LICENSE_PRIVATE_KEY` | Texto de 44 caracteres en base64 | Archivo `D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\license-private-key.txt` (NUNCA lo subas al repositorio) |
| `PAYPAL_CLIENT_ID` | Client ID de la app Live | https://developer.paypal.com/dashboard/applications/live → tu app |
| `PAYPAL_CLIENT_SECRET` | Secret de la app Live | Mismo lugar, botón **Show** bajo *Secret key 1* |
| `PAYPAL_WEBHOOK_ID` | ID del webhook | Mismo lugar, sección **Webhooks** de tu app (columna *Webhook ID*) |
| `RESEND_API_KEY` | Clave de Resend | https://resend.com/api-keys |
| `RESEND_FROM` | `Vault Local <licencias@vinculo.dev>` | `vinculo.dev` ya está verificado en https://resend.com/domains, así que sirve cualquier dirección `@vinculo.dev` sin pasos extra |
| `RESEND_REPLY_TO` | (opcional) tu correo real, p. ej. `x0d1ns0x@gmail.com` | Si alguien responde al correo de la licencia, la respuesta llega aquí en vez de perderse |
| `PROMO_CODES` | p. ej. `PRODUCTHUNT2026:2026-12-31` | Lista separada por comas de `CÓDIGO:última-fecha-de-canje` (formato año-mes-día). Cada canje da Pro de prueba por 30 días |
| `PAYPAL_API_BASE` | (opcional) `https://api-m.sandbox.paypal.com` | Solo para pruebas con el entorno sandbox de PayPal |

## Webhook en PayPal

1. Abre https://developer.paypal.com/dashboard/applications/live y entra a tu app.
2. En la sección **Webhooks**, pulsa **Add Webhook**.
3. **Webhook URL**: `https://vault-local.vercel.app/api/paypal-webhook`
4. En **Event types** marca solo **Payment capture completed** (`PAYMENT.CAPTURE.COMPLETED`).
5. Pulsa **Save** y copia el **Webhook ID** que aparece en la lista a la variable `PAYPAL_WEBHOOK_ID`.

## Seguridad

- El estado, el monto y el correo se leen de la orden consultada a PayPal con `PAYPAL_CLIENT_ID` y
  `PAYPAL_CLIENT_SECRET`, nunca del aviso. Un aviso falso no puede generar una licencia para otro
  correo. La firma (`PAYPAL_WEBHOOK_ID`) se comprueba y, si falla, queda en los registros como
  "Firma del aviso no verificada".
- Si el correo falla, la licencia queda en los registros de Vercel (pestaña **Logs**), en la línea
  que empieza con `LICENCIA`, para enviarla a mano.
- Para emitir licencias manuales (por ejemplo, la tuya de tipo `owner`) usa
  `tools/issue-license.mjs` desde tu equipo; ver `RESUMEN_PROYECTO.md`.

## Cómo compartir la prueba de 30 días con alguien

Envíale este enlace (por WhatsApp, correo, redes):

- En español: `https://vault-local.vercel.app/prueba.html?codigo=PRODUCTHUNT2026`
- En inglés: `https://vault-local.vercel.app/trial.html?code=PRODUCTHUNT2026`

El enlace ya trae el código escrito. La página explica a la persona, paso a paso:
pedir la licencia, descargar, instalar (incluido el aviso azul de Windows), crear la
contraseña maestra, activar la licencia y qué hacer al terminar los 30 días. El correo
que recibe repite los pasos de activación.

Para un código nuevo (por ejemplo, para un grupo o una campaña), agrégalo a `PROMO_CODES`
separado por coma (`PRODUCTHUNT2026:2026-12-31,AMIGOS:2027-03-31`), guarda, haz **Redeploy**
y comparte el enlace con `?codigo=AMIGOS`.

Los botones de descarga de todas las páginas buscan solos la versión más reciente publicada en
https://github.com/od1n/vault-local/releases/latest, así que no hay que editarlos en cada versión.
