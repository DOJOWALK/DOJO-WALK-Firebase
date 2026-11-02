# Cross-App Booking Lifecycle Audit — Draft
Date: 2026-11-02
Status: Source audit / review draft only. Not an approved contract, implementation, deployment, or device-test result.

## Scope and method
Reviewed current default-branch source search results across:
- `DOJOWALK/DOJO-WALK-Customer`
- `DOJOWALK/DOJO-WALK-Partner`
- `DOJOWALK/DOJO-WALK-Admin`
- `DOJOWALK/DOJO-WALK-Firebase`

This document records observed writers/readers and mismatches. It does not treat existing UI labels, Firestore Rules permissions, older audit documents, or PR-only changes as proof of a production workflow. Existing Notion policies remain the decision source and are Draft pending approval.

## 1. Observed cross-app matrix

| Area | Current source evidence | Audit result |
|---|---|---|
| Customer booking creation | Re-fetched `lib/features/booking/screens/booking_confirmation_screen.dart`: reads `users/{uid}/pets/{dogId}`, generates `bookings/{bookingId}`, writes `bookingId` equal to the document ID, `customerId`, `scheduledAt`, `preferredTime`, `walkSchedules`, `status: pending`, `walkerId: null`, `cancelRequest: null`, and `createdAt`. | Confirmed current main source. Customer writes `scheduledAt`/`preferredTime`; no `date`/`startTime` fields appear in this booking payload. It directly creates the Firestore document rather than calling a trusted booking-create callable. |
| Customer booking list | `lib/features/booking/screens/my_bookings_screen.dart` reads `bookings` filtered by `customerId`, derives status from `status`, and sorts by `scheduledAt`. | Customer is a reader of booking status. |
| Customer status vocabulary | Same file treats `pending`, `finding_walker`, `walker_assigned`, `walker_arriving`, `confirmed`, `assigned`, `accepted`, and `in_progress` as upcoming; UI labels map several legacy values separately. | Multiple vocabularies coexist. Must be mapped to one approved canonical state machine. |
| Customer cancellation | `my_bookings_screen.dart` writes a `cancelRequest` object in a Firestore transaction; Firebase rules constrain allowed parent states and fields. | Request is not equivalent to server-confirmed cancellation/refund. Align with POL-010/POL-012 and the approved 12-hour framework; do not invent charges. |
| Partner assignment consumption | Re-fetched `lib/screens/home/partner_home_screen.dart`: queries `bookings` by `walkerId == uid`, filters today's bookings using `data['date']`, and sorts by `startTime`; active statuses are `assigned`, `accepted`, `picked_up`, `walking`. | Partner consumes assignment; this is not the assignment engine. **Schema mismatch:** Customer writes `scheduledAt` and `preferredTime`, while Partner Home reads `date` and `startTime`. No mapping/adapter is proven here, so same-day display and ordering are not guaranteed. |
| Partner accept | `walk_details_screen.dart` directly updates booking `status: accepted`. | Client-side lifecycle write; requires server-authoritative transition. |
| Partner pickup / walking | Re-fetched `lib/screens/home/navigation_screen.dart`: `_updateBookingStatus(status)` directly updates `bookings/{bookingId}` with `status` and `updatedAt`; callers write `accepted`, `picked_up`, and `walking`. | Client writes booking lifecycle directly. **Fail-open defect in current default-branch source:** when `bookingId` is null/empty, helper returns `true` without writing. PR #24 proposes a fail-closed fix but remains open/unmerged; do not treat that PR as main-branch behavior. |
| Partner completion | Re-fetched `lib/features/live_walk/screens/live_walk_screen.dart`: writes `walks/{_walkDocumentId}` with `status: completed`, `dogReturned: true`, route/metrics, then separately updates `bookings/{bookingId}` to `completed` with `completedAt`, `dogReturned`, `returnLocationVerified`. | Client assertion is not verified handover proof; the two writes are sequential, not one atomic trusted operation. If the walk write succeeds and booking update fails, records can diverge. |
| Admin booking view | `lib/screens/bookings/bookings_screen.dart` reads and displays booking status and Walker name/ID. | Display/read path, not an assignment workflow. |
| Admin live operations | `lib/screens/live/live_operations_screen.dart` reads bookings by `walkerId` for operational display. | Read/monitor path, not a matching engine. |
| Firebase Functions | Current exported callable inventory previously audited in `index.ts` contains service-location/import functions only; no booking assignment/offer/accept/decline/expiry/reassignment callable was found. | Trusted booking assignment backend not present in reviewed exports. |
| Firebase Rules | Existing booking rules include customer cancellation request restrictions and constrained Walker lifecycle updates; Admin update permissions can permit assignment fields. | Rules authorize particular writes; they do not implement sequential offers, eligibility ranking, expiry, atomic winner selection, or trusted lifecycle orchestration. |

## 2. Status vocabulary reconciliation required

Observed values include:
- Customer-facing/legacy: `pending`, `finding_walker`, `walker_assigned`, `walker_arriving`, `confirmed`, `assigned`, `accepted`, `in_progress`, `completed`, `cancelled`.
- Partner lifecycle: `accepted`, `picked_up`, `walking`, `completed`.
- Proposed shared contract lifecycle: `draft`, `submitted`, `validated`, `searching_walker`, `offer_pending`, `assigned`, `in_progress`, `completed`, `cancelled`, `needs_operations`, `failed`.

These are not yet proven to be mutually compatible. Do not silently alias or write new values until the contract and Notion policy are approved. In particular:
1. Decide whether `accepted` means accepting an offer or merely confirming an already assigned booking.
2. Define whether pickup/walking are booking statuses or child walk-task states/events.
3. Define how `walker_assigned`, `walker_arriving`, `confirmed`, and `in_progress` map to canonical states (or are retired).
4. Define cancellation request vs cancellation outcome as separate concepts.
5. Keep Booking ID, Walk Task ID, and Walk History ID distinct; reconcile with merged-but-draft PR #44 contract and proposed trusted completion API.

## 3. Blocking cross-app gaps
- No reviewed trusted callable implements sequential one-Walker-at-a-time offers, timeout/decline progression, eligibility recheck, atomic accept, or reassignment.
- Partner app directly writes booking lifecycle statuses; client-side writes cannot be the authority for state transitions.
- **Booking schedule schema mismatch:** Customer creates `scheduledAt`/`preferredTime`/`walkSchedules`; Partner Home filters/sorts using `date`/`startTime`. This can prevent assigned bookings appearing in the Partner's Today list or being sorted correctly.
- **Fail-open missing ID:** current Partner Navigation helper returns success when `bookingId` is absent, allowing local progression without a persisted status transition. PR #24 is a proposed, unmerged correction only.
- Completion currently relies on client-side assertions and separate writes; no verified handover/atomic completion proof established. Walk-history creation and booking completion can diverge on partial failure.
- Customer's upcoming filter and labels include legacy states not present in the proposed canonical lifecycle.
- Admin currently provides visibility, not assignment operations; existing Admin role checks are not a substitute for an assignment authorization model.
- Firestore Rules allowlist and client write paths must be re-audited against the final approved canonical lifecycle. Do not loosen rules to make current writes pass.
- Cancellation request, cancellation decision, refund decision, and payment reversal must remain distinct and follow approved policies.

## 3A. Exact current payload/reader mismatch

Customer booking payload (current main):
- `bookingId` equals the generated Firestore document ID.
- `customerId`, `dogId`, `pickupAddressId`, `pickupAddress`.
- `scheduledAt`, `preferredTime`, `duration`, `walkCount`, `walkSchedules`.
- `status: pending`, `walkerId: null`, `cancelRequest: null`, `createdAt`.

Partner Home (current main):
- Query: `bookings.where('walkerId', isEqualTo: uid)`.
- Date filter reads `date`.
- Sort reads `startTime`.
- Active statuses: `assigned`, `accepted`, `picked_up`, `walking`.

No compatibility adapter or backend normalization connecting these exact schedule fields was established in this audit. Do not simply add duplicate `date`/`startTime` fields in the client: approve a canonical schema and normalize server-side or update all consumers consistently.

## 3B. Navigation fail-open evidence

Current default-branch `navigation_screen.dart` helper behavior:
- If `bookingId == null || bookingId.isEmpty`, it returns `true`.
- Otherwise it directly updates `bookings/{bookingId}` with the supplied status and server `updatedAt`.
- Callers use it for `accepted`, `picked_up`, and `walking`.

This is a release-blocking source defect. PR #24's proposed fix must be independently checked on its head and only becomes main behavior after authorized merge. Do not claim fixed on main.

## 4. Required implementation sequence (no production action authorized)
1. Founder/Operations approval of POL-005, POL-026, POL-021 and related cancellation/payment policies; resolve timeout, attempt, ranking, escalation and lifecycle questions.
2. Approve one canonical Booking state machine and a separate Walk Task state machine/event contract.
3. Reconcile PR #44's Booking/Walk Task contract with the trusted walk completion API proposal; retain distinct identifiers.
4. Implement trusted backend transitions with authentication, role/scope checks, transaction/idempotency/concurrency protections, audit events and server timestamps.
5. Update Firestore Rules to deny direct client writes to server-owned assignment and lifecycle fields; preserve only explicitly approved request/event writes.
6. Update Customer, Partner and Admin to call/read the canonical contract; Admin actions must be authorized and audited.
7. Add emulator/unit/integration tests for valid/invalid transitions, duplicate retries, concurrency, offer expiry, stale notifications, cancellation, privacy, scope, completion and handover.
8. Only after full Walker/Admin setup and explicit approval, plan controlled device testing. No device test is claimed here.

## 5. Evidence and limitations
- Partner current-source search excerpts: `walk_details_screen.dart`, `navigation_screen.dart`, `live_walk_screen.dart`, `partner_home_screen.dart`.
- Customer current-source search excerpt: `my_bookings_screen.dart`.
- Admin source audit references: `STEP_197_BOOKING_LOCATION_MIGRATION_CONTRACT.md`, `STEP_198_WALKER_ASSIGNMENT_PATH_AUDIT.md`, `STEP_199_ASSIGNMENT_WRITER_DEEP_SEARCH.md`.
- Existing shared draft contract: Firebase PR #58, `SHARED_BOOKING_ASSIGNMENT_AND_ROLE_CONTRACT_DRAFT_2026-11-02.md`.
- Notion policies: POL-005, POL-026, POL-021, POL-010 and POL-012. Draft status remains authoritative until approval.

This is a source-level audit. No Firestore data, Rules, Functions, app source, production configuration, deployment, merge, or device testing was changed or performed by this document.
