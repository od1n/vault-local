# Webhook de PayPal para entrega automatica de licencias

## Setup

1. En PayPal Developer Dashboard -> Webhooks -> Add Webhook
2. URL: `https://vault-local.vercel.app/api/paypal-webhook`
3. Events: seleccionar `PAYMENT.CAPTURE.COMPLETED`

## Email delivery (opcional)

Para enviar emails automaticamente con la clave de licencia:

1. Crea cuenta en https://resend.com (gratis: 100 emails/dia)
2. Obten tu API key
3. En Vercel -> Settings -> Environment Variables:
   - `RESEND_API_KEY` = tu clave de Resend

Sin Resend, las claves se logean en Vercel Functions logs y debes enviarlas manualmente.
