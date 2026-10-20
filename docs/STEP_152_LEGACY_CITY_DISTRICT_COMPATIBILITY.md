# Step 152 — Legacy City District compatibility

## Changes
- Added a read-only classifier for City ancestry:
  - `LEGACY_NO_DISTRICT`: City has matching Country/State and no District; no District is guessed from its name.
  - `DISTRICT_LINKED`: City has a safe District ID and the trusted District document matches Country/State.
  - `BROKEN_PARENT_CHAIN`: mismatched Country/State, missing referenced District, malformed District ID, or inconsistent District ancestry.
- Added regression tests for all three classifications, including a legacy City and a missing/mismatched District.
- The helper is additive only and does not alter the production callable or Firestore documents.

## Compatibility rule
Legacy Cities without a District remain classifiable and are not automatically reparented. They need explicit reviewed mapping before District-aware migration. City display names are not used to infer parent IDs.

## CI
See the linked workflow runs for the test commit; only mark the change validated when both workflows complete successfully.

## Safety
No production data migration, deployment, index cleanup, merge, or Customer/Partner changes were performed.
