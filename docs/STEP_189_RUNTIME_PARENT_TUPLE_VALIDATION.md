# Step 189 — Runtime Parent Tuple Validation

## Change
Added regression coverage for parent tuple inputs that arrive at runtime as null, a string instead of an array, or arrays containing non-string values.

## Expected behavior
Each malformed input returns `INPUT_INVALID` and `safeToMigrate: false` without throwing.

## Safety
- Test-only change; no production callable or Firestore data changed.
- District-aware preflight remains separate from the production save path.
- No production scan, migration, deployment, or merge performed.
- CI pending.
