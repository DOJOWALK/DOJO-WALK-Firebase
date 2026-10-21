# Legacy City → District Mapping: Safe Migration Plan

**Status:** Plan only — no Firestore records changed, no callable/rules deployment, no production migration run.  
**Base:** `main` in `dojoplatform2026/DOJO-WALK-Firebase`  
**Purpose:** Prepare a controlled path for legacy `service_cities` records whose `districtId` is missing or empty, while preserving existing data and name-index identities.

## Non-negotiable safety rules

1. Never infer a District from a City name alone. Names may be duplicated, translated, renamed, or shared across districts.
2. Do not automatically write `districtId`, change activation status, rename documents, or rebuild/delete name-index records during discovery.
3. Preserve every existing City document ID and existing name-index document ID.
4. Treat missing, ambiguous, mismatched, and conflicting mappings as **review required**; do not guess.
5. Run discovery and dry-run against an emulator/export first. Production read-only discovery, if later approved, must be a separate explicitly authorized step.
6. No production writes, deployment, or merge are part of this plan.

## Phase A — Read-only inventory

Produce a machine-readable report with one row per City:
- `cityId`, display name and normalized name
- existing `countryId`, `stateId`, `districtId` (distinguish absent, null, empty, malformed, and valid)
- candidate District IDs derived from authoritative source data and matching parent `countryId` + `stateId`
- evidence/source and confidence category
- associated legacy and district-aware name-index document IDs/status
- final classification: `already_linked`, `unique_evidence_candidate`, `ambiguous`, `no_candidate`, `parent_mismatch`, `index_conflict`, or `invalid_record`

The inventory must not write to Firestore. Counts in the report must reconcile to the total City records scanned. Do not include sensitive data unrelated to location mapping.

## Phase B — Human-reviewed mapping manifest

Create a separate reviewed manifest, version-controlled outside production data, containing only explicit approved mappings:
- `cityId`
- `expectedCountryId`, `expectedStateId`
- `districtId`
- evidence/source reference
- reviewer and review timestamp
- manifest version/hash

Reject duplicate City IDs, missing evidence, invalid IDs, a District whose parent Country/State does not match the City, or more than one mapping for a City. A name match alone is not sufficient evidence.

## Phase C — Preflight and dry-run

Before any future write mode:
- Re-read each City and District and verify the reviewed parent tuple still matches.
- Verify both legacy and district-aware name-index records using the existing `classifyDistrictIndexPair` preflight logic.
- Stop for any `CONFLICT_DIFFERENT_DOCUMENT`, owner mismatch, malformed index, or unexpected document identity.
- Print a proposed-change report and expected before/after counts.
- Dry-run is the default; no write flag means no writes. Dry-run must leave the emulator data byte-for-byte/logically unchanged.

## Phase D — Explicitly approved migration (not implemented here)

Only after separate review and test approval:
- Update only the approved City `districtId` field and any specifically required district-aware index record.
- Use transactions or bounded, restartable batches; revalidate all parent/index state immediately before writes.
- Preserve existing IDs and avoid deleting the legacy index during the first migration pass.
- Record per-document outcome and audit metadata; make retries idempotent.
- Abort safely on conflicts, stale manifests, partial batch failures, or count mismatches.
- Verify post-run counts and generate a rollback plan before any production run.

This plan does not authorize or perform Phase D.

## Required tests before implementation is considered ready

### Mapping/inventory tests
1. Missing and empty `districtId` are classified as legacy; neither is silently filled.
2. Exactly one authoritative, parent-consistent reviewed mapping becomes a dry-run proposal only.
3. Same-name Cities in different Districts are not auto-mapped.
4. No candidate, multiple candidates, malformed IDs, or missing evidence are rejected.
5. A candidate District with mismatched `countryId` or `stateId` is rejected.
6. A City whose parent tuple changed after manifest review is rejected as stale.
7. Inventory totals reconcile; every scanned City appears exactly once.

### Name-index preflight tests
8. Missing-both, legacy-only, district-aware-only, and both-same-document states are classified explicitly.
9. Two indexes pointing to different City documents block migration.
10. Legacy or district-aware owner/name/collection/parent mismatch blocks migration.
11. Existing document IDs remain unchanged; migration never deletes or overwrites a conflicting index.

### Write-path/emulator tests (only when implementation is proposed)
12. Dry-run creates no documents and changes no fields.
13. Approved mapping updates only the intended City and required index data.
14. A repeated run is idempotent and does not duplicate indexes/audit entries.
15. Failure halfway through a batch is recoverable and safely resumable.
16. A concurrent parent/index change causes the transaction to abort.
17. Unauthorized callers cannot invoke any migration write path.
18. Missing/invalid manifest, duplicate City IDs, stale hash, or unapproved mapping produces zero writes.

## Acceptance gates

- [ ] Read-only inventory and report format reviewed.
- [ ] Every proposed mapping backed by authoritative evidence and human approval.
- [ ] Emulator tests pass, including dry-run no-write and conflict cases.
- [ ] Before/after count reconciliation and rollback rehearsal pass.
- [ ] Separate explicit approval for any production write.
- [ ] Separate deployment approval; deployment is not implied by migration approval.

## Current implementation notes

- The existing backend activation path has allowed legacy Cities without `districtId` for compatibility. Do not abruptly change that behavior until legacy inventory and compatibility tests are complete.
- The existing `district_index_pair_preflight.ts` is read-only classification logic for index conflicts; it is not a production migration and does not prove any live data has been mapped.
- Admin UI should continue to show unlinked legacy Cities separately rather than falsely attaching them to the selected District.
