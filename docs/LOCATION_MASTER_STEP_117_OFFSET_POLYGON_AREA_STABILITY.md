# DOJO WALK Location Master — Step 117
## Stable Polygon Area Calculation Away from Coordinate Origin

Date: 2026-10-17

### Finding
The scale-aware area threshold from the numeric-tolerance audit still used absolute longitude/latitude products in the shoelace sum. For a tiny polygon located far from (0, 0), those large products can nearly cancel and make a valid, representable polygon look degenerate.

### Changes
- Translate each ring vertex by the first vertex before calculating shoelace area.
- Retain a floating-point error bound scaled to the translated products.
- Add a regression test for a small polygon near longitude 77.2090 and latitude 28.6139.
- Earlier Step 115 regression tests remain in the suite, including a shallow near-parallel gap and a small representable polygon near the origin.

### Commits
- Geometry fix: `a97b9730aec1f6bb9d94b8be66dfd80d243dc69a`.
- Offset-polygon regression test: `cb6beb5a949c6f0c35e3718429ef56329661b3de`.
- Audit trail update: `c3aa08d946717b84d21c4667888b07590f16feb8`.

### CI
- Firestore Rules: PASS — [run 39034649437](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39034649437).
- Trusted Location Geometry and Callable Tests: PASS — [run 39034649439](https://github.com/dojoplatform2026/DOJO-WALK-Firebase/actions/runs/39034649439).

### Scope and limitations
- Tests use synthetic coordinates and establish behavior of this implementation only.
- They do not establish authoritative GIS boundary accuracy, contiguity, source authenticity, or current official LGD reconciliation.
- No production export/live scan, write, import, activation, or deployment was performed.

Next: Step 118 — review numerical stability and boundary semantics in area-within-city containment checks.
