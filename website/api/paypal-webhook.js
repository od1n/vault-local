// Vercel Serverless Function — handles PayPal webhook for automatic license delivery
// PayPal sends a POST here when a payment is captured

const crypto = require('crypto');

// License signing key — MUST match the one in src-tauri/src/commands/license.rs
// In production, use environment variables
const LICENSE_SIGNING_KEY = 'vault-local-license-signing-key-v1-CHANGE-IN-PRODUCTION';

function generateLicenseKey() {
  // Generate UUID v4
  const uuid = crypto.randomUUID().replace(/-/g, '');
  // Split into 4 groups of 8 hex chars
  const groups = [uuid.slice(0, 8), uuid.slice(8, 16), uuid.slice(16, 24), uuid.slice(24, 32)];
  // HMAC-SHA256 signature
  const hmac = crypto.createHmac('sha256', LICENSE_SIGNING_KEY);
  hmac.update(uuid);
  const signature = hmac.digest('hex').slice(0, 8);
  // Format: VL-group1-group2-group3-group4-signature
  return `VL-${groups.join('-')}-${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;

    // Verify this is a payment capture event
    if (event.event_type !== 'CHECKOUT.ORDER.APPROVED' && event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      return res.status(200).json({ status: 'ignored', event_type: event.event_type });
    }

    // Extract payment details
    let email = '';
    let amount = '';
    let description = '';
    let orderId = '';

    if (event.resource) {
      // PAYMENT.CAPTURE.COMPLETED
      if (event.resource.payer) {
        email = event.resource.payer.email_address || '';
      }
      if (event.resource.amount) {
        amount = event.resource.amount.value || '';
      }
      orderId = event.resource.id || '';

      // Try to get from purchase_units
      if (event.resource.purchase_units && event.resource.purchase_units[0]) {
        const pu = event.resource.purchase_units[0];
        description = pu.description || '';
        if (!email && pu.payee) email = pu.payee.email_address || '';
        if (!amount && pu.amount) amount = pu.amount.value || '';
      }
    }

    if (!email) {
      console.error('No email found in webhook payload');
      return res.status(200).json({ status: 'no_email' });
    }

    // Generate license key
    const licenseKey = generateLicenseKey();

    // Determine plan type from amount
    let planName = 'Vault Local Premium';
    if (parseFloat(amount) >= 30) {
      planName = 'Vault Local Pro';
    }

    // Log the license for manual backup
    console.log(`=== NEW LICENSE ===`);
    console.log(`Email: ${email}`);
    console.log(`Plan: ${planName}`);
    console.log(`Amount: $${amount}`);
    console.log(`Order: ${orderId}`);
    console.log(`License Key: ${licenseKey}`);
    console.log(`==================`);

    // Send email via Resend (if RESEND_API_KEY env var is set)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Vault Local <noreply@vault-local.vercel.app>',
            to: email,
            subject: `Tu clave de ${planName}`,
            html: `
              <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #4c8dff;">Vault Local</h1>
                <h2>Gracias por tu compra</h2>
                <p>Tu clave de licencia para <strong>${planName}</strong>:</p>
                <div style="background: #0f1117; color: #e8eaed; padding: 20px; border-radius: 8px; font-family: monospace; font-size: 16px; text-align: center; letter-spacing: 1px; margin: 20px 0;">
                  ${licenseKey}
                </div>
                <h3>Como activar</h3>
                <ol>
                  <li>Abre Vault Local</li>
                  <li>Click en "Actualizar" en el sidebar</li>
                  <li>Pega tu clave de licencia</li>
                  <li>Click en "Activar"</li>
                </ol>
                <p style="color: #888; font-size: 13px;">Orden: ${orderId}<br>Monto: $${amount} USD</p>
                <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                <p style="color: #888; font-size: 12px;">Si tienes alguna pregunta, responde a este email.</p>
              </div>
            `,
          }),
        });
        console.log(`Email sent to ${email}`);
      } catch (emailErr) {
        console.error('Failed to send email:', emailErr);
      }
    }

    return res.status(200).json({
      status: 'success',
      email,
      plan: planName,
      // Don't expose the license key in the response for security
    });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
