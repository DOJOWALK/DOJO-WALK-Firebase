# Step 185 — Expected-Name Whitespace Normalization Test

## Change
Added a regression test confirming that the preflight normalizes an expected name with leading/trailing and repeated internal spaces, then compares it to the canonical snapshot name. A consistent legacy-only index remains classified as `LEGACY_ONLY` and a migration candidate.

## Safety
- Test-only change; no production callable or Firestore records changed.
- The preflight remains read-only and is not wired into the production save path.
- No production scan, migration, deployment, or merge performed.
- CI pending at report creation.
