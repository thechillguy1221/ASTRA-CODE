# Astra Code Release Certification — 2026-09-21

## Goal

Close locally actionable release blockers from `docs/migration-certification.md`, certify every available production-equivalent path with real evidence, and leave external credential/infrastructure blockers explicit.

## Plan

1. Audit the current certification report, runtime configuration, payment routes, database certification, relay, packaging, and release scripts.
2. Add focused failing tests for any production-safety or missing-path defects found during the audit; implement the smallest compatible fixes.
3. Run available deterministic and production-equivalent checks, including wallet concurrency, provenance, dependency audit, build, Codex artifact/runtime, and packaging checks.
4. Attempt each live certification only when its required infrastructure and credentials are actually available; record precise blockers otherwise.
5. Rebuild the final artifact after source changes, record its identity, update the release manifest/test summary/certification report, and verify the final tree and artifact hashes.

## Evidence policy

- Mocks and in-memory stores certify deterministic behavior only.
- Live provider, PostgreSQL, relay, clean-machine, and trusted-signing claims require real execution evidence.
- Production configuration must fail closed for required services rather than silently downgrade to development substitutes.
- The final verdict remains `NOT PRODUCTION READY` unless every launch-critical gate is genuinely certified.
