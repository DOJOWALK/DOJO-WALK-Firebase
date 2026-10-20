# DOJO WALK Location Master — Step 118
## Area-in-City Containment Boundary Semantics

Date: 2026-10-17

### Changes
- Added a regression test confirming an Area polygon may share a portion of the parent City's boundary while remaining fully covered.
- Added a regression test confirming an Area that extends a tiny amount (`1e-9` degrees) beyond the City boundary is rejected.
- Existing `assertAreaCoveredByCity` uses Turf `booleanContains`; no implementation change was needed for these tested cases.
- The latest geometry area-stability work also translates coordinates relative to the first ring vertex before shoelace summation to reduce cancellation for small polygons far from (0, 0).

### Validation
- Regression test commit: `3ad30cc03c74b189ae2b3035af329261b1fedb35`.
- Trusted Location Geometry and Callable Tests: PASS, run [39034844130](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39034844130).
- Firestore Security Rules: PASS, run [39034844159](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39034844159).

### Scope and limitations
- The tests use synthetic rectangles and check the current library's containment semantics only.
- They do not establish legal/official City or Area boundaries, geospatial accuracy at every scale, official LGD reconciliation, or production readiness.
- No production export/live scan, write, import, activation, or deployment was performed.

Next: Step 119 — review parent/child polygon coordinate precision and containment behavior for very small geographic gaps.
