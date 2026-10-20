# Step 197 — Admin/Firebase District Dual-Index Contract Audit

## Exact branch state reviewed
- Firebase: `fix/location-index-import-rules`, audited callable integration commit `a8ce3496bbf4efe947b269682aa091f76e7db36f`.
- Admin: `step-119-boundary-geometry`, contract clarification commits `18a744f5eb0a132b9f1938f90092e125a6fb0868` and `387e2554989374b5959cee828ed00cb51b81faa9`.
- Admin PR #7 and Firebase PR #6 remain Draft/Open.

## Contract findings
- Admin sends `[countryId, stateId, districtId]` for District-linked Cities and retains `[countryId, stateId]` for legacy Cities without a District.
- Admin Area/Locality payloads retain their established parent fields; they do not claim client-supplied ancestry is proof of a District relationship.
- Firebase validates the City, State, Country and (when present) District documents inside the trusted transaction, then derives the District-aware Area/Locality tuple from the trusted City District link.
- For District-linked Areas/Localities, Firebase writes the legacy and District-aware index documents in the same transaction and classifies index ownership before staging writes.
- Existing unchanged-name records with both index documents missing are blocked for manual review. Legacy Cities without a District remain on the legacy index path.

## Verification
- Firebase integration and Firestore rules CI passed on Firebase commit `a8ce349` (runs 39187126984 and 39187126956).
- Before the Admin comment/test-name clarification, Admin build and geometry tests passed on `bbebcdf` (runs 39183714414 and 39183714406).
- CI for the latest Admin documentation/test-label-only clarification is pending at time of this report; it must pass before treating the latest Admin branch as verified.

## Safety and release gates
- This is a code-contract audit, not evidence that production Firestore index documents are complete or migrated.
- No production scan, migration, deployment, or merge was performed.
- Before release, review the final shared Admin/Firebase commits and CI together. Any production scan, migration, deployment, or merge requires separate explicit approval.
