# Testing steering

- New behavior needs a focused failing-path test before implementation when
  practical, then unit and integration evidence at the boundary.
- A green unit suite is not production certification. Record typecheck, lint,
  changed-file formatting, database, security, build, and live evidence
  separately.
- Preserve existing user changes and fixture state. Never weaken or delete a
  failing test to obtain a green result.
