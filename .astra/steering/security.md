# Security steering

- Client controls are presentation only; every privileged capability is
  enforced at the server or execution boundary.
- Never log or persist secrets, tokens, credentials, or raw provider payloads
  containing them.
- Do not run arbitrary shell strings. Use structured argv and canonicalize
  filesystem paths before access.
- Treat organization, Room, device, worktree, and billing context as explicit
  isolation boundaries.
- Destructive Git, database, deployment, and production actions require an
  explicit policy decision and a durable audit event.
