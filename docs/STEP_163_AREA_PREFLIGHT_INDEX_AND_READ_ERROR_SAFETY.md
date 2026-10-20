# Step 163 — Area preflight index and read-error safety

## Completed
- Step 162's Trusted Location Geometry/Callable and Firestore Security Rules workflows both passed:
  - https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39173901617
  - https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39173901607
- Hardened the Area read-only migration scanner:
  - Firestore document IDs cannot be overwritten by a stored `id` field.
  - Invalid/blank/over-120-character Area names are classified as malformed data.
  - Firestore/helper failures are reported as `READ_ERROR`, not incorrectly labeled as broken ancestry.
  - Proposed District-aware indexes are checked against collection, owner, normalized name and the complete Country/State/District/City parent tuple.
  - A same-owner but malformed proposed index is treated as `INDEX_CONFLICT`.
  - Added descriptions for all scanner statuses.
- Added static regression tests for the safeguards and Node syntax validation.

## Validation
The Step 163 changes are committed, but their CI workflows must finish before the new tests are marked passed. The production Firestore scanners have not been run; no production record counts are known.

## Safety boundary
Both scanners remain read-only. No callable schema switch, backfill, index cleanup, deployment, merge, or production data write was performed. Admin and Firebase contracts still need a coordinated District-aware callable migration with emulator integration coverage before any write migration.
