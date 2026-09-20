# Lyntar

Lyntar is an AI development workspace. This repository currently contains the Windows-first agent foundation and local-repository vertical slice; the public website and commercial product subsystems are intentionally deferred.

## Current milestone

The first milestone is a real local Git workflow: select a repository, submit a coding task, inspect relevant files, apply a safe atomic patch, run a real project command, verify the result, perform bounded repair, and show a diff that distinguishes Lyntar changes from pre-existing edits.

## Development

1. Install Node.js 24 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure a PostgreSQL URL only when running the database-backed API.
4. Run `npm test` for deterministic tests.
5. Run `npm run golden-path` to execute the real local broken-project repair fixture and print its isolated diff/result.
6. Run `npm run typecheck`, `npm run build`, and `npm run lint` before packaging.
7. Configure the live Gateway variables only for the opt-in live smoke test.

Architecture and boundary details are in `docs/architecture.md`, `docs/threat-model.md`, `docs/permissions.md`, `docs/agent-state-machine.md`, and `docs/model-gateway.md`.

The deterministic golden path never needs provider credentials and is the required CI certification track. A live test without credentials must report `BLOCKED` or `UNVERIFIED`, never `PASS`.
