# Astra Web Search and Web Fetch

Astra web research is a server-owned capability. The Codex runtime requests
`web_search` or `web_fetch` through Astra; it never receives a search-provider
credential and it never gets unrestricted network access.

The current path is:

```text
Codex runtime
  -> Astra runtime/tool policy
  -> authenticated Astra Web Research API
  -> Room/personal authorization and task budget
  -> configured search provider or controlled public-page fetch
  -> normalized, provenance-bearing, untrusted evidence
  -> Codex runtime
```

## Implemented boundaries

- `packages/web-research` owns provider normalization, task budgets, source
  provenance, usage records, public HTTP(S) fetches, redirect validation, and
  untrusted-content sanitization.
- `POST /v1/web/search` and `POST /v1/web/fetch` require an authenticated Astra
  session.
- A Room request is authorized with `web.search` or `web.fetch` on the server.
  Viewer members do not receive either permission by default.
- The server resolves personal versus organization billing context from the
  authenticated user and Room. Clients cannot select a wallet ID.
- The context is immutable for a task. Room authorization is checked again
  before returning provider/page results so suspension or removal cannot turn a
  stale request into authorized output.
- Search results and fetched pages are marked as untrusted evidence. Page
  scripts, styles, comments, executable content, unsupported schemes, and
  private/internal destinations are not passed through as executable behavior.
- Search and page-fetch budgets are enforced outside the model, including
  search count, repeated-query count, page count, byte count, fetch size,
  redirects, and research time.
- Provider failures return `WEB_SEARCH_UNAVAILABLE`/`WEB_PROVIDER_FAILED`; no
  deterministic result is substituted for a missing live provider.

## Provider status

`UnavailableWebSearchProvider` is the default API provider. A server-side
`HttpWebSearchProvider` adapter exists for a configured provider and keeps its
credential inside the API process. No search-provider credential is bundled in
the Electron application or renderer. A live provider certification requires a
real configured staging provider and remains separate from the deterministic
unit and API tests.

## Security model

`web_fetch` allows only public `http` and `https` URLs. It rejects credentials in
URLs, localhost, loopback, private/link-local/metadata ranges, internal host
names, unsupported protocols, private redirect targets, unsupported content
types, and responses above the configured byte limits. DNS answers are checked
before each request and redirect.

Retrieved content is data, not policy. It cannot grant filesystem, terminal,
Room, billing, approval, or account permissions. Browser automation, credentialed
browser sessions, arbitrary HTTP clients, and local-network access are separate
capabilities and are not enabled by these tools.
