# Astra AI agent foundation certification

Date: 2026-09-20

## Verdict

The deterministic local-agent track is the certification path for this phase. Live provider certification is separate and cannot be marked successful without a real model response and a persisted provider usage receipt.

## Implemented

- npm-workspaces TypeScript monorepo with `apps/api`, `apps/desktop`, and the approved shared packages.
- Typed contracts for task states, budgets, IPC, API requests, model catalog entries, append-only events, and usage receipts.
- Electron main/preload adapter with context isolation, sandbox defaults, and capability-only renderer IPC.
- Local Windows path canonicalization and escape checks covering traversal, alternate separators, case-insensitive containment, device paths, UNC paths, and resolved links/junctions.
- Atomic file patch batches with checkpoints and rollback.
- Command policy and child-process cancellation with safe/sensitive/destructive/prohibited classification.
- Git baseline capture and Lyntar/pre-existing/mixed diff ownership.
- Node/TypeScript project detection and separate verification port.
- Bounded agent loop with explicit states, cancellation, permissions, model/repair/command/time/cost budgets, and concise append-only events.
- Server-controlled model catalog, Vercel AI Gateway adapter boundary, PostgreSQL migration, and actual usage-receipt persistence.
- Intentionally broken Node fixture and deterministic repair golden path.

## Verification commands

| Check                                       | Required interpretation                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm test -- --maxWorkers=1 --minWorkers=1` | All deterministic unit, integration, security, desktop-boundary, and golden-path tests pass                       |
| `npm run golden-path`                       | Must print `COMPLETED`, a passed verification, `src/validate.ts` as Lyntar-owned, and `README.md` as pre-existing |
| `npm run typecheck`                         | All TypeScript project references pass                                                                            |
| `npm run build`                             | API, Electron main, renderer bundle, and packages build                                                           |
| `npm run lint`                              | No lint errors                                                                                                    |
| `npm run test:live`                         | Either a real receipt-backed pass, or explicit `BLOCKED`/`UNVERIFIED`; never a fabricated live pass               |

## Current run

- `npm.cmd test`: 73 test files and 203 tests passed.
- `npm.cmd run golden-path`: `COMPLETED`; verification passed; `src/validate.ts` was Lyntar-owned and `README.md` was pre-existing.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed, including the renderer bundle, Electron main process, and sandboxed CommonJS preload.
- `npm.cmd run lint`: passed.
- `npm.cmd run format:check`: passed.
- `npm.cmd run dev:api` plus `GET http://127.0.0.1:4317/health`: returned `{"status":"ok"}`.
- `npm.cmd run test:live`: `BLOCKED`; `LYNTAR_LIVE_TEST`, Gateway URL, Gateway key, and model ID were absent, so the one live test was skipped rather than represented as a pass.
- The built Electron shell launched and remained running without a load error until it was manually stopped after the launch check.
- Browser smoke passed in Chromium, Firefox, and WebKit for public routes, CTA navigation, metadata, and responsive overflow checks.
- `npm.cmd run package:win:unsigned` produced an unsigned x64 NSIS artifact with SHA-256
  `4D12BFC945D00E5C31CF7101C3D7598D411F1A411A0322190331E95A7D899D1D`; Authenticode signing is
  still blocked.

## Not yet externally certified

- A live provider call in this environment, unless `npm run test:live` is run with valid credentials.
- PostgreSQL connectivity and migration application against a running database.
- Electron packaged launch with a live API/model configuration.
- Production signing, distribution, and update behavior.

## Deferred

Marketing/web/admin, commercial billing, marketplace, MCP, Skills, Plugins, cloud repository workspaces, student modes, and broad language verification remain explicitly deferred. See [deferred scope](../deferred-scope.md).
