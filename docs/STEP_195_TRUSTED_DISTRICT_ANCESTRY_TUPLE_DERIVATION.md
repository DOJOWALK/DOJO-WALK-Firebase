# Step 195 — Trusted District Ancestry Tuple Derivation

## Change
Added a pure helper that derives District-aware City/Area/Locality parent tuples from trusted document snapshots and regression tests for valid ancestry, missing District compatibility, mismatched District/State, mismatched City/Area ancestry, and malformed IDs.

## Important behavior
- The helper accepts trusted document records, not client-supplied parent IDs as proof of ancestry.
- Legacy City records without a District return `null`; the caller must preserve the legacy index and must not invent a District tuple.
- The helper is not wired into production writes. The coordinated dual-index transaction, conflict handling, rollback plan, and Admin/Firebase contract agreement remain required before switching writes.

## Safety
- No production Firestore data changed.
- No production scan, migration, deployment, or merge performed.
- CI pending.
