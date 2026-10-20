# Step 196 — Current District Dual-Index Integration Audit

## Verified branch state
- Firebase branch: `fix/location-index-import-rules`
- Audited HEAD: `e21b5174e76c75e4ee8d15672b0136c646ffc682`
- Draft PR #6 remains open; it has not been merged.

## Current callable behavior
The current `saveServiceLocationWithNameIndex` implementation in `functions/src/index.ts` now integrates the District index-pair classifier for Area/Locality records whose parent City has a District link.

- It validates the City-to-District Country/State ancestry from Firestore parent documents.
- It preserves the legacy index tuple and adds a District-aware tuple for District-linked Areas/Localities.
- It reads and classifies the new index pair before staging writes; conflicting/malformed owners fail closed.
- It checks old index ownership and removes old legacy/District-aware keys in the same transaction during rename.
- If both index keys are missing for an existing unchanged-name District-linked Area/Locality, the save fails with `failed-precondition` for manual review.
- Legacy City records without `districtId` continue to use the legacy index path; no District tuple is fabricated.

## CI verification
Latest visible runs on audited HEAD `e21b517`:
- Trusted Location Geometry and Callable Tests: PASS (run 39186870182).
- Firestore Security Rules: PASS (run 39186870078).

## Remaining release gates
- These results verify repository tests, not production data state.
- No production scan or preflight report has been run or reviewed in this step.
- No production migration, Firebase deployment, or merge has been performed.
- Before release, inspect the full Admin/Firebase contract and the complete callable test matrix on the final shared commit, then obtain explicit approval for any production scan, migration, deployment, or merge.

## Result
Code-level dual-index integration is present and the latest visible CI checks pass. Production rollout remains unverified and is not authorized by this audit.
