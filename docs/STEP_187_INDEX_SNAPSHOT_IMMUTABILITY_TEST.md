# Step 187 — Index Snapshot Immutability Test

## Change
Added a regression test that classifies a consistent legacy/district-aware index pair and verifies both input snapshots remain byte-for-byte unchanged after classification.

## Safety
- Test-only change; no production callable or Firestore data changed.
- District-aware preflight remains separate from the production save path.
- No production scan, migration, deployment, or merge performed.
- CI pending.
