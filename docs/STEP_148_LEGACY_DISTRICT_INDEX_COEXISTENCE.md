# Step 148 — Legacy and District-aware index coexistence

## Change
- Added regression tests for Area and Locality name-index IDs during the planned District migration.
- Tests assert that the current legacy tuple and proposed District-aware tuple both produce valid SHA-256 IDs and do not collide.
- Existing legacy index generation remains unchanged.

## Migration implications
- Legacy Area index tuple: `[service_areas, [countryId, stateId, cityId], normalizedName]`.
- District-aware Area tuple: `[service_areas, [countryId, stateId, districtId, cityId], normalizedName]`.
- Legacy Locality index tuple: `[service_localities, [countryId, stateId, cityId, areaId], normalizedName]`.
- District-aware Locality tuple: `[service_localities, [countryId, stateId, districtId, cityId, areaId], normalizedName]`.
- Because these IDs differ, migration must not simply overwrite the old index. It needs a staged backfill/verification, dual-read or compatibility period, transaction-safe writes, and a documented cleanup/rollback path.
- The trusted callable must derive parent IDs from Firestore documents inside a transaction. Client-provided IDs alone are not proof of ancestry.

## Validation
- Step 147 Firebase callable and Firestore Security Rules workflows passed.
- Step 148 workflows were triggered by the new test commit; confirm their final status before calling this step validated.

No production index/document writes, migrations, deployments, or repo merges were performed.
