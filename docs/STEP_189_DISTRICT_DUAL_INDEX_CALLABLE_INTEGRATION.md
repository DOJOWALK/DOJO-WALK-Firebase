# Step 189 — District-aware Dual Index Integration

## Implemented
- Integrated the read-only District index-pair classifier into `saveServiceLocationWithNameIndex` for Areas and Localities under a District-linked City.
- Continues to write the legacy index tuple for compatibility while also writing the District-aware tuple:
  - Area legacy: `[countryId, stateId, cityId]`; District-aware: `[countryId, stateId, districtId, cityId]`.
  - Locality legacy: `[countryId, stateId, cityId, areaId]`; District-aware: `[countryId, stateId, districtId, cityId, areaId]`.
- Both indexes are written in the same Firestore transaction. Ownership, normalized name, collection, and ordered parent tuple are checked before writes.
- Conflicting or malformed index pairs fail closed. Missing both indexes for an unchanged existing name requires manual review; new records and actual renames can create new index keys.
- Rename flow validates existing index ownership and removes old legacy/District-aware keys atomically.
- Expanded callable integration tests for dual writes, conflict blocking, and atomic rename cleanup.

## Verification
- Trusted Location Geometry and Callable Tests: PASS on commit `7c6d9a6`.
- Firestore Security Rules: pending at report creation.

## Safety boundary
- No production Firestore scan or migration executed.
- No Firebase deployment performed.
- PR #6 remains open and draft; no merge performed.
- This is application-code integration with CI verification, not proof that existing production records have been migrated.
