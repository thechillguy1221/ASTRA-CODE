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

On 2026-09-20, after upgrading Electron to 44.4.3, Vitest to 5.0.1, Vite to 8.3.0, and the matching React plugin to 6.1.1, it reported 0 critical, 0 high, 0 moderate, and 0 low vulnerabilities across 349 audited dependencies. The previous Electron, `extract-zip`, Vitest, and Vite findings were remediated by those reviewed upgrades; `npm audit fix --force` was not used.

License compatibility still requires review of the generated direct inventory before distribution. No production certification claim is based solely on the audit count.

Private Lyntar workspaces are explicitly marked `UNLICENSED`; third-party direct dependencies must carry a declared license in the generated report before any public package or installer distribution.
