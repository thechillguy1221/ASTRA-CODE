# Astra Code Release Candidate Test Summary

Release candidate: astra-code-v0.1.0-rc2
Source commit: recorded after the implementation commit
Installer SHA-256: F30AC3D22DDCA82DEAA6923E3DE1D3FBBB09B1BC93E9A64C9F46F9035F7C5169

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
