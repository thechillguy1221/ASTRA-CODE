# Astra production environment inventory

This is an inventory, not a secret file. Values must be supplied through the
deployment provider's encrypted variables or service references.

## Required by the production startup guard

| Variable                               | Classification           | Purpose                                                                                  |
| -------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `ASTRA_DATABASE_URL` or `DATABASE_URL` | service secret/reference | PostgreSQL connection; Railway PostgreSQL provides `DATABASE_URL`                        |
| `ASTRA_MODEL_GATEWAY_URL`              | service configuration    | Astra-managed model gateway endpoint                                                     |
| `ASTRA_MODEL_GATEWAY_API_KEY`          | secret                   | Model gateway authentication                                                             |
| `ASTRA_RUNTIME_TOKEN_SECRET`           | secret                   | Runtime token signing; at least 32 characters                                            |
| `ASTRA_SECURE_COOKIES=1`               | configuration            | Secure production session cookies                                                        |
| `ASTRA_DEVELOPMENT_ENTITLEMENT=0`      | configuration            | Prevents development entitlement bypass                                                  |
| `ASTRA_RAZORPAY_KEY_ID`                | secret/configuration     | Razorpay API identity                                                                    |
| `ASTRA_RAZORPAY_KEY_SECRET`            | secret                   | Razorpay API authentication                                                              |
| `ASTRA_RAZORPAY_WEBHOOK_SECRET`        | secret                   | Webhook signature verification                                                           |
| `ASTRA_RESEND_API_KEY`                 | secret                   | Transactional email provider                                                             |
| `ASTRA_EMAIL_FROM`                     | configuration            | Verified sender address                                                                  |
| `ASTRA_PUBLIC_SITE_URL`                | configuration            | Public origin used in links and callbacks                                                |
| `ASTRA_ALLOWED_ORIGINS`                | configuration            | Comma-separated browser origins allowed to call the API; do not use `*` with credentials |
| `ASTRA_GOOGLE_CLIENT_ID`               | configuration            | Google OAuth client                                                                      |
| `ASTRA_GOOGLE_CLIENT_SECRET`           | secret                   | Google OAuth authentication                                                              |
| `ASTRA_GOOGLE_REDIRECT_URI`            | configuration            | Google OAuth redirect                                                                    |
| `ASTRA_RELAY_SECRET`                   | secret                   | Remote relay authentication; at least 32 characters                                      |

## Optional or feature-specific

- `ASTRA_API_PORT`, `PORT`, and `ASTRA_API_HOST` control listener binding.
- `ASTRA_GOOGLE_DESKTOP_CALLBACK_URI` defaults to `astra://auth/callback`.
- `ASTRA_RELAY_REQUIRE_TLS` defaults to `1`.
- `ASTRA_SUPERADMIN_EMAIL` and `ASTRA_SUPERADMIN_PASSWORD_HASH` seed the
  server-authorized bootstrap account when configured.
- `ASTRA_WEB_SEARCH_ENDPOINT` and `ASTRA_WEB_SEARCH_API_KEY` enable a search
  provider only when the corresponding integration is configured.
- `VITE_ASTRA_PUBLIC_SITE_URL` configures the web build's public origin.

## Certification-only variables

`ASTRA_POSTGRES_CERTIFY=1`, `ASTRA_POSTGRES_RESTORE_URL`, and
`ASTRA_LIVE_TEST=1` are reserved for disposable database or explicitly
authorized provider certification. They must not be copied into normal
production environments. Certification must use real external services when
the test is intended to prove those services.

No credential is committed in this repository, and no deployment contract may
print secret values in logs or reports.
