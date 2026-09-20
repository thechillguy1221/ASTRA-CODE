# Lyntar Phase 2 Live Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Certify the existing Windows agent foundation against real dependency, database, security, and model boundaries without claiming live success when required external state is absent.

**Architecture:** Preserve the current Electron adapter, typed IPC, framework-independent agent-core, Fastify API, model-gateway, workspace security, Git ownership, and append-only event boundaries. Add only the data needed for auditable live requests and certification.

**Tech Stack:** TypeScript, npm workspaces, Electron, React/Vite, Fastify, PostgreSQL/`pg`, Vitest, Docker when available, Vercel AI Gateway-compatible HTTP streaming.

**Spec:** `docs/superpowers/specs/2026-09-20-lyntar-phase2-live-foundation-design.md`

## Global Constraints

- Preserve the deterministic baseline and run it before and after every implementation batch.
- Never place provider credentials in source, fixtures, logs, screenshots, or reports.
- Live tests must skip as `BLOCKED` when credentials are absent and may not fall back to fake models.
- Do not implement authentication, wallet, plans, Razorpay, or admin before the live foundation passes.
- Do not weaken path, command, cancellation, Git, patch rollback, budget, or event guarantees.
- Do not invent a PostgreSQL result, cost receipt, Git SHA, or release verdict.

## Review Focus

- A provider stream can emit a request ID, decision content, usage, or cost in separate/unterminated SSE chunks; the parser must retain every available field.
- A receipt can be emitted before a cost ceiling is tripped; it must remain persisted and task-correlated.
- A workspace junction can be replaced after selection; every sensitive operation must revalidate the canonical target.
- A duplicate gateway request or event delivery must be idempotent without duplicate financial evidence.
- Missing live credentials, PostgreSQL, or Docker must remain explicit blockers rather than green test results.

### Task 1: Baseline and dependency security

Run the deterministic suite with one worker, typecheck, lint, format check, and authoritative `npm audit`. Upgrade only audited vulnerable direct dependencies after checking engine and build compatibility. Record every remaining finding and run the full matrix again.

### Task 2: Auditable contracts and PostgreSQL foundation

Extend model catalog and usage receipt contracts with gateway/provider correlation, nullable usage categories, expected-cost reconciliation, and anomaly fields. Add append-only event persistence and immutability protections to the migration. Add integration tests that run against a real PostgreSQL URL when supplied and report `BLOCKED` when it is absent.

### Task 3: Windows security and process certification

Add adversarial path tests, operation-time canonicalization checks, command-policy coverage, output truncation metadata, and process-tree cancellation tests. Keep tests deterministic on Windows and avoid destructive commands.

### Task 4: Live gateway and agent certification harness

Add opt-in Live Test A, bounded-repair Test B, and live cancellation tests using the real API/model boundary. Ensure receipts are aggregated and persisted, no secret enters telemetry, and missing configuration skips explicitly.

### Task 5: Release evidence and gate decision

Run tests, typecheck, lint, format, build, golden path, audit, live smoke, and PostgreSQL checks. Attempt safe Git release-baseline diagnosis without deleting locks. Produce a sanitized report with exact counts and a conditional/not-certified verdict if any required evidence is unavailable.

### Commercial gate

Only after Task 5 reports `WINDOWS AGENT FOUNDATION: CERTIFIED` may a new plan implement authentication, wallet, exact reservation/settlement, plans, Razorpay, and minimum financial/model administration. This run must stop before that gate if live or PostgreSQL evidence is blocked.
