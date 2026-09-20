# Astra upstream source provenance

This document is the machine-readable source-of-truth for the pinned upstream
repositories used by the Astra migration. A checkout being present under
`vendor/upstream` proves acquisition only; it does not by itself prove that a
component is in Astra's production dependency or runtime graph. Integration
status is recorded explicitly below and must be upgraded only with build and
runtime evidence.

## Cline

- `CLINE_REPOSITORY_URL`: https://github.com/cline/cline
- `CLINE_SOURCE_SHA`: `9a2512bb9835869d74774da99708a7f9d80b0fe8`
- `CLINE_TREE_SHA`: `79cd0f11e55ebbf11da424afa482f003b1e0bed2`
- `CLINE_LICENSE`: Apache-2.0
- `CLINE_LICENSE_SHA256`: `F704446A5F1271608805598B557E4288CF8580477EA038C9C3D8B361F693F6B8`
- `CLINE_ACQUISITION_PATH`: `vendor/upstream/cline`
- `CLINE_ACQUISITION_STATUS`: `PINNED_CHECKOUT_ACQUIRED`
- `CLINE_PRODUCTION_INTEGRATION_STATUS`: `PENDING`
- `CLINE_SELECTED_SOURCE_PATHS`:
  - `sdk/packages/ui/components/agent-chat/index.tsx`
  - `sdk/packages/ui/components/agent-chat/agent-chat.css`
  - `sdk/packages/ui/components/agent-chat/tool-diff.tsx`
  - `sdk/packages/ui/components/agent-chat/tool-summary/`
  - `sdk/packages/ui/components/agent-approval-card.tsx`
  - `sdk/packages/ui/components/agent-approval-card.css`
  - `sdk/packages/ui/components/session-status.tsx`
  - `sdk/packages/ui/components/session-status.css`
  - `sdk/packages/ui/components/markdown.ts`
  - `sdk/packages/ui/components/markdown.css`
  - `sdk/packages/ui/components/index.ts`
- `CLINE_ASTRA_DESTINATION_PATHS`: `packages/cline-workspace-ui/` (planned)
- `CLINE_INTEGRATION_METHOD`: `ADAPT_SELECTED_UI_SOURCE_THROUGH_ASTRA_WORKSPACE_BRIDGE`
- `CLINE_RUNTIME_AUTHORITY`: `NONE`
- `CLINE_PROVIDER_AUTHORITY`: `NONE`
- `CLINE_BILLING_AUTHORITY`: `NONE`
- `CLINE_EXCLUDED_RUNTIME_PATHS`:
  - `sdk/packages/core/`
  - `sdk/packages/agents/`
  - `sdk/packages/llms/`
  - `apps/cli/`
  - `apps/examples/desktop-app/`

## Codex

- `CODEX_REPOSITORY_URL`: https://github.com/openai/codex
- `CODEX_SOURCE_SHA`: `5c5308fc9a9ee789049d646ef11e5400384b9c6f`
- `CODEX_TREE_SHA`: `4557e77bc256683fc29b6e2026b21dd72eb99674`
- `CODEX_LICENSE`: Apache-2.0
- `CODEX_LICENSE_SHA256`: `AA5E89EDCBBD01FC3FB188A527D8BDC0DA5812305CAB220C84348C14EA427288`
- `CODEX_NOTICE_SHA256`: `3C505DC54BE731583470EF3584E5CB96D60DF7ADD3E7E36294CF4DEA8316A5CB`
- `CODEX_ACQUISITION_PATH`: `vendor/upstream/codex`
- `CODEX_ACQUISITION_STATUS`: `PINNED_CHECKOUT_ACQUIRED`
- `CODEX_PRODUCTION_INTEGRATION_STATUS`: `PENDING`
- `CODEX_SELECTED_SOURCE_PATHS`:
  - `codex-rs/app-server/src/`
  - `codex-rs/app-server-client/src/`
  - `codex-rs/app-server-protocol/src/`
  - `codex-rs/app-server-transport/src/`
  - `codex-rs/core/src/`
  - `codex-rs/exec/src/`
  - `codex-rs/ext/web-search/src/`
- `CODEX_ASTRA_DESTINATION_PATHS`: `packages/codex-runtime/` (planned)
- `CODEX_INTEGRATION_METHOD`: `PINNED_CODEX_APP_SERVER_OR_CONTROLLED_BUILT_COMPONENT_WITH_TYPED_SUPERVISOR`
- `CODEX_PROTOCOL_FINGERPRINT`: `PENDING_TASK_2`
- `CODEX_RUNTIME_AUTHORITY`: `PENDING_TASK_6`
- `CODEX_PROVIDER_AUTHORITY`: `NONE_IN_DESKTOP`
- `CODEX_BILLING_AUTHORITY`: `NONE`

## Legal and redistribution obligations

- Both upstream repositories declare Apache-2.0 licensing at the pinned commits.
- The upstream license files remain in their acquired source trees and must be
  redistributed with any selected source or artifact derived from it.
- Codex's pinned checkout includes a NOTICE file with Ratatui attribution; that
  notice must remain available in any Astra distribution containing the relevant
  Codex-derived work.
- Modified upstream files must receive prominent modification notices before
  redistribution. Astra adapters are tracked separately from copied upstream
  files.
- Cline and Codex names/trademarks are used here only for source attribution and
  provenance; Astra does not imply endorsement and does not expose upstream
  account/provider experiences to Astra users.

## Status rule

`PINNED_CHECKOUT_ACQUIRED` is not an integration certification. Task 2 and Task
5 must update this document with actual Astra destination paths, build-graph
evidence, runtime evidence, and tests before the corresponding integration can
be reported as PASS.
