# Step 191 — Admin/Firebase District Index Contract Audit

## Scope
Read-only cross-repository audit of the Admin service-location model/service and Firebase district-aware index helper. No Admin files were changed.

## Findings
1. Admin `ServiceCity` currently has `countryId` and `stateId`, but no `districtId` field in its model, map serialization, or copy method.
2. Admin `saveCity()` writes the City name index with the legacy tuple `[countryId, stateId]`.
3. Admin `_parentIdsFromDocument()` returns legacy tuples for Area `[countryId, stateId, cityId]` and Locality `[countryId, stateId, cityId, areaId]`.
4. Firebase's district-aware helper expects City `[countryId, stateId, districtId]`, Area `[countryId, stateId, districtId, cityId]`, and Locality `[countryId, stateId, districtId, cityId, areaId]`.
5. Firebase's existing legacy helper deliberately permits City parent tuple lengths 2 or 3 for compatibility, but that does not make the Admin save service district-aware.

## Decision / blocker
**Do not wire the district-aware tuple into the production callable or switch Admin index generation yet.** The Admin model, City save validation, index generation, update/rename transaction reads, and tests must first agree on whether District is mandatory or optional for each City. Legacy Cities without a District need an explicit compatibility path.

## Required follow-up
- Agree and encode the authoritative City-to-District contract.
- Add District support to Admin model/save/read/write paths and parity tests for the exact SHA-256 tuple bytes.
- Test old City records without `districtId`, District-linked Cities, Areas and Localities, duplicate names, conflicting owners, retries, and rename behavior.
- Only then update callable integration and conduct a separately approved read-only project preflight.

## Safety
- Audit only; no production code or Firestore data changed.
- No production scan, migration, deployment, or merge performed.
- Step 188 safety-invariant CI and Step 189 runtime-parent validation CI are green as of this audit.
