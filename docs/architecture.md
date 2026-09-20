# Astra AI architecture

## First milestone

The first product milestone is a Windows-local coding workflow. A repository is selected on the user's computer, the agent inspects only that workspace, makes bounded atomic edits, runs a detected verification command, repairs within budget, and reports an Astra-owned diff separately from pre-existing changes.

The repository is not uploaded to the backend as a workspace representation. The backend receives model requests and safe task metadata; the selected files and Git working tree remain local.

## Process boundaries

```text
React renderer
    │ typed capability IPC
Electron preload
    │ contextBridge
Electron main adapter
    │ lifecycle, dialog, OS process boundary
packages/agent-core
    ├── WorkspacePort
    ├── PatchPort
    ├── CommandPort
    ├── GitPort
    ├── VerificationPort
    ├── ModelPort
    ├── PermissionPort
    └── EventPort
        │
        ├── packages/workspace       local files, commands, Git, verification
        └── packages/model-gateway   server-side provider adapter and receipts
```

The Electron main process does not own the agent loop. It creates adapters and forwards capability calls to `AgentTaskRunner`. The renderer receives the compatibility-preserved `window.lyntar` capability surface only; it does not receive `fs`, `child_process`, a shell function, or raw `ipcRenderer`.

## Monorepo responsibilities

- `apps/desktop`: Electron lifecycle, preload bridge, minimal React execution surface, and adapters to the local workspace and API.
- `apps/api`: Fastify health, server-controlled model catalog, and model request boundary.
- `packages/contracts`: Zod schemas and TypeScript types for domain state, IPC, API payloads, append-only agent events, and usage receipts.
- `packages/agent-core`: task state machine, bounded orchestration, permissions, cancellation, repair loop, and result assembly.
- `packages/workspace`: canonical Windows path authorization, atomic file writes, command policy/execution, Git baseline ownership, project detection, and verification.
- `packages/model-gateway`: Vercel AI Gateway-compatible HTTP adapter, structured decision normalization, streaming event normalization, and provider receipt parsing.
- `packages/db`: PostgreSQL migration and repository adapters plus deterministic in-memory stores.
- `packages/config`: server/runtime configuration parsing.
- `packages/test-utils`: reserved for deterministic test doubles and fixtures shared by tests.

## Task flow

1. The user opens a local directory through the Electron dialog.
2. The main adapter canonicalizes the directory, confirms it is a Git repository, and captures a Git baseline before the task starts.
3. The renderer sends a task prompt, server-provided model ID, and explicit budget through typed IPC.
4. Agent core requests structured model decisions. Decisions are limited to concise messages, bounded reads/searches, file patches, commands, or finish.
5. Every command is classified before execution. File and patch operations use workspace-relative paths and canonical authorization.
6. Patches are checkpointed and rolled back if a multi-file write fails.
7. Verification uses the detected project command through `VerificationPort`, not an unrestricted agent command path.
8. Failed verification can enter a bounded repair state. Model calls, repairs, commands, wall time, and estimated/provider-reported cost are checked before work starts.
9. The final Git result classifies Astra, pre-existing, and mixed paths. Only Astra-owned paths are presented as Astra changes.
10. The renderer derives progress from append-only safe events and receives no hidden model reasoning.

## Persistence

The migration includes safe workspace metadata, task/session rows, a server model catalog, usage receipts, and an immutable credit-ledger entry shape. Development entitlement mode does not create fabricated ledger transactions. Actual provider usage is stored when trustworthy metadata is returned, keyed by request and task IDs.

The catalog is controlled by the API/database. The desktop does not embed a model display name or provider route; it requests enabled catalog entries and sends the selected catalog ID back to the API.
