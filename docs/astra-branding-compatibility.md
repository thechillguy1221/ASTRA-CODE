# Astra AI branding and compatibility

The public product name is **Astra Code** (short UI label: **Astra**). The repository still contains
internal `lyntar` identifiers because they are part of the current workspace, package, environment,
IPC, and database compatibility surface.

## Public migration

- User-facing titles, navigation, copy, error messages, desktop window labels, email copy, public
  metadata, and public route content use Astra Code.
- New public host and deployment metadata must be configured explicitly; the legacy `lyntar.dev`
  canonical host is retained only until the production domain migration is supplied.
- The website uses a server/config-driven plan response. It must not invent plan pricing in the UI.

## Preserved internal identifiers

- npm package names such as `@lyntar/auth` and the root workspace name `lyntar` remain stable for
  workspace consumers and built desktop artifacts.
- Existing `LYNTAR_*` environment variables remain canonical for this release. Astra aliases may be
  added only as an explicit migration, never by silently changing the meaning of an existing key.
- Existing `window.lyntar` IPC exposure and persisted `lyntar-session.bin` storage remain available
  for compatibility. The desktop may add an `astra` alias without removing the legacy surface.
- Migration filenames, immutable migration IDs, event identifiers, protocol fields, and persisted
  values are not renamed retroactively.

## Cutover requirements

Before a public domain/installer cutover, configure the Astra host, update signed release metadata,
verify OAuth redirect URIs, update transactional email links, and run a migration-aware desktop
upgrade test. No production certification is implied by this source-level rebrand.
