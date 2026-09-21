# Astra Phase 2 Certification Report

Date: 2026-09-20
Scope: live Windows-agent foundation gates and release baseline

## A. Verdict

**WINDOWS AGENT FOUNDATION: CONDITIONALLY CERTIFIED**

The deterministic Windows agent foundation and its security boundaries pass the
available checks. Unconditional certification is blocked because the required
live model credentials and a disposable PostgreSQL certification environment
were not available in this run. No fake live certification was created.

**COMMERCIAL BILLING FOUNDATION: NOT CERTIFIED — NOT STARTED**

Authentication, wallet accounting, plans, Razorpay, and financial administration
remain gated behind live foundation certification, as required.

## B. Release identity

- Branch: `main`
- Version: `0.1.0`
- Commit SHA: recorded by the final post-commit `git rev-parse HEAD` check

## C. Tests and static checks

- Deterministic test files: **29 passed**
- Deterministic tests: **53 passed, 0 failed, 0 skipped**
- Typecheck: **PASS**
- Lint: **PASS**
- Format check: **PASS**
- Production build: **PASS**
- Deterministic golden path: **PASS**
- API `/health`: **PASS**
- Electron shell launch: **PASS** after the initial Electron binary download; no
  load-error output was observed
- Live smoke suite: **2 blocked/skipped, 0 executed live**
- PostgreSQL certification: **blocked before connection by the safety guard**
- `npm audit`: **0 vulnerabilities** across 349 installed dependencies

## D. Live model

**BLOCKED — NOT VERIFIED**

The live suite requires all of the following and none were configured:

- `ASTRA_LIVE_TEST=1`
- `ASTRA_MODEL_GATEWAY_URL`
- `ASTRA_MODEL_GATEWAY_API_KEY`
- `ASTRA_MODEL_ID`

Therefore this run has no real model, provider route, gateway request ID,
usage receipt, or actual provider cost to report. The suite does not fall back to
the fake model when live certification is requested.

## E. Live bounded repair

**BLOCKED — NOT VERIFIED**

The real two-call repair workflow was not run because the live gateway was not
configured. No live model calls or live cost were counted.

The deterministic bounded-repair path remains covered by the passing test
suite, including repair limits, failure feedback, re-verification, and usage
aggregation behavior.

## F. Live cancellation

**BLOCKED — NOT VERIFIED**

Live stream cancellation was not run without a real gateway. The deterministic
implementation and tests cover propagation through the agent task, pending tool
execution, command cancellation, and terminal task state. A live provider cost
receipt therefore cannot be claimed for this run.

## G. PostgreSQL

The migration and certification harness exist, including migration locking,
receipt/event uniqueness, transaction rollback checks, persistence checks,
ledger immutability triggers, concurrency checks, and backup/restore workflow.

The following were **not verified** in this environment:

- connectivity and server-version validation;
- fresh migration against an empty real database;
- restart/idempotent migration;
- transaction rollback against a real server;
- concurrent duplicate receipt/event behavior;
- persistence after backend restart;
- backup and restore.

The certification runner is deliberately guarded by
`ASTRA_POSTGRES_CERTIFY=1` and requires a disposable certification database;
it reported `BLOCKED` without making a database connection. `psql`,
`pg_isready`, `pg_dump`, and `pg_restore` were unavailable, and Docker Desktop’s
Linux daemon was not running.

## H. Windows security

The passing security coverage includes:

- traversal and mixed-separator rejection;
- case-insensitive canonical containment;
- symlink and directory-junction checks;
- root replacement detection;
- UNC, extended/device path, reserved-name, and alternate-data-stream checks;
- command paths outside the workspace;
- safe, sensitive, destructive, and prohibited command classification;
- bounded stdout/stderr capture and truncation metadata;
- process-tree cancellation behavior.

Canonical paths are revalidated immediately before sensitive operations. A
hostile external junction race was not independently certified on a live
Windows adversarial setup in this run.

## I. npm audit and supply chain

The initial audit findings were investigated and remediated through reviewed
dependency upgrades; `npm audit --json` now reports zero critical, high,
moderate, or low vulnerabilities. The resolved dependency families included
Electron/extract-zip, Vitest, and Vite’s Windows dev-server chain.

Direct dependency and license inventory generation is available through
`node scripts/supply-chain-report.mjs`. Internal packages are marked
`UNLICENSED`; no credentials are included in the inventory or environment
example.

## J. Git

- `git diff --check`: **PASS**
- Release baseline: clean after the final commit; exact SHA is reported with
  the release identity below.
- No SHA is inferred or fabricated.

## K. Wallet and billing

Not implemented in this phase because the live Windows foundation did not reach
unconditional certification. No fake wallet transactions, reservations,
settlements, or credits were created.

## L. Razorpay

Not started. Sandbox, live, webhook, idempotency, subscription, and refund
flows are all **NOT TESTED**.

## M. Known risks and deferred gates

- Real model integration, live bounded repair, live cancellation, and real usage
  receipts remain unverified until gateway credentials are supplied.
- PostgreSQL production-like migration, transaction, concurrency, durability,
  and restore certification remain unverified until disposable database and
  restore targets are supplied.
- Windows code signing, installer distribution, and production update delivery
  are not part of this certification run.
- Authentication and all commercial accounting remain intentionally deferred.
- No public website, marketplace, MCP, Skills, Plugins, or other deferred
  product surface was added.
