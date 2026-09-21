# Astra Code Migration Certification

Certification date: 2026-09-21 (Asia/Calcutta)

This report records the implementation and certification state after the Room/project, Room Files, import-security, membership, billing-context, and security-event implementation pass. A deterministic PASS means repository implementation and automated evidence passed; it does not turn a mock provider or in-memory store into live certification.

## A. Executive result

# NOT PRODUCTION READY

The repository now contains the Room primary-project binding, explicit Room-scoped membership, Room Files and intent contracts, controlled import preview/approval, ZIP quarantine/inspection, host handoff path, deterministic security events/severity, authoritative Room billing-context resolution, and fresh runtime authorization checks. The deterministic suite has passed with 87 test files and 278 tests. The official pinned Windows Codex app-server is acquired, digest-verified, packaged, and proven through initialize and thread/start.

The release is not production ready because live Astra Gateway/model-driven Codex turns and tools, live PostgreSQL, payment, mail, OAuth, relay/two-device execution, clean-machine certification, and trusted Windows signing remain unavailable or un-certified. These are launch-critical for a public release.

## B. Release identity

| Field                                 | Evidence                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                                | main                                                                                                                                          |
| Source base before this run           | 128990c70c1b235013e3d02462d600c7a233b1ea                                                                                                      |
| Previous certified implementation SHA | b679597d3fe03efab9a6622de8f8c46468496131                                                                                                      |
| Implementation/release source SHA     | `13e489f4f27ee6cce192133e26940dce627e3315` (`Stabilize Windows golden path timeout`); the installer was built from this implementation state. |
| Release candidate                     | astra-code-v0.1.0-rc2                                                                                                                         |
| Version                               | 0.1.0                                                                                                                                         |
| Working tree at report drafting       | Clean at the implementation commit; this certification metadata update is a docs-only follow-up.                                              |
| Installer                             | apps/desktop/release-unsigned/Astra-Code-0.1.0-win-x64-unsigned.exe                                                                           |
| Installer size                        | 166,058,419 bytes                                                                                                                             |
| Installer SHA-256                     | D7D10ECACA66B9AC8B3D651B745777F8CA3AA7E13A3C504579F9C3E554233D0E                                                                              |
| Bundled Codex executable              | apps/desktop/release-unsigned/win-unpacked/resources/codex/codex-app-server.exe                                                               |
| Bundled Codex size                    | 245,798,704 bytes                                                                                                                             |
| Bundled Codex SHA-256                 | 616C4961D85C8FACCF0C1AE5DB3CE4DFD2DE18422F6A9A5C5EBADA9C96AD4395                                                                              |
| Code signing                          | BLOCKED — no legitimate Windows code-signing certificate/private key was available.                                                           |

## C. Architecture and production path

The application remains an Electron 44 desktop shell with a bundled React/Vite renderer, isolated preload, Fastify/TypeScript API, PostgreSQL adapters, and deterministic in-memory stores for tests. Astra remains the authority for identity, plans, models, Gateway access, credits, wallets, Rooms, devices, relay authorization, MCP, Plugins, Skills, approvals, security, and audit.

The implemented path is:

Astra renderer -> typed Workspace Bridge/preload -> Astra main process -> bundled pinned Codex app-server -> Astra runtime API -> server model/Gateway layer.

Local project work remains host-local and is confined by Astra workspace policy. Room work resolves the Room, project, host, membership, permission, and organization wallet on the server. The client never chooses an arbitrary wallet as authority.

The legacy Astra runner remains available only for explicit legacy-test compatibility tests. It is not the default production runner and there is no silent fallback when the Codex runtime is unavailable.

## D. Upstream source provenance

### Cline

- Repository: https://github.com/cline/cline
- Pinned commit: 9a2512bb9835869d74774da99708a7f9d80b0fe8
- Tree: 79cd0f11e55ebbf11da424afa482f003b1e0bed2
- License: Apache-2.0
- Selected source: sdk/packages/ui/components/agent-approval-card.* and sdk/packages/ui/components/session-status.*
- Astra destinations: apps/desktop/src/renderer/cline/* and apps/desktop/src/renderer/cline-workspace.tsx
- Runtime/provider/account/billing code: excluded from Astra production.
- Evidence: renderer imports Astra wrappers around the selected copied/adapted modules; provenance and renderer build checks pass.

### Codex

- Repository: https://github.com/openai/codex
- Pinned commit: 5c5308fc9a9ee789049d646ef11e5400384b9c6f
- Tree: 4557e77bc256683fc29b6e2026b21dd72eb99674
- License: Apache-2.0; required LICENSE and NOTICE are retained.
- Protocol fingerprint: 1b94b320c014fa02eb89bc613d7beef36b1a400d164eeeaad8dd716d6da81435
- Runtime boundary: upstream app-server/app-server-client/app-server-protocol behavior through the bundled official Windows x64 artifact.
- Astra adapter: packages/codex-runtime/src/index.ts.
- Desktop adapter: apps/desktop/electron/codex-task-runner.ts.
- Runtime artifact: apps/desktop/resources/codex/codex-app-server.exe, digest verified and included in the unpacked package.
- Local Cargo rebuild: BLOCKED by the previously observed host allocation failure; it is not required for the selected official pinned release artifact.

Machine-verifiable provenance: npm.cmd run verify:source-provenance — PASS.

Detailed inventories remain in source-provenance.md, cline-component-provenance.md, and open-source-notices.md.

## E. Codex runtime certification

PASS evidence:

- Official pinned Windows runtime acquired and digest-verified.
- Manifest, source SHA, release metadata, LICENSE, and NOTICE verified.
- Astra supervisor resolves the bundled resource, not an arbitrary executable from PATH.
- The supervisor uses an Astra-owned isolated runtime home and strips inherited provider credentials.
- Real process initialize and thread/start passed through the supervisor, including the unpacked packaged layout.
- Protocol mismatch and artifact identity checks fail closed.

Not yet certified:

- a live model-driven turn through Astra Gateway;
- real Codex-generated local tool requests and results;
- approval/denial, cancellation, crash recovery, and completion through a live model task;
- Room, MCP, Plugin, Skill, Web Search, and Web Fetch execution from a live Codex turn;
- live usage reconciliation and multi-call organization billing.

The stale statement that Codex must still be built before it can execute is corrected. The official runtime exists and launches. The remaining blocker is model-driven execution through a configured Astra Gateway/model environment.

## F. Cline workspace integration

Astra uses a narrow, truthful Cline integration. The pinned Cline session status and approval-card source is present in the renderer build and is adapted through Astra-owned wrappers. Astra-native editor, file tree, terminal, search, Git, layout, Room, billing, and settings surfaces remain Astra-owned where the selected Cline source does not provide those IDE primitives.

The integrated Cline components do not own Cline runtime state, provider authentication, account state, billing, Room permissions, or model secrets. This is actual upstream source use, not a screenshot recreation; it is not a claim that the entire Cline application was imported.

## G. Workspace Bridge, tools, and model gateway

The typed desktop IPC/Workspace Bridge exposes only required task, Room, file, approval, billing, and verification operations. Renderer file selection uses native dialogs; arbitrary renderer paths are not treated as authority.

The runtime route validates the scoped Astra runtime token, authenticated session, device, task, reservation, Room membership/permission, and current authorization before protected operations. Runtime requests use server-owned reservation and Room context; the desktop does not receive provider or Gateway secrets and no BYOK path was added.

The live model path is implementation-complete enough for deterministic API tests, but live Gateway execution remains BLOCKED because no configured live Astra model/provider environment was supplied.

## H. Web Research

The existing Astra Web Research implementation remains intact. It includes typed web_search and web_fetch, provider abstraction, normalization, provenance, Room permissions, budgets, SSRF/DNS/redirect/size/content-type limits, sanitization, and untrusted-content handling. Codex tool requests are translated to Astra server-side Web Research routes and carry Room context.

Deterministic Web Research coverage is included in the full suite and passes. Live provider certification is BLOCKED because no search endpoint/key is configured. A deterministic provider is evidence of integration behavior, not live provider certification.

## I. Room project, host, and membership implementation

The Room model now has an authoritative primary project/binding shape:

- one primary_project_id per Room;
- host device binding and workspace fingerprint/version;
- deterministic host availability state;
- explicit Room-scoped membership separate from organization seats;
- server-side role/permission checks;
- transactional host handoff path with audit event;
- host-local execution requirement for desktop imports and tasks.

Organization membership no longer grants access to every Room. A user must have explicit Room membership. A Room task derives organization billing from the Room and does not trust a client wallet ID.

When the host is not the current authorized device or is not ONLINE, the desktop path refuses local Room execution rather than silently selecting a different machine.

## J. Room Files and controlled import

Implemented paths include:

- metadata and content storage in the Room domain;
- REFERENCE and ADD_TO_PROJECT intent;
- uploader, normalized name, content type, size, checksum, and security state;
- upload/list/content/delete API routes and desktop IPC;
- quarantine/validation states;
- import proposal and manifest with create/overwrite/conflict/rejected counts;
- explicit approval and completion;
- host-local write through workspace confinement;
- binary/text batch writes with rollback behavior;
- ZIP inspection/extraction in a controlled buffer before project writes;
- security events for invalid uploads and blocked behavior.

Room Files are not arbitrary host filesystem access. Reference files remain outside the project unless an approved import is completed by the authorized host path.

## K. ZIP/archive security

The archive validator rejects traversal, absolute/drive/UNC/device paths, reserved names, duplicate and case-colliding paths, encrypted/unsupported entries, CRC failures, symlink-like metadata, excessive entry count, excessive expanded size, oversized entries, and compression-ratio abuse. Safe extraction returns buffers and a manifest; it does not directly unpack into the project.

Deterministic malicious-archive and import tests pass. Fuzzing and a live multi-device import run remain un-certified.

## L. Security events and severity

The deterministic event layer records blocked path/project/Room/host/runtime and archive actions with actor, Room, device, task, requested action/resource, decision, evidence, timestamp, and severity. High-risk evidence is redacted for common secret patterns.

Severity mapping is deterministic: INFO, LOW, MEDIUM, HIGH, CRITICAL. An LLM classification alone cannot suspend a member. The current implementation records and exposes security events; a dedicated live admin alert UI and live organization deployment remain un-certified.

## M. Feature 1–65 matrix

The following matrix contains every feature row. PASS means implementation and deterministic acceptance evidence are complete. PARTIAL means code and some tests exist but a required live, desktop, remote, or external acceptance gate is still open. NOT APPLICABLE is used only where the V1 contract explicitly uses Room Files instead of a second writable project root.

|  ID | Requirement                     | Status         | Implementation evidence                                                    | Test evidence                                  | Remaining requirement                                 |
| --: | ------------------------------- | -------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
|   1 | Native Windows application      | PARTIAL        | Electron shell and unsigned x64 NSIS installer                             | Full/package builds PASS                       | Trusted signing, clean install, and clean-machine E2E |
|   2 | Codex-derived agent foundation  | PARTIAL        | Pinned official app-server, supervisor, protocol checks                    | Artifact and real initialize/thread-start PASS | Live model/tool/approval/completion task              |
|   3 | Cline workspace foundation      | PARTIAL        | Pinned Cline status/approval source in production renderer                 | Provenance and renderer build PASS             | Broader workspace E2E beyond selected components      |
|   4 | Professional editor             | PARTIAL        | Existing Astra editor/workspace                                            | Full suite/build PASS                          | Packaged Windows interaction certification            |
|   5 | Coding agent panel              | PARTIAL        | Runtime event mapping and Cline-derived activity components                | Full suite/runtime session PASS                | Live model event stream                               |
|   6 | Server-controlled AI routing    | PARTIAL        | Runtime API, server model validation, Gateway adapter                      | API tests PASS                                 | Live Gateway/provider execution                       |
|   7 | Local tool execution            | PARTIAL        | Workspace confinement, local write/command policy, Codex adapter           | Workspace/security tests PASS                  | Actual model-driven Codex tools                       |
|   8 | End-to-end streaming            | PARTIAL        | SSE transport and event bridge                                             | Gateway adapter tests PASS                     | Live streamed model response                          |
|   9 | Real model names                | PARTIAL        | Server catalogue and model binding                                         | Routing tests PASS                             | Live resolved provider/model receipt                  |
|  10 | Explicit Auto                   | PARTIAL        | AUTO is handled as an explicit selection                                   | Routing tests PASS                             | Live route/resolution evidence                        |
|  11 | Credit system                   | PARTIAL        | Usage/reservation/settlement domain                                        | Billing suite PASS                             | Live provider usage reconciliation                    |
|  12 | Credit reservation              | PARTIAL        | Reservation-bound runtime token and wallet logic                           | Billing/API tests PASS                         | Multi-call live Codex task                            |
|  13 | Pre-task estimate               | PARTIAL        | Existing task budget/credit UI                                             | Existing suite PASS                            | Packaged desktop acceptance                           |
|  14 | Live credit meter               | PARTIAL        | Usage events and receipt path                                              | API/adapter tests PASS                         | Live provider meter reconciliation                    |
|  15 | Credit overrun checkpoint       | PARTIAL        | Existing budget/checkpoint policy                                          | Existing suite PASS                            | Live autonomous-loop checkpoint                       |
|  16 | Runaway protection              | PARTIAL        | Existing task/tool/retry budgets                                           | Existing suite PASS                            | Live model loop exercise                              |
|  17 | Authoritative pricing           | PARTIAL        | Existing plan/pricing authority                                            | Billing tests PASS                             | Live checkout/payment certification                   |
|  18 | Credit rollover                 | PARTIAL        | Existing billing rules                                                     | Billing tests PASS                             | Live billing-cycle exercise                           |
|  19 | Top-up credits                  | PARTIAL        | Existing top-up domain                                                     | Billing tests PASS                             | Razorpay sandbox/payment certification                |
|  20 | Settings dashboard              | PARTIAL        | Existing Astra settings/admin surfaces                                     | Web/desktop builds PASS                        | Browser/packaged visual certification                 |
|  21 | Dashboard through Settings      | PARTIAL        | Existing workspace/settings navigation                                     | Full suite PASS                                | State-preservation E2E                                |
|  22 | Normal settings                 | PARTIAL        | User settings sections and RBAC                                            | Full suite PASS                                | Role/visibility E2E                                   |
|  23 | Team settings                   | PARTIAL        | Organization/Room settings                                                 | Full suite PASS                                | Live Team Room workflow                               |
|  24 | Business settings               | PARTIAL        | Business/admin policy surfaces                                             | Full suite PASS                                | Live policy/SSO certification                         |
|  25 | Super Admin                     | PARTIAL        | Backend RBAC/admin package                                                 | Full suite PASS                                | Live admin deployment E2E                             |
|  26 | Shared login                    | PARTIAL        | Shared Astra auth surface                                                  | Full suite PASS                                | Live OAuth/session certification                      |
|  27 | Auth design                     | PARTIAL        | Astra auth UI                                                              | Web build PASS                                 | Browser matrix                                        |
|  28 | Personal multi-device           | PARTIAL        | Device/session domain                                                      | Full suite PASS                                | Two-device live run                                   |
|  29 | Own-device remote               | PARTIAL        | Remote protocol/device authorization                                       | Full suite PASS                                | Staging relay and device E2E                          |
|  30 | Cross-person remote restriction | PARTIAL        | Room-scoped access policy                                                  | Access tests PASS                              | Live cross-person relay test                          |
|  31 | One primary Room project        | PARTIAL        | primary_project_id, host binding, project/host validation                  | Migration/API/Room tests PASS                  | Live bound-host Codex task                            |
|  32 | Project filesystem isolation    | PARTIAL        | Canonical path/workspace confinement and host checks                       | Security/ZIP tests PASS                        | Actual live Codex hostile-path run                    |
|  33 | Organization membership != Room | PASS           | room_members is separate from organization seats                           | Membership regression and migration tests PASS | Live PostgreSQL certification                         |
|  34 | Room roles                      | PARTIAL        | Owner/Admin/Editor/Agent User/Viewer permissions                           | Remote access tests PASS                       | Live Codex role exercise                              |
|  35 | Viewer                          | PARTIAL        | Server-side prompt/tool denial                                             | Permission tests PASS                          | Production-path Viewer denial                         |
|  36 | Agent User                      | PARTIAL        | Room agent permission checks                                               | Permission tests PASS                          | Live allowed/denied Codex task                        |
|  37 | Editor                          | PARTIAL        | Granular edit/import permissions                                           | Permission/import tests PASS                   | Live editor task                                      |
|  38 | Admin                           | PARTIAL        | Member/invite/handoff/admin authorization                                  | Remote access tests PASS                       | Live admin Room workflow                              |
|  39 | Suspension                      | PARTIAL        | Fresh authorization and status checks                                      | Suspension/security tests PASS                 | Live mid-Codex revocation                             |
|  40 | Removal                         | PARTIAL        | Room membership removal and revocation path                                | Membership tests PASS                          | Live mid-task removal                                 |
|  41 | Leave Room                      | PARTIAL        | Leave and last-admin protection                                            | Remote access tests PASS                       | Live Room E2E                                         |
|  42 | Multiple Rooms                  | PARTIAL        | Room-scoped membership and context                                         | Membership/API tests PASS                      | Live cross-Room context isolation                     |
|  43 | Reference project support       | NOT APPLICABLE | V1 uses controlled Room Files/reference assets, not a second writable root | Room Files/reference tests PASS                | No second writable project root is advertised         |
|  44 | Reference assets                | PARTIAL        | Room File metadata, reference intent, content retrieval                    | Room File/API tests PASS                       | Durable/live storage and packaged UX                  |
|  45 | Room Files                      | PARTIAL        | DB migration, in-memory service, Postgres adapter, API, IPC, UI            | API/schema/IPC tests PASS                      | Live PostgreSQL and packaged UI certification         |
|  46 | File intent                     | PASS           | REFERENCE and ADD_TO_PROJECT are typed and server-validated                | Room File tests PASS                           | None for deterministic contract                       |
|  47 | Controlled import               | PARTIAL        | Quarantine, preview, approval, host-local write, completion audit          | Import/rollback tests PASS                     | Live packaged host import                             |
|  48 | Import preview                  | PASS           | Manifest includes create/overwrite/conflict/rejected entries               | Preview/import API tests PASS                  | Live browser/desktop visual review                    |
|  49 | Room Files UI                   | PARTIAL        | Renderer list/upload/delete/preview/import controls                        | Renderer/build and IPC tests PASS              | Packaged UI E2E                                       |
|  50 | ZIP security                    | PASS           | Quarantine parser and bounded safe extraction                              | Malicious ZIP/path tests PASS                  | Additional fuzz/live archive corpus                   |
|  51 | Offline host                    | PARTIAL        | Host availability and local-host refusal path                              | Remote/API tests PASS                          | Live relay disconnection during Codex                 |
|  52 | Availability modes              | PARTIAL        | ONLINE/OFFLINE/UNAVAILABLE/REVOKED/unknown handling                        | API/domain tests PASS                          | Live relay/backup policy certification                |
|  53 | Host handoff                    | PARTIAL        | Authoritative handoff route, binding version, audit, DB schema             | Handoff/API tests PASS                         | Two-device activation certification                   |
|  54 | Hard sandbox                    | PARTIAL        | Deterministic path, import, command, and fresh auth policy                 | Security tests PASS                            | Actual live Codex/MCP/Plugin/Skill adversarial run    |
|  55 | Suspicious activity             | PASS           | Deterministic security-event recording and redaction                       | Security-event tests PASS                      | Live admin deployment alerting                        |
|  56 | Admin alerts                    | PARTIAL        | Authorized security-event listing/API context                              | Security-event/API tests PASS                  | Dedicated admin alert UI/live deployment              |
|  57 | Event severity                  | PASS           | Deterministic severity mapping                                             | Severity tests PASS                            | None for deterministic contract                       |
|  58 | No LLM-only suspension          | PASS           | Security event layer never suspends from one model signal                  | Regression test PASS                           | Human/admin operational certification                 |
|  59 | Invitees need no org plan       | PARTIAL        | Org seat and Room invitation paths separate personal plan                  | Invitation tests PASS                          | Live email/invitation redemption                      |
|  60 | Host need no org plan           | PARTIAL        | Host device and paying organization are separate                           | Billing/Room tests PASS                        | Live organization-host Codex task                     |
|  61 | Personal/org contexts separate  | PARTIAL        | Server Room-derived wallet resolution                                      | Billing tests PASS                             | Live multi-context Codex task                         |
|  62 | No entitlement leakage          | PARTIAL        | Room-scoped permission and wallet resolution                               | Spoof/membership tests PASS                    | Live cross-organization task                          |
|  63 | Personal wallet                 | PARTIAL        | Personal reservation/settlement path                                       | Billing tests PASS                             | Live model usage                                      |
|  64 | Organization wallet             | PARTIAL        | Room-only billing resolves organization wallet                             | Room reservation/spoof tests PASS              | Desktop-to-Codex Team/Business run                    |
|  65 | Usage attribution               | PARTIAL        | Task/reservation/Room/member/host attribution fields                       | Billing/API tests PASS                         | Live provider receipts and analytics                  |

## N. Deterministic verification

| Command                                                | Result                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| npm.cmd test                                           | PASS — 87 files, 278 tests                                                                                          |
| npm.cmd run typecheck                                  | PASS                                                                                                                |
| npm.cmd run lint                                       | PASS                                                                                                                |
| npm.cmd run format:check                               | PASS                                                                                                                |
| npm.cmd run verify:source-provenance                   | PASS                                                                                                                |
| npm.cmd run build:packages                             | PASS                                                                                                                |
| npm.cmd run build                                      | PASS — API, Electron, web prerender (54 routes), and admin                                                          |
| npm.cmd run build:renderer --workspace @lyntar/desktop | PASS during renderer/package build — 23 renderer modules                                                            |
| npm.cmd audit --omit=dev                               | PASS — 0 vulnerabilities                                                                                            |
| git diff --check                                       | PASS — only normal Windows line-ending warnings                                                                     |
| node scripts/verify-codex-runtime-artifact.mjs         | PASS — executable, manifest, LICENSE, NOTICE, and hashes                                                            |
| npm.cmd run certify:codex-runtime                      | PASS — real initialize and thread/start against pinned executable                                                   |
| npm.cmd run package:win:unsigned                       | PASS — final installer, 166,058,419 bytes, SHA-256 D7D10ECACA66B9AC8B3D651B745777F8CA3AA7E13A3C504579F9C3E554233D0E |
| Focused Room/project/billing/security suites           | PASS — 7 files, 27 tests                                                                                            |
| Local Cargo build of vendored Codex                    | BLOCKED — host allocation failure; official artifact is used and verified                                           |

## O. Live/external certification

| Capability                               | Status  | Environment/evidence                                        |
| ---------------------------------------- | ------- | ----------------------------------------------------------- |
| Codex runtime launch/session             | PASS    | Real pinned Windows executable; initialize and thread/start |
| Codex live model completion              | BLOCKED | No configured live Astra Gateway/model environment          |
| Codex local tools/approvals/cancellation | BLOCKED | Requires live model-driven Codex turn                       |
| Codex Room execution                     | BLOCKED | Requires live model plus host/relay environment             |
| Astra Gateway/provider                   | BLOCKED | No production/staging credentials/configuration supplied    |
| Web Search deterministic integration     | PASS    | Full deterministic suite                                    |
| Web Search live provider                 | BLOCKED | No endpoint/key configured                                  |
| PostgreSQL live                          | BLOCKED | No disposable PostgreSQL environment supplied               |
| Razorpay sandbox                         | BLOCKED | No sandbox credentials supplied                             |
| Resend delivery                          | BLOCKED | No verified sender/provider configuration supplied          |
| Google OAuth                             | BLOCKED | No live OAuth client/redirect certification supplied        |
| Remote relay                             | BLOCKED | No staging relay/two-device environment supplied            |
| Two-device remote                        | BLOCKED | Requires two authorized live devices                        |
| Personal wallet deterministic            | PASS    | Billing integration tests                                   |
| Team wallet deterministic                | PASS    | Room-only reservation and spoof tests                       |
| Business wallet deterministic            | PASS    | Room-only reservation and spoof tests                       |
| Windows unsigned package                 | PASS    | Real NSIS installer produced                                |
| Windows code signing                     | BLOCKED | No legitimate certificate/private key                       |
| Auto-update                              | BLOCKED | Signed update artifact and update endpoint unavailable      |
| Clean Windows install                    | BLOCKED | No isolated clean Windows certification environment         |

## P. Security and financial integrity

Deterministic checks cover Room-scoped membership, path confinement, archive validation, import rollback, SSRF/Web Research safeguards, runtime-token freshness, wallet-context spoof rejection, security-event redaction, and idempotent domain paths already present in Astra. Room membership is separate from organization seat membership.

The principal surviving objection is not a hidden fallback: the model-driven Codex path has not been exercised against a live Astra model/Gateway. Until that is available, real tool, approval, cancellation, usage, Room, MCP/Plugin/Skill, revocation, and provider-cost claims cannot be promoted to live certification.

## Q. Remaining production blockers

1. Live Astra Gateway/model environment
   Type: CREDENTIAL / EXTERNAL INFRASTRUCTURE
   Evidence: official Codex process launch passes, but no live model turn is available.
   Required action: run a bounded real model task through Astra auth, reservation, Gateway, stream, tool, usage, settlement, and completion.

2. Live Room/host/relay certification
   Type: EXTERNAL INFRASTRUCTURE
   Evidence: Room/project/host code and deterministic tests pass; no staging relay, second device, or live host execution environment is configured.
   Required action: certify personal/Team/Business Room tasks, suspension, removal, host offline, handoff, and two-device isolation.

3. Live PostgreSQL certification
   Type: EXTERNAL INFRASTRUCTURE
   Evidence: migrations and Postgres adapters are present; no disposable database run was available.
   Required action: run migrations and restart/concurrency/FK/uniqueness tests against disposable PostgreSQL with representative data.

4. Payments, mail, and OAuth
   Type: CREDENTIAL / EXTERNAL INFRASTRUCTURE
   Evidence: deterministic application tests pass; Razorpay, Resend, and Google OAuth live credentials/configuration were not supplied.
   Required action: run sandbox/payment/webhook, delivery, and OAuth callback certification.

5. Trusted Windows signing and clean install
   Type: CREDENTIAL / EXTERNAL INFRASTRUCTURE
   Evidence: unsigned installer builds and includes the pinned runtime; no trusted signing key or isolated clean Windows environment is available.
   Required action: sign final binaries, verify Authenticode, install on a clean Windows 10/11 x64 environment, and test launch/auth/restart/uninstall.

6. Auto-update certification
   Type: EXTERNAL INFRASTRUCTURE
   Evidence: no signed update artifact/endpoint was supplied.
   Required action: certify only if updater is in the V1 shipping scope.

## R. Final release decision

# NOT PRODUCTION READY

The implementation gaps previously marked MISSING in the Room/project, Room Files, import, ZIP-security, host-handoff, and security-event areas have been implemented and deterministically tested. The exact unsigned installer was rebuilt. The release remains blocked by the live model/Gateway path and other launch-critical infrastructure/certificate gates listed above; no live PASS has been manufactured.
