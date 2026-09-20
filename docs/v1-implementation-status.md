# Lyntar V1 implementation status

This document separates code that exists from infrastructure evidence that has been certified.

## Deterministically implemented

- Windows desktop capability IPC, local workspace confinement, Git baseline isolation, atomic patching, command policy, budgets, cancellation, and append-only agent events.
- Authentication services with password hashing, email verification, refresh rotation, device sessions, logout-all, password reset, account disable, and encrypted desktop credential storage.
- Fixed-point wallet arithmetic, immutable ledger entries, reservations, exact settlement/release, provider/customer/absorbed cost fields, plan entitlements, and role-gated admin adjustments.
- Server model catalog and Auto routing, with no permanent model list in the desktop. Plan values and model plan access can be loaded from PostgreSQL records.
- Signed/idempotent Razorpay webhook boundary with exact raw-body verification, deterministic event release on processing failure, and a PostgreSQL payment/webhook adapter; no frontend payment state grants credits.
- Metadata-first Skills, built-in Lyntar Essentials resources, scoped MCP, capability-approved Plugins, API integration secret handles, and unified tool definitions.
- Project-grounded Learn, Viva, and Hackathon services.
- Responsive desktop Build/Learn/Viva/Hackathon navigation, public route/SEO shell, admin shell, release manifest validation, email consent policy, and redacted support diagnostics.

## Not live-certified

- Live Gateway requests: blocked until the live environment variables are supplied.
- PostgreSQL connectivity, migrations against a server, transaction rollback, concurrency, and backup/restore: blocked until disposable PostgreSQL URLs/tools are supplied.
- Razorpay sandbox/live payments: blocked until credentials and a disposable payment environment are supplied.

Mocks and deterministic adapters remain test evidence only. They must never be promoted to live certification.
