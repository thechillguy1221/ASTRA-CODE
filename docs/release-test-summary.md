# Astra Code Release Candidate Test Summary

Release candidate: astra-code-v0.1.0-rc2
Build source commit: b70bdc2519923a191a9bc1824a4eaf20c6ea6938
Previous certified implementation commit: 13e489f4f27ee6cce192133e26940dce627e3315
Current installer: Astra-Code-0.1.0-win-x64-unsigned.exe
Current installer bytes: 166059218
Current installer SHA-256: FF3F5DDAA3DFD492EA09132377B9EB58A8688FAE2272A0DF7D1E68AC0F1F9D5B
Current installer status: PASS_UNSIGNED_LOCAL_CERTIFICATION — trusted signing and clean-machine certification remain external.

## Deterministic gates

- npm.cmd test: PASS, 89 files, 288 tests
- npm.cmd run typecheck: PASS
- npm.cmd run lint: PASS
- npm.cmd run format:check: PASS
- npm.cmd run verify:source-provenance: PASS
- npm.cmd run build:packages: PASS
- npm.cmd run build: PASS
- npm.cmd audit --omit=dev: PASS, 0 vulnerabilities
- node scripts/verify-codex-runtime-artifact.mjs: PASS
- npm.cmd run certify:codex-runtime: PASS, real initialize and thread/start
- npm.cmd run package:win:unsigned: PASS — fresh unsigned installer built from `b70bdc2519923a191a9bc1824a4eaf20c6ea6938`.
- production configuration guard: PASS — production now fails closed when Gateway, database, runtime token, Razorpay, Resend, OAuth, public-origin, or relay configuration is absent.

## Focused implementation evidence

Room/project, Room Files, import, membership, billing-context, security-event, and binary-write regression coverage: PASS. Model/config/email/catalog regression coverage: PASS, 6 files and 18 tests.

## Not certified live

Live Astra Gateway/model turns, model-driven Codex tools and approvals, PostgreSQL, Razorpay, Resend, Google OAuth, staging relay, two-device execution, trusted signing, current-source installer, clean Windows install, and updater.
