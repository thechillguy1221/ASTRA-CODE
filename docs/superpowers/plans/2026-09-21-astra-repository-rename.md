# Astra Repository Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the repository's legacy product identity to Astra throughout tracked source, configuration, package metadata, runtime IPC, persisted filenames, public URLs, tests, and documentation without leaving stale references.

**Architecture:** Keep the existing Electron/Fastify/npm-workspaces architecture unchanged. Rename internal package scopes, environment variables, IPC identifiers, TypeScript symbols, storage filenames, route slugs, and public branding consistently, then regenerate the lockfile and verify all build/runtime boundaries.

**Tech Stack:** TypeScript, React, Electron, Fastify, npm workspaces, Vitest, Prettier, ESLint, TypeScript project references.

**Spec:** User request: rename the legacy Astra identity to Astra throughout the existing Astra Code repository and push the verified result to the supplied GitHub repository.

## Global Constraints

- Preserve Astra Code functionality and security boundaries.
- Do not redesign or replace stable architecture.
- Do not leave compatibility aliases containing the legacy token when the user explicitly requested a repository-wide rename.
- Do not modify `.git`, `node_modules`, generated release binaries, or historical Git objects.
- Run tests, typecheck, lint, format, build, provenance, audit, and diff checks before pushing.
- Push only the verified commit on `main` to the supplied `origin` repository.

## Review Focus

- Package-scope consistency: every workspace dependency and lockfile entry must resolve after the scope rename.
- Runtime IPC consistency: preload, desktop declarations, renderer calls, and tests must share the Astra API name.
- Environment/config consistency: server, scripts, examples, and documentation must use the renamed variables.
- Persisted-state migration: the session filename and user-data paths must use Astra without exposing legacy storage as an active path.
- Public URL and route consistency: canonical URLs, sitemap entries, SEO metadata, and comparison slugs must agree.

### Task 1: Add the repository-wide rename regression test

**Files:**

- Create: `tests/unit/astra-branding.test.ts`

- [ ] Write a failing test that scans tracked paths and tracked text for the legacy token, constructing the token from characters so the test itself does not retain it.
- [ ] Run the focused test and confirm it fails on the current package, environment, IPC, URL, and documentation references.

### Task 2: Rename runtime, package, and configuration identifiers

**Files:**

- Modify: root/package workspace manifests and `package-lock.json`.
- Modify: every `packages/*/package.json` and `apps/*/package.json` internal scope/dependency.
- Modify: TypeScript imports, exports, types, variables, fields, IPC headers, environment variables, and persisted storage names.
- Modify: tests and scripts that exercise those identifiers.

- [ ] Replace the legacy package scope with `@astra/*` consistently.
- [ ] Replace legacy environment names with `ASTRA_*` consistently.
- [ ] Rename the exposed capability API and related TypeScript names to Astra.
- [ ] Rename persisted session and temporary runtime names to Astra.
- [ ] Regenerate the lockfile using npm without changing unrelated dependency versions.
- [ ] Run the focused rename test and the relevant package tests.

### Task 3: Rename public branding, URLs, route slugs, and documentation

**Files:**

- Modify: web metadata, site configuration, sitemap, robots, route definitions, and prerender scripts.
- Rename: tracked planning/specification filenames containing the legacy token.
- Modify: all tracked Markdown, JSON, HTML, and source references that retain the old product identity.

- [ ] Use Astra Code/Astra wording for user-facing product copy.
- [ ] Use the configured Astra public-site URL rather than the legacy domain.
- [ ] Rename route slugs only where they are explicitly product-branded; preserve unrelated competitor names.
- [ ] Update documentation and historical planning files to the new product identity.
- [ ] Run the focused rename test, formatter, and web/renderer builds.

### Task 4: Full verification and release evidence

**Files:**

- Modify: `docs/migration-certification.md`, `docs/release-manifest.json`, and `docs/release-test-summary.md` only if the rename changes their evidence.

- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `npm.cmd run format:check`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `npm.cmd run verify:source-provenance`.
- [ ] Run `npm.cmd audit --omit=dev`.
- [ ] Run `git diff --check` and confirm the tracked-token test passes.

### Task 5: Commit and push

- [ ] Review `git diff` and `git status` for unrelated changes.
- [ ] Commit the verified rename on `main`.
- [ ] Push `main` to `https://github.com/thechillguy1221/ASTRA-CODE.git`.
- [ ] Verify the remote branch contains the commit; if GitHub denies access, report the exact authenticated account/permission error.
