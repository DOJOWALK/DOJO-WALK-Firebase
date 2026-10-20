# Step 188 — Migration Safety Flag Invariant

## Change
Added a table-driven regression test covering missing indexes, legacy-only, district-aware-only, consistent dual indexes, conflicting owners, and invalid input. The test asserts that `safeToMigrate` is true only for `LEGACY_ONLY`, `DISTRICT_ONLY`, and `BOTH_SAME_DOCUMENT`.

## Safety
- Test-only change; no production code or Firestore records changed.
- District-aware preflight remains separate from the production save callable.
- No production scan, migration, deployment, or merge performed.
- CI pending.
