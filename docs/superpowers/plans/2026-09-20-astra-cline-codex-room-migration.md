# Astra AI Cline Workspace + Codex Runtime + Room Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate pinned upstream Cline workspace source and pinned upstream Codex runtime source into Astra's production desktop path, then complete Room Files, import security, revocation, and personal/organization billing-context hardening without weakening existing Astra systems.

**Architecture:** Keep Electron, Astra's Fastify/PostgreSQL control plane, and existing security/billing services. Vendor pinned upstream source under `vendor/upstream`, expose a narrow Astra-owned Codex supervisor and Workspace Bridge, adapt only Cline-owned agent-workspace UX into the renderer, and keep all model access, wallet resolution, Room authorization, and local execution behind Astra policy.

**Tech Stack:** TypeScript, React, Electron 44, Vite, Fastify, PostgreSQL/`pg`, Vitest, Zod, npm workspaces, the upstream Cline repository, and the upstream OpenAI Codex repository/build system discovered during Task 1.

**Spec:** `docs/superpowers/specs/2026-09-20-astra-cline-codex-room-migration-design.md`

## Global Constraints

- Preserve Electron; do not migrate the desktop shell to Tauri.
- Cline contributes only actual reusable workspace/agent UX; Cline's runtime, provider, account, and billing paths remain disabled.
- Codex source must be present in the production build/dependency/runtime graph and must be the authoritative production agent runtime.
- Astra remains authoritative for authentication, models, provider access, entitlements, credits, wallets, reservations, settlements, Rooms, devices, permissions, and audit.
- No BYOK and no provider/Gateway credential in the renderer, Electron bundle, installer, or user-facing settings.
- Every Room has one primary editable project bound to one host device and one validated workspace root.
- Room members never receive general host filesystem access; host execution remains local and policy-enforced.
- Personal tasks debit personal wallets; Team/Business Room tasks debit the resolved organization wallet for every model call in the task.
- Uploaded Room content is untrusted, quarantined, and never an automatic project write.
- ZIP content is inspected before import and cannot bypass workspace/path/command policy.
- Existing deterministic tests must remain green; unavailable live infrastructure stays explicitly `BLOCKED`.
- Every production-code change follows a RED → GREEN test cycle.

## Review Focus

- Codex artifact substitution: a missing, mismatched, or globally installed runtime must fail closed; `tests/integration/codex-supervisor.test.ts` owns this.
- Cline runtime leakage: the production renderer may use Cline UI modules but must not invoke Cline provider/agent code; `tests/integration/cline-boundary.test.ts` owns this.
- Billing-context drift: a multi-call Room task must never switch from organization wallet to personal wallet; `tests/integration/room-billing-context.test.ts` owns this.
- Archive/path collision attacks: traversal, reserved names, case/Unicode collisions, links, and oversized archives must remain quarantined with zero project writes; `tests/security/room-files.test.ts` owns this.
- Revocation during execution: suspension/removal/device revocation must prevent the next privileged action and preserve audit/billing state; `tests/integration/room-revocation-during-task.test.ts` owns this.
- Web research safety: search/fetch must normalize provider results, reject SSRF/private redirects, treat content as untrusted, preserve Room billing context, and stop on budget/revocation; `tests/security/web-research.test.ts` owns this.

## File Map and Boundary Decisions

Existing boundaries remain the default:

- `packages/agent-core`: retained only for Astra-specific policy, compatibility, and deterministic fixtures after the Codex cutover; it cannot be the production autonomous loop.
- `packages/workspace`: retained for canonical Windows path, command, Git, patch, and verification policy.
- `packages/remote-protocol`: extended for Room/project/file/capability domain types and in-memory authorization behavior; no parallel Room package is created.
- `packages/billing`: extended only for context-preserving organization/personal reservations and settlement adapters.
- `packages/db`: extended with migrations and PostgreSQL repositories for new Room File, import, capability, security-event, and host-binding state.
- `apps/api`: owns authenticated runtime inference, Room File/import endpoints, capability validation, and server-side billing context.
- `apps/desktop/electron`: owns runtime supervision, host filesystem execution, bridge IPC, device credentials, and offline state.
- `apps/desktop/src/renderer`: owns the Astra-branded Cline-derived workspace integration and Astra-native editor/filesystem primitives not supplied by Cline.

New boundaries are created only when they carry a real responsibility:

- `packages/codex-runtime`: Astra-owned typed supervisor/protocol adapter around the pinned Codex artifact.
- `packages/workspace-bridge`: renderer-safe command/event schemas and bridge view models.
- `packages/room-files`: Room File validation, quarantine, import manifests, and ZIP inspection; it is not a second Room authorization service.

### Task 1: Acquire and pin upstream source, provenance, and the 65-feature contract

**Files:**

- Create: `vendor/upstream/cline/` from `https://github.com/cline/cline` at the resolved immutable commit.
- Create: `vendor/upstream/codex/` from `https://github.com/openai/codex` at the resolved immutable commit.
- Create: `docs/source-provenance.md`.
- Create: `docs/product/feature-contract-v1.md` if no canonical Feature 1–65 contract exists.
- Create: `scripts/verify-source-provenance.mjs`.
- Create: `tests/integration/source-provenance.test.ts`.
- Create: `tests/unit/feature-contract.test.ts`.
- Modify: `docs/open-source-notices.md` and `docs/supply-chain.md` with actual upstream license/notice entries.

**Interfaces:**

- Produces `docs/source-provenance.md` with repository URL, resolved SHA, tree hash where available, acquisition timestamp, license hash, selected source paths, excluded paths, Astra destinations, patch list, build method, and runtime method.
- Produces a machine-readable block in `docs/source-provenance.md` consumed by `scripts/verify-source-provenance.mjs`.
- Produces a 65-row `docs/product/feature-contract-v1.md` with IDs 1–65, exact requirement text, expected behavior, actors, authorization invariant, billing invariant, acceptance criteria, evidence fields, and status.

- [ ] **Step 1: Write the failing provenance test**

  Add assertions that both upstream directories exist, each is a Git checkout, each resolves to a non-empty 40-character SHA, both URLs match the required upstream URLs, both license files are hashed, the provenance document names selected source paths, and the feature contract contains exactly IDs 1 through 65 once each.

- [ ] **Step 2: Run the focused test to verify it fails for the missing source**

  Run: `npm.cmd test -- tests/integration/source-provenance.test.ts tests/unit/feature-contract.test.ts`

  Expected: FAIL because the upstream directories and provenance/contract files do not yet exist.

- [ ] **Step 3: Fetch the real upstream repositories and inspect their current architecture**

  Use separate `git clone` commands into `vendor/upstream/cline` and `vendor/upstream/codex`. Record the checked-out `HEAD`, tree hash, license paths/hashes, top-level workspaces, build commands, Cline UI-owned paths, Cline runtime/provider paths, Codex app-server/client/protocol paths, and Codex build output paths. Do not copy files before this inventory is written.

- [ ] **Step 4: Create the provenance validator and documents**

  Implement `scripts/verify-source-provenance.mjs` to fail when a checkout, SHA, license hash, selected path, or destination is missing; to reject floating branch references; and to verify that every selected path exists. Create the 65-row contract from the supplied feature requirements without merging rows.

- [ ] **Step 5: Update notices and run the focused tests**

  Run: `npm.cmd test -- tests/integration/source-provenance.test.ts tests/unit/feature-contract.test.ts`

  Expected: PASS with exact upstream SHAs and exactly 65 feature rows. Run: `node scripts/verify-source-provenance.mjs`. Expected: exit 0.

- [ ] **Step 6: Commit the acquisition/provenance boundary**

  Commit with: `git add vendor docs scripts tests && git commit -m "feat: pin Cline and Codex provenance"`.

### Task 2: Establish the pinned Codex artifact and fail-closed supervisor

**Files:**

- Create: `packages/codex-runtime/package.json`.
- Create: `packages/codex-runtime/src/protocol.ts`.
- Create: `packages/codex-runtime/src/manifest.ts`.
- Create: `packages/codex-runtime/src/supervisor.ts`.
- Create: `packages/codex-runtime/src/index.ts`.
- Create: `apps/desktop/electron/codex-supervisor.ts`.
- Create: `tests/integration/codex-supervisor.test.ts`.
- Create: `tests/unit/codex-protocol.test.ts`.
- Modify: root `package.json` build/package scripts and `apps/desktop/package.json` packaging configuration.
- Modify: `apps/desktop/electron-builder.yml` to include only the pinned Codex artifact and required unpacked runtime resources.

**Interfaces:**

```ts
export interface CodexArtifactManifest {
  sourceSha: string;
  protocolFingerprint: string;
  artifactPath: string;
  artifactSha256: string;
  version: string;
  buildTarget: string;
}

export interface CodexRuntimeSupervisor {
  start(input: {
    sessionId: string;
    runtimeCredential: string;
    isolatedHome: string;
  }): Promise<CodexSessionHandle>;
  sendTurn(sessionId: string, input: CodexTurnInput): AsyncIterable<CodexEvent>;
  interrupt(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}
```

The actual wire messages and launch arguments are derived from the pinned Codex protocol inventory in Task 1; the adapter must not invent private upstream APIs.

- [ ] **Step 1: Write failing artifact-identity and fail-closed tests**

  Cover missing artifact, wrong SHA, wrong protocol fingerprint, arbitrary PATH executable, malformed event frame, runtime crash, cancellation, and successful launch using a deterministic process fixture that implements the recorded protocol shape.

- [ ] **Step 2: Run the focused tests**

  Run: `npm.cmd test -- tests/integration/codex-supervisor.test.ts tests/unit/codex-protocol.test.ts`

  Expected: FAIL because `@lyntar/codex-runtime` and the supervisor do not exist.

- [ ] **Step 3: Build the actual pinned Codex runtime**

  Execute the upstream-documented build command for the pinned checkout and target the supported Windows x64 artifact. Record the exact command, output path, binary hash, protocol fingerprint, and any required runtime resources in `docs/source-provenance.md`. Do not use a globally installed `codex` executable.

- [ ] **Step 4: Implement the protocol adapter and supervisor**

  Use `child_process.spawn` only with the resolved bundled artifact path, an isolated `CODEX_HOME` under Astra application data, sanitized environment variables, framed stdin/stdout, bounded output, abort propagation, crash detection, and deterministic identity checks before launch. Reject unknown protocol/runtime identity instead of falling back to `packages/agent-core`.

- [ ] **Step 5: Run focused tests and the Codex upstream-relevant checks**

  Run the focused Vitest command from Step 2 and the pinned Codex repository’s documented tests for the selected runtime/protocol. Expected: Astra identity, lifecycle, framing, cancellation, crash, and mismatch tests PASS; any unavailable upstream test must be recorded with its exact environment error.

- [ ] **Step 6: Commit the runtime supervisor**

  Commit with: `git add packages/codex-runtime apps/desktop/electron/codex-supervisor.ts apps/desktop/package.json apps/desktop/electron-builder.yml package.json tests docs/source-provenance.md && git commit -m "feat: supervise pinned Codex runtime"`.

### Task 3: Add the Astra runtime inference API and immutable billing context

**Files:**

- Create: `packages/contracts/src/domain/codex-runtime.ts`.
- Create: `packages/codex-runtime/src/inference-client.ts`.
- Create: `apps/api/src/runtime-route.ts`.
- Create: `tests/integration/codex-runtime-api.test.ts`.
- Create: `tests/integration/room-billing-context.test.ts`.
- Modify: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/model-route.ts`.
- Modify: `packages/billing/src/ports.ts`, `packages/billing/src/organization-service.ts`, and existing reservation/settlement contracts only where needed to carry immutable context.
- Modify: `packages/db/src/postgres-billing.ts`, `packages/db/src/postgres-organization-billing.ts`, and the next migration after `0011_organization_wallets.sql` for model-call, reservation, settlement, and context uniqueness.

**Interfaces:**

```ts
export type RuntimeBillingContext =
  | { kind: 'PERSONAL'; userId: string; taskId: string; sessionId: string }
  | {
      kind: 'ROOM';
      organizationId: string;
      roomId: string;
      memberId: string;
      hostDeviceId: string;
      taskId: string;
      sessionId: string;
    };

export interface RuntimeInferenceRequest {
  runtimeSessionId: string;
  modelId: string;
  billingContext: RuntimeBillingContext;
  modelCallId: string;
  estimatedCredits: string;
  messages: unknown[];
}
```

- [ ] **Step 1: Write failing billing-context tests**

  Assert personal requests resolve the personal wallet, Room requests resolve the organization wallet from Room ownership, client-supplied wallet IDs are ignored/rejected, the context cannot change after the first call, duplicate model-call reservations are idempotent, duplicate settlements are idempotent, and a personal balance is unchanged by a Room task.

- [ ] **Step 2: Run the focused tests**

  Run: `npm.cmd test -- tests/integration/codex-runtime-api.test.ts tests/integration/room-billing-context.test.ts`

  Expected: FAIL because the runtime route and immutable context contract do not exist.

- [ ] **Step 3: Implement the typed runtime request and server authorization**

  Add a server-authenticated runtime credential with expiry, session binding, device binding, and revocation. Resolve `roomId → organizationId → organization wallet` server-side, verify current Room permission before each privileged model/tool progression, validate the model catalog, and reserve before calling the existing Gateway adapter.

- [ ] **Step 4: Implement streaming and exact settlement**

  Adapt the existing `packages/model-gateway` stream into the Codex protocol response shape, preserve request/model/provider IDs and usage metadata, settle actual cost once by `modelCallId`, release unused reservation, retain provider/customer/absorbed cost separately, and recover interrupted reservations with existing lifecycle semantics.

- [ ] **Step 5: Run focused and existing billing/model suites**

  Run the two focused files plus `tests/integration/api-model-reservation.test.ts`, `tests/integration/api-model-streaming.test.ts`, `tests/integration/organization-billing.test.ts`, `tests/integration/billing-concurrency.test.ts`, and `tests/unit/model-gateway-cancellation.test.ts`. Expected: all pass with no personal/organization wallet drift.

- [ ] **Step 6: Commit the runtime transport**

  Commit with: `git add packages/contracts packages/codex-runtime apps/api packages/billing packages/db tests && git commit -m "feat: route Codex inference through Astra billing"`.

### Task 4: Create the typed Astra Workspace Bridge

**Files:**

- Create: `packages/workspace-bridge/package.json`.
- Create: `packages/workspace-bridge/src/commands.ts`.
- Create: `packages/workspace-bridge/src/events.ts`.
- Create: `packages/workspace-bridge/src/view-models.ts`.
- Create: `packages/workspace-bridge/src/index.ts`.
- Create: `tests/unit/workspace-bridge.test.ts`.
- Create: `tests/integration/workspace-bridge-ipc.test.ts`.
- Modify: `packages/contracts/src/ipc/index.ts`, `apps/desktop/desktop.d.ts`, `apps/desktop/electron/preload.cts`, `apps/desktop/electron/ipc-handlers.ts`, and `apps/desktop/electron/main.ts`.

**Interfaces:**

```ts
export type WorkspaceCommand =
  | { type: 'task.start'; input: StartTaskInput }
  | { type: 'task.resume'; taskId: string }
  | { type: 'task.interrupt'; taskId: string }
  | { type: 'task.cancel'; taskId: string }
  | { type: 'approval.respond'; requestId: string; approved: boolean }
  | { type: 'model.select'; modelId: string }
  | { type: 'room.import.approve'; proposalId: string };

export type WorkspaceEvent =
  | { type: 'session.started'; payload: SessionViewModel }
  | { type: 'assistant.delta'; payload: { taskId: string; text: string } }
  | { type: 'tool.requested'; payload: ToolRequestViewModel }
  | { type: 'tool.completed'; payload: ToolResultViewModel }
  | { type: 'approval.requested'; payload: ApprovalViewModel }
  | { type: 'diff.updated'; payload: DiffViewModel }
  | { type: 'verification.completed'; payload: VerificationViewModel }
  | { type: 'budget.warning'; payload: BudgetViewModel }
  | {
      type: 'task.blocked' | 'task.failed' | 'task.completed' | 'task.cancelled';
      payload: TaskStatusViewModel;
    };
```

- [ ] **Step 1: Write failing schema and IPC tests**

  Cover unknown commands, malformed task IDs, approval authorization, event discriminators, cancellation propagation, and the absence of a generic shell/filesystem API in the preload surface.

- [ ] **Step 2: Run the focused tests**

  Run: `npm.cmd test -- tests/unit/workspace-bridge.test.ts tests/integration/workspace-bridge-ipc.test.ts`

  Expected: FAIL because the package and typed APIs do not exist.

- [ ] **Step 3: Implement the bridge schemas and view models**

  Use Zod at the IPC boundary, convert runtime events to renderer-safe models, redact secrets and oversized output, preserve Room/billing context in task state, and reject direct renderer access to Node, process, or provider credentials.

- [ ] **Step 4: Wire preload and main handlers**

  Expose only the typed bridge methods through `contextBridge`; route task commands to the Codex supervisor and Astra local workspace adapters; route events through bounded subscriptions with cancellation cleanup.

- [ ] **Step 5: Run desktop IPC/runtime suites**

  Run the focused tests plus `tests/integration/desktop-ipc.test.ts`, `tests/integration/desktop-runtime.test.ts`, `tests/unit/desktop-session-store.test.ts`, and `tests/unit/agent-cancellation.test.ts`. Expected: existing isolation and cancellation behavior remains green.

- [ ] **Step 6: Commit the bridge**

  Commit with: `git add packages/workspace-bridge packages/contracts apps/desktop tests && git commit -m "feat: add Astra workspace bridge"`.

### Task 5: Integrate actual Cline workspace source and remove UI/runtime leakage

**Files:**

- Create: `packages/cline-workspace-ui/package.json`.
- Create: `packages/cline-workspace-ui/src/provenance.ts`.
- Create: `packages/cline-workspace-ui/src/AstraWorkspaceShell.tsx`.
- Create: `packages/cline-workspace-ui/src/cline-adapter.ts`.
- Create: `tests/integration/cline-boundary.test.ts`.
- Create: `tests/integration/cline-workspace-render.test.ts`.
- Modify: `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/view-model.ts`, `apps/desktop/src/renderer/app.css`, `apps/desktop/src/renderer/main.tsx`, and root/workspace build configuration.
- Modify: `docs/source-provenance.md` with exact Cline modules and adaptation patches.

**Interfaces:**

```ts
export interface AstraWorkspaceBridge {
  dispatch(command: WorkspaceCommand): Promise<void>;
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
  getSnapshot(): WorkspaceSnapshot;
}

export function AstraWorkspaceShell(props: {
  bridge: AstraWorkspaceBridge;
  nativeEditor: NativeEditorSurface;
}): ReactElement;
```

- [ ] **Step 1: Write failing provenance/boundary/render tests**

  Assert the selected Cline-owned source path is imported by the workspace package, the production renderer includes the provenance marker, Cline provider/account/agent modules are not imported, bridge events render through the shell, approval actions dispatch typed commands, Room billing context is visible, and model display matches the resolved model ID.

- [ ] **Step 2: Run focused tests to verify missing integration**

  Run: `npm.cmd test -- tests/integration/cline-boundary.test.ts tests/integration/cline-workspace-render.test.ts`

  Expected: FAIL because no Cline-derived workspace package or imports exist.

- [ ] **Step 3: Select and adapt only Cline-owned workspace source**

  Copy or link the exact selected upstream paths recorded in Task 1 into `packages/cline-workspace-ui`, preserve notices, remove upstream provider/account/runtime entry points, and add the adapter at the smallest boundary that leaves UI interactions intact. Do not add Cline runtime imports to the production dependency graph.

- [ ] **Step 4: Replace the current renderer entry with the adapted shell**

  Keep Astra-native project picker, editor primitives, terminal/process panels, Learn/Viva/Hackathon modes, settings, Room context, and device controls where Cline does not own the primitive. Render agent activity, approvals, diffs, and task history from real Workspace Bridge events rather than timers or placeholders.

- [ ] **Step 5: Run focused, renderer build, and branding checks**

  Run the focused tests, `npm.cmd run build --workspace @lyntar/desktop`, and `rg -ni 'Cline|OpenAI API key|Anthropic API key|OpenRouter|BYOK' apps/desktop packages/cline-workspace-ui`. Any remaining Cline match must be legal provenance or a deliberately excluded source path, not user-facing product/provider configuration.

- [ ] **Step 6: Commit the Cline UI boundary**

  Commit with: `git add packages/cline-workspace-ui apps/desktop docs/source-provenance.md tests && git commit -m "feat: integrate Cline workspace UI through Astra bridge"`.

### Task 6: Cut over the authoritative production agent path and completion gate

**Files:**

- Create: `packages/codex-runtime/src/completion-gate.ts`.
- Create: `packages/codex-runtime/src/runtime-selection.ts`.
- Create: `tests/integration/production-agent-path.test.ts`.
- Create: `tests/unit/completion-gate.test.ts`.
- Modify: `apps/desktop/electron/desktop-runtime.ts`, `apps/desktop/electron/ipc-handlers.ts`, `packages/agent-core/src/index.ts`, `packages/agent-core/src/agent-runner.ts`, and `apps/desktop/package.json`.
- Modify: `docs/agent-state-machine.md` and `docs/source-provenance.md` with the final classification of legacy components.

**Interfaces:**

```ts
export interface ProductionAgentRuntime {
  kind: 'CODEX';
  startTask(input: StartTaskInput): Promise<AgentTaskHandle>;
}

export interface CompletionGate {
  evaluate(input: {
    requestedCriteria: AcceptanceCriterion[];
    evidence: VerificationEvidence[];
  }): CompletionDecision;
}
```

- [ ] **Step 1: Write the failing authoritative-path tests**

  Assert the production factory returns `kind: 'CODEX'`, legacy `AgentTaskRunner` is not selected, Cline agent/provider modules are not selected, a Codex launch failure returns `FAILED` or `BLOCKED` without fallback, and requested tests/build/typecheck criteria must have evidence before `COMPLETED`.

- [ ] **Step 2: Run focused tests**

  Run: `npm.cmd test -- tests/integration/production-agent-path.test.ts tests/unit/completion-gate.test.ts`

  Expected: FAIL because the desktop currently constructs the independent Astra runner.

- [ ] **Step 3: Implement the Codex production factory and completion gate**

  Make production desktop task creation require the Codex supervisor. Keep the legacy runner available only through explicit deterministic test factories. Enforce model/tool/command/wall-time/repair/cost budgets outside the model, preserve cancellation, and emit `BLOCKED`, `FAILED`, `CANCELLED`, or `COMPLETED` from evidence.

- [ ] **Step 4: Run the golden path and regression suites**

  Run the focused tests plus `npm.cmd run golden-path`, `tests/golden-path/agent-broken-node.test.ts`, `tests/unit/agent-core.test.ts`, `tests/unit/session-continuity.test.ts`, and `tests/unit/agent-cancellation.test.ts`. Any deterministic test that intentionally exercises the legacy fixture must use an explicit test-only factory and be documented as such.

- [ ] **Step 5: Commit the production cutover**

  Commit with: `git add packages/codex-runtime packages/agent-core apps/desktop docs tests && git commit -m "feat: make Codex the authoritative Astra runtime"`.

### Task 7: Implement Room Files, quarantine, and API authorization

**Files:**

- Create: `packages/room-files/package.json`.
- Create: `packages/room-files/src/types.ts`.
- Create: `packages/room-files/src/validation.ts`.
- Create: `packages/room-files/src/store.ts`.
- Create: `packages/room-files/src/imports.ts`.
- Create: `packages/room-files/src/index.ts`.
- Create: `apps/api/src/room-files-route.ts`.
- Create: `tests/integration/room-files-api.test.ts`.
- Create: `tests/unit/room-files.test.ts`.
- Create: `packages/db/migrations/0012_room_files.sql`.
- Modify: `packages/db/src/schema.sql`, `packages/db/src/repositories.ts`, `packages/db/src/postgres.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `packages/remote-protocol/src/types.ts`, and `packages/remote-protocol/src/access.ts`.

**Interfaces:**

```ts
export type RoomFileIntent = 'REFERENCE' | 'ADD_TO_PROJECT';
export type RoomFileStatus = 'QUARANTINED' | 'AVAILABLE' | 'REJECTED' | 'DELETED';

export interface RoomFileRecord {
  id: string;
  roomId: string;
  uploaderId: string;
  originalName: string;
  safeName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  intent: RoomFileIntent;
  status: RoomFileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ImportProposal {
  id: string;
  roomId: string;
  fileId: string;
  destinationRelative: string;
  additions: string[];
  replacements: string[];
  conflicts: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'FAILED';
}
```

- [ ] **Step 1: Write failing Room File tests**

  Cover valid reference/import uploads, uploader/role authorization, MIME/size/name validation, checksum persistence, quarantine status, list/detail authorization, import proposal creation, and zero project writes after rejected authorization or validation.

- [ ] **Step 2: Run focused tests**

  Run: `npm.cmd test -- tests/unit/room-files.test.ts tests/integration/room-files-api.test.ts`

  Expected: FAIL because Room File entities, routes, storage, and migration do not exist.

- [ ] **Step 3: Add the PostgreSQL migration and deterministic store**

  Create foreign keys to existing Rooms/users/devices, unique `(room_id, sha256, safe_name)` constraints where compatible, indexes for Room/uploader/status, import idempotency keys, and append-only audit references. Implement the same behavior in an in-memory adapter used by tests.

- [ ] **Step 4: Implement upload/quarantine and role checks**

  Accept only configured file types and size limits, normalize names without trusting extensions, stream to safe storage, calculate SHA-256, mark content quarantined, and authorize upload/reference/import actions with current Room permissions. Reference data is explicitly marked untrusted context.

- [ ] **Step 5: Implement import proposals and preview endpoints**

  Inspect file manifests without writing the primary project, validate destination relative paths against the host-bound workspace, detect additions/replacements/collisions, and return a preview. Require `files.write` plus any configured approval before an import can transition to host execution.

- [ ] **Step 6: Run focused, migration-shape, and API security tests**

  Run focused tests plus `tests/integration/migration-shape.test.ts`, `tests/unit/remote-access.test.ts`, and `tests/security/path-security.test.ts`. Expected: all pass and organization membership without Room membership remains denied.

- [ ] **Step 7: Commit Room Files foundation**

  Commit with: `git add packages/room-files packages/remote-protocol packages/db apps/api tests && git commit -m "feat: add quarantined Room Files and import proposals"`.

### Task 8: Implement ZIP inspection and safe host-side import execution

**Files:**

- Create: `packages/room-files/src/zip-inspector.ts`.
- Create: `packages/room-files/src/import-manifest.ts`.
- Create: `tests/security/room-files.test.ts`.
- Create: `tests/unit/zip-inspector.test.ts`.
- Modify: `packages/room-files/package.json` with a direct, pinned archive-parser dependency only after its license/audit entry is recorded.
- Modify: `apps/desktop/electron/desktop-runtime.ts`, `apps/desktop/electron/ipc-handlers.ts`, `packages/workspace/src/path-security.ts`, and `packages/remote-protocol/src/desktop-bridge.ts`.

**Interfaces:**

```ts
export interface ZipInspectionLimits {
  maxEntries: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  maxPathDepth: number;
}

export interface ImportExecutionPort {
  preview(proposalId: string): Promise<ImportProposal>;
  apply(proposalId: string, approval: ImportApproval): Promise<ImportResult>;
}
```

- [ ] **Step 1: Write failing archive-security tests**

  Generate or load fixtures for traversal, absolute drive/UNC/device paths, reserved names, ADS, duplicate/case/Unicode collisions, symlink/reparse entries, excessive entries, expanded-size/ratio abuse, nested archives, executable files, and destination conflicts. Assert all unsafe inputs remain quarantined and project write count is zero.

- [ ] **Step 2: Run the focused security tests**

  Run: `npm.cmd test -- tests/security/room-files.test.ts tests/unit/zip-inspector.test.ts`

  Expected: FAIL because no ZIP inspector or import executor exists.

- [ ] **Step 3: Add a direct archive parser with recorded license and bounded inspection**

  Add the selected parser as a direct dependency rather than relying on Electron Builder’s transitive `unzipper`. Pin it in `package-lock.json`, add its license to the supply-chain inventory, and enforce entry count, expanded bytes, compression ratio, path normalization, link rejection, collision detection, and executable-content policy before returning a manifest.

- [ ] **Step 4: Implement host-side import execution**

  Execute only approved manifest entries through the existing canonical workspace/atomic patch APIs. Revalidate the current Room capability, host binding, destination, and project fingerprint immediately before writing. Write through a temporary/quarantine staging location, surface conflicts, and record import/audit events.

- [ ] **Step 5: Run focused tests and the existing workspace security suite**

  Run focused tests plus `tests/security/path-security.test.ts`, `tests/security/command-policy.test.ts`, `tests/integration/patch-rollback.test.ts`, and `tests/integration/remote-host-bridge.test.ts`. Expected: no unauthorized path or partial import survives.

- [ ] **Step 6: Commit ZIP/import hardening**

  Commit with: `git add packages/room-files packages/workspace packages/remote-protocol apps/desktop package-lock.json docs tests && git commit -m "feat: harden Room File import execution"`.

### Task 9: Harden Room host binding, revocation epochs, offline state, and handoff

**Files:**

- Create: `packages/remote-protocol/src/capabilities.ts`.
- Create: `packages/remote-protocol/src/security-events.ts`.
- Create: `tests/integration/room-revocation-during-task.test.ts`.
- Create: `tests/security/room-authorization.test.ts`.
- Create: `packages/db/migrations/0013_room_security_and_host_binding.sql`.
- Modify: `packages/remote-protocol/src/access.ts`, `packages/remote-protocol/src/types.ts`, `packages/remote-protocol/src/relay.ts`, `packages/remote-protocol/src/websocket-relay.ts`, `apps/api/src/remote-route.ts`, `apps/api/src/event-route.ts`, `apps/desktop/electron/desktop-runtime.ts`, and `packages/db/src/postgres-remote.ts`.

**Interfaces:**

```ts
export interface RoomCapabilityLease {
  id: string;
  roomId: string;
  memberId: string;
  hostDeviceId: string;
  taskId: string;
  permission: RoomPermission;
  authorizationEpoch: number;
  expiresAt: string;
  nonce: string;
}

export interface RoomSecurityEvent {
  id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  type: string;
  organizationId: string;
  roomId: string;
  actorUserId: string | null;
  deviceId: string | null;
  taskId: string | null;
  requestedAction: string;
  requestedResource: string | null;
  decision: 'ALLOWED' | 'BLOCKED';
  evidence: string;
  createdAt: string;
}
```

- [ ] **Step 1: Write failing revocation/offline/handoff tests**

  Cover suspension/removal/device revocation during an active task and before a command, stale lease/epoch rejection, replay rejection, host offline state, host mismatch, workspace fingerprint mismatch, valid host transfer, invalid transfer, and deterministic security-event severity/alert visibility.

- [ ] **Step 2: Run focused tests**

  Run: `npm.cmd test -- tests/integration/room-revocation-during-task.test.ts tests/security/room-authorization.test.ts`

  Expected: FAIL because leases, epochs, security events, and host-transfer persistence are absent.

- [ ] **Step 3: Add migrations and capability validation**

  Add Room host-binding/fingerprint/epoch fields, capability leases with nonce/expiry, append-only security events, and audit indexes. Validate authorization before each privileged command/file/import action and before continued model progression.

- [ ] **Step 4: Implement host offline and transfer state**

  Propagate heartbeat state honestly, prevent task start when the primary host is unavailable, preserve recoverable task state, and require admin-authorized new-device registration, explicit workspace selection, validated fingerprint, and activation before host binding changes.

- [ ] **Step 5: Implement severity/alert behavior**

  Record deterministic path escapes, unauthorized project access, secret-access attempts, destructive actions, and policy bypass attempts. Block high/critical actions, expose them only to authorized admins, and never auto-suspend from one model classification.

- [ ] **Step 6: Run the full remote/security suite**

  Run focused tests plus `tests/integration/remote-access-api.test.ts`, `tests/integration/remote-relay.test.ts`, `tests/integration/websocket-relay.test.ts`, `tests/integration/remote-host-bridge.test.ts`, `tests/unit/remote-access.test.ts`, and `tests/security/path-security.test.ts`.

- [ ] **Step 7: Commit Room security hardening**

  Commit with: `git add packages/remote-protocol packages/db apps/api apps/desktop tests docs && git commit -m "feat: enforce revocable Room host capabilities"`.

### Task 10: Enforce MCP/Plugin/Skill policy below the model

**Files:**

- Create: `tests/security/extension-room-boundary.test.ts`.
- Modify: `packages/mcp/src/index.ts`, `packages/plugins/src/index.ts`, `packages/skills/src/index.ts`, `packages/contracts/src/domain/workspace.ts`, `packages/remote-protocol/src/access.ts`, `apps/api/src/remote-route.ts`, and `apps/desktop/electron/desktop-runtime.ts`.

**Interfaces:**

```ts
export interface ExtensionExecutionContext {
  roomId: string | null;
  taskId: string;
  actorUserId: string;
  permissions: readonly RoomPermission[];
  workspaceRoot: string | null;
  organizationId: string | null;
}

export function authorizeExtensionAction(
  context: ExtensionExecutionContext,
  action: ExtensionAction,
): ExtensionAuthorization;
```

- [ ] **Step 1: Write failing bypass tests**

  Test MCP, Plugin, and Skill attempts to read/write outside the Room root, select a different wallet, access secrets, run unauthorized terminal actions, mutate roles, and bypass current revocation.

- [ ] **Step 2: Run focused tests**

  Run: `npm.cmd test -- tests/security/extension-room-boundary.test.ts`

  Expected: FAIL for at least the unimplemented Room-aware extension context.

- [ ] **Step 3: Implement shared extension authorization**

  Require every extension execution to receive a server/host-generated context, enforce Room permissions and workspace policy before dispatch, reject client-supplied wallet/organization IDs, and redact secrets from extension output.

- [ ] **Step 4: Run extension and remote regression suites**

  Run focused tests plus `tests/unit/extensions.test.ts`, `tests/unit/marketplace.test.ts`, `tests/integration/remote-protocol.test.ts`, and existing path/command security tests.

- [ ] **Step 5: Commit extension policy hardening**

  Commit with: `git add packages/mcp packages/plugins packages/skills packages/contracts packages/remote-protocol apps/api apps/desktop tests && git commit -m "feat: enforce Room policy for extensions"`.

### Task 11: Integrate Room UI, billing context, and Cline-derived activity surfaces

**Files:**

- Create: `apps/desktop/src/renderer/room-view-model.ts`.
- Create: `apps/desktop/src/renderer/RoomFilesPanel.tsx`.
- Create: `apps/desktop/src/renderer/RoomActivityPanel.tsx`.
- Create: `tests/integration/room-ui-contract.test.ts`.
- Modify: `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/app.css`, `apps/desktop/src/renderer/view-model.ts`, `packages/workspace-bridge/src/view-models.ts`, and `apps/desktop/desktop.d.ts`.

**Interfaces:**

```ts
export interface RoomWorkspaceViewModel {
  roomId: string;
  roomName: string;
  organizationName: string;
  role: RoomRole | 'OWNER';
  hostDevice: { label: string; online: boolean; lastSeenAt: string | null };
  primaryProject: { workspaceRootRelative: string; available: boolean };
  billing: { context: 'PERSONAL' | 'TEAM' | 'BUSINESS'; availableCredits: string };
  files: RoomFileRecord[];
  activeTask: TaskViewModel | null;
}
```

- [ ] **Step 1: Write failing UI-contract tests**

  Assert the renderer receives Room name/role/host/project/online/billing context, distinguishes personal from organization credits, exposes Room Files only to authorized roles, shows `HOST OFFLINE`, renders import previews, and maps real agent events to activity without fake timers.

- [ ] **Step 2: Run focused tests**

  Run: `npm.cmd test -- tests/integration/room-ui-contract.test.ts`

  Expected: FAIL because the Room UI/bridge view models are absent.

- [ ] **Step 3: Implement the view models and panels**

  Add typed Room context and panels to the Cline-derived shell without exposing admin-only security/audit data to ordinary members. Make Settings navigation preserve active project/tabs/session and return directly to the coding workspace.

- [ ] **Step 4: Wire real events and commands**

  Connect uploads, reference selection, import proposal/approval, activity, host state, security alerts, credit meter, approvals, diffs, and task lifecycle to the Workspace Bridge.

- [ ] **Step 5: Run desktop build and focused UI tests**

  Run the focused test and `npm.cmd run build --workspace @lyntar/desktop`. Verify no public website route is loaded by the desktop coding entry.

- [ ] **Step 6: Commit Room UI integration**

  Commit with: `git add apps/desktop packages/workspace-bridge tests && git commit -m "feat: expose secure Room workspace context"`.

### Task 12: Generate the 65-feature audit, benchmark, package, and certify

**Files:**

- Create: `scripts/run-agent-benchmark.mjs`.
- Create: `tests/integration/agent-autonomy-benchmark.test.ts`.
- Create: `tests/integration/final-feature-contract.test.ts`.
- Create: `docs/migration-certification.md`.
- Create: `docs/audits/2026-09-20-cline-codex-room-final-audit.md`.
- Modify: `scripts/verify-source-provenance.mjs`, `docs/source-provenance.md`, `docs/open-source-notices.md`, `docs/supply-chain.md`, `README.md`, and package/build metadata.

**Interfaces:**

```ts
export interface BenchmarkResult {
  taskId: string;
  correct: boolean;
  verificationPassed: boolean;
  userInterventionCount: number;
  modelCalls: number;
  creditsConsumed: string;
  wrongFiles: string[];
  falseCompletion: boolean;
  loopsDetected: number;
  compactions: number;
  durationMs: number;
}
```

- [ ] **Step 1: Write failing final-evidence tests**

  Assert the feature contract has all 65 rows, provenance validator passes, production-path assertion reports Codex/false/false, no BYOK/provider credential source is present in desktop, and a certification report cannot use `PRODUCTION READY` while required upstream/runtime/package gates are blocked.

- [ ] **Step 2: Run focused tests to verify missing final evidence**

  Run: `npm.cmd test -- tests/integration/final-feature-contract.test.ts tests/integration/agent-autonomy-benchmark.test.ts`

  Expected: FAIL until the benchmark/report generators and production-path evidence exist.

- [ ] **Step 3: Add the benchmark tasks and completion checks**

  Exercise simple bug fix, multi-file repair, failing-test repair, TypeScript/build repair, migration, ambiguous task, and upstream-integration task. Record correctness, verification, model calls, credits, intervention, changed files, loops, compaction, and false completion. Use deterministic model/runtime fixtures unless live credentials are explicitly configured.

- [ ] **Step 4: Run full deterministic verification**

  Run separately and record exact output for:

  ```text
  npm.cmd test
  npm.cmd run typecheck
  npm.cmd run lint
  npm.cmd run format:check
  npm.cmd run build
  npm.cmd audit --audit-level=high
  git diff --check
  npm.cmd run golden-path
  node scripts/verify-source-provenance.mjs
  ```

  Run upstream-relevant tests, Room/security/billing tests, and the benchmark. Do not hide failures from unrelated tests.

- [ ] **Step 5: Package the exact Windows artifact**

  Run `npm.cmd run package:win:unsigned` unless signing credentials are present and the signed pipeline is configured. Record artifact path, filename, byte size, SHA-256, version metadata, and code-signing status. Never call unsigned packaging signed.

- [ ] **Step 6: Produce the complete report**

  Generate `docs/migration-certification.md` with exact Astra/Cline/Codex SHAs, protocol fingerprint, source paths, Cline/Codex runtime evidence, all Feature 1–65 rows, Room/billing/security evidence, tests, artifact identity, external `PASS`/`FAIL`/`BLOCKED` statuses, and only genuine remaining risks. `PRODUCTION READY` is allowed only if every launch-critical gate is evidenced.

- [ ] **Step 7: Commit and verify the release candidate**

  Run `git status --short`, inspect the complete diff, scan for secrets, run `git diff --check`, commit with `git commit -m "feat: integrate Cline workspace and Codex runtime"`, capture the final SHA, and rerun the certification commands against that exact commit/artifact. Any post-certification source change invalidates the relevant evidence.

### Task 13: Add Astra Web Search, Web Fetch, and research policy

**Files:**

- Create: `packages/web-research/package.json`.
- Create: `packages/web-research/src/types.ts`.
- Create: `packages/web-research/src/provider.ts`.
- Create: `packages/web-research/src/ssrf.ts`.
- Create: `packages/web-research/src/sanitize.ts`.
- Create: `packages/web-research/src/service.ts`.
- Create: `packages/web-research/src/index.ts`.
- Create: `packages/contracts/src/domain/web-research.ts`.
- Create: `apps/api/src/web-research-route.ts`.
- Create: `tests/unit/web-research.test.ts`.
- Create: `tests/security/web-research.test.ts`.
- Create: `tests/integration/web-research-api.test.ts`.
- Modify: `packages/config/src/index.ts`, `.env.example`, `packages/remote-protocol/src/access.ts`, `packages/contracts/src/domain/workspace.ts`, `packages/codex-runtime/src/protocol.ts`, `packages/workspace-bridge/src/events.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, and the renderer activity mapping.
- Modify: `docs/source-provenance.md`, `docs/supply-chain.md`, and `docs/migration-certification.md` with provider/configuration and live-certification evidence.

**Interfaces:**

```ts
export interface WebSearchRequest {
  query: string;
  maxResults?: number;
  recency?: string;
  domains?: string[];
  excludeDomains?: string[];
  safeSearch?: boolean;
}

export interface WebSearchProvider {
  search(request: WebSearchRequest, signal: AbortSignal): Promise<NormalizedSearchResponse>;
  fetch(request: WebFetchRequest, signal: AbortSignal): Promise<SanitizedPageResponse>;
}

export interface WebResearchService {
  search(context: WebResearchContext, request: WebSearchRequest): Promise<NormalizedSearchResponse>;
  fetch(context: WebResearchContext, request: WebFetchRequest): Promise<SanitizedPageResponse>;
}
```

- [ ] **Step 1: Write failing normalization, policy, SSRF, and injection tests**

  Cover normalized search output, source metadata/hash, authorized personal/Team/Business search, unauthorized Viewer/Room search, provider credentials absent from desktop inputs, localhost/private/link-local/metadata/file/ftp/custom URL rejection, public-to-private redirect rejection, size/timeout/content-type limits, cancellation, provider failure, budget exhaustion, Room suspension/removal, prompt injection in snippets/pages, and personal-versus-organization billing attribution.

- [ ] **Step 2: Run focused tests**

  Run: `npm.cmd test -- tests/unit/web-research.test.ts tests/security/web-research.test.ts tests/integration/web-research-api.test.ts`

  Expected: FAIL because no Web Research package, API route, policy, or events exist.

- [ ] **Step 3: Implement provider abstraction and normalized contracts**

  Add `WebSearchProvider` and a server-only configured provider adapter. Normalize provider output into stable result/source records; never pass raw provider response objects to Codex. Keep live provider URL/key configuration server-only and support deterministic provider fixtures without labeling them live.

- [ ] **Step 4: Implement SSRF-safe fetch and content sanitization**

  Validate HTTP(S) scheme, resolve and reject private/loopback/link-local/metadata/internal destinations, disable automatic unsafe redirects, revalidate every redirect, enforce redirect/byte/time/content-type limits, reject binary/unsupported content, normalize encoding, strip executable HTML/browser content, and mark fetched text as untrusted data. Do not execute JavaScript, download files automatically, access browser cookies, or perform browser automation.

- [ ] **Step 5: Implement Astra policy, budgets, and billing context**

  Add separate `WEB_SEARCH` and `WEB_FETCH` permission checks, task search/fetch/byte/time/repeated-query/provider-cost limits, cancellation, current Room authorization checks, and immutable personal/Team/Business billing-context attribution. Record search usage separately from model usage while retaining task/session/turn/member/Room/organization IDs.

- [ ] **Step 6: Wire runtime and Workspace Bridge events**

  Add typed `web.search.started`, `web.search.completed`, `web.fetch.started`, `web.fetch.completed`, `web.fetch.blocked`, and `web.budget.warning` events. Make Codex request the Astra tool boundary, route through the API/service, and render concise activity/source entries in the Cline-derived workspace without exposing hidden chain-of-thought.

- [ ] **Step 7: Run focused, extension, billing, and security suites**

  Run focused tests plus `tests/security/extension-room-boundary.test.ts`, `tests/integration/room-billing-context.test.ts`, `tests/security/path-security.test.ts`, `tests/unit/model-gateway-cancellation.test.ts`, and the full existing suite. Expected: local deterministic provider tests pass; live provider status remains `BLOCKED` unless real server credentials are configured.

- [ ] **Step 8: Commit Web Research integration**

  Commit with: `git add packages/web-research packages/contracts packages/config packages/remote-protocol packages/codex-runtime packages/workspace-bridge apps/api apps/desktop tests docs .env.example package.json package-lock.json && git commit -m "feat: add Astra web research tools"`.

## Plan Self-Review

- Coverage: Tasks 1–2 cover upstream acquisition, licenses, provenance, Codex artifact identity, protocol compatibility, isolated runtime home, and fail-closed launch. Tasks 3–6 cover Astra transport, billing context, bridge, Cline UI, production cutover, no fallback, budgets, cancellation, and completion. Tasks 7–11 cover Room Files, imports, ZIP security, host binding, revocation, offline/handoff, extension policy, UI, and attribution. Task 12 covers Feature 1–65 evidence, benchmark, packaging, and release certification.
- No placeholder implementation is accepted: unknown upstream paths are resolved and recorded in Task 1 before later tasks consume them; no task may invent an upstream API.
- Type consistency: `RuntimeBillingContext`, `WorkspaceCommand`, `WorkspaceEvent`, `RoomFileRecord`, `ImportProposal`, `RoomCapabilityLease`, `RoomSecurityEvent`, and `RoomWorkspaceViewModel` are defined before consumers.
- Regression coverage: each review-focus failure mode has an owning test file and a full-suite verification step.
- Explicit blockers: missing live AI, PostgreSQL, OAuth, Resend, Razorpay, relay, or signing infrastructure remains `BLOCKED`; it never becomes a deterministic PASS.
- Web Research is a separate Astra capability; deterministic provider tests can pass without live search credentials, but live search-provider certification remains `BLOCKED` until actual server configuration is exercised.
