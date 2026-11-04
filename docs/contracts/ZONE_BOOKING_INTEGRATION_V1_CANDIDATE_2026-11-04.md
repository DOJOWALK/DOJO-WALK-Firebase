# Zone → Booking Integration Contract V1 — Candidate

**Status:** Draft / contract candidate  
**Date:** 2026-11-04  
**Scope:** Firebase backend contract only; no runtime implementation in this change.  
**Depends on:** Zone Lifecycle PR #71 and Booking validation/ownership PRs #76–#79.  
**Safety:** No merge, deployment, production reads/writes, schema migration, Rules change, or Admin/Customer/Partner UI enablement is authorized by this document.

## 1. Purpose

Define the trusted boundary between the canonical Service Zone lifecycle and Booking request processing. A booking must be assigned to exactly one currently active, approved Service Zone using the trusted saved pickup coordinates. A client must never select or assert its own `serviceZoneId`, Zone status, Boundary ID/hash, or timezone.

This document is a contract candidate and test plan. It does not claim that a Booking-to-Zone resolver or authenticated Booking callable currently exists.

## 2. Source-of-truth dependencies

### 2.1 Zone lifecycle

The Zone lifecycle implementation candidate is Firebase PR #71:

- PR: https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/71
- Head inspected: `b6d05d8158a438bb7eb09484f9d8446fbbac2186`
- Zone collection: `service_zones/{zoneId}`
- Boundary collection: `service_location_boundaries/{boundaryId}`
- Approval collection: `service_zone_approval_requests/{approvalRequestId}`

PR #71 exposes ten lifecycle callables and maintains workflow status, service-active state, verified Boundary references, Founder approval references, revisions, audit records and idempotency. Its CI at the inspected head completed 5/5 workflows successfully. It remains a separate open, unmerged PR.

### 2.2 Booking request trust boundary

Booking validation/ownership candidate chain:

- PR #76: schedule normalization
- PR #77: trusted pet and pickup snapshots
- PR #78: canonical request validation composition
- PR #79: UID-scoped saved pet/address loading and Firestore Emulator tests

PR #79 latest inspected head: `c1dd164a4561a927869a59a0adcff73c56643370`.

The trusted saved address path is `users/{request.auth.uid}/addresses/{pickupAddressId}`. The saved address coordinates, not client-supplied coordinates or Zone identifiers, are the candidate input to Zone resolution. The authenticated callable does not yet exist.

## 3. Booking eligibility predicate

A Zone is eligible for a new booking only when all conditions are true at resolution time:

1. The Zone document exists.
2. `workflowStatus == "active"`.
3. `isServiceActive == true`.
4. A current verified Boundary document exists and belongs to this Zone:
   - `locationType == "zone"`
   - `locationId == zoneId`
   - `zoneId == zoneId`
   - `verificationStatus == "verified"`
5. The Zone's verified Boundary ID and verified Boundary hash match the current Boundary document and its server-recomputed canonical geometry hash.
6. The Zone's `approvedBoundaryId` and `approvedBoundaryHash` match `verifiedBoundaryId` and `verifiedBoundaryHash`.
7. `approvedRequestId` resolves in `service_zone_approval_requests/{approvalRequestId}` to a record with `status == "approved"`, `requestType == "activation"`, matching `zoneId`, `revision == approvedRevision`, `boundaryId == approvedBoundaryId`, and `boundaryHash == approvedBoundaryHash`.
8. `approvedRevision` is the revision pinned by that approval; activation may increment the Zone's current `revision`, so the resolver must not incorrectly require `approvedRevision == current revision`.
9. `verifiedBoundaryRevision` matches the current Boundary document's `revision`; its `zoneRevision` must be consistent with the Zone revision history and must not be treated as the Boundary document revision.
10. The polygon is valid and can be evaluated by the trusted server geometry implementation.

These names follow the current PR #71 Zone Lifecycle API v1 contract candidate and implementation. Do not substitute `currentApprovalRequestId` for `approvedRequestId` when validating the completed activation approval; `currentApprovalRequestId` identifies the currently pending decision request.

A draft, pending, rejected, inactive, suspended, stale, malformed, or partially populated Zone/Boundary/approval tuple is not eligible. A previously active Zone that is suspended or deactivated must not accept new bookings. This predicate does not cancel or terminate an already-running walk.

**Important:** The exact field tuple must be confirmed against the final merged Zone contract before implementation. Do not silently treat `status`, `workflowStatus`, and `isServiceActive` as interchangeable.

## 4. Trusted point-in-polygon resolution

### 4.1 Input

The resolver accepts only a trusted saved-address record loaded by the authenticated server path. It must not accept any of these from the client as authority:

- `serviceZoneId`, `zoneId`, `boundaryId`, `boundaryHash`
- `serviceTimeZone` or `timeZone`
- arbitrary latitude/longitude that differ from the saved address snapshot

Coordinate validation:

- Latitude and longitude must be finite numeric values.
- Latitude range: [-90, 90].
- Longitude range: [-180, 180].
- Both coordinates must be present together.
- Missing, null, malformed, out-of-range, or partial coordinate pairs fail closed.
- Do not silently fall back to city, district, PIN code, radius, nearest Zone, or a client-supplied Zone ID.

### 4.2 Resolution outcome

The Founder-approved rule is **majority of the verified house footprint**, not nearest Zone and not the pickup GPS point alone.

**When a trusted, verified building-footprint polygon exists:**
1. Intersect the complete footprint with all currently eligible Zone polygons.
2. If eligible Zone polygons overlap one another within the evaluated footprint, return Admin review required.
3. Calculate each Zone's intersection area as a share of the **entire** verified building footprint. Any footprint area outside eligible Zones counts as unserved; do not renormalize only across covered fragments.
4. Select a Zone only when exactly one eligible Zone contains **strictly more than 50%** of the total footprint area.
5. If there is no strict majority, an exact tie, invalid/numerically indeterminate geometry, or a boundary/overlap conflict, return Admin review required and do not confirm a booking or create a task.

**Fallback when no trusted footprint exists:** point-in-polygon may be used only when the saved pickup point is strictly inside exactly one eligible Zone and is not on/near a boundary. If the point is on/near a shared boundary or intersects multiple eligible Zones, do not guess; require Admin review. This fallback does not claim to implement the majority-of-house rule.

The building-footprint source, provenance, verification process, geometry precision/tolerance and audit evidence are still implementation gates. Never accept a footprint or Zone choice as trusted merely because the client supplied it. A point on an outer service boundary with no qualifying majority is not service coverage.

The resolver must not use radius-only coverage. A geospatial candidate index may be used for performance only if it is server-maintained, complete for all eligible Zones, and followed by exact polygon evaluation. The index itself is not proof of coverage.

### 4.3 Required trusted resolution snapshot

After exactly one match, the server-generated booking snapshot should bind:

- `serviceZoneId`
- `serviceZoneRevision`
- `serviceBoundaryId`
- `serviceBoundaryHash`
- `serviceTimeZone` (only after the timezone source decision in Section 7 is approved)
- `zoneResolvedAt` (server timestamp)

These are server-authored values. Client-authored values or aliases must be rejected. The snapshot is evidence of the Zone/Boundary used when the booking was accepted; it does not grant a right to create future bookings if the Zone later becomes inactive.

## 5. Consistency and race protection

The resolver and booking acceptance flow must not rely on a stale cached Zone read.

Before a booking becomes confirmed/assignable, the server must revalidate the exact Zone revision, active state, Boundary ID/hash and Founder activation approval tuple used by the resolution. A Zone deactivation, suspension, Boundary replacement, or approval invalidation racing with booking acceptance must not result in a booking being confirmed against stale eligibility.

The implementation design must document how candidate discovery and Firestore transaction reads are made consistent. If the spatial candidate lookup cannot be included in a transaction, the final transaction must re-read and validate the selected Zone/Boundary/approval documents and fail if any pinned revision/hash/state changed. It must also address the possibility that a newly activated overlapping Zone was created between candidate discovery and commit; a simple re-read of only the selected Zone is insufficient to prove the exactly-one invariant.

No booking or Walk Task writes are authorized until this race/overlap consistency design has executable Emulator tests.

## 6. Required synthetic Emulator acceptance matrix

All tests must use synthetic data and a `demo-*` Firebase project. The harness must explicitly reject production project `dojo-platform-b68a3` and require the Firestore Emulator. No real customer, pet, address, Zone or payment data.

### 6.1 Positive cases

1. A valid saved pickup point strictly inside one eligible Zone and away from boundaries resolves to that Zone; if a verified footprint is used, the strict-majority rule determines the Zone.
2. The resulting snapshot contains the server-derived Zone ID, Zone revision, verified Boundary ID/hash and server timestamp.
3. A request cannot alter the resolved Zone snapshot by adding client-authored Zone fields.
4. The selected Zone is revalidated before booking acceptance and the pinned revision/hash is unchanged.

### 6.2 Negative cases

5. Point outside all eligible polygons → no coverage; no booking/task writes.
6. Point inside a draft Zone → reject.
7. Point inside a Boundary-pending or Boundary-rejected Zone → reject.
8. Point inside a verified but not Founder-approved Zone → reject.
9. Point inside an approved but not activated Zone → reject.
10. Point inside a deactivated Zone → reject.
11. Point inside an emergency-suspended Zone → reject new booking.
12. Zone says active but `isServiceActive` is false or missing → reject.
13. Missing Zone, Boundary or approval document → reject.
14. Zone's verified Boundary ID differs from the current Boundary → reject.
15. Stored Boundary hash differs from recomputed canonical geometry hash → reject.
16. Approved Boundary ID/hash differs from the currently verified Boundary → reject.
17. Approval request is pending, rejected, stale, superseded or has a mismatched Zone/revision/Boundary/hash/request type → reject.
18. Saved address has no coordinates → reject.
19. Saved address has only latitude or only longitude → reject.
20. Coordinates are strings/booleans/NaN/infinite/out of range when not supported by the canonical saved-address schema → reject.
21. Two eligible Zone polygons overlap within the verified house footprint → ambiguous; Admin review required; no booking/task writes.
22. Pickup is on/near a shared edge and no verified building footprint exists → Admin review required; no booking/task writes.
23. Verified building footprint spans adjacent, non-overlapping eligible Zones and one Zone contains strictly more than 50% of the entire footprint → resolve to that Zone; record measured area ratios and footprint evidence.
24. Verified footprint is exactly 50/50, numerically indeterminate, invalid, or has no eligible majority → Admin review required; no booking/task writes.
23. A Zone is suspended/deactivated after candidate discovery but before booking commit → commit rejected.
24. Boundary is replaced or approval invalidated after candidate discovery but before booking commit → commit rejected.
25. A second Zone becomes eligible after candidate discovery but before commit and overlaps the point → commit rejected; exactly-one condition must be re-established.
26. Client supplies forged `serviceZoneId`, `zoneId`, Boundary ID/hash or timezone → invalid request; no trusted writes.
27. Authenticated user references another user's saved address → ownership failure before Zone resolution.
28. Unauthenticated request → denied before reading user-owned records.

Every denial test must assert both the expected callable error and that no booking, Walk Task, payment intent, assignment or trusted snapshot write occurred.

## 7. Timezone contract — Founder decision recorded

**Decision:** All DOJO WALK India bookings use the IANA timezone `Asia/Kolkata` (IST), regardless of City or Zone. A Zone must not override this India-wide policy.

- The trusted server-side country configuration for India is the source of truth; clients and device timezone settings are never authoritative.
- The booking acceptance service must resolve the India country configuration and validate `Asia/Kolkata` against the runtime IANA timezone database. Do not accept a client-supplied `timeZone` or `serviceTimeZone`.
- Persist the resolved timezone as server-authored `serviceTimeZone: "Asia/Kolkata"` in the booking's trusted service snapshot, alongside the original local date/time and computed UTC instant.
- The India country configuration source/document path and its revision must be pinned in the implementation contract before runtime code is written. Do not invent or silently assume a Firestore country-config collection that is not yet present.
- A future non-India launch requires a separate country-level timezone policy; it must not change already accepted booking instants.
- India currently has no daylight-saving clock changes. The generic conversion layer must still define deterministic behavior for ambiguous/nonexistent local times in other future country configurations; no silent guessing is permitted.

Required tests:
1. India service location resolves to `Asia/Kolkata` from trusted country configuration.
2. Client timezone fields and device timezone changes cannot alter the resolved timezone or UTC instant.
3. Original local date, local time, IANA timezone, UTC instant and source-config revision are persisted together.
4. Missing, invalid or unsupported trusted timezone configuration fails closed.
5. A later country-config change does not rewrite an already accepted booking.
6. The conversion layer's ambiguous/nonexistent local-time behavior is explicit and tested before any non-India timezone is enabled.

## 8. Booking flow placement

The intended server sequence is:

1. Authenticate; take customer identity only from `request.auth.uid`.
2. Validate the strict request allowlist.
3. Load the customer's own pet and saved pickup address from UID-scoped paths.
4. Build canonical pet and pickup snapshots from trusted records.
5. Validate saved pickup coordinates.
6. Resolve exactly one eligible Zone and pin its trusted revision/Boundary/approval snapshot.
7. Resolve and pin `Asia/Kolkata` from trusted India country configuration and persist the timezone/config revision.
8. Normalize the schedule and convert local occurrences to UTC.
9. Check availability and capacity for the resolved Zone and requested time slots.
10. Quote and collect payment only after availability is confirmed, according to the approved payment contract.
11. In the final acceptance transaction, revalidate Zone eligibility and idempotency, then persist the booking and its bounded child Walk Tasks as permitted by the booking contract.

A received request is not automatically a confirmed booking, payment success, or assignable Walk Task. Immediate requests remain awaiting operations confirmation; no Partner task is created until confirmed. Regular bookings must have a finite approved end date/horizon before child task generation.

## 9. Open implementation gates

These are not to be silently guessed:

- Final Zone schema and status/eligibility tuple must be frozen against the merged PR #71 contract.
- Exact-one spatial resolution strategy, index completeness and transaction/race design.
- Verified building-footprint source/verification and majority-area algorithm for shared Zone boundaries; no point-only approximation.
- Canonical India country-configuration document path/revision and deterministic generic DST policy before non-India launch.
- Coordinate precision and accepted saved-address schema.
- Booking availability/capacity semantics and Zone scoping.
- Booking idempotency key/retention and final transaction boundaries.
- Bounded Regular schedule end-date/horizon.
- Immediate request confirmation and operations SLA.
- Payment provider/quote/refund contract.
- Canonical Walk Task schema/status transitions and role access.

## 10. Explicit non-effects

This contract candidate does not:

- implement a Zone resolver or Booking callable;
- add or modify Firestore collections, indexes, Rules, or Functions exports;
- create bookings, Walk Tasks, payment intents, assignments, or production documents;
- modify Admin, Customer, Partner or Website apps;
- migrate legacy data;
- enable any UI action;
- merge PR #71 or PRs #76–#79;
- deploy or change `main`.

## 11. Review sequence

1. Review this contract against the final Zone Lifecycle API contract and PR #71.
2. Record the trusted India country-config source/revision and the verified building-footprint source, verification and area-measurement/tolerance contract.
3. Implement synthetic Emulator fixtures and resolver acceptance tests only, including strict-majority, exact-tie, missing-footprint and race cases.
4. Run the negative cases first against the unimplemented resolver baseline; distinguish expected missing-endpoint failures from harness failures.
5. Implement the resolver on a dedicated branch only after tests are executable.
6. Add authenticated Booking callable only after resolver, timezone and ownership tests pass.
7. Add transaction/idempotency/availability/Walk Task tests before considering merge readiness.
