# Lyntar Phase 2 Live Foundation Design

## Goal

Convert the deterministic Windows agent slice into an auditable live-agent foundation without weakening the existing safety boundaries. Commercial account, wallet, payment, and admin work remains gated behind a real live-model and PostgreSQL certification.

## Scope and release gate

This phase is executed in order: preserve the deterministic baseline, remediate dependencies, harden Windows and command security, certify PostgreSQL when a real instance is available, certify live model execution when credentials are supplied, then issue a truthful foundation verdict. Missing credentials or infrastructure produce `BLOCKED` evidence and stop commercial-layer implementation.

The live test track never falls back to the deterministic model. It is opt-in, records provider-supplied usage only, and redacts secrets from reports.

## Architecture

The existing boundary remains authoritative:

```text
Electron renderer -> typed IPC -> Electron adapter -> agent-core
                                             -> ports
                                      workspace / command / git /
                                      verification / model / events

Desktop -> Fastify API -> model-gateway -> Vercel AI Gateway-compatible endpoint
```

The API owns provider credentials, model selection, receipt persistence, and request correlation. The desktop owns local repository capabilities and forwards cancellation through the API/model boundary. `agent-core` remains framework-independent.

## Live certification paths

Live Test A runs the existing broken Node fixture through the real model boundary and verifies an isolated diff plus an immutable usage receipt. Live Test B uses a separate live request sequence with a deliberately insufficient first edit, observes a real verification failure, performs a bounded repair request, and aggregates all request receipts. Live cancellation aborts an in-flight stream and verifies no later tool action starts.

Each task carries hard limits for model calls, repair attempts, commands, wall time, and actual observed cost. A limit produces `BLOCKED` or `CANCELLED`; no unbounded retry loop exists.

## Data and audit

Usage receipts preserve request, gateway, task/session, model/provider, token categories, actual cost, expected-cost reconciliation, anomaly status, and creation time. Provider-missing fields remain null. Append-only agent events remain safe and concise; hidden reasoning and secrets are excluded.

The PostgreSQL foundation adds idempotent receipt/event writes, migration bookkeeping, model catalog metadata, and ledger immutability triggers. Commercial wallet behavior is not enabled until live-agent certification passes.

## Security

Workspace paths are canonicalized at operation time and revalidated immediately before read/write/command operations. Tests cover traversal, mixed separators, case changes, symlink/junction escapes and replacement, UNC/extended/device paths, alternate data streams, and outside-workspace command targets. Commands remain classified as safe, sensitive, destructive, or prohibited; destructive and credential/download patterns never execute automatically.

## Deferred scope

Authentication, device sessions, wallet reservations/settlement, plans, Razorpay, financial administration, public web surfaces, marketplace, MCP, Skills, Plugins, additional operating systems, and collaboration remain deferred until the live foundation gate is actually certified.
