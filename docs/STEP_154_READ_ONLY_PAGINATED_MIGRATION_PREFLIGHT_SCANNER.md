# Step 154 — Read-only paginated migration preflight scanner

## What was added
- Added `functions/scripts/district_migration_preflight.cjs`.
- The script scans `service_areas` using document-ID pagination and performs reads only.
- It checks Area → City → State → Country ancestry, checks the referenced District when a City has a District ID, verifies the existing legacy name-index points back to the Area with the expected tuple, computes the proposed District-aware index ID, and checks whether that proposed index is absent, already owned by the same Area, or owned by another record.
- It emits a JSON report with counts by status and per-Area IDs/status/reason. It does not output location names or write Firestore documents.
- The script refuses to guess the Firebase project: set `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` explicitly. It requires Application Default Credentials and a built `functions/lib` directory.

## Run manually (read-only)
From `functions/` after installing dependencies and building:
```sh
npm ci
npm run build
GCLOUD_PROJECT="YOUR_INTENDED_PROJECT_ID" REPORT_PATH="./district-preflight-report.json" node scripts/district_migration_preflight.cjs
``
The output file is created exclusively; the command refuses to overwrite an existing report. Without `REPORT_PATH`, JSON is printed to stdout.

## Interpretation and limits
- `READY` means the script's read-only checks passed at scan time; it is not migration approval.
- `LEGACY_NO_DISTRICT` requires reviewed explicit mapping.
- `BROKEN_PARENT_CHAIN` and `LEGACY_INDEX_MISSING_OR_MISMATCHED` require investigation.
- `INDEX_CONFLICT` must never be resolved by overwriting the other owner.
- This scan is paginated but not an atomic snapshot; rerun and review results before any separately approved migration.
- This step scans Areas only. Locality/index preflight remains a follow-up before any migration of Localities.
- The script was not run against production and this change performs no automatic scan on deploy or CI.

## Safety
No production records, indexes, or callable behavior changed. No deployment, merge, index cleanup, or Customer/Partner changes were performed.
