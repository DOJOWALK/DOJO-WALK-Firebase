# Step 157 — Locality preflight error and index ownership safeguards

## Changes
- Scanner now distinguishes known broken-data conditions from Firestore/index-helper read failures; read failures are counted as `READ_ERROR` rather than misleadingly counted as broken ancestry.
- Firestore document IDs are assigned after document data, so a stored `id` field cannot override the canonical document ID.
- The proposed District-aware index is checked against its collection path, owning Locality document, normalized name, and full Country/State/District/City/Area parent tuple. A mismatched existing record is not considered safe merely because its owner ID matches.
- Added static regression tests for the above guardrails, pagination, and absence of Firestore write methods.

## Validation
GitHub Actions were triggered for test commit `e73f718e931c8fa7f4b45c47e61dd6beaebd1bb3`:
- Trusted Location Geometry and Callable Tests
- Test Firestore Security Rules

See:
- https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions
- https://github.com/dojoplatform2026/DOJO-WALK-Firebase/tree/fix/location-index-import-rules/functions/test

## Safety
No production scan was run, and no Firestore data or indexes were written. No deployment, merge, or Customer/Partner changes were made. Static source tests do not substitute for a controlled read-only execution with approved credentials.
