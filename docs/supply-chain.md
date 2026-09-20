# Supply-chain evidence

The lockfile is `package-lock.json` and is regenerated only by reviewed npm dependency changes. Direct dependency and license inventory is reproducible with:

```text
node scripts/supply-chain-report.mjs
```

The command reads every workspace `package.json`, resolves the installed package metadata, and prints each direct dependency’s requested range, installed version, dependency class, and declared license. It does not contact a registry or write files.

The authoritative audit command for this release gate is:

```text
npm audit --json
```

On 2026-09-20, after adding the reviewed WebSocket relay and Windows packaging dependencies, it reported 0 critical, 0 high, 0 moderate, and 0 low vulnerabilities across 619 audited dependencies. `npm audit fix --force` was not used.

License compatibility still requires review of the generated direct inventory before distribution. The Cline lineage audit is recorded in `docs/cline-lineage.md`; no Cline package or copied Cline source is present in the current repository, so no Cline-specific attribution obligation was identified in this pass. No production certification claim is based solely on the audit count.

Private Astra AI workspaces are explicitly marked `UNLICENSED`; third-party direct dependencies must carry a declared license in the generated report before any public package or installer distribution. Internal `@lyntar/*` package identifiers remain compatibility names and are not the public product name.
