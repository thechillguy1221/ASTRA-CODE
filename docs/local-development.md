# Local development

The repository uses npm workspaces and a strict TypeScript project-reference build.

## Commands

- `npm test` runs deterministic unit, integration, security, and golden-path tests.
- `npm run typecheck` validates all workspace project references.
- `npm run build` builds each workspace that exposes a build script.
- `npm run lint` runs the repository ESLint configuration.
- `npm run golden-path` runs the deterministic Windows-oriented broken Node repository workflow and reports state, verification, receipts, and diff ownership without source dumps.
- `npm run build --workspace @lyntar/desktop` followed by `npm run start --workspace @lyntar/desktop` starts the Electron shell. Start the API separately with `npm run dev:api` when a configured model gateway is available.
- `npm run test:live` runs only when `LYNTAR_LIVE_TEST=1` and Gateway credentials/model configuration are present.
- `LYNTAR_POSTGRES_CERTIFY=1 npm run certify:postgres` runs the real PostgreSQL migration, persistence, idempotency, rollback, ledger, and backup/restore checks only against a disposable database when `LYNTAR_DATABASE_URL`, `LYNTAR_POSTGRES_RESTORE_URL`, `pg_dump`, and `pg_restore` are available; without the explicit opt-in it exits `BLOCKED` without connecting.
- With the web server running on port 5173, `python scripts/browser-smoke.py` exercises public routes, CTA navigation, metadata, and responsive overflow in any installed Playwright browser. Use the repository's `webapp-testing` server wrapper or start Vite with `node_modules/.bin/vite.cmd --host 127.0.0.1 apps/web`.
- `npm run package:win:unsigned` creates a reproducible unsigned Windows x64 NSIS artifact. `npm run package:win` is the signed pipeline and requires release signing credentials/host policy.

## Environment

The backend reads server-side model credentials. They must not be copied into the Electron renderer or packaged desktop binary. `LYNTAR_DATABASE_URL` points to PostgreSQL for real receipt/event persistence. `LYNTAR_POSTGRES_RESTORE_URL` must identify a separate disposable restore database; deterministic tests inject in-memory stores.

## Scope

The repository now contains deterministic web, identity, billing, extensions, modes, and remote
boundaries for the Astra release candidate. External certification remains separate: live Gateway,
PostgreSQL, OAuth, Resend, Razorpay, relay staging, and code signing must not be inferred from
deterministic adapters.
