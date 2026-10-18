# Step 181 — Canonical Snapshot Name Whitespace Validation

## Change
Fixed the snapshot-name validator in `functions/src/district_index_pair_preflight.ts` to collapse actual whitespace runs with the intended regular expression before checking canonical form.

Added a regression test in `functions/test/district_index_pair_preflight.test.cjs` ensuring a populated snapshot name such as `gaur   city` is rejected as `INPUT_INVALID` rather than accepted as canonical.

## Safety
- Read-only classifier only; no Firestore reads or writes added.
- Production save callable remains unchanged and the preflight remains unwired from production.
- No production scan, migration, deployment, or merge performed.
- CI status must be checked after this commit; no test pass is claimed in this report.
