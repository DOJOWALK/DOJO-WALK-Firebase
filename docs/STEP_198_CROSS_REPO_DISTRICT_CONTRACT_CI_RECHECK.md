# Step 198 — Cross-Repository District Contract CI Recheck

## Exact revisions checked
- Firebase: `fix/location-index-import-rules`, HEAD `2381a8e` (contract audit).
- Admin: `step-119-boundary-geometry`, HEAD `e38091a` (strict District ID type contract report).

## CI evidence
Firebase HEAD `2381a8e`:
- Trusted Location Geometry and Callable Tests: PASS (run 39187407368).
- Test Firestore Security Rules: PASS (run 39187407377).

Admin HEAD `e38091a`:
- Service Location Geometry Tests: PASS (run 39187720104).
- Admin Web Build Check (No Deploy): PASS (run 39187720095).

## Contract result
- Admin sends a District ID for District-linked Cities and preserves legacy City payload compatibility when no District is selected.
- Firebase validates City/State/Country/District ancestry from trusted Firestore documents.
- Firebase derives District-aware Area/Locality index tuples from the stored City District relationship, rather than trusting client-supplied ancestry.
- District-linked Area/Locality save and rename maintain the legacy and District-aware index pair atomically; unsafe ownership conflicts fail closed.
- Existing unchanged-name District-linked records with both index entries missing require manual review.
- Legacy Cities without a District remain on the legacy index path.

## Release gates
- Both PRs remain Draft/Open; neither has been merged.
- CI verifies repository tests/build only. It does not prove production index completeness or production data compatibility.
- No production scan, migration, deployment, or merge was performed.
- Production rollout still requires a reviewed read-only inventory/preflight, reconciliation of manual-review cases, and separate explicit approval.
