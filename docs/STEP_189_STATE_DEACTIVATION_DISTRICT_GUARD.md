# Step 189 — State Deactivation Must Guard Active Districts

Date: 2026-10-19

## Finding
The Admin service-location hierarchy treats District as a direct child of State, and the trusted status callable already checks active Cities and descendant Areas before State deactivation. However, the server-side State deactivation path did not independently check active `service_districts` documents. A client-side Admin precheck is not a security boundary.

## Change
- Added a transactional query in `setServiceLocationStatus` that rejects State deactivation while any District with matching `stateId` has canonical `isServiceActive == true`.
- Added Firestore Emulator integration coverage with an active District and no active City, proving this guard is independent of the existing City guard.
- The check runs before transaction writes.

## Validation
CI is running for the code and integration-test commits; final pass status will be recorded after completion.

## Safety
- No production Firestore records were scanned or changed.
- No deployment or merge performed.
- Admin PR #7 remains open/draft; Partner and Customer remain deferred until Admin/Firebase contract work is complete.
