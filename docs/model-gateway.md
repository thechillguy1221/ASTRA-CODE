# Model gateway

## Boundary

`packages/model-gateway` owns provider-specific HTTP details. `apps/api` owns the authenticated server route and catalog lookup but does not construct provider payloads or parse provider usage.

The current adapter targets a Vercel AI Gateway-compatible endpoint using:

```text
POST {LYNTAR_MODEL_GATEWAY_URL}/chat/completions
Authorization: Bearer <server-only key>
```

It requests streaming structured JSON, includes usage in the stream, normalizes one `ModelDecision`, emits a provider request ID when available, and emits a `UsageReceipt` only when provider-supplied usage or cost metadata is trustworthy. The desktop calls `POST /v1/model-requests`; the API consumes the provider stream and returns the normalized decision plus receipt.

## Server-controlled catalog

`GET /v1/models` returns enabled catalog entries containing:

- `modelId`: stable Lyntar identifier used by tasks.
- `displayName`: user-facing name.
- `gatewayModelId`: provider route selected by the server.
- `providerSlug`, `enabled`, and capability flags.

The desktop displays this response and sends the selected `modelId` back to the API. It does not hard-code a model name or provider route.

## Request and decision contract

Requests carry `requestId`, `taskId`, `modelId`, and bounded conversation messages. Decisions are one of `message`, `readFile`, `search`, `patch`, `command`, or `finish`. The agent runtime still authorizes every read, patch, and command; a valid model response is not permission to execute it.

## Usage receipts

Receipts persist:

```text
request_id, task_id, model_id, provider_route,
input_tokens, output_tokens, cache_tokens,
actual_cost_usd, received_at
```

The PostgreSQL migration enforces unique request IDs. In-memory stores are used by deterministic tests. No wallet or credit transaction is fabricated when a provider omits cost metadata.

## Live smoke policy

`npm run test:live` is opt-in and requires `LYNTAR_LIVE_TEST=1`, `LYNTAR_MODEL_GATEWAY_URL`, `LYNTAR_MODEL_GATEWAY_API_KEY`, and `LYNTAR_MODEL_ID`. Missing configuration is reported as `BLOCKED`. A failed request or missing provider usage is `UNVERIFIED`; it is never reported as a successful live certification.
