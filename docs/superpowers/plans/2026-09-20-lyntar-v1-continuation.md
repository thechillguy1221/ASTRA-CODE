# Lyntar V1 Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the deterministic V1 commercial, extensibility, learning, desktop, web, release, and observability foundations while preserving blocked live-certification gates.

**Architecture:** Add focused packages for auth, plans, billing, extensions, integrations, releases, email, and shared UI contracts. Keep server-only secrets and accounting in API/package boundaries, keep the existing agent runtime unchanged, and use deterministic in-memory adapters for tests when external services are unavailable.

**Tech Stack:** TypeScript, npm workspaces, Fastify, Zod, PostgreSQL-compatible repositories, Electron/React/Vite, Vitest, fixed-point decimal accounting.

**Spec:** `docs/superpowers/specs/2026-09-20-lyntar-v1-continuation-design.md`

## Global Constraints

- Preserve `ebd44dd07050f815af6ab54abb89b8d4485fdbff` behavior and all existing agent/security boundaries.
- Never fabricate live model, PostgreSQL, or Razorpay evidence.
- Never put provider, payment, session, or SMTP secrets in renderer code, source, logs, fixtures, reports, or screenshots.
- Use fixed-point accounting; JavaScript floating point is not a financial source of truth.
- Ledger history is append-only; corrections use compensating entries.
- Client-side balances and hidden UI are never authorization controls.
- Live tests remain opt-in and report `BLOCKED` when required configuration is absent.

## Review Focus

- Decimal credit strings preserve `37.826` exactly across reservation/settlement and JSON boundaries; fixed-point tests pin this to billing.
- Replayed webhook, subscription-period, settlement, and admin idempotency keys produce one logical mutation; idempotency tests pin this to billing.
- Revoked device refresh, disabled user, and rotated session credentials cannot authenticate; auth integration tests pin this to auth.
- Extension metadata is searchable without loading all instructions/tools into model context; routing tests pin this to extensions.
- A project-grounded Learn/Viva/Hackathon response references actual files and never claims unavailable live data; mode tests pin this to product services.

### Task 1: Authentication and device sessions

Add `packages/auth` with password hashing, email verification, refresh rotation, account disable, device sessions, and deterministic repository adapters. Add API routes and contract tests. Keep browser/deep-link and Windows secure-storage adapters behind interfaces; do not store renderer tokens.

### Task 2: Plans, wallet, ledger, reservations, and settlements

Add `packages/plans` and `packages/billing` with fixed-point credit math, immutable ledger operations, reservations, usage settlement, provider/customer/absorbed cost separation, plan entitlements, deterministic concurrency simulation, and PostgreSQL migration/schema/repository interfaces. Add API routes and billing tests.

### Task 3: Razorpay architecture and financial administration

Add a server-only payment adapter boundary, webhook verification/idempotency state machine, subscription-period grants, refunds/reconciliation, role-based admin services, and admin API/read models. Use deterministic signed-webhook fixtures only; live/sandbox remains blocked.

### Task 4: Model catalog and Auto routing

Extend model metadata, plan access, feature flags, and server-side Auto routing. The desktop receives catalog decisions; it never chooses arbitrary gateway IDs. Add deterministic routing and entitlement tests.

### Task 5: Skills, MCP, Plugins, integrations, and unified tool registry

Add metadata-first extension packages with official built-in Skill resources, progressive routing, MCP transport declarations, plugin manifests/permission review, secret handles, and a searchable risk-aware unified tool registry. Add deterministic security tests.

### Task 6: Learn, Viva, Hackathon, and desktop UX

Add project-grounded mode services and typed IPC/UI surfaces. Drive visible progress from append-only events; preserve reduced-motion and approval behavior. Add renderer contract/component tests.

### Task 7: Web/admin shells, releases, email, finance, observability, and docs

Add minimal responsive `apps/web` and `apps/admin` shells, server-managed Windows release manifests, SMTP interfaces/suppression models, finance/usage read models, structured redacted telemetry, support-bundle policy, feature flags, and V1 docs. No marketing claim is presented as live evidence.

### Task 8: Full deterministic certification and release report

Run every deterministic suite plus typecheck, lint, format, build, audit, golden path, and blocked live harnesses. Produce separate implementation/live verdicts, exact counts, starting/final SHA, and unresolved external gates. Commit only after fresh verification.
