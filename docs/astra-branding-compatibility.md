# Astra AI branding and compatibility

The public product name is **Astra Code** (short UI label: **Astra**). The repository now uses
`astra` identifiers across its workspace, packages, environment, IPC, storage, and public metadata.

## Public migration

- User-facing titles, navigation, copy, error messages, desktop window labels, email copy, public
  metadata, and public route content use Astra Code.
- Public host and deployment metadata must be configured explicitly. The repository default is
  `https://astra.dev`; replace it with the verified production domain before launch if that domain
  is not the intended canonical host.
- The website uses a server/config-driven plan response. It must not invent plan pricing in the UI.

## Renamed internal identifiers

- npm package names use the `@astra/*` scope and the root workspace is `astra`.
- Runtime configuration uses `ASTRA_*` environment variables.
- The desktop exposes `window.astra` and persists `astra-session.bin`.
- Active protocol headers, route slugs, TypeScript symbols, migration references, and test fixtures
  use Astra naming.

## Cutover requirements

Before a public deployment, configure the verified Astra host, update signed release metadata,
verify OAuth redirect URIs, update transactional email links, and run a migration-aware desktop
upgrade test for users migrating from earlier internal identifiers. No production certification is
implied by this source-level rebrand.
