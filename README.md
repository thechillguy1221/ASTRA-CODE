# Lyntar

Lyntar is a Windows-first AI development workspace with a local-repository agent, server-controlled models and plans, deterministic commercial accounting, extensibility boundaries, and public/admin shells. External certification remains separate from deterministic implementation.

## Current milestone

The core milestone is a real local Git workflow: select a repository, submit a coding task, inspect relevant files, apply a safe atomic patch, run a real project command, verify the result, perform bounded repair, and show a diff that distinguishes Lyntar changes from pre-existing edits. Authentication, fixed-point wallet accounting, reservations/settlements, model routing, Skills, MCP, Plugins, modes, release metadata, and support boundaries are implemented with deterministic adapters.

## Development

1. Install Node.js 24 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`. Keep development entitlement disabled unless intentionally running a local development harness.
4. Run `npm test` for deterministic tests.
5. Run `npm run golden-path` to execute the real local broken-project repair fixture and print its isolated diff/result.
6. Run `npm run typecheck`, `npm run build`, and `npm run lint` before packaging.
7. Configure Gateway, PostgreSQL, restore, or Razorpay variables only for their opt-in certification harnesses.

Architecture and boundary details are in `docs/architecture.md`, `docs/threat-model.md`, `docs/permissions.md`, `docs/agent-state-machine.md`, and `docs/model-gateway.md`.

The deterministic track never needs provider credentials and is the required CI certification path. Live Gateway/PostgreSQL/Razorpay evidence remains independent: without the required environment it must report `BLOCKED` or `UNVERIFIED`, never `PASS`.
