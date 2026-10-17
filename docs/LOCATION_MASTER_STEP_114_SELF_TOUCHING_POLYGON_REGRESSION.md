# DOJO WALK Location Master — Step 114
## Self-Touching Polygon Regression Coverage

Date: 2026-10-17

### Change
- Added a regression test for a polygon ring that revisits a non-adjacent vertex and touches itself.
- Added a regression test for a non-adjacent vertex that lies on another ring edge.
- Existing `assertSimpleNonZeroAreaRing` pairwise segment-intersection validation rejects these malformed rings with `BOUNDARY_POLYGON_INVALID`; no production geometry behavior change was required.

### Validation
- Test commit: `adcebc7e97f9e0cc875cc00de589a00ab64ad890`.
- Firestore Rules CI: PASS, run [39032681538](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39032681538).
- Trusted Location Geometry and Callable Tests: PASS, run [39032681526](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39032681526).

### Scope and limitations
- These are synthetic regression geometries and automated checks only.
- They do not prove that a real-world boundary is authoritative, contiguous, correctly sourced, or reconciled with current official LGD records.
- No production export/live scan, write, import, activation, or deployment was performed.

Next: Step 115 — audit near-collinear segment handling and the fixed numeric tolerance for geographic coordinates.
