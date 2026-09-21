# Astra project control

`.astra` is the repository-local source for durable project steering and
human-reviewed Specs. It is intentionally separate from generated agent logs.

## Precedence

1. Security and repository policy are authoritative.
2. `AGENTS.md` files apply to their directory subtree.
3. `.astra/steering/*.md` applies by declared scope and task relevance.
4. A Spec's accepted requirements constrain execution until an explicit,
   reviewed Spec revision is recorded.
5. User instructions for the current task override lower-priority guidance
   unless doing so would violate a security or repository policy.

Secrets, credentials, access tokens, and unreviewed model guesses must not be
stored here. Durable corrections must identify their provenance.

## Spec layout

Each persisted Spec may be exported for review under `.astra/specs/<slug>/`:

- `requirements.md`
- `design.md`
- `tasks.md`
- `verification.md`
