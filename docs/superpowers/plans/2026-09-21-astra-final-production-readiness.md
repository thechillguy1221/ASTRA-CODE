# Astra Final Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the verified internal production-readiness gaps without changing Astra's stable runtime, billing, Room, Cline, or Codex architecture.

**Architecture:** Keep model choice server/catalog driven and make live certification choose a model only through an explicit test-only variable. Extend the existing model contract with presentation metadata derived from the authoritative catalog. Add a server-owned email sender identity store, with Super Admin routes/UI and PostgreSQL persistence, while preserving an environment fallback for bootstrap.

**Tech Stack:** TypeScript, Fastify, React, Zod, PostgreSQL migrations, Vitest, Electron renderer.

**Spec:** `docs/migration-certification.md` and the final production-readiness prompt supplied by the user.

## Global Constraints

- No global production model ID may force user requests; selected catalog model IDs remain authoritative.
- No provider credentials or email sender secrets may reach the renderer.
- Super Admin routes enforce server-side role checks.
- Existing deterministic tests, Room controls, billing boundaries, Cline provenance, and Codex runtime integration remain intact.
- External live credentials remain explicitly blocked rather than represented as passing evidence.

## Review Focus

- Obsolete `ASTRA_MODEL_ID` must not remain an active production configuration input; the live harness must still have an explicit test-only model selector.
- Model display must not invent provider identity; it must use catalog provider metadata or a deterministic fallback label.
- Email sender updates must reject spoofed From/Reply-To values and must be audit-authorized.
- PostgreSQL sender settings must survive restart and migration while in-memory tests remain deterministic.
- The final report must distinguish fresh evidence from historical installer/live-provider evidence.

### Task 1: Remove the global model selector

**Files:**

- Modify: `packages/config/src/index.ts`
- Modify: `.env.example`
- Modify: `scripts/certification.mjs`
- Modify: `tests/unit/config-production.test.ts`
- Modify: `tests/integration/certification-report.test.ts`
- Modify: `tests/live/model-gateway.smoke.test.ts`
- Modify: `docs/model-gateway.md`
- Modify: `docs/certification/2026-09-20-phase2-live-foundation.md`

**Interfaces:**

- Production config no longer exposes `modelId`.
- Live smoke config uses `ASTRA_LIVE_TEST_MODEL_ID`, classified as test/certification-only.

- [ ] Add a regression assertion that `loadConfig` ignores/removes the obsolete global selector and that production model selection remains request/catalog based.
- [ ] Run the focused test and confirm it fails against the current `modelId` field/`ASTRA_MODEL_ID` requirement.
- [ ] Remove the field from the environment schema/config result and replace the live harness requirement with `ASTRA_LIVE_TEST_MODEL_ID`.
- [ ] Update active documentation and `.env.example` classifications.
- [ ] Run the focused and complete test suites.

### Task 2: Expose authoritative provider metadata in the model picker

**Files:**

- Modify: `packages/contracts/src/domain/model.ts`
- Create: `apps/desktop/src/renderer/model-presentation.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `tests/integration/api-catalog.test.ts`
- Create: `tests/unit/model-presentation.test.ts`

**Interfaces:**

- `modelPresentation(model)` returns provider label, stable provider icon key, and display name from `ModelCatalogEntry`.
- Renderer displays provider and icon metadata without hard-coded model catalogs or secrets.

- [ ] Add failing tests for provider presentation and catalog metadata preservation.
- [ ] Implement the smallest presentation helper and optional catalog metadata required by the existing server contract.
- [ ] Render provider/icon in the model selector and settings catalog.
- [ ] Run focused renderer/catalog tests and the renderer build.

### Task 3: Super Admin-controlled email sender identities

**Files:**

- Modify: `packages/email/src/index.ts`
- Create: `packages/db/migrations/0015_email_sender_identities.sql`
- Modify: `packages/db/src/postgres-email.ts`
- Modify: `packages/db/src/postgres.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/api/src/email-route.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `tests/unit/email.test.ts`
- Create: `tests/integration/admin-email-senders.test.ts`

**Interfaces:**

- `EmailSenderIdentity` is an approved kind/address/reply-to record.
- `EmailSenderStore` supports get/list/upsert.
- Email messages select a sender kind; the service resolves it server-side and the Resend provider sends the resolved address.
- Admin API: `GET /v1/admin/email/senders` and `PUT /v1/admin/email/senders/:kind`.

- [ ] Add failing unit/API tests for sender resolution, spoof rejection, role enforcement, and idempotent update behavior.
- [ ] Implement sender types, validation, service resolution, and provider message plumbing.
- [ ] Add the PostgreSQL migration/store and wire it through the production server.
- [ ] Add Super Admin email settings controls to the existing admin Email surface.
- [ ] Run focused email/API tests, migration/build checks, and the complete suite.

### Task 4: Evidence refresh and final verification

**Files:**

- Modify: `docs/migration-certification.md`
- Modify: `docs/release-manifest.json`
- Modify: `docs/release-test-summary.md`
- Modify: `.env.example`

- [ ] Re-run the full deterministic suite, typecheck, lint, format, provenance, package/build, audit, and Codex artifact checks.
- [ ] Re-scan tracked production files for obsolete legacy identity and `ASTRA_MODEL_ID`.
- [ ] Recompute current commit/artifact facts from command output.
- [ ] Update the report with only fresh evidence and exact remaining external blockers.
