# Architecture steering

- Preserve existing Astra package boundaries and server-authoritative policy.
- Keep orchestration decisions in a replaceable domain package; Electron is a
  capability adapter, not the source of policy.
- Prefer append-only evidence, optimistic versions, idempotency, and explicit
  failure states over inferred UI state.
- Repository content remains on the authorized execution target unless the
  user explicitly approves a safe handoff.
