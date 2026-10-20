# Step 168 — District ancestry and index compatibility tests

Expanded the callable regression matrix to cover valid District-linked Area and Locality saves. The tests verify that the trusted callable checks District ancestry but intentionally continues to use the legacy Area tuple `[countryId, stateId, cityId]` and Locality tuple `[countryId, stateId, cityId, areaId]` until an atomic, coordinated migration is approved.

The matrix also covers missing District documents and a District attached to the wrong State; these negative cases verify no location or index write occurs. Legacy City records without `districtId` remain supported.

CI status: pending for the latest commits. No production scan, migration, deployment, or merge was performed.
