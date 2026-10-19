# Developer Team Handoff — Shared Firebase

Admin remains the release priority. Keep this PR Draft/open and do not merge or deploy without explicit approval.

**Main continuation source:** [DOJO WALK Admin Developer Team Control Center](https://github.com/dojoplatform2026/DOJO-WALK-Admin/blob/step-119-boundary-geometry/docs/DEVELOPER_TEAM_CONTROL_CENTER.md)

## Current Firebase snapshot at report creation
- PR #6: Draft/open — https://github.com/dojoplatform2026/DOJO-WALK-Firebase/pull/6
- Branch: `fix/location-index-import-rules`
- PR head SHA at verification: `e2f72b72e97b9bf51d81dddfa366c6986afef811`
- Trusted Location Geometry and Callable Tests: PASS, run https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39236530995
- Firestore Security Rules: PASS, run https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39236531337

Always re-check current PR head and CI before relying on these values.

## Safety / sequencing
- This repository supports the Admin service-location contract.
- Customer and Partner code stays untouched until Admin is complete and explicitly approved/merged.
- CI PASS does not mean production data was migrated or Functions/Rules deployed.
- No production scan, import, activation, deployment, or merge is authorized by this document.
- Keep District-aware index changes coordinated with Admin's exact parent tuple and City districtId compatibility rules.

## Next action
Run the cross-repository contract audit defined in the Admin Control Center. Compare current Admin and Firebase source/tests; document exact mismatches and required tests. Do not infer production counts or execute migration.
