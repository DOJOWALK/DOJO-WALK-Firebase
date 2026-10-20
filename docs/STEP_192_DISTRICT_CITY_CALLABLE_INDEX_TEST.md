# Step 192 — District-linked City Callable Index Integration Test

## Change
Added a callable/emulator regression test that creates Country → State → District → City through the trusted save callable, then verifies the City stores its District ID and the canonical City name index uses the ordered three-parent tuple `[countryId, stateId, districtId]`. The test also tracks its index for cleanup.

## Scope and safety
- Test-only change; production callable behavior is unchanged.
- Legacy City records and legacy Area/Locality index tuples remain unchanged.
- This does not enable District-aware Area/Locality index writes.
- No production scan, migration, deployment, or merge performed.
- CI status is pending.
