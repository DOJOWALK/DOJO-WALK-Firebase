# Step 149 — District-aware migration preflight and rollback plan

## Scope
Planning and contract review only. This document does not run a migration or change production data.

## Existing callable constraints
- The trusted `saveServiceLocationWithNameIndex` callable uses the legacy Area parent tuple `countryId, stateId, cityId` and legacy Locality tuple `countryId, stateId, cityId, areaId`.
- The additive District-aware index contract adds `districtId` before `cityId` for Area and before `cityId, areaId` for Locality.
- Admin payloads, callable allowlists, Firestore ancestry validation, and index tuple generation must be released in a coordinated sequence. Do not send `districtId` to the current Area callable until the server contract accepts and validates it.

## Preflight classification (read-only)
Each Area should be classified before any write:
1. **READY** — referenced City exists; City has a valid `districtId`; City, District, State and Country ancestry matches; current legacy index matches the Area name and legacy parents; proposed District-aware index ID is unoccupied or already points to the same Area.
2. **LEGACY_NO_DISTRICT** — City exists but has no `districtId`. Do not guess a District from text names; require explicit reviewed mapping.
3. **BROKEN_PARENT_CHAIN** — a referenced parent is missing or the stored country/state/district ancestry disagrees. Quarantine for review.
4. **INDEX_CONFLICT** — proposed index exists and points to a different location, or multiple same-name candidates compete under the same canonical parent tuple. Do not overwrite.
5. **LEGACY_INDEX_MISSING_OR_MISMATCHED** — existing legacy index is missing or its owner/tuple does not match the Area. Resolve before migration.

Localities inherit District only through the trusted Area → City chain. Never accept client-supplied District ancestry as proof.

## Required migration stages
1. **Freeze contract** — publish the final ordered parent tuple and Admin/Firebase payload contract; retain legacy tuple support during rollout.
2. **Read-only dry run** — scan paginated records; emit counts and per-record classifications without writes. Use a stable snapshot/checkpoint and record document IDs, not personal data.
3. **Review exceptions** — manually resolve all `LEGACY_NO_DISTRICT`, `BROKEN_PARENT_CHAIN`, and `INDEX_CONFLICT` records.
4. **Backfill additive indexes** — transactionally read the Area/Locality and all required parents, revalidate ancestry and index ownership, then create only absent District-aware indexes. Existing index owned by another record is a hard stop.
5. **Verify** — rerun dry run; require zero unexplained conflicts, verify index-to-document reciprocity and legacy index continuity, and run callable + Firestore rules tests.
6. **Switch writes** — only after Admin and callable contracts are coordinated, use the new tuple for District-linked records. Preserve a defined legacy path for unmapped legacy Cities until explicitly retired.
7. **Cleanup (separate approval)** — do not delete old indexes as part of backfill. Retire them only after observed usage confirms no legacy readers/writers remain and rollback window is closed.

## Transaction requirements
- Derive ancestry from Firestore parent documents read inside the transaction.
- Validate Country → State → District → City → Area → optional Locality relationships.
- Re-check duplicate index ownership in the transaction.
- Keep parent IDs immutable on update unless an explicit, reviewed reparenting migration exists.
- Enforce verified geometry and existing activation/active-child rules independently of name-index checks.
- Make retry behavior idempotent: same source document and same tuple may be treated as already migrated; a different owner must fail closed.

## Rollback
- Before switching writes: stop the backfill; keep all legacy indexes untouched; remove only newly created additive indexes after verifying they are owned by the migration and no switched writer depends on them.
- After switching writes: first restore the legacy writer/reader contract; preserve documents and old indexes; remove additive indexes only after confirming no active code depends on them.
- Never delete or rewrite location documents as an automatic rollback action.

## Approval gates
No production migration, deployment, index cleanup, or Admin/Customer/Partner rollout is authorized by this plan. Require a reviewed dry-run report, passing emulator integration tests, an explicit rollout/rollback owner, and separate user approval before any production action.
