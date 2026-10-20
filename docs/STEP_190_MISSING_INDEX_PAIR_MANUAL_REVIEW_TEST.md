# Step 190 — Missing Dual-Index Pair Manual-Review Regression

## Change
Added an emulator integration test for an existing District-linked Area whose legacy and District-aware index documents are both absent. An unchanged-name save must fail closed with `failed-precondition`, leave the Area unchanged, and must not silently recreate either index.

## Safety
- Test-only change; no production records changed.
- Confirms missing index pairs require explicit review rather than implicit repair.
- No production scan, migration, deployment, or merge performed.
- CI pending.
