# Agent state machine

Task states are explicit and transitions are validated by `packages/contracts`. Terminal states cannot transition to another state.

```text
CREATED → ANALYZING → PLANNING → EXECUTING → VERIFYING → COMPLETED
                                      │             │
                                      │             └→ REPAIRING → EXECUTING
                                      │
                                      └→ WAITING_FOR_PERMISSION → EXECUTING
```

Any active state can terminate as `CANCELLED`, `FAILED`, or `BLOCKED` when the corresponding condition occurs. Verification failure enters `REPAIRING` only when repair and model budgets remain. Unsupported verification becomes `BLOCKED`, not a false pass.

## States

- `CREATED`: task accepted but not started.
- `ANALYZING`: initial task/repository work is being prepared.
- `PLANNING`: the agent is requesting bounded model decisions.
- `WAITING_FOR_PERMISSION`: a sensitive action is waiting for the user.
- `EXECUTING`: a read, patch, or approved command is running.
- `VERIFYING`: the detected project verification command is running.
- `REPAIRING`: a failed verification is being addressed within budget.
- `COMPLETED`: verification passed and a result was assembled.
- `FAILED`: an unexpected non-cancellation error stopped the task.
- `CANCELLED`: the user or caller aborted the task.
- `BLOCKED`: the task cannot safely continue, including exhausted budgets or unavailable verification.

## Append-only events

The event log is the renderer's source of progress. Events use an ID, task ID, timestamp, discriminated type, and concise safe payload. Typical events include `task.started`, `model.requested`, `model.completed`, `tool.requested`, `permission.requested`, `permission.granted`, `file.read`, `patch.applied`, `command.started`, `command.completed`, `verification.started`, `verification.failed`, `repair.started`, `verification.completed`, and one terminal event.

Source contents, credentials, full command output, and hidden reasoning are not event payloads. Verification output is bounded before being included in a failure summary sent to the model.
