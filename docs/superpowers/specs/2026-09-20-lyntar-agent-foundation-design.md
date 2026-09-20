# Lyntar Agent Foundation and Windows Vertical Slice

**Date:** 2026-09-20
**Status:** Approved design
**Scope:** Monorepo foundation followed immediately by the first real local-repository agent workflow

## Goal

Create the smallest production-oriented Lyntar architecture that can support a replaceable Windows desktop shell, a local coding-agent runtime, a server-mediated model boundary, auditable usage receipts, and a deterministic certification path. The first meaningful product result is a Windows user opening a local Git repository, asking for a bounded coding task, allowing Lyntar to inspect and edit only that repository, run a real command and verification, repair a failure within task budgets, and receive a Lyntar-specific diff/result.

The public marketing site, billing, marketplace, MCP, Skills, Plugins, student modes, and admin UI are explicitly out of scope until this vertical slice works.

## Constraints and decisions

- V1 uses Electron, React, Vite, Fastify, TypeScript, and npm workspaces.
- The repository is Windows-first, but pure packages must remain platform-neutral where possible.
- Electron main owns OS capabilities and lifecycle only. Agent orchestration lives in `packages/agent-core`.
- Renderer code can call only typed, capability-oriented IPC methods; it never receives generic filesystem or shell primitives.
- The selected repository remains local. Backend workspace data contains safe metadata only and never an uploaded repository representation.
- All model/provider credentials stay outside the desktop binary and are read by the server-side model adapter.
- The initial model adapter is Vercel AI Gateway-compatible and isolated in `packages/model-gateway`; the model catalog is returned by the backend.
- Actual model usage metadata is recorded when returned by the provider. No fabricated billing transactions are created.
- Development execution uses explicit task budgets and development entitlements; commercial wallet charging is deferred.
- A deterministic fake model is mandatory for CI. Live Gateway smoke testing is opt-in and must clearly report unavailable credentials or failed calls.
- The vertical slice certifies Node/TypeScript repository command detection first. The command-detection interface remains extensible for Python, Rust, Java, and Flutter.

## Repository layout

```text
lyntar/
├── apps/
│   ├── api/                      # Fastify HTTP boundary and model/catalog/receipt persistence
│   └── desktop/                  # Electron adapter, React renderer, typed preload bridge
├── packages/
│   ├── agent-core/               # State machine, budgets, cancellation, ports, orchestration
│   ├── config/                   # Validated environment/config loading
│   ├── contracts/                # api/, ipc/, agent-events/, domain/ schemas
│   ├── db/                       # PostgreSQL schema, SQL migrations, repositories
│   ├── model-gateway/            # Gateway adapter, structured decisions, stream/receipt parsing
│   ├── test-utils/               # Deterministic models, fake ports, temp fixtures
│   └── workspace/                # Canonical Windows paths, local files, commands, Git, verification
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   ├── golden-path/
│   └── fixtures/broken-node-app/
├── docs/
└── package.json
```

`apps/web` and `apps/admin` are not created until their implementation phases begin.

## Process boundaries

```text
React renderer
  ↓ typed capability IPC
Electron preload
  ↓ validated IPC commands/events
Electron main adapter
  ↓ constructed ports and lifecycle wiring
packages/agent-core
  ↓ ModelPort, WorkspacePort, PatchPort, CommandPort, GitPort,
    VerificationPort, EventPort, PermissionPort
packages/workspace / packages/model-gateway / apps/api
```

The desktop main process creates the agent-core runtime and supplies adapters. It does not contain the state machine, retry policy, tool classification, or domain decisions. This leaves Electron replaceable by another shell later.

## Shared contracts

`packages/contracts` is split into explicit namespaces:

- `domain/`: workspace, task, model, usage receipt, Git baseline, permission, and task budget types.
- `agent-events/`: append-only discriminated event union with event IDs, task IDs, timestamps, and safe payloads.
- `ipc/`: renderer-to-main commands and main-to-renderer event envelopes.
- `api/`: backend request/response schemas for model catalog, model requests, streamed model events, and usage receipts.

Zod schemas are the runtime source of truth at process boundaries. TypeScript types are inferred from those schemas. A contract test must reject malformed IPC commands and malformed model decisions before they reach the runtime.

## Agent state machine

The allowed task states are:

```text
CREATED → ANALYZING → PLANNING → WAITING_FOR_PERMISSION → EXECUTING
EXECUTING → VERIFYING → REPAIRING → VERIFYING
EXECUTING → COMPLETED
VERIFYING → COMPLETED
any active state → FAILED | CANCELLED | BLOCKED
```

Illegal transitions are rejected. The renderer derives progress from append-only events rather than callbacks or inferred UI state. Model scratchpad/reasoning is never emitted to the renderer; only concise plan/status messages and safe tool/action summaries are exposed.

## Agent ports and behavior

`packages/agent-core` owns the orchestration use case and depends only on ports:

- `ModelPort`: sends structured context and receives normalized decisions/stream events plus optional usage receipt.
- `WorkspacePort`: lists/searches/reads files within an authorized canonical workspace.
- `PatchPort`: applies a multi-file patch through a checkpoint and rolls back on partial failure.
- `CommandPort`: executes classified commands with timeout/output limits and cancellation.
- `GitPort`: detects the repository, captures baseline status/dirty files, and computes a final Lyntar-only diff.
- `VerificationPort`: detects/executes a project verification command separately from arbitrary agent commands.
- `EventPort`: appends and publishes safe events.
- `PermissionPort`: classifies proposed actions and resolves safe, approval-required, high-risk, and prohibited actions.

The first runtime implements a bounded understand/plan/act/verify/repair/present loop. It cannot loop on verification indefinitely. Each task enforces `maxModelCalls`, `maxRepairs`, `maxCommands`, `maxWallTimeMs`, and `maxEstimatedCostUsd`; exceeding a budget transitions to `BLOCKED` with a user-visible explanation.

Cancellation uses one `AbortSignal` from IPC through agent-core, model streaming, command children, and pending tool execution. Cancellation produces `task.cancelled`, terminates child processes, aborts the model request, rolls back an in-flight patch, and releases no fictional billing state.

## Workspace and Windows path security

Workspace selection establishes a canonical root. Authorization canonicalizes both the root and target using Windows-aware resolution before checking containment. The implementation must account for:

- `..` traversal and alternate separators;
- case-insensitive comparisons;
- symlink and junction escapes;
- UNC paths and Windows device paths;
- paths that do not yet exist when a file is being created.

Generic `fs` and shell APIs are not exposed to the renderer. Workspace methods accept relative paths or structured commands only. Writes reject outside-root targets and use checkpoints/rollback.

## Command permissions

The model does not receive an unrestricted shell tool. It proposes a structured command. The permission layer classifies it:

- safe: execute within the workspace;
- sensitive: request approval;
- destructive: require explicit high-risk approval;
- prohibited: reject.

The first policy blocks destructive filesystem and Git reset/clean operations, shutdown/registry mutation, credential access, outside-workspace execution, and PowerShell download-and-execute patterns. Every decision emits an append-only permission event.

## Git baseline and diff isolation

Before any mutation, `GitPort` records repository identity, baseline status, and the set/content hashes of pre-existing dirty files. After the task, it computes changed files and hunks attributable to Lyntar, keeping pre-existing modifications distinct. The renderer must label those categories separately and never claim a pre-existing change as agent-created.

## Project command detection and verification

The detector reads only local manifest/config metadata and returns a typed `ProjectProfile` with language, framework hints, and candidate commands. Initial certified support is:

- Node/TypeScript: `package.json` scripts, preferring `test`, then `check`, then `build` when present.
- A repository without a recognized verification command becomes `BLOCKED` with an actionable message rather than silently assuming `npm test`.

The detector interface includes extensible adapters for `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `pom.xml`, `build.gradle`, and `pubspec.yaml`, but those adapters are deferred unless required by tests.

## Model gateway and server catalog

`packages/model-gateway` contains:

- `ModelRequest` and normalized structured decision contracts;
- a Vercel AI Gateway-compatible HTTP adapter;
- streaming event parsing with cancellation;
- capability metadata;
- usage/cost receipt parsing.

`apps/api` exposes the server-owned model catalog. Desktop fetches records containing at least `modelId`, `displayName`, `gatewayModelId`, `enabled`, and capabilities. The desktop does not hard-code a permanent model list or a specific model name.

The backend model request path validates the selected catalog record, adds request/task correlation IDs, invokes the configured gateway adapter, and persists an actual usage receipt when provider metadata exists. The first slice may use a development catalog record and entitlement mode, but it must not invent cost or ledger transactions.

## Database foundation

PostgreSQL is the production target. The initial migration creates:

- `users`;
- `workspaces` with safe local metadata only;
- `agent_sessions`;
- `agent_tasks`;
- `model_catalog`;
- `usage_receipts` containing `request_id`, `task_id`, `model_id`, `provider_route`, `input_tokens`, `output_tokens`, `cache_tokens`, `actual_cost_usd`, and `received_at`;
- immutable `credit_ledger_entries` shape, without generating fake development transactions.

Migrations are explicit and idempotent through the selected migration runner. Repository methods are scoped to the user/session IDs supplied by the API boundary.

## Desktop experience in this phase

The renderer implements only the vertical-slice surface:

- select/open a local repository;
- show canonical workspace and Git baseline status;
- enter a coding task;
- show concise append-only progress events;
- approve/reject permission requests;
- stop a task;
- show Lyntar-created vs pre-existing changes;
- show verification output, usage receipt, and unresolved issues.

It does not implement marketing, account billing, extension management, or the full product navigation yet.

## Testing and certification

Every production behavior is developed test-first.

- Unit: contracts, state transitions, budgets, cancellation, path containment, command policy, patch rollback, command detection, receipt parsing.
- Integration: Fastify API with injected requests, model catalog, model request boundary, receipt persistence, and migration shape.
- Security: traversal, junction/symlink escape, UNC/device paths, prohibited commands, pre-existing Git changes, cancellation cleanup.
- Deterministic golden path: fixture repository with fake model, real local file edits, real command/test execution, broken-test repair, bounded repair count, isolated diff, and append-only events.
- Live AI smoke: opt-in only, configured Gateway endpoint, records model/request ID/cost, and fails visibly when credentials are unavailable.

The intentionally broken fixture at `tests/fixtures/broken-node-app` contains a failing validation test. The certified task is to fix the implementation without editing the test, observe the real failure, repair once, rerun verification, and present the resulting diff.

## Explicitly deferred

Razorpay, commercial wallet enforcement, auth providers, SMTP, public web, SEO/AEO, marketplace, Skills, Plugins, MCP, direct integrations, Learn Mode, Viva Mode, Hackathon Mode, admin UI, automatic updates, code signing, multi-user collaboration, cloud/background agents, and non-Windows installers.

These areas may use the current contracts and database boundaries later, but no placeholder UI or fake capability is created in this phase.

## Risks and mitigations

- **Gateway API variation:** isolate provider payloads in model-gateway and test normalized decisions/receipts independently.
- **Windows filesystem ambiguity:** canonicalize with realpath/handle-aware checks where available and deny uncertain paths.
- **Agent loops:** enforce budgets and state transitions centrally; no open-ended retry loop.
- **User data loss:** checkpoint every write batch and rollback on partial failure; preserve baseline dirty files.
- **Electron coupling:** keep main process adapters thin and keep orchestration in pure packages.
- **No live credentials in CI:** deterministic fake model is the required certification path; live smoke is explicit and separately reported.
