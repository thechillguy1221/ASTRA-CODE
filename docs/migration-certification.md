# Astra Code Migration Certification

Certification date: 2026-09-21 (Asia/Calcutta)

## A. Executive result

# NOT PRODUCTION READY

The repository now has a passing deterministic TypeScript/API/renderer build,
an acquired and hash-verified official Codex Windows x64 runtime, a real
initialize/session launch certification, and an unsigned Windows installer
containing that runtime. It is still not production ready because live Astra
model/Gateway execution and several launch-critical external and Room
certifications remain unavailable or incomplete.

## B. Release identity

| Field                                | Evidence                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Branch                               | `main`                                                                                       |
| Starting SHA                         | `8fdaaa7c4e3eea761b9b8930ddf825caa77b3ea7`                                                   |
| Final SHA                            | Not created; the working tree is intentionally uncommitted. `HEAD` remains the starting SHA. |
| Version                              | `0.1.0`                                                                                      |
| Working tree                         | Dirty with the migration changes listed by `git status --short`.                             |
| Certified desktop artifact           | `apps/desktop/release-unsigned/Astra-Code-0.1.0-win-x64-unsigned.exe`                        |
| Artifact size                        | 166,008,031 bytes                                                                            |
| Artifact SHA-256                     | `D8A964B303AD982ECD49094B4602F34BE923B9DBA5C0EEA64106B1FF17F403B0`                           |
| Bundled Codex runtime                | `resources/codex/codex-app-server.exe`, 245,798,704 bytes                                    |
| Bundled Codex SHA-256                | `616C4961D85C8FACCF0C1AE5DB3CE4DFD2DE18422F6A9A5C5EBADA9C96AD4395`                           |
| Runtime package status               | PASS — installer includes executable, manifest, Codex LICENSE/NOTICE, and Cline LICENSE      |
| Code signing                         | BLOCKED — no signing credential was available; the artifact is unsigned.                     |
| Web/API/relay deployment identifiers | None supplied or verified in this workspace.                                                 |

## C. Architecture audit

The existing architecture remains Electron 44 with a bundled React/Vite
renderer, isolated preload, Fastify/TypeScript API, PostgreSQL adapters, and
deterministic in-memory test stores. Astra continues to own authentication,
billing, wallets, model catalogue, Rooms, devices, relay policy, MCP,
Plugins, Skills, and authorization.

The new source path is designed as:

`Astra renderer -> Astra Workspace Bridge/main process -> Codex app-server -> Astra runtime API -> Vercel AI Gateway`.

The source-level cutover defaults `DesktopRuntime` to `CodexTaskRunner`; the
legacy runner is available only through an explicit `legacy-test` test mode.
The official Codex release artifact is bundled and the real process now passes
initialize and `thread/start` through the Astra supervisor.

## D. Upstream source provenance

### Cline

- Repository: `https://github.com/cline/cline`
- Pinned SHA: `9a2512bb9835869d74774da99708a7f9d80b0fe8`
- Tree: `79cd0f11e55ebbf11da424afa482f003b1e0bed2`
- License: Apache-2.0
- Selected upstream source: `sdk/packages/ui/components/agent-approval-card.*` and `sdk/packages/ui/components/session-status.*`
- Astra destinations: `apps/desktop/src/renderer/cline/*` and `apps/desktop/src/renderer/cline-workspace.tsx`
- Evidence: renderer build transformed 23 modules and the production `App.tsx` imports the Astra wrappers around those copied/adapted components.
- Boundary: Cline runtime, provider authentication, account, and billing code is excluded.

### Codex

- Repository: `https://github.com/openai/codex`
- Pinned SHA: `5c5308fc9a9ee789049d646ef11e5400384b9c6f`
- Tree: `4557e77bc256683fc29b6e2026b21dd72eb99674`
- License: Apache-2.0; pinned NOTICE retained.
- Protocol fingerprint: `1b94b320c014fa02eb89bc613d7beef36b1a400d164eeeaad8dd716d6da81435`
- Runtime boundary: upstream `codex-rs/app-server`, `app-server-client`, and `app-server-protocol`, launched only through the Astra supervisor.
- Astra adapter: `packages/codex-runtime/src/index.ts`.
- Desktop adapter: `apps/desktop/electron/codex-task-runner.ts`.
- Build result: official pinned Windows x64 app-server acquisition and SHA verification PASS. A local Cargo build remains BLOCKED by host allocation failures; the official release artifact is the selected production build input.
- Runtime result: `npm.cmd run certify:codex-runtime` PASS — real executable initialize and `thread/start` from an Astra-controlled runtime home.

The machine-verifiable provenance check passed:

`npm.cmd run verify:source-provenance` — PASS.

Full details are in [source-provenance.md](source-provenance.md),
[cline-component-provenance.md](cline-component-provenance.md), and
[open-source-notices.md](open-source-notices.md).

## E. Codex agent architecture and production-path status

Implemented in source:

- typed app-server wire protocol without an invented JSON-RPC envelope;
- initialize/initialized, thread/start, turn/start, interrupt, and stop;
- protocol fingerprint validation;
- bundled-runtime path resolution and manifest validation;
- isolated Astra-owned runtime home and provider configuration;
- scoped runtime token bound to task and reservation;
- Astra Responses gateway transport and SSE normalization;
- dynamic `web_search` and `web_fetch` tool schemas;
- command/file approval routing;
- event translation to Astra task events;
- completion verification and no silent legacy fallback;
- official artifact identity, license/NOTICE checks, and packaged-resource launch.

Deterministic adapter tests passed. The actual upstream executable now passes
initialize and `thread/start` through the Astra supervisor, including from the
unpacked Windows package layout. Live model inference, dynamic tool execution,
approval, cancellation, crash recovery, and completion through the Astra
Gateway remain un-certified because no live Astra model/Gateway environment
was available. The old Astra loop is not the default production path.

## F. Cline workspace UI

The production renderer now contains and imports real pinned Cline UI source
for session status and approval cards through Astra wrappers. The imported
components do not own runtime, provider, account, billing, Room, or model
secrets. Astra-native editor, file, terminal, search, Git, and layout surfaces
remain Astra-owned because the selected Cline sources do not independently
provide those IDE primitives.

This is a genuine narrow Cline integration, not a screenshot recreation. It is
not evidence that the entire Cline AgentChat application has been imported.

## G. Astra Workspace Bridge and model gateway

The typed supervisor/runner emits task, model, tool, permission, patch,
usage, verification, and completion events. Runtime model calls use the
server-side `/runtime/codex/v1/responses` route, which validates the scoped
runtime token, task, reservation, current session/device, Room permission, and
catalogue model before using the server-only Responses gateway client.

No BYOK path was added. Provider and Gateway secrets are not placed in the
renderer, preload, Codex runtime configuration, or installer. Live provider
execution was not available and is therefore not certified.

## H. Web Research

The existing Web Research implementation remains intact and its deterministic
coverage includes typed `web_search`/`web_fetch`, provider abstraction,
normalization, provenance, SSRF/DNS/redirect/size limits, Room permission
checks, budgets, and prompt-injection handling. The Codex adapter now exposes
those tools through Astra routes and returns normalized results to Codex.

Deterministic Web Research coverage was previously 5 files / 36 tests and is
included in the full suite below. Live provider certification is BLOCKED because
no search endpoint/key is configured. The Codex dynamic-tool route is wired,
but a full Codex-to-web model-driven run remains BLOCKED without a live Astra
Gateway/model environment.

## I. Rooms, local tools, and billing

Existing Astra Room and billing code was preserved. The new runtime route
resolves billing from server-side task/reservation state and never trusts a
client wallet ID. Personal, Team, and Business context logic remains in the
existing billing services.

The migration has not yet proven a complete desktop Codex Room task. In
particular, the desktop reservation path currently does not submit the full
Team/Business Room context needed for an end-to-end organization-wallet run,
and Codex cannot execute until its artifact is built. Therefore organization
wallet isolation, fresh suspension during Codex tools, remote-host execution,
MCP/Plugin/Skill execution through Codex, Room Files import, and host handoff
remain un-certified even where existing Astra domain code exists.

## J. Feature 1–65 certification matrix

Status values are release statuses, not claims based on a UI control or type
definition. `PARTIAL` means some existing or deterministic implementation is
present but the authoritative production path is not fully proven. `MISSING`
means no verified implementation was found for the complete contract.

|  ID | Requirement                     | Status  | Implementation evidence                                 | Test evidence                                   | Remaining limitation                                             |
| --: | ------------------------------- | ------- | ------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
|   1 | Native Windows application      | PARTIAL | Electron shell; verified unsigned Astra Code installer  | Full build PASS; package PASS                   | Code signing, clean install, and Windows desktop E2E remain open |
|   2 | Codex-derived agent foundation  | PARTIAL | Pinned Codex checkout; official app-server; supervisor  | 4 deterministic + live launch/session PASS      | Live model/tool/approval/completion run unavailable              |
|   3 | Cline workspace foundation      | PARTIAL | Pinned Cline status/approval components in renderer     | Renderer build PASS; provenance PASS            | Narrow UI subset; full workspace/runtime integration unproven    |
|   4 | Professional editor             | PARTIAL | Existing Astra workspace/editor                         | Full suite PASS                                 | No Windows desktop E2E in this run                               |
|   5 | Coding agent panel              | PARTIAL | Astra panel consumes mapped runtime events              | Full suite PASS; runtime session PASS           | Live model-driven event stream unavailable                       |
|   6 | Server-controlled AI routing    | PARTIAL | Runtime token route and Responses gateway               | API integration tests PASS                      | Live provider execution unavailable                              |
|   7 | Local tool execution            | PARTIAL | Existing workspace policy plus Codex approval adapter   | Workspace/full suite PASS; runtime session PASS | Actual model-driven Codex tool execution unverified              |
|   8 | End-to-end streaming            | PARTIAL | Responses SSE client and event bridge                   | Gateway response tests PASS                     | No live model stream                                             |
|   9 | Real model names                | PARTIAL | Existing server catalogue and runtime model binding     | Existing suite PASS                             | No live resolved-model receipt                                   |
|  10 | Explicit Auto                   | PARTIAL | Adapter omits model only for explicit `AUTO`            | Existing routing tests PASS                     | Not exercised by live Codex                                      |
|  11 | Credit system                   | PARTIAL | Existing fixed-point billing plus usage receipt parsing | Billing/full suite PASS                         | Live provider usage not reconciled                               |
|  12 | Credit reservation              | PARTIAL | Existing reservations; token bound to reservation       | API integration PASS                            | Full autonomous multi-call run blocked                           |
|  13 | Pre-task estimate               | PARTIAL | Existing task budget/credit UI                          | Existing suite PASS                             | No desktop acceptance run                                        |
|  14 | Live credit meter               | PARTIAL | Runtime usage event and receipt loading                 | Adapter/API tests PASS                          | Exact provider usage unavailable live                            |
|  15 | Credit overrun checkpoint       | PARTIAL | Existing budget/checkpoint foundations                  | Existing suite PASS                             | Not proven through Codex loop                                    |
|  16 | Runaway protection              | PARTIAL | Existing agent budget/protection code                   | Existing suite PASS                             | Not proven through Codex loop                                    |
|  17 | Authoritative pricing           | PARTIAL | Existing plans/billing package                          | Existing suite PASS                             | Commercial live configuration not certified                      |
|  18 | Credit rollover                 | PARTIAL | Existing billing domain                                 | Existing suite PASS                             | No live billing-cycle certification                              |
|  19 | Top-up credits                  | PARTIAL | Existing billing domain                                 | Existing suite PASS                             | Razorpay/live entitlement blocked                                |
|  20 | Settings dashboard              | PARTIAL | Existing Astra settings/admin surfaces                  | Web/desktop builds PASS                         | No visual/browser certification in this run                      |
|  21 | Dashboard through Settings      | PARTIAL | Existing renderer navigation                            | Build/full suite PASS                           | Session-preservation E2E unverified                              |
|  22 | Normal settings                 | PARTIAL | Existing settings implementation                        | Full suite PASS                                 | Role/visibility E2E unverified                                   |
|  23 | Team settings                   | PARTIAL | Existing organization settings                          | Full suite PASS                                 | Room billing UI not Codex-proven                                 |
|  24 | Business settings               | PARTIAL | Existing organization/admin surfaces                    | Full suite PASS                                 | Live policy/SSO capabilities unverified                          |
|  25 | Super Admin                     | PARTIAL | Existing admin package/RBAC                             | Full suite PASS                                 | Production admin E2E not run                                     |
|  26 | Shared login                    | PARTIAL | Existing Astra auth                                     | Full suite PASS                                 | OAuth/live auth not certified                                    |
|  27 | Auth design                     | PARTIAL | Existing auth UI                                        | Web build PASS                                  | Browser matrix not run                                           |
|  28 | Personal multi-device           | PARTIAL | Existing device/session domain                          | Full suite PASS                                 | Live multi-device test not run                                   |
|  29 | Own-device remote               | PARTIAL | Existing remote protocol                                | Full suite PASS                                 | Live relay/host test not run                                     |
|  30 | Cross-person remote restriction | PARTIAL | Existing access policy                                  | Full suite PASS                                 | Live Room relay path unverified                                  |
|  31 | One primary Room project        | MISSING | No complete verified production path found              | No dedicated passing test                       | Room project binding still incomplete                            |
|  32 | Project filesystem isolation    | PARTIAL | Existing workspace confinement                          | Existing security tests PASS                    | Not repeated through compiled Codex                              |
|  33 | Org membership != Room          | PARTIAL | Existing Room/member domain                             | Existing suite PASS                             | Full production-path proof absent                                |
|  34 | Room roles                      | PARTIAL | Existing role model                                     | Existing suite PASS                             | Not exercised by Codex runtime                                   |
|  35 | Viewer                          | PARTIAL | Existing permission checks                              | Existing suite PASS                             | Production-path denial unverified                                |
|  36 | Agent User                      | PARTIAL | Existing agent permission model                         | Existing suite PASS                             | Production-path grant unverified                                 |
|  37 | Editor                          | PARTIAL | Existing role model                                     | Existing suite PASS                             | Direct editing through Codex unverified                          |
|  38 | Admin                           | PARTIAL | Existing member/admin operations                        | Existing suite PASS                             | Live authorization not certified                                 |
|  39 | Suspension                      | PARTIAL | Existing suspension logic                               | Existing suite PASS                             | Mid-Codex revocation blocked                                     |
|  40 | Removal                         | PARTIAL | Existing member removal logic                           | Existing suite PASS                             | Mid-Codex revocation blocked                                     |
|  41 | Leave Room                      | PARTIAL | Existing leave/last-admin logic                         | Existing suite PASS                             | No live Room E2E                                                 |
|  42 | Multiple Rooms                  | PARTIAL | Existing Room membership model                          | Existing suite PASS                             | Workspace isolation E2E unverified                               |
|  43 | Reference project support       | MISSING | No complete verified implementation found               | No dedicated passing test                       | Not implemented as certified V1 capability                       |
|  44 | Reference assets                | MISSING | No complete verified implementation found               | No dedicated passing test                       | Room Files/reference pipeline absent                             |
|  45 | Room Files                      | MISSING | No complete verified subsystem found                    | No dedicated passing test                       | Upload/quarantine/storage not complete                           |
|  46 | File intent                     | MISSING | No complete verified implementation found               | No dedicated passing test                       | REFERENCE/ADD_TO_PROJECT contract incomplete                     |
|  47 | Controlled import               | MISSING | No complete verified implementation found               | No dedicated passing test                       | Host import authority not complete                               |
|  48 | Import preview                  | MISSING | No complete verified implementation found               | No dedicated passing test                       | Conflict manifest UX absent                                      |
|  49 | Room Files UI                   | MISSING | No complete verified implementation found               | No dedicated passing test                       | UI and metadata workflow absent                                  |
|  50 | ZIP security                    | MISSING | No complete verified import pipeline found              | No dedicated passing test                       | Quarantine/ZIP attack certification absent                       |
|  51 | Offline host                    | PARTIAL | Existing remote/host state concepts                     | Existing suite PASS                             | Not proven through Codex task                                    |
|  52 | Availability modes              | PARTIAL | Existing architecture documents host-local state        | Existing suite PASS                             | Sync/backup policy not certified                                 |
|  53 | Handoff                         | MISSING | No complete verified handoff implementation             | No dedicated passing test                       | Explicit host transfer absent                                    |
|  54 | Hard sandbox                    | PARTIAL | Existing workspace policy and approval path             | Existing security tests PASS                    | Codex/MCP/Plugin/Skill path not exercised                        |
|  55 | Suspicious activity             | MISSING | No complete verified security-event implementation      | No dedicated passing test                       | Deterministic event layer incomplete                             |
|  56 | Admin alerts                    | PARTIAL | Existing admin/security surfaces                        | Existing suite PASS                             | High-risk Room event path incomplete                             |
|  57 | Event severity                  | MISSING | No complete verified severity policy                    | No dedicated passing test                       | Severity enforcement incomplete                                  |
|  58 | No LLM-only suspension          | MISSING | No complete verified policy certification               | No dedicated passing test                       | Security automation not certified                                |
|  59 | Invitees need no org plan       | PARTIAL | Existing invitations/org membership                     | Existing suite PASS                             | Live invitation flow not run                                     |
|  60 | Host need no org plan           | PARTIAL | Existing device/Room separation                         | Existing suite PASS                             | Host/org billing E2E not run                                     |
|  61 | Contexts separate               | PARTIAL | Existing personal/org billing services                  | Existing suite PASS                             | Full Codex context transition blocked                            |
|  62 | No entitlement leakage          | PARTIAL | Existing server authorization                           | Existing suite PASS                             | Production Room path blocked                                     |
|  63 | Personal wallet                 | PARTIAL | Existing personal reservation/settlement                | Existing suite PASS                             | Live Codex multi-call proof blocked                              |
|  64 | Organization wallet             | PARTIAL | Runtime API accepts server-owned reservation context    | API tests PASS                                  | Desktop Room reservation/Codex run not proven                    |
|  65 | Usage attribution               | PARTIAL | Usage receipts and task/reservation IDs                 | API integration tests PASS                      | Full member/Room/host/model receipt path blocked                 |

## K. Deterministic verification

| Command                                                  | Result                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm.cmd test`                                           | PASS — 86 files, 265 tests                                                           |
| `npm.cmd run typecheck`                                  | PASS                                                                                 |
| `npm.cmd run lint`                                       | PASS                                                                                 |
| `npm.cmd run format:check`                               | PASS                                                                                 |
| `npm.cmd run verify:source-provenance`                   | PASS                                                                                 |
| `npm.cmd run build:packages`                             | PASS                                                                                 |
| `npm.cmd run build`                                      | PASS — API, Electron, web prerender (54 routes), and admin                           |
| `npm.cmd run build:renderer --workspace @lyntar/desktop` | PASS — 23 modules                                                                    |
| `npm.cmd audit --omit=dev`                               | PASS — 0 vulnerabilities                                                             |
| `git diff --check`                                       | PASS — only normal Windows LF/CRLF warnings                                          |
| `npm.cmd run build:codex-runtime`                        | PASS — official pinned Windows x64 release acquired and verified                     |
| Local Cargo build of vendored Codex with Rust 1.95.0     | BLOCKED — host allocation failure / `STATUS_STACK_BUFFER_OVERRUN` in upstream crates |
| `node scripts/verify-codex-runtime-artifact.mjs`         | PASS — executable, manifest, LICENSE, NOTICE, and hashes verified                    |
| `npm.cmd run certify:codex-runtime`                      | PASS — real initialize and `thread/start` against pinned executable                  |
| `npm.cmd run package:win:unsigned`                       | PASS — `Astra-Code-0.1.0-win-x64-unsigned.exe`                                       |

## L. External and live certification

| Service/capability                     | Status  | Evidence/limitation                                                     |
| -------------------------------------- | ------- | ----------------------------------------------------------------------- |
| Cline pinned source acquisition        | PASS    | Immutable checkout and license/provenance validation                    |
| Cline renderer subset                  | PASS    | Production renderer build includes selected copied/adapted components   |
| Codex pinned source acquisition        | PASS    | Immutable checkout and protocol fingerprint                             |
| Codex artifact acquisition/identity    | PASS    | Official pinned release, digest, manifest, LICENSE, and NOTICE verified |
| Codex runtime launch/session           | PASS    | Real packaged executable initialize and `thread/start` passed           |
| Codex model/tool/approval completion   | BLOCKED | No live Astra model/Gateway environment supplied                        |
| Astra Responses/Gateway live model     | BLOCKED | No live provider credentials/configuration supplied                     |
| Web Search deterministic integration   | PASS    | Existing deterministic suite; full suite passed                         |
| Web Search provider live certification | BLOCKED | No endpoint/key configured                                              |
| PostgreSQL live certification          | BLOCKED | No disposable live database run in this pass                            |
| Razorpay sandbox                       | BLOCKED | No sandbox credentials/run evidence                                     |
| Resend delivery                        | BLOCKED | No verified sender/delivery evidence                                    |
| Google OAuth                           | BLOCKED | No configured live OAuth certification                                  |
| Remote relay                           | BLOCKED | No staging relay/two-device certification                               |
| Windows unsigned packaging             | PASS    | Real unsigned installer built with packaged Codex runtime               |
| Windows code signing                   | BLOCKED | No signing credential                                                   |
| Auto-update                            | BLOCKED | No signed artifact to certify                                           |
| Production DNS/domain/deployment       | BLOCKED | No deployment identifiers or domain supplied                            |

## M. Security and licensing notes

The runtime token is server-issued, scoped, task/reservation-bound, and does
not contain a provider key. The Codex supervisor strips inherited provider
environment variables and writes an Astra-owned runtime home. The runtime API
revalidates the underlying Astra session and reservation.

The strongest remaining security objection is that Room/MCP/Plugin/Skill and
host-revocation behavior has not been exercised through a model-driven Codex
task. The real runtime launch/session boundary is proven; the remaining
tool-path proof requires a live Astra model/Gateway environment. Cline and
Codex Apache-2.0 files and the Codex NOTICE are retained in both the vendored
inventory and packaged Codex resources; no endorsement is implied.

## N. Remaining production blockers

1. Run the live model-driven Codex turn/tool/approval/cancel/completion path
   through the Astra Gateway with bounded credentials and spend.
2. Complete the desktop-to-Room billing context path and prove personal vs
   Team/Business wallet isolation across multi-call Codex tasks.
3. Exercise path, command, web, MCP, Plugin, Skill, suspension, removal, and
   host-offline policies through the real Codex adapter.
4. Complete/certify Room Files, quarantine, import preview, ZIP security,
   security events, and host handoff where advertised.
5. Run live Astra Gateway/provider, Web Search, PostgreSQL, OAuth, payment,
   email, relay, and updater certifications where required for launch.
6. Produce and sign a final Windows installer, then tie it to an immutable
   release commit and record its SHA-256.

## O. Final release decision

# NOT PRODUCTION READY

This verdict is based on the exact evidence above. The repository build,
deterministic suite, official Codex runtime launch, and unsigned Windows
package are healthy, but live model execution, launch-critical external
integrations, signing, and several Room production paths remain unproven or
blocked.
