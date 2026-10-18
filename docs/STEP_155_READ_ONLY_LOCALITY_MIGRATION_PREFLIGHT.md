# Step 155 — Read-only Locality migration preflight

## Changes
- Added `functions/scripts/district_locality_migration_preflight.cjs`.
- The scanner paginates `service_localities` by document ID and reads Locality → Area → City → State → Country plus the City’s District when present.
- It verifies parent IDs, validates the legacy Locality name-index owner/name/parent tuple, computes the District-aware Locality index ID, and checks the proposed index owner.
- The report includes status counts and per-record IDs/reasons. It does not write Firestore documents or indexes.
- Also corrected whitespace normalization and JSON newline output in the Area preflight scanner.

## Run (manual, read-only)
From `functions/` after dependencies are installed and TypeScript is built:
```sh
npm ci
npm run build
GCLOUD_PROJECT="YOUR_INTENDED_PROJECT_ID" REPORT_PATH="./locality-preflight-report.json" node scripts/district_locality_migration_preflight.cjs
```
Use the intended project ID and credentials deliberately. The output report path is created exclusively and will not overwrite an existing file.

## Limits and safety
- The scan is paginated, not an atomic snapshot; repeat and review before any separately approved migration.
- `READY` is a classification, not migration authorization.
- Legacy Cities without District remain a manual-review category; the scanner does not infer District from names.
- The scanner was not run against production. No data/index writes, deployment, merge, or Customer/Partner changes were made.
