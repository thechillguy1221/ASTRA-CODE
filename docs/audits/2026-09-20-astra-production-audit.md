# Astra AI production audit — 2026-09-20

This is the implementation audit for the native-Windows production-hardening pass. Statuses distinguish code that exists from infrastructure that has actually been certified.

## Repository identity

| Field                     | Observed value                                               |
| ------------------------- | ------------------------------------------------------------ |
| Branch                    | `main`                                                       |
| HEAD                      | `4f5018576454a006b32a031b4762c6f268509f33`                   |
| Version                   | `0.1.0`                                                      |
| Package manager           | npm workspaces with committed `package-lock.json`            |
| Desktop                   | Electron 44, React/Vite renderer, sandboxed CommonJS preload |
| API                       | Fastify, TypeScript                                          |
| Production persistence    | PostgreSQL via `pg` adapters and SQL migrations              |
| Deterministic persistence | in-memory stores and test adapters                           |
| Audit working tree        | clean before this audit change                               |

## Product feature inventory

| Feature                      | Frontend entry                           | Backend owner                         | Local runtime owner                                                    | Database owner                                           | Tests                                                    | Status / gap / action                                                                                                                |
| ---------------------------- | ---------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Coding workspace             | `apps/desktop/src/renderer/App.tsx`      | `apps/api/src/model-route.ts`, events | `apps/desktop/electron/desktop-runtime.ts` and `packages/agent-core`   | event/receipt stores                                     | agent, desktop, golden path                              | Implemented and deterministic-tested; native editor/remote UX remains less complete than a mature IDE                                |
| Local files, commands, Git   | desktop workspace adapters               | none for execution                    | `packages/workspace`                                                   | local Git/workspace state                                | security, command, patch, golden path                    | Implemented and deterministic/security-tested                                                                                        |
| Agent persistence            | desktop session store and agent-core     | event persistence                     | `packages/agent-core`                                                  | agent events/receipts                                    | session continuity                                       | Implemented; live restart certification unavailable                                                                                  |
| Model catalogue and Auto     | desktop model IPC, web model page        | `catalog.ts`, model routes            | API model port                                                         | model catalogue tables                                   | catalog, Auto, model route                               | Implemented; live provider/model certification blocked                                                                               |
| Personal billing             | web/account and desktop wallet           | billing routes/service                | reservation header from desktop                                        | personal wallets/buckets/ledger                          | billing, concurrency, API billing                        | Implemented and deterministic-tested                                                                                                 |
| Team/Business pooled billing | plan/web surfaces and remote Room routes | plan/remote metadata                  | organization context passed through typed reservation/model boundaries | org wallet/buckets/ledger/reservations/settlements       | organization billing, API billing/model, migration tests | Implemented with fixed-point pooled reservation/settlement and Room attribution; real PostgreSQL certification remains blocked       |
| Auth, OTP, reset, devices    | web auth; desktop auth IPC               | auth routes/service                   | Electron safeStorage and session store                                 | auth/session/device tables                               | auth and API auth                                        | Implemented/deterministic-tested; live Google and PostgreSQL blocked                                                                 |
| Personal devices             | account/devices and remote routes        | remote routes/service                 | typed device identity IPC and remote host bridge boundary              | remote device tables                                     | remote access, relay, host-bridge, desktop IPC           | Device registration/revocation and typed host dispatch implemented; installed multi-device relay certification remains blocked       |
| Rooms                        | remote API and public feature route      | remote routes/service                 | typed host bridge boundary; full installed Room UX remains limited     | organizations/rooms/members/invites/pooled wallet tables | remote access/API/relay, host-bridge, org billing        | Authorization, suspension/removal, pooled billing, and attribution implemented deterministically; live host workflow remains blocked |
| Skills/MCP/Plugins           | extension routes/surfaces                | package registries                    | agent/tool boundary packages                                           | registry metadata                                        | extensions, remote permission tests                      | Deterministically implemented; live hostile endpoint/plugin certification unavailable                                                |
| Learn/Viva/Hackathon         | desktop modes and web feature routes     | local runtime services                | `packages/modes` plus workspace snapshot                               | none required for deterministic mode                     | modes                                                    | Implemented/deterministic-tested                                                                                                     |
| Super Admin                  | `apps/admin`                             | admin/email/analytics routes          | none                                                                   | PostgreSQL admin/analytics stores                        | admin/analytics/email                                    | Implemented/deterministic-tested; live data certification blocked                                                                    |
| Public web/SEO               | `apps/web`, prerender script             | plan/release endpoints                | none                                                                   | none                                                     | browser smoke/route tests                                | Crawlable prerender and metadata implemented; public domain still configured centrally to legacy `lyntar.dev` until supplied         |
| Windows release              | Electron Builder NSIS                    | release manifest route                | Electron main/preload                                                  | release metadata                                         | package/build checks                                     | Fresh Astra-branded unsigned x64 installer generated and hashed; signing and installed-app E2E remain blocked                        |

## Cline lineage matrix

| Astra component         | Cline source / package         | Upstream version/commit | Reuse form                              | License obligation                          | Coverage / boundary                                                  |
| ----------------------- | ------------------------------ | ----------------------- | --------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| Agent runtime           | None found in repository audit | Not applicable          | Independent Astra `packages/agent-core` | No Cline notice identified                  | agent-core tests; Astra owns orchestration                           |
| File/workspace tools    | None found                     | Not applicable          | Independent `packages/workspace`        | No Cline notice identified                  | path/security tests; Astra owns capability boundary                  |
| Terminal/process policy | None found                     | Not applicable          | Independent workspace command runner    | No Cline notice identified                  | command/cancellation tests                                           |
| Session persistence     | None found                     | Not applicable          | Independent agent-core/session stores   | No Cline notice identified                  | session tests                                                        |
| MCP                     | None found                     | Not applicable          | Independent `packages/mcp`              | No Cline notice identified                  | extension/permission tests                                           |
| Desktop UI              | None found                     | Not applicable          | Electron/React/Vite implementation      | No Cline notice identified                  | desktop build and IPC tests                                          |
| Astra wrapper boundary  | Not applicable                 | Not applicable          | `@lyntar/*` internal packages           | Internal compatibility identifiers retained | Public Astra branding; no evidence of a Cline-derived implementation |

Conclusion: the repository is Astra-owned and independently implemented in the audited paths. The release must not claim Cline SDK/Core reuse or inherit Cline licensing obligations without new source evidence.

## Desktop shell audit

| Area                   | Observed implementation                                                          | Gap / action                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Native shell           | Electron main process with context isolation, sandbox, node integration disabled | Preserve Electron; migrating to Tauri would be an unnecessary rewrite without a concrete defect |
| Bundled renderer       | Vite output loaded with `loadFile` outside dev mode                              | Implemented; package smoke passes                                                               |
| Local file/process/Git | Main-process `DesktopRuntime` adapters                                           | Implemented and security-tested                                                                 |
| Secure credentials     | Electron `safeStorage` abstraction                                               | Implemented and unit-tested                                                                     |
| Deep links             | `astra://` protocol and single-instance forwarding                               | Implemented; installed-app E2E not yet certified                                                |
| Window lifecycle       | BrowserWindow with min size, standard lifecycle                                  | Implemented; multi-monitor/DPI manual E2E not run                                               |
| Installer              | Electron Builder NSIS x64 unsigned artifact                                      | Generated and hashed; signing/unattended install E2E unavailable                                |
| Updater                | Release manifest/package configuration exists                                    | Signature/update install/rollback not live-certified                                            |

## Frontend route map

Public routes are defined centrally in `apps/web/src/routes.ts`: home, pricing, download, models, security, docs, blog, agent/codebase/model-switching/task-estimation/MCP/remote/security/cost-control/learn/viva/hackathon/skills/plugins features, student/freelancer/startup/developer/team use cases, verified comparison pages, account/auth/legal routes, plus unpublished comparison/marketplace routes. `apps/admin` is a separate admin client. The Electron renderer is a separate bundled coding client, not a public web shell.

## Backend service matrix

| Service          | Implementation                             | Persistence                            | Current evidence                                                         |
| ---------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| Auth/OAuth       | Fastify auth routes + `packages/auth`      | PostgreSQL adapters or in-memory tests | deterministic PASS; live OAuth/PG BLOCKED                                |
| Model gateway    | model route + `packages/model-gateway`     | usage receipts                         | fake gateway tests PASS; live gateway BLOCKED                            |
| Personal billing | billing route/service + `packages/billing` | personal wallet/buckets/ledger         | deterministic PASS                                                       |
| Payments         | Razorpay state machine/webhook route       | payment stores                         | deterministic webhook tests PASS; sandbox BLOCKED                        |
| Email            | Resend abstraction/campaign routes         | email stores                           | deterministic sanitization/idempotency tests PASS; real delivery BLOCKED |
| Admin/analytics  | admin/email/analytics routes               | admin/analytics stores                 | deterministic authorization/NO_LIVE_DATA tests PASS                      |
| Devices/Rooms    | remote routes + remote-protocol            | PostgreSQL/in-memory remote stores     | deterministic authorization/revocation PASS; live relay BLOCKED          |
| Release          | release manifest route                     | release config                         | deterministic route/build checks; signed update BLOCKED                  |

## Authentication, device, remote, and Room matrix

| Boundary                                  | Implemented                | Deterministic evidence                  | Live gap                                                        |
| ----------------------------------------- | -------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Email/password/OTP/reset                  | Yes                        | auth unit/integration suite             | Real PostgreSQL/Resend not available                            |
| Web sessions/logout-all                   | Yes                        | auth API suite                          | Multi-instance distributed rate limit/live PG blocked           |
| Desktop auth                              | Yes                        | desktop runtime/credential tests        | Installed Windows and Google system-browser flow not run        |
| Device registration/revocation            | Yes                        | auth/remote tests                       | Real multi-device relay not available                           |
| Relay grant/signature/replay/backpressure | Yes                        | remote protocol/WebSocket tests         | TLS staging relay/DNS unavailable                               |
| Own-device authorization                  | Yes in service/API         | remote access, relay, host-bridge tests | Installed desktop host/client wiring and live relay unavailable |
| Room roles/suspend/remove/leave           | Yes in service/API         | remote/API/host-bridge tests            | Live sockets and external relay unavailable                     |
| Workspace sandbox                         | Existing local path policy | path security tests                     | Remote host attack certification not run                        |

## Billing/model matrix

| Concern                  | Observed                                                                   | Action                                                               |
| ------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Plan values              | Server-controlled Free/Basic/Pro/Max/Team/Business matrix                  | Preserve and expose authoritative values                             |
| Credit unit              | Fixed-point, `$0.01` per credit in plan/billing math                       | Preserve; add org parity                                             |
| Personal reservation     | Backend-authenticated and idempotent                                       | Preserve                                                             |
| Personal settlement      | Provider receipt source of truth, exact release                            | Preserve                                                             |
| Organization reservation | Fixed-point in-memory and PostgreSQL adapters with row-lock contract       | Deterministic tests pass; real PostgreSQL race certification blocked |
| Organization settlement  | Exact pooled settlement/release with provider/customer/absorbed cost       | Deterministic tests pass; real PostgreSQL certification blocked      |
| Member/Room attribution  | Reservation/model boundary and org receipts carry actor/Room/host metadata | Deterministic API and migration tests pass                           |
| Rollover/top-up          | Deterministic personal buckets                                             | Preserve; org policy remains separate                                |
| Model selection          | Explicit Auto/manual catalog                                               | Preserve; live provider blocked                                      |

## Security matrix

| Control                                            | Evidence                                                   | Remaining risk                                                |
| -------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Workspace canonical paths/reparse/UNC/device paths | security tests                                             | Remote-host live attack not run                               |
| Command classification/output limits/cancellation  | security/integration tests                                 | Windows process-tree manual certification not complete        |
| Renderer isolation                                 | Electron config and IPC tests                              | Packaged installed E2E not run                                |
| Secret redaction/scans                             | source scan and telemetry boundary                         | External provider live logs unavailable                       |
| Ledger immutability/idempotency                    | personal and organization billing tests/schema constraints | Real PostgreSQL trigger/transaction certification unavailable |
| Admin RBAC/audit                                   | admin tests                                                | Live PostgreSQL transaction behavior unavailable              |
| Relay grant authorization/revocation               | relay tests                                                | Durable multi-instance/staging TLS unavailable                |

## Live certification matrix

| External gate     | Status at audit | Exact blocker                                                                            |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------- |
| AI Gateway/model  | BLOCKED         | `LYNTAR_LIVE_TEST`, gateway URL/key/model absent                                         |
| PostgreSQL        | BLOCKED         | `LYNTAR_DATABASE_URL` and disposable restore target absent                               |
| Google OAuth      | BLOCKED         | real OAuth client configuration absent                                                   |
| Resend            | BLOCKED         | real API key and verified sender absent                                                  |
| Razorpay          | BLOCKED         | sandbox credentials absent                                                               |
| Relay             | BLOCKED         | staging relay/TLS/DNS/two-host environment absent                                        |
| Windows signing   | BLOCKED         | signing certificate/environment absent                                                   |
| Public domain/DNS | BLOCKED         | production Astra domain not supplied; canonical remains centrally configured legacy host |

## Immediate production actions

1. Certify organization billing, migrations, reservation races, and restore against disposable PostgreSQL.
2. Wire and certify the installed desktop host/client path through a real TLS relay staging environment.
3. Provide and verify AI Gateway, Google OAuth, Resend, Razorpay sandbox, signing, and production-domain infrastructure.
4. Keep final verdict `NOT PRODUCTION READY` unless all launch-critical external gates are actually certified.
