# Booking + Walk Task API V1 — Schema Decision Record

**Date:** 2026-11-04  
**Status:** Founder-directed schema decision record; documentation only. Runtime implementation and production rollout remain gated.  
**Repository:** `DOJOWALK/DOJO-WALK-Firebase`  
**Basis:** `BOOKING_WALK_TASK_API_V1_DECISION_CANDIDATE_2026-11-04.md`, canonical field alignment in `BOOKING_WALK_TASK_CONTRACT_V1_DRAFT.md` Section 12, Zone lifecycle PR #71, Booking validation/ownership PRs #76–#79, and approved DOJO WALK booking/Zone policies.

## 1. Decision scope

The Founder approved preparing the final V1 schema on the existing candidate basis, preserving the previously approved India timezone and Zone-majority rules.

This record fixes the cross-app data vocabulary, parent/child relationship, callable boundaries, and state ownership for implementation planning. It does **not** authorize merging, production deployment, payment capture, app cutover, live customer booking writes, or changing Firestore Rules.

### 1.1 Policy decisions treated as approved

1. India booking time is always derived from trusted `Asia/Kolkata`; neither device timezone nor a City/Zone-supplied timezone is authoritative.
2. A verified building footprint is assigned to a Zone only when exactly one eligible Zone contains strictly more than 50% of the **entire** footprint area. Do not renormalize over covered fragments.
3. If no verified footprint exists, the existing approved fallback may use the saved pickup point only when it is strictly inside exactly one eligible Zone and outside the agreed boundary-uncertainty band. This is explicitly point-based coverage, not a majority-of-building result.
4. Exact tie, no strict majority, overlapping eligible Zones, invalid/uncertain geometry, shared-edge/near-edge point, stale evidence, or unresolved coverage means review/exception and **no Booking confirmation, payment capture, task creation, or Walker assignment**.
5. A valid saved address in another Zone may be selected by the Customer; the server resolves it independently. Never silently rewrite the selected address or send it to the nearest/non-covering Zone.
6. Ordinary eligible bookings must not wait for routine Central Admin approval. Central Admin handles exceptions, alerts, overrides only where separately authorized, and operations oversight.
7. Availability must be established before payment. No cash and no coupon workflow; discount, if applicable, is a separately server-authorized price adjustment.
8. A running walk cannot be cancelled directly. Emergency stop requires safe dog/customer handover first.
9. Parent Booking ID and individual Walk Task ID are separate. Existing `walks/{walkId}` remains completed-walk/review history and is not repurposed.

### 1.2 Items this record does not silently approve

- Payment provider, merchant account, webhook signature details, refund workflow implementation and exact provider event schema.
- ServiceType enum values until matched against the approved service catalogue.
- Exact slot length, capacity numbers, Walker workload limits, overlap/buffer rules and backup wait timer.
- Exact geospatial engine/version, projection, topology repair policy, numeric tolerance and point boundary-uncertainty distance.
- Building-footprint source verification and reviewer operations rollout.
- Customer/Partner/Admin UI release, Rules deployment, data migration, production indexes or production deployment.

These must be resolved before their corresponding runtime phase. The conservative behavior when any required value is missing is fail closed.

## 2. Canonical collection model

| Collection / document | Purpose | Owner / write authority |
|---|---|---|
| `bookings/{bookingId}` | One parent customer booking/commercial record | Trusted Functions only |
| `walk_tasks/{walkTaskId}` | One executable scheduled walk occurrence | Trusted Functions only |
| `booking_idempotency/{keyHash}` | Customer request idempotency and replay result | Trusted Functions only |
| `booking_quotes/{quoteId}` | Short-lived availability and price quote | Trusted Functions only |
| `booking_payments/{paymentId}` | Payment attempt/provider binding and verified state | Trusted Functions/webhook only |
| `booking_capacity_reservations/{reservationId}` | Atomic capacity holds and consumption | Trusted Functions only |
| `booking_assignment_attempts/{attemptId}` | Walker assignment and backup attempt audit | Trusted Functions only |
| `booking_operation_exceptions/{exceptionId}` | Durable coverage, capacity, assignment and race exceptions | Trusted Functions only |
| `booking_audit/{eventId}` | Append-only booking lifecycle audit | Trusted Functions only |
| `booking_outbox/{eventId}` | Transactional events for notifications/dispatch | Trusted Functions only |
| `service_country_configs/IN` | Trusted India country configuration | Central-controlled backend setup; Functions read-only |

All collection names above are proposed canonical V1 names. The Booking-related collections do not currently all exist in production. They must be created and tested in the demo Emulator before any production rollout.

### 2.1 Trusted country configuration

Document: `service_country_configs/IN`

Required fields:
- `schemaVersion: 1`
- `countryCode: "IN"`
- `timeZone: "Asia/Kolkata"`
- `timeZoneRevision: positive integer`
- `isEnabled: true`
- `updatedAt: server Timestamp`
- `updatedBy: authorized Central Admin UID`

The Booking resolver reads this trusted document and pins `timeZone` and `timeZoneRevision` into the Booking and every Walk Task. It rejects a missing, disabled, malformed or unsupported country configuration. No client may submit or override the timezone. City and Zone documents do not override the India timezone.

## 3. Parent Booking schema

Document: `bookings/{bookingId}`

### 3.1 Identity and trusted snapshots

| Field | Type | Authority |
|---|---|---|
| `schemaVersion` | number (1) | Server |
| `bookingId` | string; equals document ID | Server |
| `customerId` | string; authenticated UID | Server only |
| `dogId` | string | Selected ID, ownership checked by server |
| `dogName` | string | Trusted pet snapshot |
| `dogDetails` | map; allowlisted fields only | Trusted pet snapshot |
| `pickupAddressId` | string | Selected ID, ownership checked by server |
| `pickupAddress` | map; canonical structured snapshot | Trusted saved address |
| `serviceZoneId` | string | Server Zone resolver only |
| `cityId` | string | Server copied from resolved Zone |
| `countryCode` | "IN" | Server |
| `timeZone` | "Asia/Kolkata" | Trusted country config |
| `timeZoneRevision` | number | Trusted country config |

### 3.2 Plan, request and lifecycle

| Field | Type | Rule |
|---|---|---|
| `bookingPlan` | enum: `one_time`, `choose_dates`, `regular`, `immediate` | Canonical app-wide enum |
| `serviceType` | approved catalogue enum | Server validates against catalogue |
| `requestVersion` | number (1) | Client protocol version |
| `requestStatus` | enum | `received`, `needs_review`, `rejected` |
| `status` | enum | Booking aggregate state below |
| `revision` | positive integer | Incremented by trusted state transitions |
| `requestedAt` | Timestamp | Server |
| `createdAt`, `updatedAt` | Timestamp | Server |
| `serviceStartDate`, `serviceEndDate` | `YYYY-MM-DD` | Server-normalized local calendar dates; finite plans only |
| `occurrenceCount` | integer | Server-derived |
| `walkTaskIds` | string[] | Server-created child IDs; bounded |
| `nextAction` | enum/string | Server response/display hint; never authorization |

Persist the normalized occurrence list in a private/server-owned schedule subdocument or bounded child schedule records when needed; do not trust a mutable client copy as the executable source. Each materialized Walk Task is the executable source for its occurrence.

### 3.3 Booking lifecycle status

| Status | Meaning |
|---|---|
| `request_pending` | Authenticated request recorded; Zone/coverage outcome is known or an exception is being resolved; no availability guarantee |
| `needs_review` | Coverage/geometry/operational exception; not payable or assignable |
| `availability_confirmed` | Server quote issued and capacity reservation held |
| `payment_pending` | Payment order initiated against the valid quote |
| `confirmed` | Verified payment and all required Walk Tasks materialized |
| `in_progress` | At least one child task is in progress |
| `completed` | All required child tasks completed |
| `cancel_requested` | Cancellation request awaiting policy evaluation |
| `cancelled` | Cancelled under policy; no child task is running |
| `rejected` | Cannot be serviced; reason recorded |

A request with an unresolved Zone/footprint exception must use `needs_review`, not appear as a confirmed booking. The system must never show a payment action for an unserviceable or unquoted request.

## 4. Walk Task schema

Document: `walk_tasks/{walkTaskId}`; exactly one document per executable occurrence.

| Field | Type | Authority |
|---|---|---|
| `schemaVersion` | number (1) | Server |
| `walkTaskId` | string; equals document ID | Server |
| `bookingId` | string | Server parent reference |
| `customerId` | string | Copied from parent |
| `walkerId` | string or null | Server assignment only; null before assignment |
| `dogId`, `dogName`, `dogDetails` | canonical identity + snapshot | Copied from trusted parent |
| `pickupAddressId`, `pickupAddress` | canonical reference + snapshot | Copied from trusted parent |
| `serviceZoneId`, `cityId` | string | Copied from server-resolved parent |
| `countryCode` | "IN" | Copied from parent |
| `scheduledAt` | Firestore Timestamp | Server conversion from selected local time |
| `timeZone` | "Asia/Kolkata" | Copied from trusted parent |
| `timeZoneRevision` | number | Copied from trusted parent |
| `serviceDateKey` | `YYYY-MM-DD` | Server-derived in Asia/Kolkata |
| `durationMinutes` | integer, 20–60 | Validated request |
| `status` | canonical task enum | Server transition only |
| `assignmentStatus` | `unassigned`, `assigned`, `accepted`, `backup_required`, `exception` | Server |
| `assignmentAttemptCount` | non-negative integer | Server |
| `pickupConfirmedAt`, `startedAt`, `completedAt` | Timestamp or null | Server-authorized events |
| `createdAt`, `updatedAt` | Timestamp | Server |
| `revision` | positive integer | Server |

The task may also carry a minimal verified payment reference (for example `paymentId` or `paymentVerifiedAt`) but must not duplicate provider secrets, card/bank data or the full payment instrument.

### 4.1 Task states and protected transitions

`awaiting_assignment` → `assigned` → `accepted` → `picked_up` → `in_progress` → `completed`

Exceptional states: `backup_required`, `handover_required`, `cancelled`, `missed`.

- `walkerId` remains null until server confirms an active, approved Walker with a current assignment to the exact Zone.
- Walker cannot self-assign or change Zone, customer, dog, pickup, time, duration or payment fields.
- `in_progress` cannot transition directly to `cancelled`.
- Emergency stop must first record the required dog/customer handover evidence and authorized actor.
- Existing legacy Partner display value `walking` may be read through a compatibility adapter; all new writes use `in_progress`.

## 5. Request and callable API

All callable Functions use region `asia-south1`, Firebase Authentication, strict payload allowlists, App Check enforcement when enabled for the supported clients, stable error codes and server-owned writes.

### 5.1 `createBookingRequest` — customer callable

Allowed request keys only:
- `requestVersion`
- `idempotencyKey` (UUID v4)
- `bookingPlan`
- `serviceType`
- `dogId`
- `pickupAddressId`
- `schedule` (plan-specific customer selection)

Never accept authoritative `customerId`, `dogName`, `dogDetails`, `pickupAddress`, coordinates, `serviceZoneId`, `cityId`, `timeZone`, `scheduledAt`, price, payment state, task ID, Walker ID or status.

Server sequence:
1. Require `request.auth.uid`; reject unauthenticated callers.
2. Load the pet and saved address only under `users/{uid}/pets/{dogId}` and `users/{uid}/addresses/{pickupAddressId}`.
3. Normalize the strict allowlisted schedule; enforce 20–60 minutes, finite plan rules, no duplicate dates/slots, 31 calendar-day maximum and 90-occurrence maximum. Do not partially accept a truncated schedule.
4. Build canonical dog and pickup snapshots from trusted records.
5. Read trusted `service_country_configs/IN`; pin `Asia/Kolkata` and revision.
6. Resolve Zone using the verified-footprint majority policy or the approved safe point fallback. Do not accept client Zone/City.
7. Persist `request_pending` when valid and routable, or `needs_review` / a durable exception when coverage is ambiguous or unserviceable. Do not create Walk Tasks, reserve capacity or initiate payment here.
8. Return `bookingId`, `requestStatus`, `status`, `revision` and next action. Do not claim a slot, payment or Walker has been secured.

Same customer + same idempotency key + same normalized payload returns the same Booking. Same key with different payload returns `already-exists` and changes nothing.

### 5.2 `createBookingQuote` — customer callable

Request: `bookingId`, `expectedRevision`.

- Re-read parent, pet/address ownership binding, current Zone/Boundary/approval tuple and footprint evidence.
- Re-resolve coverage from trusted saved address/footprint; reject stale Zone/Boundary/approval or changed footprint version/hash.
- Check every requested occurrence for slot and eligible Walker capacity.
- If any required occurrence cannot be served, do not issue a payable quote or partially reserve the booking. Return a clear unavailable result and safe alternative slots only when those alternatives are actually checked.
- If all occurrences are available, atomically create a short-lived quote and capacity reservation.
- Quote binds customer UID, Booking ID/revision, Zone ID and revisions, boundary ID/hash, footprint version/hash or point-fallback marker, exact occurrences, duration, price breakdown, currency, and expiry.
- Quote expiry: 10 minutes is the proposed V1 default; quote TTL remains a configurable implementation gate and must be confirmed against payment provider behavior before enabling payments.
- No client-authored price, discount, capacity, slot or availability value is authoritative.

### 5.3 Payment initiation and verification

- Payment order creation is permitted only from a valid, unexpired quote with capacity reserved.
- The provider amount/currency/order binding is created server-side from the quote.
- Only a verified provider webhook or trusted server-to-server provider verification may set payment to paid.
- Validate provider signature/authenticity, merchant account, event/order/payment identifiers, amount, currency, booking, quote and customer binding.
- Duplicate provider event is idempotent. Wrong amount/currency/binding is rejected and creates an auditable exception; never mark paid.
- Client success page or client-supplied `paymentStatus: "paid"` is not proof.
- Payment provider schema and webhook secrets are a separate integration decision; do not invent or store provider secrets in Firestore.

### 5.4 `confirmBookingAndCreateWalkTasks` — trusted backend only

This is not an unrestricted customer callable. It is invoked only after verified payment.

1. Validate paid provider event and quote binding/expiry rules.
2. Re-read Zone eligibility, boundary/approval tuple, saved pickup/footprint evidence, timezone configuration and capacity reservation.
3. Verify no relevant revision or evidence changed after quote.
4. Create all required tasks and transition parent to `confirmed` in one transaction where Firestore limits allow.
5. If a bounded multi-stage task-generation protocol is required, use an explicit non-assignable `materializing` state; parent cannot become `confirmed` and no task can be assigned until all expected tasks exist and counts/hashes reconcile.
6. Create outbox and audit events atomically with final confirmation.
7. Idempotent retries return the same task IDs; never create duplicate tasks.

### 5.5 Automatic Walker assignment

- After paid tasks are materialized, the assignment service attempts eligible Walkers automatically; routine Central Admin approval is not a prerequisite.
- Candidate Walker must be proven eligible from the current Partner/Walker source schema before implementation: active and approved state, exact Zone assignment, availability, schedule overlap, skills and workload capacity must all be checked server-side. The field names `isActive`, `isApproved`, `status == "approved"` and collection `walker_zone_assignments` are **unverified candidates**, not approved canonical schema. Do not implement against these names until the Partner repository and current assignment model are audited and the exact contract is recorded.
- Assignment also checks schedule overlap, availability, skills/operational eligibility and capacity using the finalized Walker schema; no profile preference alone authorizes assignment.
- Assignment uses a transaction/lease so two tasks cannot consume the same Walker availability concurrently.
- If no eligible Walker is available, task remains unassigned with `assignmentStatus: "backup_required"` or `exception`; do not falsely confirm a Walker. Notify operations through outbox/exception. The already paid Booking remains visible with an honest operational status and applicable customer communication.
- Primary Walker timeout, backup timing, navigation-start detection and the existing 5–10 minute additional wait target must be implemented from the separately approved operations policy; this schema does not fabricate a timeout value.
- A Zone suspended after payment blocks new assignment; already-running walks follow the emergency/handover policy.

## 5.6 Partner App source audit and compatibility gate

Source audit: `DOJOWALK/DOJO-WALK-Partner` default branch, inspected files `firestore.rules`, `lib/screens/auth/account_check_screen.dart`, `lib/screens/home/partner_home_screen.dart`, `lib/screens/home/working_schedule_screen.dart`, and `lib/features/onboarding/screens/work_location_screen.dart`.

Verified existing Walker profile contract at `walkers/{walkerUid}`:
- Account eligibility currently checks `isApproved == true`, `isActive == true`, and `status == "approved"`.
- Admin Rules permit Walker status values `under_review`, `approved`, `rejected`, `suspended`, and `inactive`; `verificationStatus` values are `pending`, `verified`, and `rejected`.
- The onboarding flow stores `zones` as a list of document IDs sourced from the legacy `zones` collection, plus display fields `zoneName` and `zoneNames`. This is not evidence of a `walker_zone_assignments` collection.
- Working hours are stored in profile field `workingSchedule`, with `status: "active"` and `days.{monday..sunday}.{enabled,start,end}`. The UI validates end after start.
- Partner Home currently queries `bookings` by `walkerId`, filters by legacy `date` and `startTime`, and treats `assigned`, `accepted`, `picked_up`, and `walking` as active statuses.
- Partner Home uses device-local `DateTime.now()` for its Today filter. The new canonical Partner adapter must instead derive the service day from `scheduledAt` and trusted `timeZone` (India: `Asia/Kolkata`).
- The Partner Firestore Rules shown in this repository have no `walk_tasks/{walkTaskId}` match. Default-deny therefore blocks Partner task reads/writes until explicit least-privilege task rules and query tests are added.
- Current `bookings/{bookingId}` rules allow reads for Admin, owning Customer, or assigned Walker; client booking creation is denied. Walker progress updates currently target the Booking document and permit legacy fields including `walkSchedules`, `walkNotes`, `peeCount`, `poopCount`, `distance`, and `durationActual`. These must be mapped to a trusted task-progress API, not copied as unrestricted writes to the new task schema.
- **Rules/UI mismatch found:** `working_schedule_screen.dart` writes `workingSchedule` on `walkers/{uid}`, but the Walker-owner profile update allowlist in this Partner repository's `firestore.rules` does not include `workingSchedule`. This write appears denied under the inspected Rules. Verify against the deployed Rules/version and add a focused Emulator test before relying on working hours for automatic assignment.

Migration gates:
1. Audit Admin and Firebase Rules/repositories for the authoritative source of Zone IDs; the Partner app's legacy `zones` IDs cannot be assumed to equal `service_zones` IDs.
2. Add an explicit compatibility adapter from `walk_tasks` to Partner Today/Upcoming/Active screens; do not silently query parent `bookings` as if it were one task per walk.
3. Define server-authorized progress callables/events for accept, pickup, start, complete, emergency handover and GPS evidence. Keep sensitive status and assignment fields server-owned.
4. Resolve the workingSchedule Rules/UI mismatch and define how `availability` subcollection documents combine with `workingSchedule`; neither alone proves a free slot.
5. Build Partner Emulator Rules tests for assigned-only task reads, exact Walker UID binding, forbidden assignment/status writes, and allowed progress transitions.
6. Preserve legacy completed `walks/{walkId}` review history separately.

No Walker assignment collection or canonical availability capacity schema is approved by this audit. The current Partner source proves only profile-level Zone ID list and weekly working hours; it does not prove atomic slot capacity, schedule conflict handling, task concurrency locks, or a trusted assignment API.

## 6. Zone and building-footprint evidence pinned to Booking

Booking stores the resolution evidence so later Zone edits cannot silently rewrite history:

Before a resolver treats a Zone as eligible, it must re-read and validate the live Zone document and the referenced approval record: `workflowStatus == "active"`, `isServiceActive == true`, verified Boundary ID/revision/hash match, and the exact `approvedRequestId` document must exist with `status == "approved"`, `requestType == "activation"`, matching `zoneId`, `revision == approvedRevision`, `boundaryId == approvedBoundaryId` and `boundaryHash == approvedBoundaryHash`. This mirrors the activation/approval checks in the Zone lifecycle callable; an `approved` label alone is insufficient.

- `serviceZoneId`, `cityId`
- `zoneRevisionAtResolution`
- `boundaryIdAtResolution`, `boundaryRevisionAtResolution`, `boundaryHashAtResolution`
- `approvalRequestIdAtResolution`, `approvedRevisionAtResolution`
- `coverageMethod`: `verified_footprint_majority` or `saved_address_point_fallback`
- For footprint: `buildingFootprintId`, `buildingFootprintVersion`, `buildingFootprintHash`, `footprintAreaModelVersion`, and per-Zone intersection share audit reference.
- For point fallback: saved address coordinate snapshot/hash and resolver version.

Do not copy the full private building polygon into Customer/Partner-visible Booking DTOs or Walker views. Store detailed geometry calculation evidence in a server-only audit/resolution record with restricted access. Walker sees only the assigned Zone and pickup operational details needed to perform the walk.

A resolver must use a deterministic pinned geometry implementation. Raw latitude/longitude degree-squared is prohibited for area ratios. No implementation is considered ready until tests prove known ratios, holes/multipolygons policy, invalid topology behavior, strict-majority threshold, exact ties, overlapping Zones, and precision/tolerance handling. The actual geometry package/version and numerical tolerance remain a technical review gate.

## 7. Capacity reservation and idempotency

### 7.1 Capacity

- Capacity is reserved before payment, not after it.
- Reservation is bound to Booking, Zone, exact occurrence/slot, duration, Walker capacity model version and expiry.
- Reservation and quote creation are atomic; concurrent requests for the last available capacity unit cannot both succeed.
- A quote expiry or payment failure releases the hold idempotently.
- Paid capacity is consumed when tasks are materialized.
- Do not rely on a client-side availability check or a non-transactional count query as the capacity lock.
- Slot key/partitioning and capacity source (Zone slot inventory versus Walker-specific schedule) must be selected after auditing the current Walker/availability schema. Until then the Emulator must use an explicit test-only adapter and must not be represented as production capacity implementation.

### 7.2 Idempotency

- Client generates one UUID v4 per submission and reuses it on retries.
- Store a hash of customer UID + idempotency key; never store a raw secret/token.
- Persist normalized payload hash, Booking ID, response, created timestamp and retention metadata.
- Same key + same payload returns the original result; same key + changed payload returns conflict.
- Provider webhook idempotency is separate and keyed by provider event/order/payment identity.
- Keep request idempotency for at least 180 days and longer while a Booking/payment/dispute remains unresolved. Do not TTL-delete active lifecycle evidence.

## 8. Schedule and date rules

- All India date/time selections are interpreted in `Asia/Kolkata`.
- Server converts local date/time to one Firestore `scheduledAt` Timestamp and derives `serviceDateKey` as `YYYY-MM-DD` in Asia/Kolkata.
- Persist `scheduledAt`, `timeZone`, `timeZoneRevision`, `serviceDateKey`, `durationMinutes`; no competing authoritative `date` and `startTime`.
- One-Time: one occurrence.
- Choose-Dates: explicit finite selected occurrences.
- Regular: explicit finite calendar start/end dates; calendar-month example 7th to 6th; maximum 31 calendar days and 90 occurrences in V1. No indefinite subscription/task generation.
- Immediate: no device-clock-derived appointment. It enters operations/availability handling and cannot be charged/assigned until an actual slot is checked, quoted and paid.
- If timezone config is missing/invalid, reject. Do not fall back to device locale/timezone.

## 9. Security and read model

- Customer may read only their own Booking and associated tasks through authorized query/service paths.
- Walker may read only tasks assigned to their UID and only operational fields required for the walk.
- City Manager visibility is limited to Zones in their assigned City; Central and Founder visibility follows the approved authority model.
- Supervisor sees only assigned Zone operational data.
- No client writes to Booking status, Walk Task status, customer identity, dog/pickup snapshots, Zone/City, schedule, price, payment state, task IDs, Walker assignment, audit, capacity, idempotency, quote or outbox.
- Customer and Walker/Partner must not read or enumerate building footprint geometry or private review evidence.
- Exact Firestore Rules and query shapes require Emulator acceptance tests; this record does not deploy Rules.

## 10. Required Emulator acceptance suite

Before production callable is called ready, run tests against the actual exported callable and Firestore Emulator, not only a reference-model oracle.

Minimum scenarios:
1. Unauthenticated caller rejected.
2. Authenticated owner pet/address accepted; foreign pet/address rejected identically without data disclosure.
3. Forged `customerId`, dog/pickup snapshots, coordinates, Zone/City, timezone, price, payment, status and task IDs rejected.
4. Same idempotency key/same payload returns one Booking; changed payload conflicts.
5. Active exact Zone + verified Boundary + exact approved activation request accepted.
6. Inactive, suspended, stale, partially approved, wrong Boundary/hash/revision or wrong approval request rejected.
7. Verified building footprint strict >50% selects one Zone.
8. Exact 50/50 tie, no majority, overlapping Zones, invalid polygon, uncertain geometry and shared edge require review; no Booking confirmation/task/payment writes.
9. Entire footprint denominator is used; uncovered portion is not renormalized away.
10. Point fallback succeeds only strictly inside one eligible Zone and outside uncertainty band; edge/overlap fails closed.
11. A saved address in a different Zone resolves to that Zone, not the previous Booking Zone.
12. Country config pins Asia/Kolkata; client/device timezone ignored; missing/invalid config rejects.
13. One-Time, Choose-Dates, Regular 7th-to-6th, Immediate and invalid schedule cases.
14. Duration below 20 or above 60 rejects; more than 31 days or 90 occurrences rejects without partial writes.
15. Availability before payment; no quote/payment order when unavailable.
16. Atomic last-slot reservation under concurrent requests; no oversell.
17. Quote expiry releases reservation; stale Zone/Boundary/footprint invalidates quote.
18. Payment wrong amount/currency/order/customer/quote binding rejected.
19. Duplicate provider webhook creates one paid transition and one task set.
20. Parent cannot become confirmed until every task exists; bounded generation cannot expose partial assignable tasks.
21. Exact Zone Walker assignment required; inactive/unapproved/unassigned/wrong-Zone Walker rejected.
22. Concurrent task assignment cannot double-book a Walker.
23. No Walker available creates durable exception; no false assignment or hidden booking confirmation.
24. Running walk cannot be cancelled directly; emergency handover required.
25. Every denial asserts no forbidden Booking, task, payment, capacity, assignment or outbox writes.
26. Audit and outbox events are atomic and idempotent.
27. Rules tests prove Customer/Partner/Manager/Supervisor/Central/Founder read boundaries and deny all protected client writes.
28. Race tests mutate Zone, Boundary, approval, footprint or country config between quote and confirmation; final commit rejects stale versions.

The existing 8-case Automatic Booking Emulator suite is a test-only reference oracle. It is not evidence that the production callable, resolver, capacity service or payment path works. Keep it separate from the actual callable integration suite.

## 11. Implementation order and release gates

1. **Schema + DTO tests:** validate shared canonical Booking/Walk Task fields and strict request allowlists.
2. **Trusted source + Zone eligibility:** UID-scoped pet/address loader; exact Zone/Boundary/approval tuple; country config.
3. **Geometry resolver:** pinned geospatial implementation and building-footprint review evidence; majority and safe point fallback.
4. **Authenticated request callable:** create parent only; no task/payment.
5. **Availability + capacity:** atomic quote/hold, concurrent acceptance tests.
6. **Payment adapter:** provider sandbox, signature/amount/currency/idempotency tests; no live keys in source.
7. **Task materialization:** verified paid event, bounded atomic generation, audit/outbox.
8. **Automatic Walker assignment:** exact Zone assignment, capacity, race and backup tests.
9. **Security Rules + app contract integration:** Customer, Partner, Admin parity tests.
10. **Staged release:** demo Emulator → provider sandbox → explicit Founder review → production deployment approval.

No later stage is considered PASS merely because an earlier unit test or reference-model test passes. Production readiness requires actual callable integration evidence and explicit rollout approval.

## 12. Current implementation reality

At the time of this record:
- Pure schedule normalizer, trusted pet/pickup snapshot builders, canonical request validator and UID-scoped saved source loader exist on separate draft PRs.
- Zone lifecycle callables exist on PR #71's separate unmerged branch.
- Automatic Booking's 8 Emulator tests are a test-only reference model.
- No production Booking callable, actual Booking Zone resolver, real capacity reservation service, verified payment adapter, Walk Task materializer or automatic Walker assignment service has been proven to exist on the current Booking branch.
- The saved Customer address model currently has scalar latitude/longitude only; a verified building-footprint source and reviewer workflow are still required for majority coverage.

This decision record therefore finalizes the V1 **schema and integration direction**, not the runtime implementation or production authorization.
