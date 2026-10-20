# DOJO WALK Location Master — Step 115
## Near-Collinear Segment and Numeric-Tolerance Audit

Date: 2026-10-17

### Finding and fix
- A regression case with a very shallow but representable polygon notch exposed a false rejection caused by a fixed `1e-12` tolerance in geographic-coordinate segment checks.
- Removed fixed coordinate padding from segment bounding-box checks.
- Replaced fixed determinant epsilon with a scale-aware floating-point error bound based on `Number.EPSILON` and the magnitudes of the determinant products.
- Replaced the fixed degree-squared polygon area threshold with an accumulated floating-point round-off bound, so small representable polygons are not rejected merely for being small.
- Added regression coverage for near-parallel edges with a positive gap and a small but representable polygon.

### CI verification
Both required workflows completed successfully on Firebase commit `f897e4c4a389dff7c6646b0986ab866fbc80071f`:
- Firestore Rules: [run 39034492047](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39034492047) — PASS.
- Trusted Location Geometry and Callable Tests: [run 39034492053](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39034492053) — PASS.

### Scope and limitations
- The new checks use floating-point error bounds; they are not a proof of exact geometric robustness for every possible coordinate input.
- Tests use synthetic geometry. They do not establish that real-world boundaries are authoritative, contiguous, or reconciled against current official LGD records.
- No production export/live scan, write, import, activation, or deployment was performed.

Next: Step 116 — review geographic coordinate range and ring normalization/closure edge cases.
