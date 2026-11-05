# Building Footprint — Firestore Emulator Test Plan v1

**Status:** Test specification only; not executed.
**Related:** Admin PR #58; Firebase PR #80; Zone lifecycle PR #71.
**Environment:** Firebase Emulator Suite with a `demo-*` project ID only.

## 1. Test objective

Prove that only a verified, current, server-owned building footprint linked to the authenticated customer's own saved address can influence Booking Zone resolution. Prove that ambiguous geometry, invalid ownership, stale Zone/Boundary versions or race conditions fail closed and create no booking/task/payment/assignment records.

The Admin proposal suggests a separate Building Footprint domain. Final Firestore path/schema, callable names and Rules are not approved yet. The test harness must be written against the approved schema after review; do not create production collection assumptions in app code.

## 2. Synthetic fixture set

Create only in-memory/emulator fixtures:
- Customer Alice and Bob, each with their own synthetic `users/{uid}/addresses/{addressId}`.
- Central Admin with explicit footprint-create permission; Central Admin without permission; inactive Admin.
- Reviewer with exact active case assignment; reviewer without assignment.
- Two eligible synthetic Zones A and B with approved current boundaries and synthetic approval tuples.
- One synthetic verified building polygon split 70/30, one split 51/49, one exact 50/50, one 49/49 with 2% outside coverage, one with 60% in A / 40% outside, one invalid/self-intersecting polygon, and one footprint whose geometry hash is stale.
- A synthetic ineligible Zone (inactive or stale boundary) and an overlapping eligible Zone fixture.
- Use fixed coordinates around a synthetic local grid; no actual customer addresses, home coordinates or production identifiers.

## 3. Required Firestore Emulator test groups

### A. Authentication, role and address ownership
1. Unauthenticated footprint draft request is denied.
2. Inactive Admin or missing permission is denied.
3. Authorized Central Admin can create a pending draft for an existing owned-address reference through the trusted server operation.
4. Client-supplied `ownerUid` cannot change the authenticated owner.
5. Alice cannot create or associate a footprint with Bob's address.
6. Reviewer without an exact active assignment cannot verify.
7. Submitter cannot review their own footprint.
8. Customer and Partner clients cannot write, read or enumerate footprint geometry.
9. Client cannot set `verificationStatus=verified`, reviewer identity, geometry hash or current-version pointer.

### B. Geometry, provenance and version integrity
10. Fewer than three distinct vertices, invalid coordinates, zero-area, self-intersection and repeated zero-length edges are rejected.
11. Missing/unsupported provenance metadata is rejected.
12. Geometry hash mismatch is rejected.
13. A valid draft is stored pending only; it is not returned as a trusted footprint.
14. Reviewer approval stores reviewer UID, timestamp, source evidence reference, canonical hash and immutable version.
15. Rejection requires a reason and never activates the footprint.
16. Editing an approved geometry creates a new pending version; verified version is not overwritten.
17. Stale address association, changed saved pickup location or superseded footprint is not eligible.
18. Idempotent replay with the same payload returns the same result; changed payload under the same key conflicts.
19. Stale expected version/hash at review or commit is rejected.
20. Every successful state transition writes an audit event.

### C. Majority resolver integration
21. 70/30 and 51/49 verified footprint fixtures resolve to the strict-majority Zone.
22. 50/50 exact tie returns Admin-review-required.
23. 49/49 with 2% outside coverage returns no majority; do not renormalize covered fragments.
24. 60% in Zone A / 40% outside all eligible Zones resolves to A.
25. Overlapping eligible Zone polygons within the footprint return conflict and no Zone selection.
26. Missing verified footprint is not silently replaced with a majority claim based on the pickup point.
27. Invalid or numerically indeterminate geometry returns Admin-review-required.
28. Inactive, suspended, pending, stale or unapproved Zone is excluded from eligible coverage.
29. Zone activation/deactivation or Boundary/approval tuple changes between resolution and booking commit force revalidation; stale result cannot commit.
30. Footprint version/hash changes between resolution and commit reject the transaction.
31. A new eligible Zone overlap discovered before commit forces a fresh majority calculation.
32. Any denied/ambiguous result creates no Booking, Walk Task, payment capture, assignment or notification side effect.

## 4. Assertions required in every test

For each denial/ambiguity case, assert both:
- Expected structured outcome/error and reason code.
- No forbidden documents were created or changed in `bookings`, `walk_tasks`, payment/assignment collections, or footprint current-version pointers.

For success cases, assert:
- Resolved Zone ID and exact Zone revision/Boundary ID/hash.
- Footprint ID/version/hash and area shares used.
- Resolver version and server resolution timestamp.
- Trusted timezone snapshot is `Asia/Kolkata` from the approved India country configuration; no client/device timezone affects it.

## 5. Emulator safety controls

- Refuse to run unless project ID begins with `demo-`.
- Explicitly reject `dojo-platform-b68a3` and any non-demo project ID.
- Use Auth + Firestore Emulators for role and ownership tests; no real Firebase Auth.
- No production credentials, customer records, live API calls or external geocoding.
- Run tests serially where shared emulator state exists.
- Clear fixture collections before/after each test group.
- CI must report the exact commit SHA, emulator command, test count and per-suite result.

## 6. Current blockers before executable tests

1. Founder approval of Admin PR #58's source/evidence and independent reviewer policy.
2. Final Firestore footprint collection/version path and trusted ownership linkage.
3. Final role/permission names and whether current Zone boundary-review assignment mechanism is reused or a dedicated footprint-review assignment is introduced.
4. Server geometry implementation, area model/projection, precision/tolerance and deterministic reason codes.
5. Firestore Rules and indexes for the approved schema.
6. Transaction contract for Zone/Boundary/footprint revalidation at booking commit.

Until these are decided, this document is an acceptance plan only. Do not add placeholder Rules or runtime code that could accidentally permit client access.


## 7. Geometry implementation audit (2026-11-04)

The current Firebase Functions geometry helper `functions/src/location_geometry.ts` uses Turf validity and containment helpers and includes defensive ring checks. It validates Zone/Area polygons and parent containment; it does **not** currently calculate polygon intersection area or a building-footprint majority share.

The current Functions dependencies include `@turf/boolean-valid`, `@turf/boolean-contains` and `@turf/helpers`; the reviewed package manifest does not declare Turf intersection/area modules. Do not implement majority by applying the existing point-in-polygon helper, by using the pickup point, or by dividing raw latitude/longitude degree-squared values.

Before coding the resolver, select and pin a deterministic geospatial implementation that:
- Validates footprint and Zone polygons and handles holes/multipolygons if they are allowed by the final schema.
- Computes polygon intersection and area in a documented metric/equal-area model suitable for the pilot geography, not raw degree-squared arithmetic.
- Defines numerical precision, tolerance, tie/near-tie behavior and invalid-topology handling.
- Has synthetic unit fixtures with known area ratios and regression tests.
- Produces an auditable set of per-Zone intersection areas/shares and geometry/version hashes.

The current Zone review callable provides a useful independent-review pattern: active reviewer permission, exact assignment in `zone_boundary_review_assignments`, submitter self-review rejection, and transaction-time revalidation. Footprint review should use a dedicated assignment scope/collection and a dedicated callable, not the Zone Boundary review assignment record.

This section records read-only findings and does not approve a library, schema, permissions or callable names.
