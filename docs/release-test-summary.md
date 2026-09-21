# Astra Code Release Candidate Test Summary

Release candidate: astra-code-v0.1.0-rc2
Build source commit: e01c71ee786726373e3a407144dcfc103bacc432
Previous certified implementation commit: 13e489f4f27ee6cce192133e26940dce627e3315
Historical installer SHA-256: D7D10ECACA66B9AC8B3D651B745777F8CA3AA7E13A3C504579F9C3E554233D0E
Historical installer status: NOT VALID FOR CURRENT SOURCE — fresh packaging from the build source was blocked by host resource/allocation and Codex resource-copy failures.

## Deterministic gates

- npm.cmd test: PASS, 87 files, 280 tests
- npm.cmd run typecheck: PASS
- npm.cmd run lint: PASS
- npm.cmd run format:check: PASS
- npm.cmd run verify:source-provenance: PASS
- npm.cmd run build:packages: PASS
- npm.cmd run build: PASS
- npm.cmd audit --omit=dev: PASS, 0 vulnerabilities
- node scripts/verify-codex-runtime-artifact.mjs: PASS
- npm.cmd run certify:codex-runtime: PASS, real initialize and thread/start
- npm.cmd run package:win:unsigned: BLOCKED — first attempt failed with `Array buffer allocation failed`/host resource exhaustion; retry failed with Windows `0xC00000FD` during renderer build; direct packager retry failed copying the Codex executable with `UNKNOWN`.
- production configuration guard: PASS — production now fails closed when Gateway, database, runtime token, Razorpay, Resend, OAuth, public-origin, or relay configuration is absent.

## Focused implementation evidence

Room/project, Room Files, import, membership, billing-context, security-event, and binary-write regression coverage: PASS, 7 files and 27 tests.

## Not certified live

Live Astra Gateway/model turns, model-driven Codex tools and approvals, PostgreSQL, Razorpay, Resend, Google OAuth, staging relay, two-device execution, trusted signing, current-source installer, clean Windows install, and updater.
