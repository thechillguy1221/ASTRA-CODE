# Astra Control-Plane Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plan, model, entitlement, limit, Super Admin authorization, audit, versioning, and invalidation decisions authoritative through a transactional PostgreSQL-backed control plane while preserving existing Astra runtime behavior.

**Architecture:** Add a dependency-light `@astra/control-plane` package containing typed contracts, policy evaluation, permission resolution, audit redaction, repository ports, and cache invalidation. Implement deterministic memory adapters in that package and PostgreSQL adapters/migrations in `@astra/db`; compose the services in `apps/api` and route existing billing/model flows through authoritative snapshots.

**Tech Stack:** TypeScript, Zod, Fastify, PostgreSQL/`pg`, PostgreSQL transactions and `NOTIFY`, Vitest, npm workspaces, existing Astra `PlanCatalog`/billing/model-gateway architecture.

**Spec:** `docs/superpowers/specs/2026-09-21-astra-control-plane-foundation-design.md`

## Global Constraints

- Do not replace existing Astra authentication, billing, wallets, model gateway, Rooms, organizations, remote, email, Razorpay, desktop, or Codex architecture.
- The frontend must never be authoritative for plan, model, entitlement, limit, credit, or billing decisions.
- Every material control-plane mutation requires server authorization, strict validation, optimistic version checking, a reason where high-impact, and a transaction-coupled append-only audit event.
- Existing subscriber terms, financial history, user passwords, session tokens, provider secrets, and cryptographic material must not be silently changed or exposed.
- Explicit model selection remains authoritative; only `AUTO` may invoke server-side routing.
- Restricted operations fail closed when authoritative policy is unavailable.
- Production PostgreSQL persistence must not silently fall back to in-memory stores.
- Use TDD for every behavior change: write a failing test, observe the expected failure, implement the smallest passing change, then run the focused and relevant regression suites.

## Review Focus

- A stale concurrent admin update must not overwrite a newer version or create an audit event for a failed mutation. Test in Task 2 and Task 4.
- A notification loss or invalidation listener failure must not leave restricted runtime policy permanently stale. Test TTL refresh and fail-closed behavior in Task 2 and Task 5.
- An authenticated non-admin or admin without the required permission must not reach a control-plane mutation even if the request body claims a stronger role. Test in Task 4.
- A client-invented explicit model, disabled model, hidden model, or plan-ineligible model must be rejected before gateway execution. Test in Task 5.
- Audit data containing secret-like keys must be redacted and the persisted event must be undeletable/updatable. Test in Task 2 and Task 3.

---

### Task 1: Control-plane package contracts and workspace integration

**Files:**
- Create: `packages/control-plane/package.json`
- Create: `packages/control-plane/tsconfig.json`
- Create: `packages/control-plane/src/contracts.ts`
- Create: `packages/control-plane/src/ports.ts`
- Create: `packages/control-plane/src/errors.ts`
- Create: `packages/control-plane/src/index.ts`
- Modify: `packages/control-plane/package.json` (declare direct `zod` dependency)
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Test: `tests/unit/control-plane-contracts.test.ts`

**Interfaces:**
- Produces `ControlPlanePlanSnapshot`, `ControlPlaneModelSnapshot`, `EntitlementDecision`, `LimitValue`, `AdminPermission`, `AuditEventInput`, `ControlPlaneVersionConflict`, `ControlPlaneRepository`, `ControlPlaneTransaction`, and `InvalidationBus` exports for later tasks.
- Consumes only `@astra/contracts` types and Zod; it must not import `@astra/db`, Fastify, or React.

- [ ] **Step 1: Write failing contract tests.** Add tests that reject negative limits, invalid permission names, missing plan IDs, malformed model IDs, missing high-impact reasons, and secret-like audit fields, and that accept a valid `expectedVersion` mutation envelope.

- [ ] **Step 2: Run the focused tests.**

  Run: `npm test -- tests/unit/control-plane-contracts.test.ts`

  Expected: FAIL because `@astra/control-plane` and its schemas do not exist.

- [ ] **Step 3: Add the package and typed contracts.** Export Zod schemas and TypeScript types for plan/model snapshots, versioned mutations, entitlements, limits, permissions, audit events, invalidation messages, and stable error codes. Add the workspace package to the root build references and Vitest aliases.

- [ ] **Step 4: Run focused tests and package typecheck.**

  Run: `npm test -- tests/unit/control-plane-contracts.test.ts` and `npm run build --workspace @astra/control-plane`

  Expected: all contract tests pass and the new package compiles with no TypeScript errors.

- [ ] **Step 5: Commit.**

  Run: `git add packages/control-plane package.json tsconfig.json vitest.config.ts tests/unit/control-plane-contracts.test.ts && git commit -m "feat: add control plane contracts"`

### Task 2: Deterministic policy service, permissions, audit redaction, and invalidation

**Files:**
- Create: `packages/control-plane/src/memory.ts`
- Create: `packages/control-plane/src/permissions.ts`
- Create: `packages/control-plane/src/audit.ts`
- Create: `packages/control-plane/src/service.ts`
- Modify: `packages/control-plane/src/index.ts`
- Test: `tests/unit/control-plane-service.test.ts`
- Test: `tests/unit/control-plane-cache.test.ts`

**Interfaces:**
- Consumes the contracts and repository ports from Task 1.
- Produces `InMemoryControlPlaneRepository`, `InMemoryAuditStore`, `InMemoryInvalidationBus`, `ControlPlaneService`, `resolveAdminPermissions(role)`, and `redactAuditState(value)`.

- [ ] **Step 1: Write failing service tests.** Cover create/update/list plan snapshots, model snapshots, entitlements, limits, version conflicts, permission matrices, reason requirements, audit redaction, append-only in-memory audit behavior, local invalidation, TTL refresh, and fail-closed policy evaluation.

- [ ] **Step 2: Run the focused tests.**

  Run: `npm test -- tests/unit/control-plane-service.test.ts tests/unit/control-plane-cache.test.ts`

  Expected: FAIL because service, memory adapter, and evaluator implementations do not exist.

- [ ] **Step 3: Implement the in-memory ports and service.** Use immutable snapshot copies, per-resource version counters, explicit mutation validation, deterministic permission resolution with `SUPER_ADMIN` coverage, secret-key redaction, and synchronous invalidation publication. Make cache refreshes bounded by a configurable TTL and return a typed unavailable decision rather than granting access.

- [ ] **Step 4: Run the focused tests.**

  Run: `npm test -- tests/unit/control-plane-service.test.ts tests/unit/control-plane-cache.test.ts`

  Expected: all service and cache tests pass, including stale-update rejection and no audit event on failed mutation.

- [ ] **Step 5: Commit.**

  Run: `git add packages/control-plane/src tests/unit/control-plane-service.test.ts tests/unit/control-plane-cache.test.ts && git commit -m "feat: add control plane policy service"`

### Task 3: PostgreSQL migration, bootstrap, repository, audit trigger, and NOTIFY adapter

**Files:**
- Create: `packages/db/migrations/0016_control_plane_foundation.sql`
- Create: `packages/db/src/postgres-control-plane.ts`
- Modify: `packages/db/src/postgres.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/schema.sql`
- Test: `tests/integration/control-plane-migration.test.ts`
- Test: `tests/unit/postgres-control-plane.test.ts`

**Interfaces:**
- Consumes the contracts and repository ports from `@astra/control-plane`, existing `plans`/`model_catalog` projections, and `Pool`/`PoolClient` from `pg`.
- Produces `PostgresControlPlaneRepository`, `PostgresInvalidationBus`, `bootstrapControlPlane`, and `PostgresControlPlaneTransaction`.

- [ ] **Step 1: Write failing adapter/migration tests.** Assert migration ordering, required table/trigger/NOTIFY SQL, idempotent bootstrap of Free/Basic/Pro/Max/Team/Business and existing models, transaction-coupled mutation/audit calls, parameterized queries, and no plaintext secret persistence.

- [ ] **Step 2: Run the focused tests.**

  Run: `npm test -- tests/integration/control-plane-migration.test.ts tests/unit/postgres-control-plane.test.ts`

  Expected: FAIL because migration `0016` and the PostgreSQL control-plane adapter do not exist.

- [ ] **Step 3: Add the forward migration.** Create typed plan/version/entitlement/limit/model-history/permission tables, extend `admin_audit_log` with context/version/redaction metadata, add append-only update/delete triggers, add required indexes and uniqueness constraints, seed only missing snapshots from current Astra defaults, and use `pg_notify('astra_control_plane_changed', payload)` in the mutation transaction.

- [ ] **Step 4: Implement the PostgreSQL repository and listener.** Use `PoolClient` transactions, `SELECT ... FOR UPDATE` where a mutation reads current state, `UPDATE ... WHERE version = expectedVersion`, explicit SQL columns, redacted JSON snapshots, and a dedicated LISTEN connection that invalidates only the indicated cache domain/resource. Do not return secrets or raw credential fields.

- [ ] **Step 5: Register migration and stores.** Add `0016_control_plane_foundation` to `applyFoundationMigration`, expose the repository/bus through `PostgresStores`, and keep the existing model and plan adapters compatible during transition.

- [ ] **Step 6: Run focused adapter tests and the package build.**

  Run: `npm test -- tests/integration/control-plane-migration.test.ts tests/unit/postgres-control-plane.test.ts` and `npm run build --workspace @astra/db`

  Expected: tests pass and the database package compiles. If live PostgreSQL is unavailable, SQL contract tests remain green and the exact live blocker is recorded.

- [ ] **Step 7: Commit.**

  Run: `git add packages/db/migrations/0016_control_plane_foundation.sql packages/db/src packages/db/src/schema.sql tests/integration/control-plane-migration.test.ts tests/unit/postgres-control-plane.test.ts && git commit -m "feat: persist versioned control plane"`

### Task 4: Server-authoritative admin authorization and control-plane APIs

**Files:**
- Modify: `packages/billing/src/admin.ts`
- Modify: `packages/billing/src/index.ts`
- Modify: `apps/api/src/admin-route.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Test: `tests/integration/api-control-plane.test.ts`
- Test: `tests/unit/admin.test.ts`

**Interfaces:**
- Consumes `ControlPlaneService`, permission resolver, audit store, and repository adapters from Tasks 1–3 plus existing `AuthService` identity data.
- Produces authenticated policy endpoints and permission-checked admin CRUD/version/audit endpoints with stable `401`, `403`, `409`, and `503` responses.

- [ ] **Step 1: Write failing API tests.** Cover unauthenticated access, user access, role-to-permission mapping, Super Admin access, finance/support denial for plan/model mutations, missing reason, invalid payload, stale expected version, audit pagination, and policy lookup for the authenticated user.

- [ ] **Step 2: Run the focused API tests.**

  Run: `npm test -- tests/integration/api-control-plane.test.ts tests/unit/admin.test.ts`

  Expected: new endpoint tests fail because routes and permission-based control-plane wiring are absent; existing admin tests remain the regression baseline.

- [ ] **Step 3: Extend server-side admin permissions.** Preserve legacy `AdminAction` callers while mapping each control-plane route to explicit permissions. Require the authenticated role from `AuthService`; ignore body/query role claims. Require reasons for high-impact writes and pass request/session/device/IP context into the audit transaction.

- [ ] **Step 4: Register control-plane dependencies and routes.** Add typed schemas and explicit handlers for plan/model reads and writes, version history, entitlement reads, limit reads, and paginated audit reads. Connect the production server to PostgreSQL stores and the test app to deterministic stores.

- [ ] **Step 5: Run focused API tests.**

  Run: `npm test -- tests/integration/api-control-plane.test.ts tests/unit/admin.test.ts`

  Expected: all new authorization/API tests pass and existing wallet/email/admin authorization tests remain green.

- [ ] **Step 6: Commit.**

  Run: `git add packages/billing/src/admin.ts packages/billing/src/index.ts apps/api/src/admin-route.ts apps/api/src/app.ts apps/api/src/server.ts tests/integration/api-control-plane.test.ts tests/unit/admin.test.ts && git commit -m "feat: expose authorized control plane APIs"`

### Task 5: Runtime policy enforcement and reloadable plan/model snapshots

**Files:**
- Modify: `packages/plans/src/index.ts`
- Modify: `packages/billing/src/service.ts`
- Modify: `packages/billing/src/organization-service.ts`
- Modify: `apps/api/src/model-selection.ts`
- Modify: `apps/api/src/model-route.ts`
- Modify: `apps/api/src/codex-runtime-route.ts`
- Modify: `apps/api/src/app.ts`
- Test: `tests/unit/plans-v1.test.ts`
- Test: `tests/integration/api-model-route.test.ts`
- Test: `tests/integration/api-auto-model.test.ts`
- Test: `tests/integration/codex-runtime-api.test.ts`

**Interfaces:**
- Consumes `ControlPlaneService` snapshot/evaluator APIs and existing billing reservations/model catalog ports.
- Produces a backward-compatible reloadable plan provider and model policy evaluator used by normal model requests and Codex runtime requests.

- [ ] **Step 1: Write failing enforcement tests.** Add cases for explicit plan-ineligible model rejection, invented model rejection, disabled/hidden/maintenance rejection, unavailable policy fail-closed, explicit selected-model preservation, `AUTO` routing through the current catalog, and billing/organization plan checks using refreshed snapshots.

- [ ] **Step 2: Run focused enforcement tests.**

  Run: `npm test -- tests/unit/plans-v1.test.ts tests/integration/api-model-route.test.ts tests/integration/api-auto-model.test.ts tests/integration/codex-runtime-api.test.ts`

  Expected: the new entitlement/maintenance/fail-closed assertions fail against the current catalog-only validation.

- [ ] **Step 3: Add the reloadable provider adapter.** Preserve `PlanCatalog` public behavior for existing callers while allowing an authoritative snapshot replacement from the control-plane cache. Ensure unknown/unavailable snapshots do not grant access.

- [ ] **Step 4: Route all model execution paths through policy evaluation.** Validate authenticated plan and organization context before gateway execution, retain the selected model ID, allow only `AUTO` to select a different model, and apply the same policy to Codex runtime requests.

- [ ] **Step 5: Run focused enforcement and regression tests.**

  Run: `npm test -- tests/unit/plans-v1.test.ts tests/integration/api-model-route.test.ts tests/integration/api-auto-model.test.ts tests/integration/codex-runtime-api.test.ts tests/integration/api-model-reservation.test.ts tests/integration/api-billing.test.ts`

  Expected: all pass with no change to valid existing reservation or billing behavior.

- [ ] **Step 6: Commit.**

  Run: `git add packages/plans/src packages/billing/src/service.ts packages/billing/src/organization-service.ts apps/api/src/model-selection.ts apps/api/src/model-route.ts apps/api/src/codex-runtime-route.ts apps/api/src/app.ts tests/unit/plans-v1.test.ts tests/integration/api-model-route.test.ts tests/integration/api-auto-model.test.ts tests/integration/codex-runtime-api.test.ts tests/integration/api-model-reservation.test.ts tests/integration/api-billing.test.ts && git commit -m "feat: enforce control plane policy at runtime"`

### Task 6: Bootstrap documentation, certification wiring, and Slice 1 verification

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `packages/db/src/postgres.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/authentication-and-billing.md`
- Create: `docs/control-plane.md`
- Test: `tests/unit/control-plane-bootstrap.test.ts`
- Test: `tests/security/control-plane.test.ts`

**Interfaces:**
- Consumes the complete Slice 1 service and adapters from Tasks 1–5.
- Produces a production startup path that applies migration/bootstrap, starts invalidation listening, and documents the authoritative/fail-closed boundaries.

- [ ] **Step 1: Write failing bootstrap/security tests.** Assert empty-store bootstrap, representative-store idempotency, production PostgreSQL wiring, secret filtering, append-only audit behavior, and no accidental in-memory fallback when a database URL is configured.

- [ ] **Step 2: Run the focused tests.**

  Run: `npm test -- tests/unit/control-plane-bootstrap.test.ts tests/security/control-plane.test.ts`

  Expected: tests fail until production startup and security boundaries are wired.

- [ ] **Step 3: Wire startup and documentation.** Initialize the control plane after migrations, seed missing defaults, attach PostgreSQL invalidation listeners, keep in-memory adapters only for deterministic test construction, and document admin permissions, version conflicts, audit guarantees, cache behavior, and secret handling.

- [ ] **Step 4: Run Slice 1 certification commands.**

  Run: `npm test`

  Expected: the full deterministic suite passes with zero failures.

  Run: `npm run typecheck`

  Expected: all project references compile with zero errors.

  Run: `npm run lint`

  Expected: ESLint exits zero.

  Run: `npm run format:check`

  Expected: Prettier reports all checked files formatted.

  Run: `npm run build`

  Expected: packages, API, desktop, web, prerender, and admin builds exit zero.

  Run: `npm run verify:source-provenance`

  Expected: source provenance verification exits zero.

  Run: `git diff --check`

  Expected: no whitespace errors.

- [ ] **Step 5: Commit certification/documentation updates.**

  Run: `git add apps/api/src/server.ts packages/db/src/postgres.ts docs/architecture.md docs/authentication-and-billing.md docs/control-plane.md tests/unit/control-plane-bootstrap.test.ts tests/security/control-plane.test.ts && git commit -m "docs: certify control plane foundation"`

## Completion contract

Slice 1 is complete only when every task has a passing focused test run, the full certification commands have fresh zero-exit evidence, and the branch contains no uncommitted implementation changes. Only then may the next task begin: update the specification and plan for Slice 2 commercial foundation and continue automatically using the same control-plane interfaces.
