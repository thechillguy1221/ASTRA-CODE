# Astra AI V1 implementation status

This document separates code that exists and passes deterministic verification from live external infrastructure evidence that has been certified.

## Deterministically implemented & verified (77 test files, 220 passed tests on 2026-09-20)

- **User-Controlled Model Selection (spec §3, §4)**: Explicit user model selection is strictly authoritative. `AUTO_MODEL_ID = 'AUTO'` acts as a dedicated selectable option with transparent routing disclosure. Same-model provider failover preserved with `logicalModelId`.
- **Server-Controlled V1 Pricing & Plans (spec §5, §6, §8, §68)**:
  - Free: ₹0, 25 monthly credits, 1 active job.
  - Basic: ₹499/month (+ applicable taxes), 300 monthly credits, 3 active jobs.
  - Pro: ₹999/month (+ applicable taxes), 600 monthly credits, 5 active jobs.
  - Max: ₹1,999/month (+ applicable taxes), 1,200 monthly credits, 10 active jobs.
  - Team: ₹9,999/month (+ applicable taxes), 6,000 pooled credits, 5 seats, 10 active jobs per active seat.
  - Business: ₹19,999/month (+ applicable taxes), 12,000 pooled credits, 10 seats, 10 active jobs per active seat.
  - One Astra credit represents USD $0.01 of billable model usage; internal accounting keeps seven decimal places.
  - Plan models allow all models (`*`) where credits are the sole economic limiter. Tax exclusivity clearly marked.
- **Wallet Buckets & Immutability (spec §7, §9, §10, §41)**:
  - Universal wallet with 7-decimal fixed-point math (`CREDIT_SCALE = 10,000,000`).
  - Bucket schemas defined for `free_monthly`, `subscription_monthly`, `purchased_topup`, `promotional`, `referral`, `refund_adjustment`, `admin_adjustment`.
  - Append-only ledger; DB triggers prevent UPDATE and DELETE operations.
  - Concurrent reservation double-spend prevention verified.
- **Task Cost Estimation & Authorization (spec §11, §12, §13)**:
  - Pre-task estimate range (min/max credits, token estimates, post-task projected balance).
  - Multi-tiered cost warning levels (`none`, `info`, `warn`, `auth-required`).
  - Per-task spending caps and threshold checks to prevent surprise balance depletion.
- **Canonical Agent Session Architecture (spec §17–§27)**:
  - Runtime ownership: `AgentSession` and `StructuredTaskState` independent of provider session.
  - Append-only event history with 25+ discriminated event schemas (`model.changed`, `checkpoint.created`, `session.paused`, `session.resumed`, `test.result`, etc.).
  - Checkpoint mechanism (`SessionCheckpoint`) supporting safe pause/resume, model switching, and crash recovery.
- **Complete Razorpay Subscription State Machine (spec §31–§39)**:
  - Handles `CREATED`, `AUTHENTICATED`, `ACTIVE`, `PENDING`, `HALTED`, `CANCELLED`, `COMPLETED`.
  - Immediate cancellation rule: on confirmed cancellation, paid access ends immediately, monthly credits expire, purchased credits survive.
  - Idempotent credit allocation (`subscription-cycle:{id}:{period_start}`) resisting replays and duplicate webhooks.
  - Refunds and chargebacks tracked with audit logs.
- **Security Boundaries (spec §43–§47)**:
  - Command classification policy: SAFE / SENSITIVE / PROHIBITED.
  - Secret redaction for environment variables, bearer tokens, API keys, private keys, and payment secrets.
  - Prompt injection defense: untrusted repository content wrapped with non-elevating trust boundary markers.
- **Astra Remote Protocol (internal package `@lyntar/remote-protocol`, spec §48–§64)**:
  - Mobile-first structured RPC protocol (`@lyntar/remote-protocol`) over outbound secure connections.
  - HMAC-signed QR code pairing with 60s TTL and public-key device fingerprinting.
  - Tiers for remote terminal commands, diff viewing, and spend authorization.
  - Device and Room-member revocation removes matching active broker connections immediately.
  - Typed desktop device identity IPC, host dispatch bridge, and organization-pooled reservation/
    settlement boundaries are implemented and deterministically tested.
  - Installed host/client integration, durable multi-instance relay state, and organization-pooled
    PostgreSQL concurrency remain unlive-certified.
- **Team/Business pooled billing**:
  - Fixed-point organization wallets, expiring buckets, immutable organization ledgers, bounded
    reservations, exact settlement/release, rollover, webhook grants, and Room/member/host
    attribution are implemented for deterministic and PostgreSQL-backed paths.

## Final deterministic verification (2026-09-20)

- `npm.cmd test`: 77 test files and 220 tests passed; no failures.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- `npm.cmd run format:check`: passed.
- `npm.cmd run build`: passed; web prerender generated 53 crawlable route documents.
- `npm.cmd run golden-path`: `COMPLETED`; verification passed; `src/validate.ts` was Astra-owned and
  `README.md` remained pre-existing.
- `npm.cmd audit --audit-level=moderate`: 0 vulnerabilities after upgrading `electron-builder` to
  26.15.3 and `ws` to 8.21.3.
- `node scripts/supply-chain-report.mjs`: passed; the direct inventory reports no unreported license
  value after the remote-protocol package metadata fix.
- Browser smoke: Chromium, Firefox, and WebKit passed public-route, CTA, metadata, and responsive
  overflow checks at 320, 360, 390, 768, and 1280 CSS pixels.
- `npm.cmd run package:win:unsigned`: produced `apps/desktop/release-unsigned/Astra-AI-0.1.0-win-x64-unsigned.exe`;
  the final release-candidate checksum is `5BC566E6583ABDDFAF283F85F5C094CE4422F446B317854391BD2F434FF4752E`;
  Authenticode status is `NotSigned`.

## Not live-certified (Blocked per Spec §80)

- **LIVE AI CERTIFICATION**: BLOCKED — external provider/gateway credentials not supplied in environment.
- **RAZORPAY SANDBOX CERTIFICATION**: BLOCKED — Razorpay test/sandbox account credentials not supplied.
- **POSTGRESQL CERTIFICATION**: BLOCKED — disposable real PostgreSQL server instance not connected.
- **WINDOWS LIVE CERTIFICATION**: BLOCKED — code-signing credentials and installed-app/distribution environment are not attached.
- **ASTRA REMOTE LIVE CERTIFICATION**: BLOCKED — public relay service, TLS/DNS staging, and two-host environment are not deployed.

Mocks and deterministic test harnesses remain test evidence only. They are not promoted to live certification.
