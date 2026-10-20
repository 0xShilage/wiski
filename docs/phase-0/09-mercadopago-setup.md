# 09 — Mercado Pago setup: exactly what's needed

> Status: checklist for Q22 · rev 6 · 2026-10-19 — Phase 2 uses the **Orders API** (13 D1); panel steps and notification events below are for Orders. Rev 5 corrected the ids recorded in rev 4 (they were the *test* ones).

## Received

| Item | Value | Goes into |
|---|---|---|
| Seller type | Pessoa física (CPF). The number itself is deliberately **not** recorded in code, docs or config — the site doesn't need it. If counsel wants it in the legal texts, it arrives with those texts. | legal texts (Q13) |
| Pix key registered | yes | — |
| **Test** User ID / `collector_id` | `3733347216` | `MP_COLLECTOR_ID` in **development** (`.env.local`) |
| **Test** Application ID | `5754049850745190` | `MP_APPLICATION_ID` in **development** |
| **Production** User ID / Application ID (S2) | **still open.** On 2026-10-19 the ids sent for production were `3733347216` / `5754049850745190` — the same as the test ids above. The production Access Token is `APP_USR-<Application ID>-…-<User ID>`: compare its first and last digit groups with the ids in Suas integrações › **Produção** before go-live. Earlier notes had `1138239348` / `2826739158388788`. | `MP_COLLECTOR_ID`, `MP_APPLICATION_ID` in **production** |
| Production credentials | activated | Production Access Token goes into the server `.env` in Phase 5, by you |
| Name payers see as the Pix recipient (Q13) | received 2026-10-19 — the account holder's legal name. Kept **only** in the server `.env` as `PIX_RECIPIENT_NAME` (not in the repository); shown on the order page as "Confira o nome do recebedor". | `PIX_RECIPIENT_NAME` |

Why the ids matter: the payment worker refuses any order whose `user_id` (collector) or `integration_data.application_id` isn't ours (→ NEEDS_ATTENTION, never PAID). With the test ids in production **every real payment would be held**. The app also refuses to boot when `MP_ACCESS_TOKEN` doesn't end with `-<MP_COLLECTOR_ID>`.

**Ground rule:** secrets never go in the chat, e-mail or the repository. You put them yourself into the server's `.env` (Phase 5) or, for development only, into a git-ignored `.env.local` with **test** values. **Plain-text notes with credentials (e.g. `DATA.txt`) don't belong in the project folder** — keep them in a password manager. Credentials that sat in such a file should be renewed (Suas integrações › Produção › Credenciais).

## A. Tell me these (not secret — fine to send in the chat)

| Item | Where to find it | Why the site needs it |
|---|---|---|
| **User ID** (`collector_id`) and **Application ID** — production and test are different | Suas integrações → your application → Produção / Testes. Also the last and first digit groups of each Access Token. | the worker rejects any order not created by your app for your account |
| **Production credentials activated?** (yes/no) | Suas integrações → Produção → Credenciais de produção | go-live gate |

## B. Secrets (never send them — put them in `.env`)

| `.env` key | Where it comes from | Used for |
|---|---|---|
| `MP_ACCESS_TOKEN` (production, `APP_USR-…`) | Suas integrações → **Produção › Credenciais de produção** → Access Token | server-side calls only: create the Pix order, read it, cancel an unpaid one, exception refunds |
| `MP_ACCESS_TOKEN` (development, also `APP_USR-…` for the Orders API) | **Testes › Credenciais de teste** → Access Token (created automatically with the app) | local development with sandbox Pix |
| `MP_WEBHOOK_SECRET` | **Webhooks › Configurar notificações** → after saving, the **assinatura secreta** | verifying the `x-signature` HMAC on every notification |
| `MP_WEBHOOK_SECRET_PREVIOUS` | only while rotating (after pressing reset on the signature) | accepts both old and new signature for a short window |

**Not needed:** Public Key (only for card forms — we don't take cards), Client ID and Client Secret (OAuth/marketplace only), your Mercado Pago password, bank details, the Pix key value, test-user passwords.

## C. Steps in the Mercado Pago panel

1. Turn on two-factor authentication on the Mercado Pago account. The Access Token can create charges and refunds, so treat it like a bank password.
2. Register a Pix key if the account doesn't have one yet.
3. In **Suas integrações**, the application integrates **Checkout Transparente** with the **API de Orders** (online payments on your own site, no e-commerce platform).
4. Test credentials appear automatically; they are all development needs. Sandbox orders use the payer e-mail `test@testuser.com` (the app does this by itself in development).
5. In **Webhooks › Configurar notificações** (Phase 5, once the site is online):
   - production URL: `https://wiski.fun/api/webhooks/mercadopago`
   - event: **Order (Mercado Pago)**. (Chargebacks don't need their own event: the worker re-reads every approved order nightly for 120 days and flags a dispute for the streamer.)

   Save, then copy the **assinatura secreta** into `.env`. The site doesn't send a per-order `notification_url`, so every notification comes through this signed panel configuration. The server's nginx must pass Mercado Pago's own `x-request-id` header through unchanged — it is part of the signature (`docker/nginx/snippets/mercadopago-webhook.conf`).
6. Activate production credentials when the site is ready to go live (Phase 5). It asks for an industry (entertainment/media), the website `https://wiski.fun`, and acceptance of the terms. The lawyer's terms, privacy and refund texts must be online by then — production refuses to start while the provisional texts are current.

## D. When each piece is needed

| Phase | Needed |
|---|---|
| Phase 2 (built) | nothing from you for the code: Claude's workspace can't reach `api.mercadopago.com`, so every Mercado Pago call is tested against a local mock built from the documented requests and responses. To try it yourself: test Access Token + test ids in `Wiskiflix/.env.local`, `npm run dev` + `npm run worker` (see `docs/phase-2/README.md`). |
| Phase 5 (go-live) | production Access Token + production webhook secret + **production** ids + `PIX_RECIPIENT_NAME`, typed by you into the server's `.env`; then one real low-value Pix (a movie with a one-off R$ 5,00 voucher: `npm run voucher:create -- --fixed 1500 --max 1`) to confirm the flow end to end |

A Pix created with test credentials returns a QR code that can't be paid from a real bank app. Sandbox approval happens through Mercado Pago's test tools; in the suites it is a signed test notification plus the mock's state change, and before launch that one real payment.

Sources: [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials) · [Credenciais de teste automáticas (nov/2025)](https://www.mercadopago.com.br/developers/pt/news/2025/11/19/Streamlined-integration-testing-with-automatic-credentials) · [Pix na API Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix) · [Migrar de API Payments para API Orders](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/migrate-payments-to-orders.md) · [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/notifications/webhooks)
