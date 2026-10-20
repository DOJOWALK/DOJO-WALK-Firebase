# Step 159 — Locality preflight classification regression tests

## Changes
Added `functions/test/district_locality_preflight_classification.test.cjs` to cover the scanner's classification contract:
- Legacy City without District remains manual review.
- Broken parent ancestry is not migration-ready.
- Missing/mismatched legacy index blocks readiness.
- Proposed index owned by another Locality is an index conflict.
- Clean ancestry and an unoccupied proposed index can be READY.
- Known malformed ancestry and Firestore/helper read failures use separate classifications.
- A proposed index owned by the current Locality is only accepted when its collection/name/parent tuple matches.

## Validation
The test commit is `f394d93835e172e7a4c66a1bc95af94cbf1d1d94`. No GitHub Actions runs were returned for this exact commit at report time, so CI is not claimed as passed.

## Safety
No production scan or Firestore writes were performed. No deployment, merge, or Customer/Partner changes were made. Tests use the compiled helper contract and source assertions; they do not replace a controlled run with approved credentials.
