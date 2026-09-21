# Astra Control-Plane Foundation Design

**Status:** Approved design for implementation

**Scope:** Slice 1 of the Super Admin control-plane program

**Date:** 2026-09-21

## Goal

Make plan, model, entitlement, limit, and administrative policy decisions authoritative on the server without replacing the existing Astra architecture or silently changing existing customer behavior.

The first slice provides the durable control-plane foundation that later commercial and operations slices will consume:

```text
Super Admin
  -> permission-checked control-plane mutation
  -> PostgreSQL transaction + versioned snapshot + audit event
  -> invalidation notification
  -> runtime policy snapshot
  -> billing/model/entitlement enforcement
```

## Existing architecture and constraints

- `apps/api` owns Fastify route registration and production dependency wiring.
- `packages/db` owns PostgreSQL migrations and adapters, with deterministic in-memory stores used by tests.
- `packages/plans` owns the current `PlanCatalog` and Astra default plan definitions.
- `packages/billing` owns personal and organization credit reservation/settlement and currently receives a `PlanCatalog`.
- `model_catalog` is already the persisted model source used by `/v1/models` and model execution.
- `plans` already stores current plan projections and is loaded at API startup.
- `admin_audit_log` already records some admin mutations but has coarse role/action authorization and no database append-only guard.
- Existing user, organization, Room, wallet, model gateway, email, Razorpay, remote, desktop, and Codex behavior must remain compatible.

The design therefore adds a focused `@astra/control-plane` domain package and PostgreSQL adapters instead of moving policy logic into HTTP handlers or rewriting billing.

## Design decisions

### 1. Dedicated control-plane domain package

Create `packages/control-plane` with:

- Zod-backed control-plane contracts and typed mutation inputs;
- repository and transaction ports;
- permission-based admin authorization;
- immutable audit event creation and redaction;
- versioned snapshot services;
- entitlement and limit evaluation;
- cache/invalidation interfaces;
- deterministic in-memory implementations for tests.

The package must not depend on Fastify, React, PostgreSQL, provider SDKs, or secret storage.

`@astra/db` implements the package ports. `apps/api` composes the services with existing auth, billing, and model routes.

### 2. Versioned plan snapshots

Keep `plans` as the compatibility projection used by existing foreign keys and payment/subscription code. Add typed versioned plan configuration rows and child tables:

- plan identity/status metadata;
- plan configuration versions with monotonically increasing versions;
- typed commercial-independent policy fields needed by current runtime behavior;
- versioned entitlement values;
- versioned limit values;
- versioned model access rows.

Slice 1 owns plan identity, policy, entitlement, and limit versions. Slice 2 will add regional/versioned pricing and commercial transition behavior without rewriting this versioning model.

Every mutation supplies `expectedVersion`. PostgreSQL updates use a version predicate inside a transaction. A stale writer receives a typed conflict and does not partially apply.

### 3. Authoritative model catalog

Extend the existing `model_catalog` projection only with fields required for Slice 1 policy and lifecycle decisions, including maintenance state, provider metadata, region availability, and an optimistic version. Store immutable model configuration history separately so changing the current projection never destroys historical configuration.

The persisted catalog remains the sole source for `/v1/models`, explicit model validation, and Auto routing inputs. No new client-side model matrix is introduced.

### 4. Permission-based Super Admin authorization

Preserve the existing top-level roles for backward compatibility, then map them to explicit permissions:

- `admin.users`
- `admin.organizations`
- `admin.rooms`
- `admin.billing`
- `admin.models`
- `admin.plans`
- `admin.security`
- `admin.email`
- `admin.features`
- `admin.releases`
- `admin.system`

`SUPER_ADMIN` receives all permissions through server-side policy. Every admin route authenticates independently, derives the role from the authenticated server identity, resolves permissions, and rejects unauthorized calls. Frontend state, local storage, hidden routes, and request body role fields are never used as authority.

### 5. Transaction-coupled append-only audit logging

Every material control-plane mutation writes its audit event in the same database transaction as the configuration change. The audit event contains actor ID, role/permission, action, target type/ID, redacted before/after state, reason, request ID, session/device context, network context when available, and timestamp.

The audit table receives database triggers that reject updates and deletes. Redaction is performed before persistence; secret-like keys and token/password fields are never stored. In-memory tests use an append-only store with equivalent redaction and mutation behavior.

High-impact changes require a non-empty reason. Read-only operations do not create mutation events.

### 6. Resilient cache invalidation

Each control-plane domain exposes a snapshot version. Runtime services read immutable snapshots through a small cache with:

- explicit local invalidation after a successful mutation;
- PostgreSQL `NOTIFY` emitted from the same transaction after commit eligibility;
- a listener that invalidates matching domain keys on notification;
- bounded TTL fallback for missed notifications;
- fail-closed behavior for restricted policy decisions when no safe snapshot exists.

Notifications carry only domain and resource identifiers/version, never secret or customer-sensitive payloads. The in-memory adapter publishes equivalent events synchronously.

### 7. Backend enforcement

The model request path will evaluate authoritative policy before gateway execution:

1. authenticate the user;
2. load the current plan/policy snapshot;
3. validate the requested model against enabled/visible/maintenance/region state;
4. validate plan/model access and limits;
5. preserve an explicit user-selected model;
6. allow server routing only for `AUTO`;
7. execute the gateway request using the validated catalog entry.

If policy configuration is unavailable, restricted operations fail closed. Existing development-only entitlement behavior remains explicit and test-only; production wiring will use the control-plane service.

The same evaluator will be usable by billing and organization services without trusting client-provided plan or entitlement data.

## Persistence model

Migration `0016_control_plane_foundation.sql` will be forward-only and idempotent. It will:

1. create control-plane plan/version/entitlement/limit/model-history/permission tables;
2. extend the existing audit table with context, version, and redaction metadata;
3. add append-only triggers and indexes;
4. import the current Astra default plans and existing model catalog into version 1 only where a control-plane record is absent;
5. preserve existing plan IDs and foreign-key relationships;
6. avoid changing existing subscriber terms or rewriting financial history;
7. register the migration through `applyFoundationMigration`.

Bootstrap logic must be safe on empty and representative databases. Production must not silently fall back to in-memory persistence when a PostgreSQL configuration is expected.

## API contracts

Authenticated client-facing policy endpoints:

- `GET /v1/entitlements/me`
- `GET /v1/organizations/:organizationId/entitlements`

Permission-checked admin endpoints:

- `GET /v1/admin/control-plane/plans`
- `POST /v1/admin/control-plane/plans`
- `GET /v1/admin/control-plane/plans/:planId`
- `PUT /v1/admin/control-plane/plans/:planId`
- `GET /v1/admin/control-plane/plans/:planId/versions`
- `GET /v1/admin/control-plane/models`
- `POST /v1/admin/control-plane/models`
- `GET /v1/admin/control-plane/models/:modelId`
- `PUT /v1/admin/control-plane/models/:modelId`
- `GET /v1/admin/control-plane/audit`

Mutations use strict Zod schemas, explicit fields, a required `reason` for high-impact actions, and `expectedVersion`. There is no unrestricted generic update endpoint.

## Error and safety behavior

- Invalid input returns a stable validation error without mutation.
- Missing permission returns `403` without revealing resource details.
- Missing or invalid session returns `401`.
- Stale version returns `409 CONTROL_PLANE_VERSION_CONFLICT`.
- Missing authoritative policy returns `503 CONTROL_PLANE_UNAVAILABLE` for restricted policy reads and `403`/`409` for denied operations as appropriate.
- Disabled, hidden, maintenance, or plan-ineligible models cannot execute even if a client invents the model ID.
- Secrets, passwords, access tokens, refresh tokens, provider credentials, and cryptographic material are never returned or logged.

## Testing strategy

Focused tests will cover:

- contract validation and redaction;
- in-memory repository/service behavior;
- plan/model version creation and optimistic conflicts;
- transactional audit coupling and append-only rejection;
- permission matrix and Super Admin coverage;
- entitlement and limit evaluation;
- model route rejection for unauthorized, disabled, hidden, maintenance, and invented models;
- explicit model preservation and `AUTO`-only routing;
- notification invalidation, TTL recovery, and fail-closed behavior;
- migration ordering and bootstrap idempotency;
- PostgreSQL adapter SQL behavior through existing certification hooks where a live database is available.

The existing full test suite, typecheck, lint, format check, production build, provenance checks, and `git diff --check` remain required before Slice 1 is certified.

## Non-goals for Slice 1

- regional/versioned pricing, top-ups, promotions, model consumption pricing, and Razorpay mapping changes;
- full Super Admin operations UI;
- feature-flag targeting;
- user, organization, Room, device, email, release, maintenance, and analytics administration beyond the policy interfaces needed by the foundation;
- secret rotation or vault implementation;
- destructive financial record operations.

Those capabilities consume this foundation in Slice 2 and Slice 3.
