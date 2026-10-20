# Step 169 — District ancestry CI verification

## Verified commit
`fa72d50e1bd9811dffea56a66fda799d08f5a1d5`

## Results
- Trusted Location Geometry and Callable Tests: PASS — https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39176087242
- Firestore Security Rules: PASS — https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39176087469

## Coverage in this batch
- District document attached to the wrong State is rejected before Area/index writes.
- Locality creation is rejected when its City references a missing District document.
- Legacy City without `districtId` remains compatible for Area creation.
- Valid District-linked City ancestry is checked for Area and Locality writes.
- Current legacy index tuple remains in use; District-aware index tuple migration is not enabled.

Earlier CI attempts failed due to test fixture and test-index helper mistakes. Those test issues were corrected in the verified commit above; do not treat the earlier failed runs as current failures.

No production scan, data migration, deployment, or merge was performed.
