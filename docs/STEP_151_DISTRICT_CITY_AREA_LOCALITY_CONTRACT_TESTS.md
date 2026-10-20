# Step 151 — Full District → City → Area → Locality contract tests

## Changes
- Extended the additive District parent-chain consistency helper to optionally validate a Locality's Country, State, District, City and Area IDs against the trusted expected chain.
- Added regression coverage for a fully consistent District → City → Area → Locality chain.
- Added negative tests for Locality attached to a different Area or District.
- Existing City/Area mismatch tests remain in place.

## Safety boundary
The helper remains a contract utility and is not wired into the production callable. This does not change current payload allowlists, deployed behavior, Firestore records or indexes.

## Validation status
The changes were committed on the existing Firebase branch. CI status must be checked on the latest test commit before treating the tests as passing. No production migration or deployment was performed.
