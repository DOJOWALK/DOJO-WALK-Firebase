# Step 171 — District index-pair classifier hardening

This step hardens the read-only District index migration preflight helper.

## Classification outcomes
- `MISSING_BOTH`
- `LEGACY_ONLY`
- `DISTRICT_ONLY`
- `BOTH_SAME_DOCUMENT`
- `CONFLICT_DIFFERENT_DOCUMENT`
- `LEGACY_OWNER_MISMATCH`
- `DISTRICT_OWNER_MISMATCH`

The classifier verifies collection path, normalized name, and ordered parent tuple. If both index documents exist but point to different location documents, it explicitly reports `CONFLICT_DIFFERENT_DOCUMENT` and marks the pair unsafe to migrate. It does not access Firestore or mutate input records.

## Verification
- Initial helper CI passed on `0ec943a095fa143c0d2da32b55906b17875af9d3`.
- Final classifier and test commit verified: `0670a3d6df7ac526e9d55e628a4aedc01a6e3b57`.
- Trusted Location Geometry and Callable Tests: PASS — [run 39176494247](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39176494247).
- Firestore Security Rules: PASS — [run 39176494216](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39176494216).
- A prior intermediate commit had a callable test failure; the corrected final commit above passed both workflows.

## Safety boundary
This helper is not wired into the production callable. Legacy name-index behavior remains unchanged. No production scan, migration, deployment, or merge was performed.
