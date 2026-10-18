# Step 150 — Trusted callable parent-validation audit

## Audit result
The existing trusted callable remains on the legacy Area/Locality payload contract:
- Area: Country → State → City.
- Locality: Country → State → City → Area.
- District-aware helper contracts exist but are intentionally not wired into the production callable yet.
- The current callable rejects `districtId` on an Area payload before writing, preventing a client from silently switching index tuples ahead of coordinated migration.
- The current callable validates Area ancestry through the referenced City, State and Country; District-aware Area validation must additionally derive and verify the City’s District inside the transaction before adopting the new Area tuple.
- Parent immutability and duplicate index ownership are already enforced in the callable flow; those checks must remain intact during migration.

## Added regression coverage
Expanded `functions/test/district_schema_contract.test.cjs`:
- Reject Area attached to a different City even if District matches.
- Reject Area with mismatched Country or State ancestry.
Existing tests continue to cover a City linked to a different District and an Area with a mismatched District.

## Release gate
Before enabling District-aware Area writes, add callable/emulator integration coverage for a complete District → City → Area → Locality chain, wrong ancestry, duplicate index ownership, immutable parents, and legacy City compatibility. Then update Admin and Firebase contracts together.

No production callable, data, indexes, deployment, or migration was changed.
