# 09 — Mercado Pago setup: exactly what's needed

> Status: checklist for Q22 · rev 5 · 2026-10-02 — **correction:** the ids recorded in rev 4 belong to the *test* credentials (see "Received").

## Received (2026-10-02)

| Item | Value | Goes into |
|---|---|---|
| Seller type | Pessoa física (CPF). The number itself is deliberately **not** recorded in code, docs or config — the site doesn't need it. If counsel wants it in the legal texts, it arrives with those texts. | legal texts (Q13) |
| Pix key registered | yes | — |
| **Test** User ID / `collector_id` | `3733347216` | `MP_COLLECTOR_ID` in **development** (`.env.local`) |
| **Test** Application ID | `5754049850745190` | `MP_APPLICATION_ID` in **development** |
| **Production** User ID / `collector_id` | `1138239348` (the last group of the production Access Token — please confirm in Suas integrações › Produção) | `MP_COLLECTOR_ID` in **production** |
| **Production** Application ID | `2826739158388788` (please confirm) | `MP_APPLICATION_ID` in **production** |
| Production credentials | activated | Production Access Token goes into the server `.env` in Phase 5, by you |
| Name payers see as the Pix recipient | **still to confirm** — for a pessoa física account bank apps usually show the account holder's legal name, not a brand name | the "confira o nome do recebedor" hint on the Pix page |

Why it matters: the webhook worker rejects any payment whose `collector_id` isn't ours. With the test id in production, **every real payment would be rejected** (sent to NEEDS_ATTENTION). Since Phase 1 the app refuses to boot when `MP_ACCESS_TOKEN` doesn't end with `-<MP_COLLECTOR_ID>`.

Webhook URL and secret: configure them in Phase 5, once `https://wiski.fun/api/webhooks/mercadopago` exists. For development, use the test credentials (section B).

**Ground rule:** secrets never go in the chat, e-mail or the repository. You put them yourself into the server's `.env` (Phase 5) or, for development only, into a git-ignored `.env.local`. **Plain-text notes with credentials (e.g. `DATA.txt`) don't belong in the project folder** — keep them in a password manager. Credentials that sat in such a file should be renewed (Suas integrações › Produção › Credenciais).

## A. Tell me these (not secret — fine to send in the chat)

| Item | Where to find it | Why the site needs it |
|---|---|---|
| **Seller identity**: CPF (pessoa física) or CNPJ/MEI, and the name payers will see as the Pix recipient | your Mercado Pago account profile | terms, receipts, and the "confirm the recipient name before paying" hint on the Pix page |
| **Pix key registered?** (yes/no, not the key itself) | Mercado Pago app → Pix → Minhas chaves | Mercado Pago only offers Pix if the account has Pix keys registered |
| **User ID** (número de usuário / `collector_id`) — **production and test are different** | Suas integrações → your application's details. It is usually also the last group of digits of the Access Token. | the webhook worker rejects any payment whose `collector_id` isn't yours |
| **Application ID / name** | Suas integrações | labels logs; confirms we're configuring the right app |
| **Production credentials activated?** (yes/no) | Suas integrações → Produção → Credenciais de produção | go-live gate |

## B. Secrets (never send them — put them in `.env`)

| `.env` key | Where it comes from | Used for |
|---|---|---|
| `MP_ACCESS_TOKEN` (production, starts with `APP_USR-`) | Suas integrações → **Produção › Credenciais de produção** → Access Token | server-side calls only: create the Pix charge, read payment status, exception refunds |
| `MP_ACCESS_TOKEN` (development) | **Testes › Credenciais de teste** → Access Token (created automatically with the app) | local/staging development |
| `MP_WEBHOOK_SECRET` | **Webhooks › Configurar notificações** → after saving, the **assinatura secreta** | verifying the `x-signature` HMAC on every notification |
| `MP_WEBHOOK_SECRET_PREVIOUS` | only while rotating (after pressing reset on the signature) | accepts both old and new signature for a short window |

**Not needed:** Public Key (only for card forms — we don't take cards), Client ID and Client Secret (only for OAuth/marketplace setups), your Mercado Pago password, bank details, the Pix key value, test-user passwords.

## C. Steps in the Mercado Pago panel

1. Turn on two-factor authentication on the Mercado Pago account. The Access Token can create charges and refunds, so treat it like a bank password.
2. Register a Pix key if the account doesn't have one yet.
3. In **Suas integrações**, create an application for online payments on your own site (no e-commerce platform), integrating **Checkout Transparente** (Payments API). The wizard's wording can vary slightly.
4. Test credentials appear automatically. The test Access Token is all Phase 2 needs.
5. In **Webhooks › Configurar notificações**:
   - production URL: `https://wiski.fun/api/webhooks/mercadopago`
   - test URL: the staging address we set up later
   - event: **Pagamentos**

   Save, then copy the **assinatura secreta** into `.env`. The site doesn't also send a per-payment `notification_url`, so every notification comes through this signed panel configuration.
6. Activate production credentials when the site is ready to go live (Phase 5). It asks for an industry (entertainment/media), the website `https://wiski.fun`, and acceptance of the terms. Have the terms and privacy pages online by then.
7. Send me the items in section A.

## D. When each piece is needed

| Phase | Needed |
|---|---|
| Phase 1 | nothing |
| Phase 2 (Pix + webhook code) | test Access Token + test webhook secret, with the **test** `MP_COLLECTOR_ID`/`MP_APPLICATION_ID`. Mercado Pago's API is reachable from my workspace. If you want me to run sandbox calls from here, put **test** values only in `Wiskiflix/.env.local` on your computer and tell me; I'll read it from there. |
| Phase 5 (go-live) | production Access Token + production webhook secret + **production** ids, typed by you into the server's `.env`; then one real low-value Pix (a movie sponsorship, or less with a one-off test voucher down to the R$ 5,00 minimum) to confirm the full flow end to end |

A Pix charge created with test credentials returns a QR code that can't be paid from a real bank app. So the approval path is covered by signed test notifications and mocked API responses in the test suite, and then by that one real payment before launch.

Sources: [Credenciais](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials) · [Credenciais de teste automáticas (nov/2025)](https://www.mercadopago.com.br/developers/pt/news/2025/11/19/Streamlined-integration-testing-with-automatic-credentials) · [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/notifications/webhooks) · [Pix — chaves cadastradas](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix) · [Integrar Pix (API Payments)](https://www.mercadopago.com.br/developers/en/docs/checkout-api-payments/integration-configuration/integrate-pix)
