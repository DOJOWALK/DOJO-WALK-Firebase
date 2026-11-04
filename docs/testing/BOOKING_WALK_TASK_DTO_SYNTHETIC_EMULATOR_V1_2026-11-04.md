# Booking + Walk Task V1 DTO — Synthetic Emulator Test Contract

**Date:** 2026-11-04  
**Status:** Test-only reference contract; not production integration evidence.  
**Parent decision:** PR #83, Booking + Walk Task API V1 Schema Decision Record.

## Purpose

Exercise the proposed canonical parent Booking / child Walk Task shape in a demo Firestore Emulator before runtime implementation. The suite is intentionally isolated under `test_booking_walk_task_dto_*` collections and is not imported by deployed Functions.

## Scenarios covered

1. One-Time creates one parent and one executable task.
2. Choose-Dates preserves multiple dates and multiple walks on one date as separate tasks.
3. Finite Regular produces only its finite occurrence set; no unbounded subscription/task series.
4. Immediate with `ASAP` and client clock metadata cannot create a confirmed aggregate without a server-verified slot.
5. Client-forged identity, pet/address snapshots, Zone/City, timezone, appointment time, price, payment, status and Walker fields are rejected by the test-only allowlist.
6. Parent confirmation and task materialization reject a partial parent-child set.
7. Aggregate retry does not duplicate child tasks.
8. Walker eligibility fixture requires active + approved + verified + exact Zone membership.

## Explicit limitations

- This is a synthetic reference oracle, not the exported production callable.
- It does not authenticate a Firebase user or invoke Auth Emulator.
- It does not read real Customer App DTOs or prove the Customer App adapter maps its current `walkSchedules` / `dateSchedules` payload correctly.
- The Walker `zones` list is only a test fixture reflecting the audited Partner profile shape; its mapping to canonical `service_zones` remains a migration gate.
- It does not implement or verify Zone geometry, approval request tuple, capacity reservation, payment provider, real task materializer, assignment locking, Firestore Rules, or notifications.
- The task timestamps in the fixtures are synthetic. Production must convert customer-selected local wall-clock values using trusted `Asia/Kolkata` and pin the country config revision.
- Emulator data is demo-only. The workflow refuses any non-`demo-*` project and explicitly rejects the production Firebase project ID.

## Actual callable integration gate

The actual callable integration suite remains blocked until the production Booking callable, trusted Zone resolver, country configuration reader, availability/capacity service, verified payment transition, task materializer and Walker assignment service exist. A PASS here means only these isolated DTO reference assertions passed; it must not be represented as production booking readiness.

## Read-only Customer App compatibility audit

Source inspected: `DOJOWALK/DOJO-WALK-Customer`, `main` at `4a50ccd29aa1354c6478ac6e2c32c7213acec18d`; file `lib/features/booking/screens/booking_confirmation_screen.dart` (blob `94d45b12c7873fc2d289e164df965c735c0c63cb`). No Customer repository files were changed by this PR.

The current confirmation screen is not yet compatible with the canonical callable request DTO without an adapter and product-policy corrections:

- It creates `bookings/{bookingId}` client-side and calls `.set(bookingData)` directly after reading only the selected pet document.
- It sends `customerId`, client-copied `petDetails`, `pickupAddress`, `scheduledAt`, price fields inside `walkSchedules`, status, Walker placeholder and timestamps. These are not permitted as authoritative fields in the V1 callable request.
- Current plan vocabulary is `one_time`, `customize`, `regular`; V1 canonical plan vocabulary is `one_time`, `choose_dates`, `regular`, `immediate`. The adapter must explicitly map `customize` to `choose_dates`; do not change enum values silently.
- Current service type values are `regular_walk`, `custom_walk`, `temporary_walk`; the approved service catalogue enum remains a separate gate.
- Choose-Dates currently preserves nested `dateSchedules[].walks[]`; an adapter must preserve every date and every walk occurrence.
- Regular currently describes an indefinite daily repeat (including Sundays) and has no finite end date in this screen. This conflicts with the V1 finite Regular contract (calendar-month/finite occurrence set). Do not silently generate unlimited tasks; product/UI contract needs alignment.
- Immediate currently writes `scheduledAt: Timestamp.fromDate(DateTime.now())` and `preferredTime: ASAP`. V1 explicitly forbids device time as appointment authority; Immediate must remain unconfirmed/unpayable until a server-checked slot exists.
- `_cleanWalk` derives and writes client-side price. V1 requires server quote pricing; client price must be display-only and excluded from the callable authority payload.
- The screen reads the pet under `users/{uid}/pets/{dogId}`, but does not independently read/verify the saved address under `users/{uid}/addresses/{addressId}`; backend must perform both ownership reads.
- Existing screen success dialog says the request is saved and availability/pricing will be confirmed later. This UX must be reconciled with callable response states and must not show confirmed/paid before backend says so.

### Required Customer App adapter tests before cutover

1. Map legacy `customize` to canonical `choose_dates` and reject unknown plan aliases.
2. Preserve nested Choose-Dates dates and all per-date walk slots exactly.
3. Require finite Regular end date / finite occurrence list; reject indefinite repeat.
4. Immediate request excludes client `DateTime.now()` / `scheduledAt`; no payable quote until server availability.
5. Request includes only `requestVersion`, UUID v4 `idempotencyKey`, canonical plan, approved service type, `dogId`, `pickupAddressId` and normalized schedule.
6. Strip customer UID, pet/address snapshots, client price, Zone/City, status, Walker, payment, timestamps and generated IDs.
7. Retry reuses the same idempotency key for the same user intent; changed intent generates a new key.
8. Preserve parent Booking read compatibility while rendering child Walk Tasks after the staged backend cutover.

These are not tested by this PR's synthetic Firebase Emulator oracle. The current actual-callable/app-adapter integration gate remains BLOCKED until the Customer adapter and backend callable are implemented together with the agreed enum, finite Regular policy and trusted Zone/timezone gates.

## Follow-up source inspection — booking plan semantics and service type

Additional Customer source inspected at `DOJOWALK/DOJO-WALK-Customer` main commit `4a50ccd29aa1354c6478ac6e2c32c7213acec18d`:

- `lib/features/booking/screens/choose_walk_screen.dart` (blob `0ab692f470a7cf675f1c30006c4e8157126b1736`)
- `lib/features/booking/services/walk_pricing_service.dart` (blob `fe8db3da4268449f9516099b685f0c5ef0b056b0`)

Verified compatibility findings:
1. The UI calls the immediate request **“Walk Now”** but represents it internally as `WalkBookingType.oneTime` plus `schedule.isImmediate == true`. The confirmation screen therefore currently sends `bookingPlan: "one_time"` while also sending `preferredTime: "ASAP"` and device `DateTime.now()`. The V1 request enum distinguishes `immediate` from `one_time`; an explicit adapter must map by the `isImmediate` intent first, not just the enum name.
2. The three legacy service values are `regular_walk`, `custom_walk`, and `temporary_walk`; the confirmation screen derives them from the booking plan. No approved canonical service catalogue enum was located in the inspected Customer files. V1 must not assume these legacy values are canonical service types. The adapter should receive a separately selected/approved service type; final enum mapping remains a contract gate.
3. Regular currently says it repeats daily Monday–Sunday and serializes `frequency: "Daily"`, `walksPerWeek: 7`, and a `dailyWalkTemplate` without an end date. This conflicts with the approved finite calendar-month Regular policy (calendar-month period, e.g. start on the 7th and end on the 6th of the next month). The current UI needs an explicit finite period/end-date model and tests before it can emit a complete Regular occurrence set. Month-end handling for start dates on the 29th–31st must be specified in the adapter contract rather than guessed.
4. The schedule editor permits custom durations 1–240 minutes, while the booking confirmation currently accepts only 20, 30, 45, or 60 minutes. The backend V1 policy range is 20–60 minutes. Both screens need one shared validation rule; unsupported custom durations must be rejected before request submission.
5. The price service currently has only a draft 30-minute ₹149 estimate. It is not an authoritative rate table. All price fields in the current screen payload must remain excluded from the callable request and final quote must come from the backend.

### Current status after source inspection

- Backend synthetic DTO Emulator reference suite: PASS (8/8 on exact PR #84 head).
- Existing backend geometry/callable test suite: PASS (379/379 on same commit).
- Existing synthetic Auth/Functions fixture suite: PASS (45/45 on same commit).
- Firestore Rules Emulator suite: PASS (66/66 on same commit).
- Customer App adapter implementation: NOT STARTED.
- Actual authenticated Booking callable integration: BLOCKED (callable and required backend services do not yet exist).

No Customer App source, Rules, or production backend runtime files were modified in this test-only PR.
