# Astra commercial foundation — Slice 2

## Goal

Move business-adjustable pricing and offer configuration behind the control-plane boundary without changing existing subscriber terms or weakening wallet/accounting invariants.

## Tasks

1. Add strict commercial contracts for versioned regional plan prices, top-up packages, promotions, and model consumption rates.
2. Add deterministic in-memory repository/service behavior with effective-date selection, optimistic versions, and fail-closed reads.
3. Add PostgreSQL migration and adapter tables for commercial versions, preserving existing `plans`, wallet ledgers, and payment history.
4. Add authenticated public pricing reads and permission-checked admin CRUD with required reason/version metadata and audit coupling.
5. Wire pricing reads and reservation validation to the commercial policy service; preserve the existing PlanCatalog as the compatibility projection during rollout.
6. Add tests for effective dates, regional separation, optimistic conflicts, promotion limits, API authorization, checkout catalog validation, and personal/organization wallet compatibility.

## Verification

Focused Vitest tests, control-plane/db/api builds, root typecheck, lint, format check, migration SQL checks, and the final repository certification suite.
