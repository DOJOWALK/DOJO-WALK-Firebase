# DOJO WALK Location Master — Step 115
## Scale-Aware Polygon Numeric Tolerance — PASS

Date: 2026-10-17

### Audit finding
A new regression test exposed a false rejection: the prior fixed `1e-12` tolerance was applied directly to cross products and coordinate bounding boxes in degree coordinates. A shallow but non-self-intersecting notch was therefore treated as touching/intersecting. The prior fixed shoelace-area cutoff also rejected small, representable polygons.

### Fixes
- Replaced fixed coordinate padding in segment bounds with exact bounds comparisons.
- Added a floating-point determinant error bound scaled to the actual products, instead of comparing cross products against a fixed degree-based epsilon.
- Replaced the fixed `1e-12` degree-squared area cutoff with a round-off bound derived from the accumulated shoelace products.
- Added regression coverage for a near-parallel positive gap and a small but representable polygon; existing self-touch, bow-tie, collinear, zero-length-edge and containment tests remain included.

### Commits
- Segment bounds adjustment: `cd64bf3669337442481a34eb366f5748547c9cec`.
- Scale-aware intersection tolerance: `41e02889feaea0959e3374abd2e495e01836e64e`.
- Corrected near-parallel test geometry: `779191384ff87b3331cafc6a493b3569a5b773df`.
- Scale-aware area tolerance: `a41c9cee27e14a38fd539370dd7fbcb0acca9a33`.
- Small polygon regression test: `0f051f2c77ed87b4748888442bc14b9f72131ae7`.

### Final CI on test commit
- Firestore Rules: PASS, run [39033453213](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39033453213).
- Trusted Location Geometry and Callable Tests: PASS, run [39033453249](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39033453249).

### Scope limits
- Floating-point predicates reduce fixed-epsilon false positives; they are not a substitute for a formally robust computational-geometry library or authoritative GIS review.
- Synthetic geometry tests do not verify official LGD records, real-world contiguous boundaries, source authenticity, or production data.
- No production export/live scan, write, import, activation, or deployment was performed.

Next: Step 116 — audit polygon ring closure, winding/orientation assumptions and behavior around the international date line.
