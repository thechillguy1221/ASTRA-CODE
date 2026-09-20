# Lyntar threat model

## Scope

This document covers the Windows-local vertical slice: the React renderer, Electron main/preload boundary, local repository, child processes, API process, model gateway, and persistence of task/usage metadata.

## Assets

- User source files and uncommitted work.
- Git history and the distinction between existing and Lyntar-created changes.
- Provider credentials and model request metadata.
- Usage receipts and task identifiers.
- The integrity of commands executed in the selected repository.

## Trust boundaries

1. The renderer is untrusted application content. It can request only typed capabilities.
2. Electron main is trusted to mediate OS capabilities, but is intentionally kept thin so orchestration remains testable outside Electron.
3. `packages/workspace` is the local capability boundary. It authorizes paths and commands before touching the repository or starting a child process.
4. The API is the server-side model boundary. Gateway credentials are not read by the renderer or packaged desktop UI.
5. The model is an untrusted proposer. Its structured decisions are data and must pass agent permissions and workspace policy.

## Threats and controls

| Threat                                                                                                                 | Control                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `..`, alternate separators, case variants, absolute paths, device paths, or UNC paths escape the repository            | Windows normalization, realpath resolution through existing parents, case-insensitive containment with a separator boundary, and rejection of device/absolute relative paths        |
| Symlink or junction points escape after an apparently safe string check                                                | Existing path segments are resolved before authorization; resolved candidates must remain contained in the canonical root                                                           |
| Model executes destructive or shell-injection commands                                                                 | Structured executable/args, `shell: false`, metacharacter rejection, command risk classification, approval for sensitive/destructive commands, and rejection of prohibited patterns |
| Model invokes `git reset --hard`, `git clean`, registry mutation, shutdown, format, or download-and-execute PowerShell | Explicit prohibited command rules                                                                                                                                                   |
| Existing user edits are shown as agent edits                                                                           | Git baseline captures status paths and hashes before the task; final diff classifies pre-existing, mixed, and Lyntar paths                                                          |
| A partial multi-file write corrupts the repository                                                                     | Affected files are snapshotted and written through temporary files; failure rolls back the batch                                                                                    |
| A repair loop consumes unbounded provider spend                                                                        | Model-call, repair, command, wall-time, and cost budgets are checked before work starts                                                                                             |
| User cannot stop a long task                                                                                           | One `AbortSignal` propagates through agent core, model fetch, command child process, verification, and pending permission waits                                                     |
| Hidden model reasoning leaks into the UI or event log                                                                  | Model contract accepts concise structured decisions; events contain summaries, paths, risk/action labels, and bounded results only                                                  |
| Provider returns no usage metadata but the system invents a cost                                                       | Receipt parser returns `null` unless provider-supplied usage/cost fields exist; no fake credit ledger entries are created                                                           |

## Residual risks

- The current desktop permission UI is intentionally minimal and should gain distinct high-risk approval copy before broader distribution.
- The first verifier certifies Node/TypeScript projects; other detected project kinds report verification unavailable until their command adapters are implemented.
- Live provider and PostgreSQL deployment behavior require environment-backed smoke tests; deterministic CI does not prove external service availability.
- Packaging/signing, auto-update, and enterprise policy hardening are outside this milestone.
