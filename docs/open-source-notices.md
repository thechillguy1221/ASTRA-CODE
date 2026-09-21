# Astra Code open-source notices

Astra Code's internal `@astra/*` packages are private and marked `UNLICENSED`.
The desktop renderer incorporates selected Cline SDK UI components from the
pinned Apache-2.0 checkout:

- source repository: https://github.com/cline/cline
- pinned commit: `9a2512bb9835869d74774da99708a7f9d80b0fe8`
- incorporated source paths:
  - `sdk/packages/ui/components/session-status.tsx`
  - `sdk/packages/ui/components/session-status.css`
  - `sdk/packages/ui/components/agent-approval-card.tsx`
  - `sdk/packages/ui/components/agent-approval-card.css`
- Astra destination: `apps/desktop/src/renderer/cline/`
- license: Apache-2.0

The Cline license and source checkout remain under `vendor/upstream/cline`.
The Windows package also includes a readable copy at
`resources/licenses/CLINE-LICENSE`.
The copied/adapted files are tracked in `docs/cline-lineage.md` and
`docs/cline-component-provenance.md`. Cline provider, account, billing, and
autonomous-runtime code are not part of Astra's production path.

The pinned Codex checkout is also Apache-2.0 and remains under
`vendor/upstream/codex`. Its license, NOTICE, selected source paths, build
identity, and runtime artifact are tracked in `docs/source-provenance.md`.

Before distributing an installer, regenerate the complete dependency inventory
from the committed lockfile and installed package metadata:

```text
node scripts/supply-chain-report.mjs
npm audit --json
```

Preserve upstream copyright, license, and NOTICE text in any distribution that
contains derived source or artifacts. Astra Code is independent and does not imply
endorsement by Cline, Codex, or any other upstream project.
