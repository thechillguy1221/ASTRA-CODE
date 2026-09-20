# Astra AI commercial platform status

This document records implementation state separately from external certification. It is intentionally
not a production-ready claim.

## Implemented in this continuation

- Astra AI public naming in user-facing web, desktop, admin, and model-agent copy.
- Compatibility plan for existing `@lyntar/*`, `LYNTAR_*`, `window.lyntar`, persisted storage, and
  migration identifiers.
- Hashed six-digit email OTPs with expiry, resend cooldown, attempt limits, single use, and generic
  unknown-email behavior.
- Google OAuth/OIDC boundary with server-fixed provider redirect URI, state, PKCE challenge binding,
  single-use desktop code, system-browser Electron entry point, and deep-link forwarding.
- Resend provider abstraction with idempotency header, transactional/marketing separation, HTML
  sanitization, safe variables, suppression, preferences, and deterministic campaign delivery.
- Server-authoritative admin analytics interfaces, PostgreSQL query adapter, explicit `NO_LIVE_DATA`,
  and metric definitions.
- Super Admin hash-only bootstrap and the existing server-side role checks.
- Route-driven Astra public website, feature/use-case pages, verified-source comparison data, withheld
  comparison pages when sources are not current, dynamic metadata updates, JSON-LD, sitemap, and
  responsive/accessibility-oriented UI.
- Server-authoritative Auto model selection with explicit user choice, model-bound reservations, and
  no silent fallback from a manually selected model.
- Fixed-point task credit accounting with bounded overrun approval checkpoints, runaway-loop guards,
  live observed-usage events, and the revised $0.01-per-credit conversion.
- Compact agent-session/checkpoint persistence with restart-safe workspace session identity and
  redaction/size limits for persisted user/task metadata; raw model context and source contents are
  not stored in the desktop session file.
- Authenticated WebSocket relay transport with token-based connection authentication, heartbeat,
  backpressure bounds, broker authorization, replay-safe message forwarding, and immediate broker
  revocation when a device or Room member is revoked/suspended/removed.
- Reproducible Windows x64 NSIS packaging configuration with separate signed and explicitly unsigned
  build commands. The unsigned installer build was exercised; code-signing remains an external release
  gate.

## Deliberately blocked or incomplete external certification

- Google OAuth: blocked until a real OAuth application and redirect registration are supplied.
- Resend: blocked until a verified sender/domain and API key are supplied.
- PostgreSQL: deterministic adapters and migration are implemented; live connectivity, restore, and
  concurrency require a disposable PostgreSQL environment.
- Razorpay: existing deterministic state machine remains; sandbox/live payment evidence is pending.
- AI Gateway: existing live harness remains; provider credentials are not present.
- Windows installer: unsigned x64 NSIS artifact builds locally; Authenticode signing and production
  distribution remain pending.
- Remote relay: the WebSocket transport is implemented and deterministically tested; grant issuance,
- desktop host/client integration, durable multi-instance relay state, and staging network certification
  remain pending. Team/Business organization wallets are schema-ready but are not yet wired into the
  live model-reservation path; current billable reservations use the authenticated user's wallet.

## Compatibility note

Public Astra copy does not imply that internal identifiers have been renamed. The cutover of the
production domain, installer identity, OAuth redirect URLs, email links, and signed release manifest
must be a separate migration with an upgrade test.
