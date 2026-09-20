# Astra AI Cline Workspace + Codex Runtime + Room Platform Design

**Date:** 2026-09-20  
**Status:** Design approved in conversation; written specification awaiting review  
**Baseline:** `8a461a6c97a0d2814410e0d1eb1faf18e5f8e861` on `main`

## Goal

Migrate Astra's production coding path so that the actual open-source Cline
workspace source provides the desktop coding-workspace UI and the actual
open-source Codex source provides the autonomous agent/runtime foundation,
while preserving Astra's existing control plane: authentication, model
gateway, credit accounting, plans, Rooms, devices, permissions, billing,
extensions, website, and administration.

The result must have one authoritative production agent path, one authoritative
server-controlled billing path, deterministic Room security below the model,
and auditable source provenance. Missing external credentials may block live
certification, but must not be represented as implementation success.

## Non-goals

- Replacing Electron with Tauri.
- Rebuilding Cline's workspace UI from screenshots or behavior descriptions.
- Reimplementing Codex's agent loop in TypeScript when the upstream runtime can
  be adapted directly.
- Adding BYOK or exposing provider credentials to desktop users.
- Replacing Astra's existing billing, authentication, or Room services with
  parallel systems.
- Publishing macOS/Linux support, live-provider certification, or payment
  certification without evidence.

## Baseline facts

- Desktop shell: Electron 44 with a bundled React/Vite renderer and isolated
  preload.
- Backend: Fastify/TypeScript.
- Persistence: PostgreSQL adapters plus deterministic in-memory test stores.
- Current coding runtime: independent `packages/agent-core`; no Cline or Codex
  source/dependency is currently present.
- Current workspace: independent `packages/workspace` plus desktop adapters.
- Existing commercial and Room foundations: authentication, personal and
  organization billing, remote devices, Room membership/roles/suspension/
  removal/leave, relay protocol, model catalog, MCP/Plugins/Skills, admin,
  website, and Windows packaging.
- Fresh baseline verification on 2026-09-20: `npm.cmd test` passed 77 files and
  221 tests; typecheck, lint, format check, and production build passed.
- The first sandboxed test attempt failed with `spawn EPERM`; the elevated
  rerun passed. This is an environment constraint, not a repository test
  failure.

## Design decisions

### 1. Preserve Electron and the Astra control plane

Electron remains the native shell. The renderer remains bundled into the
installed application and never loads the public Astra website for coding
operations. Native filesystem, process, Git, secure storage, device identity,
deep-link, and window lifecycle behavior remain owned by the existing Astra
main-process adapters.

Astra remains authoritative for authentication, entitlements, reservations,
model selection, provider access, wallet context, Room authorization, and
audit. No upstream UI or runtime may bypass those boundaries.

### 2. Acquire upstream source before integration

The implementation starts by fetching:

- `https://github.com/cline/cline`
- `https://github.com/openai/codex`

The exact resolved commit SHA, repository URL, license files, imported paths,
adaptation patches, and destination paths are recorded in
`docs/source-provenance.md`. The selected commits are immutable inputs to the
build. No source integration work proceeds with an unrecorded floating branch.

The acquisition step also records the current license and notices before any
source is copied or linked. Existing Astra public branding remains Astra AI;
required upstream legal notices remain in the distribution notices.

### 3. Cline UI boundary

Only the workspace presentation and interaction layer is imported/adapted from
Cline. The adapter owns:

- project/file navigation;
- editor and tabs;
- search, problems, output, terminal and diff surfaces;
- agent activity presentation;
- pane sizing and workspace state;
- coding-oriented interaction patterns.

Cline provider setup, account state, API-key configuration, provider billing,
and Cline agent orchestration are excluded. Cline-originated UI dependencies
that directly call a Cline runtime are routed through an Astra Workspace
Bridge instead.

The bridge exposes typed Astra view models and commands rather than leaking
upstream runtime objects into the renderer. Astra branding replaces product
labels without deleting legally required attribution.

### 4. Codex runtime boundary

The exact Codex integration mechanism is selected after inspecting the pinned
upstream repository. The allowed production forms are:

1. a linked/buildable Codex workspace or crate invoked as a controlled local
   runtime; or
2. a vendored, pinned Codex runtime component invoked through a narrow process
   protocol.

The chosen form must put actual Codex source in the build/dependency graph and
must exercise it in an integration test. The adapter must expose only the
operations Astra needs: session/turn lifecycle, tool requests/results,
streaming events, approvals, interruption, cancellation, persistence,
context compaction, and completion status.

`packages/agent-core` is classified during migration. Astra-specific budget,
billing-context, security, verification, and event policy is retained. Any
duplicated autonomous loop, tool router, context manager, patch engine, or
process orchestrator is removed from the authoritative production path after
the Codex adapter is proven. There must be no silent fallback to the old loop.

### 5. Model and billing transport

The production inference path is:

```text
Cline-derived workspace UI
  -> Astra Workspace Bridge
  -> Codex-derived runtime
  -> authenticated Astra backend
  -> entitlement/model validation
  -> personal or Room organization reservation
  -> Vercel AI Gateway
  -> selected provider/model
  -> streamed response and usage
  -> exact settlement and release
  -> runtime events
  -> Workspace Bridge
  -> workspace UI
```

The desktop contains no provider or Gateway secret. Manual model selection is
never silently replaced. Auto is an explicit Astra catalog choice. A Room task
keeps its server-resolved organization billing context for every model call in
the autonomous task.

### 6. Room/project model

Each Room has exactly one primary editable project bound to one authorized
host device and a relative workspace root. Organization membership does not
grant Room access; Room membership and permissions do.

The host remains filesystem authority. Remote members send authorized requests
through Astra and the relay; the host executes local files, commands, Git, and
Codex tools. Canonical-path, reparse-point, UNC, command-policy, secret
redaction, and approval checks remain below the model and below plugins/MCP/
Skills.

### 7. Room Files and imports

Room Files are a separate, controlled storage subsystem. Each upload records
Room, uploader, safe name, MIME/type, size, checksum, intent, quarantine
status, and timestamps.

Supported intents are:

- `REFERENCE`: readable as authorized agent context, never automatically
  written to the primary project.
- `ADD_TO_PROJECT`: quarantined content becomes an explicit import proposal.

An import proposal is inspected, path-validated, conflict-checked, previewed,
permission-checked, and approved before the host runtime writes locally.
ZIP archives are never extracted directly into the project. They are inspected
in quarantine with traversal, size, nesting, symlink/reparse, collision, and
executable-content controls.

### 8. Room security and lifecycle

Room roles remain `VIEWER`, `AGENT_USER`, `EDITOR`, and `ADMIN`, backed by
granular permissions. Suspension immediately invalidates Room authorization,
active sessions, prompts, and tool access while retaining membership metadata;
restore re-enables access without a new invitation. Removal revokes access and
preserves audit history. A last-owner/admin leave is rejected until control is
transferred.

Security events are deterministic records with severity, actor, Room, device,
task, requested resource/action, outcome, and evidence. High-risk events are
blocked and shown to authorized admins. A single LLM classification never
auto-suspends a member.

### 9. Wallet context

The server resolves the billing context; the client cannot select a wallet ID
to authorize spending.

- Personal project: personal wallet.
- Team Room: Team organization wallet.
- Business Room: Business organization wallet.

Usage attribution includes initiating member, organization, Room, host device,
project, task/session/turn, model/provider, raw cost, credits, reservation,
settlement, and timestamp. Personal credits remain unchanged by Room work.

### 10. Completion and autonomy gate

The Codex-derived runtime runs ordinary safe tasks through inspect, tool,
edit, verify, repair, and completion without requiring repeated user
"continue" prompts. Astra adds bounded model/tool/command/time/cost budgets,
runaway detection, cancellation, and a completion gate that evaluates the
requested acceptance criteria against actual verification results.

The UI exposes operational events and concise summaries, not hidden
chain-of-thought. A model assertion of success is insufficient.

### 11. Astra Web Search and Web Fetch

Web research is an Astra-owned tool capability available to the Codex-derived
runtime. It is independent of Cline, Codex login state, browser sessions,
customer API keys, and MCP. The path is:

```text
Codex tool request
  -> Astra tool/policy layer
  -> authentication, Room permission, budget, and billing context
  -> Astra Web Search Service
  -> configured server-side provider
  -> normalized results or sanitized page content
  -> Codex evidence with source metadata
```

`web_search` and `web_fetch` are separate capabilities. Search never grants
arbitrary HTTP access. Browser automation is a separate future capability.
Provider credentials remain server-side and are absent from Electron,
preload, Cline UI, Codex configuration, Room members, and model context.

The provider abstraction exposes normalized search results and sanitized fetch
content rather than provider-specific response objects. Each task has bounded
search count, fetch count, bytes, time, repeated-query, and provider-cost
budgets. Room policy controls `WEB_SEARCH` and `WEB_FETCH`; Room research uses
the same immutable personal or organization billing context as model calls.

Fetched URLs are restricted to public HTTP(S) destinations by default. The
service validates schemes, DNS/IP ranges, redirects, response size, content
type, encoding, and timeouts. It rejects loopback, private/link-local,
metadata, internal DNS, `file:`, `ftp:`, and custom protocols. Retrieved text
and snippets are untrusted data: prompt-injection instructions cannot alter
Astra policy, permissions, wallet context, tools, approvals, or host access.
Search/fetch events include query/URL, source IDs, provider, timestamps,
content hashes where practical, policy decisions, and budget state.

## Migration phases

### Phase 0 — provenance and audit

Fetch and pin the upstream repositories; inspect licenses and build systems;
record source lineage; classify every existing agent/workspace component as
Astra-specific, duplicated, adapter, obsolete, or temporary compatibility.
Generate the 65-feature matrix from actual files, endpoints, schema, auth
rules, and tests.

### Phase 1 — Codex runtime adapter

Add the minimal build/launch boundary around the pinned Codex runtime. Feed it
typed Astra session, model, tool, approval, budget, cancellation, and billing
context. Prove session/turn/tool/interrupt/compaction/completion behavior using
the actual upstream runtime before changing the desktop production path.

### Phase 2 — Astra Workspace Bridge and Cline UI

Import/adapt the selected Cline workspace source into a bounded renderer
package. Replace Cline runtime/provider calls with the Workspace Bridge. Wire
real streamed Codex/Astra events, local workspace commands, approvals, model
state, credit context, diffs, and verification into the imported UI.

### Phase 3 — authoritative-path cutover

Route the desktop's production coding task through Codex → Astra Bridge. Add a
test that proves the old independent Astra loop is not selected. Remove or
isolate conflicting provider/API-key/BYOK paths. Preserve the old code only
where an explicit compatibility adapter or test fixture still needs it.

### Phase 4 — Room Files and project imports

Add the Room File data model, storage abstraction, upload validation,
quarantine, reference context, import preview, host-side write execution,
conflict handling, ZIP inspection, audit events, and UI. Add real authorization
tests for every role and import transition.

### Phase 5 — Room hardening and billing context

Bind the one-primary-project rule to host/device state; harden offline,
revocation, suspension, handoff, workspace serialization, MCP/Plugin/Skill
policy, and organization-wallet reservation/settlement attribution. Add
personal-vs-organization isolation tests across multi-call tasks.

### Phase 6 — verification and release evidence

Run the deterministic suite, upstream-relevant tests, security and billing
tests, agent autonomy benchmark, desktop build/package, provenance checks,
license inventory, and available live certifications. Record blocked external
certifications without promoting them.

### Phase 7 — Web Search and Web Fetch

Add the Astra-owned normalized provider interface, server-only configuration,
SSRF-safe fetcher, content sanitizer, tool policy, Room billing attribution,
bounded research budgets, Workspace Bridge events, source provenance, and
deterministic/live certification harnesses. Search-provider live certification
remains blocked until a real provider configuration is available.

## Error and recovery rules

- Upstream fetch/build failure blocks the corresponding integration; no
  substitute reimplementation is silently accepted.
- Missing live credentials block only the affected live certification.
- Provider failure pauses or fails the task honestly; local edits remain
  recoverable and reservations settle from actual receipts.
- Host offline prevents task start/continuation when local tools are required;
  the UI shows `HOST OFFLINE` and never reports completion.
- Room revocation/suspension cancels or prevents new privileged work and
  preserves audit state.
- Import validation failure leaves the upload quarantined and creates no
  project write.
- Web-search provider failure returns `WEB SEARCH UNAVAILABLE`; no fabricated
  result or external-verification claim is emitted.
- Web fetch rejects unsafe schemes, private destinations, unsafe redirects,
  oversized responses, unsupported content, and invalid policy context before
  content reaches the runtime.
- Completion failure produces `BLOCKED` or `FAILED`, never a model-only
  success.

## Verification strategy

Every migration unit follows test-first development: write a focused failing
test, observe the expected failure, implement the smallest fix, rerun the
focused test, then run the full relevant suite.

Required evidence includes:

- pinned upstream SHAs and license/notice inventory;
- actual Cline-derived workspace module loaded by the desktop renderer;
- actual Codex-derived runtime launched by the production agent path;
- no direct desktop provider credential path and no BYOK UI/API;
- Codex session/turn/tool/cancellation/compaction/completion tests;
- Cline Bridge event/render integration tests;
- Room membership, roles, suspension, removal, leave, offline, and
  one-primary-project tests;
- Room File upload/reference/import/ZIP security tests;
- path, command, reparse-point, MCP, Plugin, and Skill boundary tests;
- personal and organization reservation/settlement attribution tests;
- web-search normalization, fetch sanitization, SSRF/redirect, prompt-injection,
  Room policy, budget, cancellation, provenance, and billing-context tests;
- 65-feature matrix with implementation and test evidence;
- `npm.cmd test`, typecheck, lint, format, build, audit, and
  `git diff --check` results;
- Windows packaging and checksum evidence where the environment supports it;
- external AI/PostgreSQL/Razorpay/Resend/OAuth/relay/signing results marked
  `PASS`, `FAIL`, or `BLOCKED` only from actual runs.

## Release gate

The release verdict is `PRODUCTION READY` only if the exact source SHA and
artifact have no unresolved launch-critical failures and the required upstream
source integrations are proven in the build/runtime graph. Missing external
credentials or infrastructure produce `NOT PRODUCTION READY` with the exact
service marked `BLOCKED`; deterministic mocks do not upgrade that status.

The final report must contain every Feature 1–65 row, source provenance,
runtime path evidence, Room/billing/security evidence, exact test results,
artifact identity, and remaining risks.

It must also report Web Search implementation, Web Fetch implementation,
provider live certification, SSRF tests, Room permission tests,
billing-context tests, and web prompt-injection tests separately.
