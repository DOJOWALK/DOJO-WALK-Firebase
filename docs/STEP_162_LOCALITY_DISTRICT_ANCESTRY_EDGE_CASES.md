# Step 162 — Locality District ancestry edge-case tests

## CI verification
Step 161 test commit `0fcef3d8c0b97038ab204fe8f8eab46fbeb2921c` completed successfully:
- Trusted Location Geometry and Callable Tests: https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39173669732
- Test Firestore Security Rules: https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39173669756

## Changes
Added regression coverage for:
- City linked to a District belonging to a different State is classified as `BROKEN_PARENT_CHAIN`.
- A legacy City with no District mapping remains `LEGACY_NO_DISTRICT`; no District is guessed by name.
- The JSON report documents all six statuses, including `READ_ERROR`.

Test commit: `4ec855e5f61213ca92fcaeb19957a2266494df9f`.

## Validation status
The Step 162 commit workflows must complete before these new assertions can be called CI-passed. The scanner has not been run against production Firestore; CI only validates code/tests in the configured workflow environment.

## Safety
No production Firestore writes, migration, deployment, or merge. Customer and Partner repositories unchanged.
