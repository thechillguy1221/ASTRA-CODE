# Astra AI Cline lineage audit

Audit date: 2026-09-20

Astra uses a pinned, selected subset of the Cline SDK UI as a presentation
foundation. The integration is deliberately limited to agent interaction
components; Astra does not instantiate the Cline agent loop, provider handlers,
account state, or billing flows.

| Astra component                                           | Verified upstream Cline component                                     | Astra boundary                                                                 | Source classification         | License obligation                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------- |
| `apps/desktop/src/renderer/cline/session-status.tsx`      | `sdk/packages/ui/components/session-status.tsx`                       | `AstraClineSessionStatus` maps Astra event state to the Cline status component | MODIFIED-UPSTREAM/VENDORED UI | Apache-2.0 attribution and source notice retained    |
| `apps/desktop/src/renderer/cline/agent-approval-card.tsx` | `sdk/packages/ui/components/agent-approval-card.tsx`                  | `AstraClineApprovalCard` supplies Astra permission callbacks and labels        | MODIFIED-UPSTREAM/VENDORED UI | Apache-2.0 attribution and source notice retained    |
| `apps/desktop/src/renderer/cline/*.css`                   | `sdk/packages/ui/components/{session-status,agent-approval-card}.css` | Astra-compatible styling and token fallbacks                                   | MODIFIED-UPSTREAM/VENDORED UI | Apache-2.0 attribution and source notice retained    |
| `apps/desktop/src/renderer/cline-workspace.tsx`           | Cline SDK UI component contracts                                      | Typed renderer-only adapter                                                    | ASTRA-ADAPTER                 | No additional upstream code beyond selected UI files |
| `packages/agent-core`                                     | No Cline runtime component                                            | Existing Astra compatibility/runtime code; not selected as Cline authority     | ASTRA-NATIVE                  | No Cline runtime dependency                          |
| `packages/workspace`                                      | No independently owned Cline IDE primitive                            | Windows paths, patching, Git isolation, command policy                         | ASTRA-NATIVE                  | No Cline runtime dependency                          |
| `packages/model-gateway`                                  | Cline provider flows excluded                                         | Astra Gateway request/stream/receipt normalization                             | ASTRA-NATIVE                  | No Cline provider/billing dependency                 |
| `packages/remote-protocol`                                | Cline remote flows excluded                                           | Astra device/Room protocol and authorization                                   | ASTRA-NATIVE                  | No Cline remote dependency                           |

Pinned upstream: `https://github.com/cline/cline`, commit
`9a2512bb9835869d74774da99708a7f9d80b0fe8`, tree
`79cd0f11e55ebbf11da424afa482f003b1e0bed2`.

The Cline SDK UI source is incorporated into the production renderer through
the copied component modules and the `AstraCline*` adapter. The current build
does not import `sdk/packages/ui/components/agent-chat/index.tsx` because that
surface has broader Tailwind/Radix/runtime coupling; the provenance matrix
records it as a future adapter boundary rather than claiming it is integrated.

The following paths are intentionally excluded from Astra's production path:

- `sdk/packages/core/`
- `sdk/packages/agents/`
- `sdk/packages/llms/`
- Cline provider/account/billing settings
- Cline autonomous agent execution

Reproducible evidence:

```text
npm.cmd run build:renderer --workspace @astra/desktop
node scripts/verify-source-provenance.mjs
```

Astra AI is independent and does not imply endorsement by Cline.
