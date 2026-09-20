# Astra AI open-source notices

Astra AI’s internal `@lyntar/*` packages are private and marked `UNLICENSED`. The product does not currently ship Cline-derived code. Direct and transitive dependency evidence is generated from the committed lockfile and installed package metadata:

```text
node scripts/supply-chain-report.mjs
npm audit --json
```

Before a public installer or package distribution, review the generated inventory for every dependency’s license, preserve any required notices, and reject an incompatible license. The repository’s current release gate records the dependency inventory as an artifact rather than copying third-party code into the Astra source tree.

Third-party product names used in comparison content are descriptive references only. Astra AI is independent and is not endorsed by referenced providers or competing products unless expressly stated.
