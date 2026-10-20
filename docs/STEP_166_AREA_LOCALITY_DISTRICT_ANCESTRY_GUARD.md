# Step 166 — District ancestry guard for Area and Locality saves

## Changes
- The trusted save callable now checks a District-linked City before saving an Area or Locality.
- If the City has a non-empty `districtId`, the referenced `service_districts/{districtId}` document must exist and its `countryId` and `stateId` must match the Area/Locality parent tuple.
- Added an emulator callable regression test for an Area whose City points to a missing District; it expects `failed-precondition` and verifies no Area or name-index write occurs.
- Legacy name-index tuple behavior remains unchanged in this step. The District-aware index migration is still a separate coordinated change.

## Verification
CI has been triggered by the code and test commits. Do not mark this step fully verified until both Trusted Location Geometry/Callable Tests and Firestore Security Rules workflows pass.

## Safety
No production scan, production Firestore mutation, migration, deployment, or merge was performed.
