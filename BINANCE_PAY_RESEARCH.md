# Binance Pay Integration Research

Research date: 2026-06-04

## 1. Individual Developer Access

Binance Pay Merchant has an **"Individual Merchant"** option during application. You do NOT need a registered business. Requirements:
- Verified Binance account (KYC completed)
- Country of residence must match ID documents
- KYB/KYC documents submitted during merchant application
- Regulatory compliance check (may be rejected based on jurisdiction)

Application: https://merchant.binance.com

## 2. Checkout Flow

Three options, all via **Create Order API v3** (older versions are deprecated):

| Method | How it works |
|--------|-------------|
| **Hosted Checkout (recommended)** | Server calls Create Order API -> receives `checkoutUrl` -> redirect user to Binance-hosted page -> user pays -> redirected back |
| **QR Code** | API returns `qrcodeLink` -> display on your site -> user scans with Binance app |
| **App Deeplink** | API returns `deeplink`/`universalUrl` -> opens Binance app directly (mobile) |

The hosted checkout is the simplest and most similar to the current PayPal flow.

## 3. Webhook System

Yes, fully supported and very similar to PayPal:
- Configure webhook URL in merchant dashboard (Developer > Webhooks > Edit)
- Binance sends POST with payment status on completion
- Signature verification using Binance-issued public key
- Must respond with HTTP 200 + "SUCCESS" body
- Supports idempotency and retry

This maps directly to the existing Vercel serverless function pattern.

## 4. Fees

- **Receiving payments: 0% (free)** - no fee for accepting crypto via Binance Pay
- **Payouts (withdrawing to external wallet): 0.80%** capped at $5 USD
- **Currency conversion: spread applied** if converting between currencies
- **Mini Program merchants: minimum volume requirement** or quarterly fee (not applicable for API-only integration)
- Keeping funds in Binance = no fees. Only pay when withdrawing.

## 5. Supported Currencies

- 80+ crypto tokens accepted from buyers (BTC, ETH, BNB, USDT, USDC, etc.)
- Merchant receives in chosen crypto/stablecoin (USDT recommended for stability)
- Fiat order currencies supported (EUR for MICA users, USDC for others)
- Instant settlement in merchant's Binance wallet

## 6. Geographic Restrictions

**Venezuela concern**: In August 2024, Venezuela imposed DNS blocks on Binance (web + app). Users bypass via VPN. Binance itself did NOT restrict Venezuela - the restriction came from the Venezuelan government. Current status (2026) is unclear but:
- Binance is available in 180+ countries
- The block was government-side, not Binance-side
- This affects BUYERS in Venezuela, not necessarily the merchant
- Your customers worldwide can pay normally

**Key risk**: Venezuelan customers specifically may have trouble accessing Binance checkout.

## 7. Simpler Alternative: NOWPayments

If Binance Pay merchant approval is problematic, **NOWPayments** is a strong alternative:

| Feature | NOWPayments |
|---------|-------------|
| Fees | ~0.5% mono-currency, ~1% multi-currency |
| Currencies | 350+ cryptos, 40 fiat |
| Integration | REST API, payment links, checkout buttons |
| KYC | Simpler onboarding than Binance |
| Model | Non-custodial (funds go to YOUR wallet) |
| USDT TRC20 | Zero network fees promo for new partners |

Website: https://nowpayments.io

## 8. Simplest Option: Manual Wallet Address

Show your USDT (TRC20) wallet address + amount on checkout page. Buyer sends manually. You verify on-chain or check Binance deposit. Downsides:
- No automated verification (must poll blockchain or check manually)
- Poor UX (copy address, switch apps, paste, send, wait)
- Error-prone (wrong amount, wrong network)
- No webhook, no refund flow

Not recommended for a product aiming for professional UX.

---

## Recommendation

**Primary plan: Binance Pay Merchant API (hosted checkout)**
- Apply as Individual Merchant at merchant.binance.com
- Use Create Order API v3 with hosted checkout (redirect flow)
- Add webhook endpoint to existing Vercel serverless function
- Flow: User clicks "Pay with Crypto" -> server creates order -> redirect to Binance checkout -> webhook fires -> generate license + send email (same as PayPal flow)
- 0% receiving fees
- Settlement in USDT

**Fallback: NOWPayments**
- If Binance merchant approval fails or takes too long
- 0.5% fee but simpler onboarding
- Non-custodial (funds go directly to your wallet)
- More payment options for buyers (350+ cryptos, not locked to Binance ecosystem)

**Implementation effort**: Low. The architecture mirrors the existing PayPal integration. A second serverless function (or branch in the existing one) handles the Binance webhook. The landing page gets a second payment button.

## Key Sources

- Binance Pay Merchant: https://merchant.binance.com/en
- API Docs: https://developers.binance.com/docs/binance-pay/introduction
- Create Order v3: https://developers.binance.com/docs/binance-pay/api-order-create-v3
- Webhooks: https://merchant.binance.com/en/docs/functionalities/webhooks
- Fees: https://www.binance.com/en/support/faq/binance-pay-fees-6ff1944867e54b9a9576bce3109c7f7a
- Merchant Application FAQ: https://www.binance.com/en/support/faq/detail/7a49148912214defa816f14ee51b9f9f
- NOWPayments: https://nowpayments.io/pricing
