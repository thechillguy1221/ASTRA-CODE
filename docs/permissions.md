# Workspace permissions

The model proposes structured actions. It never receives a generic shell function or unrestricted filesystem API. Agent core asks `PermissionPort` before each capability action, and command execution applies the policy again at the `CommandPort` boundary.

## Actions

- `readFile`: read one workspace-relative file.
- `search`: search files within the selected workspace.
- `patch`: apply an atomic batch of workspace-relative file writes.
- `command`: run a structured executable with an argument array and workspace-relative working directory.

## Command risk classes

| Class         | Examples                                                                                                                                                                                    | Runtime behavior                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `safe`        | `node`, `npm test`, `pytest`, read-only Git inspection                                                                                                                                      | Execute inside the canonical workspace after policy validation            |
| `sensitive`   | unrecognized executables, `cmd.exe`, package publish/install-like actions, mutating Git actions                                                                                             | Ask for user approval before execution                                    |
| `destructive` | policy-classified high-impact operations                                                                                                                                                    | Require explicit approval; the command runner still validates the request |
| `prohibited`  | `rm`, `rmdir`, `del`, `format`, `shutdown`, registry mutation, `git reset --hard`, `git clean`, PowerShell download-and-execute, shell metacharacters, absolute/outside-workspace arguments | Reject; approval cannot override the policy                               |

On Windows, npm-family commands are launched through `cmd.exe /d /s /c` with shell metacharacters rejected before launch. Other commands use `spawn` with `shell: false`. Output is capped and child processes receive the task abort signal.

## Approval lifecycle

1. Agent core emits `permission.requested` with a request ID and action kind.
2. Task state becomes `WAITING_FOR_PERMISSION`.
3. The renderer shows a concise approval prompt.
4. Approval or rejection returns through typed IPC.
5. The task returns to `EXECUTING`, or the action is denied. Cancellation resolves a pending approval as cancelled.

File reads, searches, and atomic patches in the selected workspace are currently treated as allowed local capabilities. This is a development entitlement mode, not commercial billing authorization.
