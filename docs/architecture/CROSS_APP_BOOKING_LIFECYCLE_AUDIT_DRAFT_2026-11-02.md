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

This is a release-blocking source defect on current main. I separately fetched PR #24's exact head (`64c182a894591b32b92b33ba8c78f8a28acf4f14`): its helper validates the reference with `hasWalkBookingReference`, shows a support message and returns `false` when missing, and trims the ID before update. This confirms the fail-closed change exists on the PR head only; it remains unmerged, so main is still affected. The PR fix does not address the broader issue that valid lifecycle transitions are still direct client writes.

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


## 6. PR #47 normalizer/adapter verification (02 Nov 2026)

Exact PR evidence:
- PR #47: https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/47
- Reviewed changed files: `functions/src/booking_request_normalizer.ts`, `functions/src/legacy_customer_booking_adapter.ts`, and their two Node test files.
- Reviewed head commit: `4f732ac7589f300f01d7668e6bcb89707e95d965` (commit message: `test: cover schedules with more than three walks`).
- The head commit changes the normalizer test to accept four walks; it does not connect the normalizer to a callable or Firestore writer.

Observed behavior:
1. The pure normalizer accepts a proposed DTO: one-time uses `serviceDateKey` + `walkSchedules`; choose-dates uses `dateSchedules[].serviceDateKey` + `walks`. It emits `serviceDateKey`, `time`, `durationMinutes`, and `walkNumber` occurrences.
2. The legacy adapter reads Customer's `bookingPlan`, `scheduledAt`, `preferredTime`, `walkSchedules`, `selectedDates`, and `dateSchedules`. For one-time bookings it requires an injected service-date resolver for `scheduledAt`; for choose-dates it requires a resolver and verifies each Timestamp against the explicit `selectedDates` key.
3. `preferredTime` is only used to detect `ASAP`; scheduled time is taken from each `walkSchedules[].time`. ASAP and regular requests produce no scheduled occurrences and remain awaiting operations/period approval.
4. The adapter output is not the Partner Home schema: it does not emit Partner's `date` or `startTime`, and no callable/import path invokes it. Therefore PR #47 does not resolve the Customer-to-Partner Today-list mismatch.
5. Current Customer writer source (`lib/features/booking/screens/booking_confirmation_screen.dart`, blob `94d45b12c7873fc2d289e164df965c735c0c63cb`) confirms integer `walkSchedules[].duration`, Timestamp `scheduledAt`, and for choose-dates a `selectedDates` string list plus `dateSchedules[].date` Timestamp and nested walks. The adapter's duration type is compatible with this writer; the earlier comment alleging a string-duration mismatch was explicitly corrected in PR discussion.
6. Customer source still enforces a maximum of three walks per day in its submission validation, while the pure normalizer now accepts four. The UI cap and server DTO contract should be reconciled against an approved product limit before end-to-end integration; do not assume the normalizer test changes the Customer UI behavior.
7. The reviewed PR scope explicitly excludes Firestore reads/writes, Auth/ownership checks, availability, pricing, idempotency, task creation, assignment, lifecycle changes, and deployment. Keep it separate from assignment implementation.

Verification qualification (exact head rechecked):
- Commit `4f732ac7589f300f01d7668e6bcb89707e95d965` has workflow run `41186165719` (`Trusted Location Geometry and Callable Tests`) completed successfully.
- The job log confirms the workflow ran `npm run build`, then `firebase emulators:exec ... "npm test && cd functions && npm test"`. The Functions test script is `npm run build && node --test test/*.test.cjs`, so the PR #47 normalizer and legacy-adapter test files were included.
- The job log reports **301 passed, 0 failed**. The combined commit-status endpoint returned no status contexts, but the workflow run and job log provide direct exact-head build/test evidence. PR #47's Functions build and automated test suite therefore PASS on this head; this is not an end-to-end Customer→Partner integration pass.
- No production data, Rules, Functions deployment, app source, merge, or device test was performed as part of this audit.

Required next step:
- Keep PR #47 Draft. Define/approve the service-zone timezone resolver and canonical occurrence/Partner reader contract; add exact Customer-writer fixture coverage for the real one-time and choose-dates shapes, and an integration test proving normalized occurrences reach the Partner reader. Reconcile the current Customer UI's three-walk-per-day submission cap with the normalizer's acceptance of four or more; this is a source mismatch, not an approved policy decision. Do not add duplicate `date`/`startTime` fields or persistence as an unreviewed workaround.


## 7. Updated Customer → Partner Today-list audit (02 Nov 2026, exact source refresh)

This section supersedes no approved contract; it refreshes the source evidence after the PR #47 Asia/Kolkata boundary-test commit.

### Exact source revisions reviewed
- Customer writer `lib/features/booking/screens/booking_confirmation_screen.dart`, blob `94d45b12c7873fc2d289e164df965c735c0c63cb`.
- Partner reader `lib/screens/home/partner_home_screen.dart`, blob `9a1c14fe13e05eaa7fd2df55942a20b02ce82074`.
- Firebase adapter branch `feat/booking-normalizer-adapter-clean-2026-10-31`, commit `da16f650c9738473482d896387cf09b1efec0eab`.
- PR #47 current head is `da16f650c9738473482d896387cf09b1efec0eab`; PR remains open, Draft and unmerged.

### Current writer/reader behavior
Customer writes common fields including `bookingPlan`, `scheduledAt` Timestamp, `preferredTime`, `duration`, `walkCount`, `walkSchedules[]`, `status: pending`, and `walkerId: null`. Choose-Dates additionally writes `selectedDates[]` as YYYY-MM-DD strings and `dateSchedules[]` with a Timestamp `date` and nested `walks[]`. The Customer source rejects a daily primary schedule with more than three walks.

Partner Home queries `bookings` by `walkerId == Firebase Auth UID`; it filters by `date` for the device-local current day, sorts by `startTime`, and includes only `assigned`, `accepted`, `picked_up`, and `walking` statuses. Its card formatter also reads legacy fields such as `dogName`/nested `dog.name`, `type`, `duration`, and pickup location fields.

The pure Firebase adapter consumes the Customer schedule fields and emits normalized occurrences with `serviceDateKey`, `time`, `durationMinutes`, and `walkNumber`. It does not emit Partner's `date` or `startTime`; no callable, Firestore persistence path, or Partner reader integration invokes it. Customer creates a pending unassigned request, so it is correctly absent from the Partner assigned-work query until a trusted assignment workflow exists.

### Timezone finding — important qualification
The Notion Booking API Contract draft records a V1 design direction of `Asia/Kolkata`, UTC Firestore timestamps, and service-local `serviceDateKey` / `serviceTime` / `timezone` on each Walk Task. This is a documented design direction, not production approval. Partner Home currently derives its day boundary from device-local `DateTime.now()`; the reader has not yet been changed to consume an approved service-local task contract.

PR #47 now has two additional boundary tests using an injected pure test resolver: UTC `2026-10-31T18:31:00Z` maps to India-local date `2026-11-01`, and Choose-Dates checks Timestamp/date-key correspondence. This does not implement a production timezone resolver or a callable.

### Remaining incompatibilities / acceptance gates
1. Define the approved canonical occurrence/task DTO and explicit mapping to the Partner reader; do not add speculative duplicate `date`/`startTime` fields to Customer writes.
2. Replace device-local Today filtering with service-local date semantics only after the contract is approved and wired end-to-end.
3. Preserve all One-Time walks and all nested Choose-Dates occurrences; test later dates, not only index zero.
4. Define how the assigned Walker's task is materialized/read securely; test assigned versus unassigned and cross-Walker denial.
5. Test stable ordering for multiple walks per day and supported 12-hour/24-hour clock formats.
6. Test only approved lifecycle states; do not promote `pending` to `assigned` in a client adapter.
7. Keep Regular and ASAP unscheduled pending their bounded-period / operations rules.
8. Reconcile Customer's three-walk-per-day UI cap with the normalizer's acceptance of four or more; this is a product-contract mismatch, not an implementation choice for this audit.
9. Add malformed/empty payload, retry, idempotency, duplicate task creation, and authenticated ownership/authorization tests when the callable boundary is approved.

### Exact-head verification correction
The earlier Section 6 records the prior PR #47 head `4f732ac7589f300f01d7668e6bcb89707e95d965` and its 301-test run. The current head is `da16f650c9738473482d896387cf09b1efec0eab`; its exact-head GitHub Actions checks completed successfully, including Diff Integrity and the Firebase build/Rules/Functions emulator workflow. The Functions suite reports **303 passed, 0 failed**. This is exact-head automated build/emulator evidence for the pure normalizer/adapter tests, not Customer → Partner integration, deployed behavior, or device QA.

**Gate remains BLOCKED / NO-GO for production integration:** the Notion Booking API Contract remains a working draft with unresolved approval/mapping decisions. This addendum is source audit and test planning only. No app source, Rules, Functions, Firestore data, production configuration, merge, deployment, or device test was changed or performed.
