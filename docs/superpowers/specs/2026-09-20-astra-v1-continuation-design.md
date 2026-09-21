# Astra V1 Continuation Design

## Purpose

Extend the existing deterministic Windows-agent foundation into a complete,
testable V1 product architecture without weakening the live-certification
gates. External model, PostgreSQL, and Razorpay certification remain explicit
environment gates; deterministic adapters provide repeatable development and
CI evidence without being represented as live evidence.

## Non-negotiable boundaries

The existing Electron renderer, typed capability-only IPC, Electron adapter,
framework-independent `packages/agent-core`, workspace security, model-gateway,
Fastify API, and database contracts remain authoritative. New product layers
consume those boundaries rather than moving orchestration into React or
placing provider/payment secrets in the desktop.

Authentication and billing live behind server-side ports. Wallet accounting
uses fixed-point decimal strings/integers and immutable ledger entries.
Reservations and idempotency are enforced by repository interfaces and the
PostgreSQL schema; in-memory implementations exist only for deterministic
tests. Live database concurrency remains blocked until a real PostgreSQL
instance is supplied.

Extensions use metadata-first routing. Skills are instruction packages, MCP is
an external tool transport, Plugins extend Astra itself, and direct API
integrations use secret handles. All extension tools pass through a unified
capability/risk registry and cannot bypass native workspace security.

## Product surfaces

The API exposes deterministic account, device, plans, wallet, payment,
catalog, extension, learning-mode, and admin service boundaries. The desktop
keeps the existing agent workflow and gains first-run navigation, account and
extension views through typed IPC. A responsive web shell and server-admin
shell consume the same contracts; they do not claim live payment or provider
certification.

## Data flow

```text
desktop/web/admin -> typed contracts -> Fastify services -> repositories
                                      -> model gateway / payment adapters
                                      -> PostgreSQL when configured
```

Before an AI task, the billing service checks plan/model entitlement and
creates an atomic reservation. Each usage receipt settles provider and
customer cost separately, releases unused reservation, and appends immutable
ledger entries. Provider cost may be absorbed for Astra-caused failures.

## Deterministic certification

Tests cover password/session behavior, device revocation, fixed-point credit
math, immutable ledger corrections, reservation concurrency simulation,
subscription/webhook idempotency, plan entitlements, Auto routing, metadata
routing for Skills, MCP/plugin permission gates, Learn/Viva/Hackathon project
grounding, desktop API contracts, responsive web/admin shells, and the
existing agent/security suites. Live model, PostgreSQL durability/concurrency,
and Razorpay sandbox/live tests remain skipped as `BLOCKED` when their required
configuration is absent.

## Deliberately deferred

This implementation does not claim live provider, PostgreSQL, Razorpay, code
signing, installer publication, or external marketplace trust certification.
It also avoids copying third-party code or branding; built-in Skills are
first-party metadata/instruction resources with explicit source and license
fields.
