# Step 199 — Partner Onboarding / Firebase Rules Compatibility Audit

## Scope
Read-only comparison of the current `dojoplatform2026/dojo-partner` onboarding screens on `main` with `firestore.rules` on Firebase branch `fix/location-index-import-rules`.

## Findings

### 1. Walker draft payload is broadly allowlisted
`PersonalDetailsScreen` creates a new `walkers/{uid}` draft with the required identity/status fields, timestamps, and optional work-location fields. The current walker create rule explicitly permits the legacy fields `city`, `state`, `area`, `zoneName`, `zoneNames`, `zones`, and `travelMode`. The current work-location flow does not create a walker document by itself; it updates only an existing `in_progress` draft.

### 2. Address update path is allowed, subject to full document constraints
`CurrentAddressScreen` merges `currentAddress` and `updatedAt` into an existing walker document. Both keys are in the owner-update allowlist. Actual success still depends on the full resulting document satisfying all rule invariants; this audit does not claim a live Firestore write was exercised.

### 3. Service-location migration mismatch remains
The Partner `WorkLocationScreen` reads active records from the legacy `zones` collection and derives `city/state/area/zoneName/zones` from those records. The newer Admin/Firebase Service Location contract uses `service_cities`, `service_areas`, and related service-location collections. Partner has not yet been migrated to consume those new collections or persist canonical service-location IDs.

This is a cross-repository integration blocker, not something to silently patch in Firebase rules: the user workflow has required finishing Admin before modifying Partner/Customer. Keep the current legacy payload compatible until the Admin schema and migration plan are finalized.

### 4. No production evidence inferred
This was a source/rules inspection only. No Firebase Emulator was run against the Partner Flutter app, no production reads/writes were made, and no deployed rules were checked.

## Next safe action
Finish and verify the Admin Service Location setup and its schema contract first. Then make a separately reviewed Partner migration plan that replaces legacy `zones` reads with active service City/Area selection, persists canonical IDs, and adds emulator-backed create/update tests against the final rules.

## Release gates
- No code changes in Partner or Customer.
- No production scan, migration, deployment, or merge performed.
- Firebase/Admin PRs remain separate review units.
