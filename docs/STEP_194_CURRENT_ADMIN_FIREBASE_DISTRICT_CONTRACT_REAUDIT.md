# Step 194 — Current Admin/Firebase District Contract Re-audit

## Scope
Re-checked the current draft Admin branch `dojoplatform2026/DOJO-WALK-Admin:step-119-boundary-geometry` at `0bb96ca` against Firebase branch `fix/location-index-import-rules` at `6eeaf7e`. This updates the earlier Step 191 findings where Admin model support had not yet been reflected.

## Confirmed Admin behavior
- `ServiceCity` now has optional `districtId`, and its map read/write and `copyWith` preserve it.
- `saveCity()` verifies a supplied District belongs to the selected Country and State.
- Existing City records cannot silently add/remove a District or switch to another District; those changes require a separate migration.
- The Admin trusted-callable payload uses `[countryId, stateId, districtId]` for a District-linked City and preserves `[countryId, stateId]` for a legacy City without District.
- Admin Area and Locality saves still send the legacy index parent tuples; they do not switch to District-aware tuples.

## Firebase behavior
- The District-aware tuple helper expects District `[countryId, stateId]`, City `[countryId, stateId, districtId]`, Area `[countryId, stateId, districtId, cityId]`, and Locality `[countryId, stateId, districtId, cityId, areaId]`.
- The production save callable remains on the legacy index helper for backward compatibility.
- The District-aware Area/Locality preflight classifier is pure/read-only and is not wired into production writes.

## Result
- City contract: aligned for District-linked and legacy District-less City records at the payload/tuple level, subject to CI and end-to-end review.
- Area/Locality index contract: intentionally not switched yet. Before switching, Firebase must derive and validate District ancestry from trusted Firestore parent documents and transact against both legacy and District-aware index refs, failing closed on owner conflicts.
- Do not infer that production indexes are migrated from these code-level checks.

## Next gates
1. Add Admin-side regression coverage for District-linked City payload selection and the legacy District-less path.
2. Add Firebase emulator tests for Area/Locality ancestry-derived District tuples, including legacy City without District.
3. Design dual-index transaction behavior and rollback before modifying the production save callable.
4. Run a read-only preflight only after the target project is explicitly confirmed and the complete report can be reviewed.
5. Production scan, migration, deployment, and merge require separate explicit approval.

## Verification
- Firebase latest visible runs for commit `6eeaf7e`: Trusted Location Geometry and Callable Tests and Firestore Security Rules both passed.
- Admin latest visible runs for commit `0bb96ca`: Service Location Geometry Tests and Admin Web Build Check (No Deploy) both passed.

## Safety
Audit/documentation only; no production code, Firestore records, or deployment configuration changed. No production scan, migration, deployment, or merge performed.
