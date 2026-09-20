# Authentication and billing boundaries

Authentication is owned by `packages/auth`. The API owns sessions and device records. The renderer receives only the public user; access and refresh tokens remain in the Electron main process and are stored through Electron `safeStorage` in production.

Billable execution follows:

1. Authenticate the user on the API.
2. Check the server plan and model entitlement.
3. Reserve the task ceiling transactionally.
4. Require the reservation ID on authenticated model requests.
5. Aggregate every request receipt at task completion.
6. Settle actual customer cost and release unused reservation.

`1 Astra Credit = $0.01` of billable model usage. Credit amounts are represented as fixed-precision decimal text at the API boundary. PostgreSQL uses numeric columns; in-memory deterministic tests use bigint-backed arithmetic. Floating point is not the financial source of truth.

The provider cost, customer-billable cost, and absorbed cost are distinct. An internal failure can therefore be recorded without rewriting provider usage history.

The default `buildApi()` test harness enables development entitlement mode. The long-running API server reads `LYNTAR_DEVELOPMENT_ENTITLEMENT`, which defaults to disabled. A production authenticated task must present a valid reservation header.
