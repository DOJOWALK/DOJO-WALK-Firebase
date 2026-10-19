# Step 193 — Canonical District Index Parent IDs

## Change
Hardened the District-aware index tuple helper to reject parent IDs with leading or trailing whitespace rather than silently trimming them. Added regression tests for padded Country and District IDs.

## Why
The migration preflight requires canonical parent IDs. Keeping the tuple generator equally strict prevents differently formatted inputs from being silently converted into an index key.

## Safety
- Helper and unit-test change only; production save callable remains unwired to District-aware Area/Locality index writes.
- No Firestore records were changed.
- No production scan, migration, deployment, or merge performed.
- CI pending.
