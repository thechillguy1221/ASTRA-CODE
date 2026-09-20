# Astra AI Cline lineage audit

Audit date: 2026-09-20

The current repository does not contain the Cline SDK/Core or copied Cline source. The repository-wide audit found no `@cline/sdk`, `@cline/core`, Cline agent-loop import, or Cline source directory in the workspace packages or lockfile. The `/compare/cline` public page is competitor content and is not evidence of code reuse.

| Astra component            | Verified upstream Cline component | Astra boundary                                                   | Modified upstream source | License obligation             |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------- | ------------------------ | ------------------------------ |
| `packages/agent-core`      | None found                        | `AgentTaskRunner`, ports, budgets, state machine, events         | No                       | No Cline obligation identified |
| `packages/workspace`       | None found                        | canonical Windows paths, patching, Git isolation, command policy | No                       | No Cline obligation identified |
| `packages/model-gateway`   | None found                        | gateway request/stream/receipt normalization                     | No                       | No Cline obligation identified |
| `packages/mcp`             | None found                        | Astra MCP registry and permissions                               | No                       | No Cline obligation identified |
| `packages/remote-protocol` | None found                        | device/Room protocol and authorization                           | No                       | No Cline obligation identified |
| `apps/desktop`             | None found                        | Electron adapter and typed capability IPC                        | No                       | No Cline obligation identified |

The product therefore owns the agent abstractions rather than wrapping a Cline runtime. This is a lineage finding, not a recommendation to rewrite the working agent. If a future change adopts Cline code, pin the exact upstream commit, preserve the applicable notices, record modifications, and review the current license before merging it.

Reproducible checks:

```text
rg -ni "cline|@cline" apps packages tests package.json package-lock.json
node scripts/supply-chain-report.mjs
npm audit --json
```

No public claim says Astra is affiliated with or endorsed by Cline.
