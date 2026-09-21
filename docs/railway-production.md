# Railway production deployment

The repository contains the API service deployment contract in `railway.toml`.
It builds the monorepo, runs the migration runner before deploy, starts the
Fastify API, and uses `/ready` for dependency-aware readiness. `/health` is
process liveness only.

## Service shape

- `astra-api`: the server-side API, control plane, billing, Room and
  orchestration boundary.
- `astra-worker`: a private worker service using `node apps/api/dist/worker.js`.
  It claims durable PostgreSQL jobs and scheduled automation occurrences with
  leases, renewal, stale-lease recovery, cancellation and retry bounds. It
  must not receive provider keys or renderer credentials.
- Railway PostgreSQL: referenced through `DATABASE_URL` (the application also
  accepts `ASTRA_DATABASE_URL` for existing deployments).
- The web and admin bundles are built by the monorepo release pipeline. They
  are not silently advertised as live services until their Railway services
  and public domains are actually linked and smoke-tested.

The worker is an execution-plane coordinator, separate from the API process.
Its executor integration is deliberately fail-closed: a deployment without a
trusted isolated executor records a durable failure rather than marking user
work successful. A future executor must be a private service with an explicit
allow-list, scoped credentials, bounded filesystem/network access and no access
to API, admin or billing secrets.

## Required production variables

The production configuration guard in `packages/config` remains authoritative.
Required names include database, model gateway, runtime token, secure cookies,
Razorpay, email, public origin, OAuth, and relay configuration. Values must be
entered as Railway secrets or service references; no values belong in this
repository.

## Deployment sequence

```text
railway login
railway link
railway variables set ...        # non-secret values only; secrets use Railway UI/CLI secret flow
railway up
railway domain                  # capture generated domains after deployment
curl https://<api-domain>/health
curl https://<api-domain>/ready
```

Do not run `railway up` against an unreviewed project. The CLI must report the
correct project and environment first. Live smoke certification requires the
actual generated URLs and safe credentials; local tests and mocked provider
tests are not substitutes.
