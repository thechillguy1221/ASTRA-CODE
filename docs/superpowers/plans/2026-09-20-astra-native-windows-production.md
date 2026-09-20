# Astra AI Native Windows Production Hardening Plan

**Goal:** Move the existing Astra AI release candidate from deterministic commercial/agent coverage toward a production-grade Windows release candidate without replacing the stable Electron, agent-core, workspace-security, API, database, billing, or remote-protocol foundations.

**Architecture:** Keep Electron as the native Windows shell because the repository already bundles a real local-capability desktop runtime. Keep the Fastify API as control plane, the Electron main process as capability adapter, `packages/agent-core` as framework-independent orchestration, PostgreSQL as the production persistence target, and `packages/remote-protocol` as the authenticated relay/Room boundary. Add organization-scoped pooled accounting beside the existing personal wallet path instead of overloading personal wallet rows.

**Tech Stack:** TypeScript, npm workspaces, Electron 44, React/Vite, Fastify, Zod, PostgreSQL/`pg`, Vitest, Electron Builder NSIS, WebSocket relay, fixed-point integer accounting, existing typed IPC and capability ports.

**Spec:** The newest Astra native-Windows production prompt, including real installed Windows packaging, backend-authoritative model/plan/credit controls, personal devices, Team/Business pooled wallets, Rooms, secure remote boundaries, and truthful certification.

**Global Constraints:** Preserve existing passing behavior and internal `@lyntar/*`, `LYNTAR_*`, `window.lyntar`, migration, and protocol identifiers where compatibility requires them. Do not migrate Electron to Tauri without a concrete defect. Do not put provider or billing secrets in desktop code. Do not call deterministic tests live certification. Do not weaken workspace, command, cancellation, or permission safeguards. Do not alter unrelated user work. Use tests before production changes and run the full verification suite before release identity is recorded.

**Review Focus:** Organization wallet correctness and race resistance; user/Room authorization; desktop-to-relay boundaries; installer/deep-link/native behavior; secret handling; exact test evidence; distinction between implemented, deterministic, live, blocked, and certified.

## Evidence baseline

- Branch: `main`.
- Starting HEAD: `4f5018576454a006b32a031b4762c6f268509f33`.
- Working tree: clean at plan creation.
- Existing deterministic baseline: 73 test files and 203 passing tests, typecheck/lint/format/build/audit/golden path passing in the prior verified run.
- Existing shell: bundled Electron desktop with context-isolated preload and local workspace/process/Git adapters; no Tauri implementation exists.
- Existing personal billing: fixed-point personal wallet, buckets, reservation, settlement, release, rollover, admin ledger, and PostgreSQL adapter.
- Verified gap: `organizations.pooled_credits` and Room metadata exist, but billable model reservation/settlement still uses only the authenticated user's personal wallet.
- External gates currently unavailable: live AI Gateway, disposable PostgreSQL, Google OAuth app, Resend sender/key, Razorpay sandbox, relay staging/DNS/signing credentials.

## Implementation sequence

### 1. Freeze audit evidence and gap matrices

- Re-run repository identity, deterministic suite, typecheck, lint, format, build, audit, golden path, and current unsigned packaging checks.
- Inspect the real desktop shell, API route graph, billing contracts/adapters, remote protocol, migration list, and packaging configs.
- Record feature ownership/status/risk in `docs/audits/2026-09-20-astra-production-audit.md` and keep external certification blockers explicit.
- Verify no live secrets are present in source, artifacts, logs, or documentation.

### 2. Implement organization-scoped pooled credit accounting

- Add contract types for organization wallet, organization buckets, organization reservations, and usage settlement attribution without changing personal wallet schemas.
- Add a billing service/store boundary that can reserve and settle against either a personal wallet or an authorized organization wallet.
- Add an in-memory deterministic implementation first, with fixed-point arithmetic, idempotency, earliest-expiring bucket allocation, exact release, provider/customer/absorbed cost separation, and immutable compensating ledger entries.
- Add PostgreSQL migration and adapter tables with organization foreign keys, unique idempotency keys, row locking, settlement uniqueness, and member/Room/task attribution.
- Extend API reservation/settlement requests to accept an explicit organization/Room context only after server-side Room/plan authorization; never trust client balance or plan fields.
- Add deterministic tests for pooled reservation races, settlement/release, duplicate settlement, member attribution, Room authorization, seat/job limits, and isolation from personal wallets.

### 3. Harden desktop-native release behavior

- Keep Electron and document the concrete reason no Tauri migration is justified for this release.
- Add a real Astra Windows icon resource/configuration where the packaging tool supports it, preserve bundled renderer behavior, and test protocol registration, window lifecycle, secure storage, and no provider secrets in packaged output.
- Add deterministic tests for native capability boundaries and package metadata; run unsigned NSIS packaging and record checksum/signing status.
- Keep signed packaging/update paths explicit and blocked when credentials or production update metadata are absent.

### 4. Connect remote protocol to desktop capability boundaries

- Add a small main-process remote host/client boundary that consumes authenticated relay grants and routes only typed remote messages to existing `DesktopRuntime` capabilities.
- Enforce Room permissions, host workspace selection, cancellation, command policy, and local canonical-path checks before any remote action.
- Add deterministic host/client tests for own-device ownership, Room role restrictions, suspension/removal revocation, offline/disconnect handling, replay/backpressure, and no raw filesystem escape.
- Keep live relay certification blocked without staging infrastructure; do not claim a working live remote session from unit tests.

### 5. Truthful production UX and controls

- Expose server-selected model, estimate, actual/provisional credits, bounded overrun continuation, and organization/personal wallet context through existing contracts/IPC where the current UI can support it.
- Keep Settings secondary to the coding workspace and show truthful empty/no-live-data states.
- Avoid a broad UI rewrite; change only surfaces needed to represent implemented controls without fake status.

### 6. Certification and release discipline

- Add/extend certification scripts so absent external credentials produce `BLOCKED`, never fake success.
- Run focused tests after each change, then full deterministic tests, typecheck, lint, format check, production build, audit, golden path, browser smoke when UI changes, package build, `git diff --check`, and secret scan.
- Attempt available live/infrastructure certifications; preserve blocked statuses with exact reason and attempted command.
- Inspect the final diff, create a clean release-candidate commit only if the environment permits, record the exact SHA/artifact/checksum, and issue `PRODUCTION READY` only if every launch-critical external gate is actually certified. Otherwise issue `NOT PRODUCTION READY`.

## Final evidence format

Use the required A–AY report sections from the user prompt. Each subsystem must distinguish `IMPLEMENTED`, `DETERMINISTIC TESTED`, `LIVE TESTED`, `CERTIFIED`, and `BLOCKED`; list only real remaining risks; include exact commands/results and the final immutable release identity.
