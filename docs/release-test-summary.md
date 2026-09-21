# Astra Code Release Candidate Test Summary

Release candidate: astra-code-v0.1.0-rc2
Source commit: 13e489f4f27ee6cce192133e26940dce627e3315 (implementation/artifact source state)
Installer SHA-256: D7D10ECACA66B9AC8B3D651B745777F8CA3AA7E13A3C504579F9C3E554233D0E

## Deterministic gates

- npm.cmd test: PASS, 87 files, 278 tests
- npm.cmd run typecheck: PASS
- npm.cmd run lint: PASS
- npm.cmd run format:check: PASS
- npm.cmd run verify:source-provenance: PASS
- npm.cmd run build:packages: PASS
- npm.cmd run build: PASS
- npm.cmd audit --omit=dev: PASS, 0 vulnerabilities
- node scripts/verify-codex-runtime-artifact.mjs: PASS
- npm.cmd run certify:codex-runtime: PASS, real initialize and thread/start
- npm.cmd run package:win:unsigned: PASS

## Focused implementation evidence

Room/project, Room Files, import, membership, billing-context, security-event, and binary-write regression coverage: PASS, 7 files and 27 tests.

## Not certified live

Live Astra Gateway/model turns, model-driven Codex tools and approvals, PostgreSQL, Razorpay, Resend, Google OAuth, staging relay, two-device execution, trusted signing, clean Windows install, and updater.
