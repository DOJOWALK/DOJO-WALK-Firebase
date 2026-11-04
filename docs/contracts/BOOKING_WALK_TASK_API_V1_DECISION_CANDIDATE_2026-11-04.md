# Booking + Walk Task API Contract V1 — Decision Candidate

**Date:** 2026-11-04  
**Status:** Candidate for Founder review. Proposed defaults are not production-approved.  
**Based on:** Canonical field alignment in `BOOKING_WALK_TASK_CONTRACT_V1_DRAFT.md` Section 12 and the Emulator acceptance plan.

## 1. Purpose and invariants

This document resolves the open API decisions with conservative proposed defaults so synthetic Emulator implementation can proceed after review.

Non-negotiable invariants:

1. One parent `bookings/{bookingId}` represents the customer booking request/commercial record.
2. One child `walk_tasks/{walkTaskId}` represents one executable walk occurrence.
3. Customer, Partner, Admin and Firebase use the same canonical field names.
4. Customer never authors trusted customer identity, dog snapshot, pickup snapshot, Zone/City, price, payment state, task ID, Walker assignment or task status.
5. Availability is checked before payment. Payment is verified server-side. Walker assignment happens only after payment confirmation and task creation.
6. No child task becomes assignable before payment is verified.
7. No direct client writes to parent Booking state or child Walk Tasks.
8. Existing `walks/{walkId}` remains completed-walk/review history; it is not repurposed.

## 2. Proposed callable API

All callables use region `asia-south1`, require Firebase Authentication, validate strict allowlisted payloads, and derive `customerId` from `request.auth.uid`.

### 2.1 `createBookingRequest`

Purpose: validate and record customer intent only.

Request candidate:

- `requestVersion: 1`
- `idempotencyKey: string` — UUID v4 generated once per user submission and reused on network retry
- `bookingPlan: "one_time" | "choose_dates" | "regular" | "immediate"`
- `serviceType: approved service enum`
- `dogId: string`
- `pickupAddressId: string`
- plan-specific schedule input:
  - One-Time: one local date + local time + `durationMinutes`
  - Choose-Dates: complete selected dates and walk entries
  - Regular: explicit start date, end date and occurrence template
  - Immediate: no authoritative fixed start instant; optional customer preference window only

Forbidden as authoritative request input: `customerId`, `dogName`, `dogDetails`, `pickupAddress`, `serviceZoneId`, `cityId`, `timeZone`, `serviceDateKey`, `scheduledAt`, `walkerId`, `status`, `price`, `paymentStatus`, task IDs, server timestamps.

Server behavior:

1. Read pet from `users/{auth.uid}/pets/{dogId}`.
2. Read address from `users/{auth.uid}/addresses/{pickupAddressId}`.
3. Build allowlisted `dogName` and `dogDetails` snapshots from the actual pet record; build structured `pickupAddress` from the saved address.
4. Validate duration 20–60 minutes, schedule syntax, plan-specific required/forbidden fields and maximum occurrence count.
5. Resolve pickup coordinates against canonical active Zone polygons; do not trust client Zone/City.
6. Write one parent Booking in `request_pending` state. Do not write assignable Walk Tasks.
7. Return `bookingId`, `requestStatus`, and next action. Do not claim availability, payment or assignment succeeded.

### 2.2 `createBookingQuote`

Purpose: check live availability and issue a short-lived server quote.

Request: `bookingId` and expected booking revision.

Server behavior:

- Re-read Booking and trusted Zone/City state.
- Re-check Zone active status and pickup coverage.
- Check slot/Walker capacity using authoritative availability data.
- Return an explicit unavailable result with nearby alternatives when no slot is available.
- If available, create a server-signed/stored quote token bound to customer UID, booking ID/revision, Zone, pickup, exact occurrences, price breakdown and expiry.
- Proposed quote validity: **10 minutes**. Expiry or any material booking/availability change invalidates the quote.
- No payment order is created for unavailable or expired quotes.

The token is opaque to the client; all trusted values are stored server-side or cryptographically verified server-side. Client-supplied price or availability flags are ignored.

### 2.3 Payment confirmation

Payment initiation and provider webhook verification remain server-side. A client success screen or client-supplied `paymentStatus: paid` is never proof of payment.

Only a verified provider event may transition payment to paid. The webhook must be idempotent by provider event/order/payment ID and verify amount, currency, merchant account, booking, quote and customer binding.

### 2.4 `confirmBookingAndCreateWalkTasks`

Purpose: consume a valid paid quote and materialize executable occurrences.

Invocation: trusted backend path after verified payment; not an unrestricted customer callable.

Server behavior:

1. Verify payment and quote token are valid, paid, unexpired at payment authorization, and bound to the same Booking/customer/revision.
2. Re-check Zone remains active and all occurrences remain eligible under the approved policy.
3. In one transaction (or a bounded, explicitly staged generation protocol if the maximum write count requires it), transition parent to `confirmed` and create one child task per occurrence.
4. Copy only trusted canonical snapshots and fields into each task.
5. Initialize `walkerId: null`; task status `awaiting_assignment`.
6. Emit audit/outbox events atomically.
7. Duplicate provider events or retries return the original outcome and never create duplicate tasks.

No client can call this endpoint to mark payment as paid or bypass provider verification.

## 3. Proposed state model

### 3.1 Booking status

| Status | Meaning |
| --- | --- |
| `request_pending` | Request recorded; availability not yet confirmed |
| `availability_confirmed` | A valid availability quote is held |
| `payment_pending` | Payment order initiated against a valid quote |
| `confirmed` | Payment verified and Walk Tasks materialized |
| `in_progress` | At least one task has started |
| `completed` | All required tasks completed |
| `cancel_requested` | Customer requested cancellation; policy evaluation pending |
| `cancelled` | Cancellation approved and no active walk is running |
| `rejected` | Request cannot be serviced |

Booking status is not copied blindly to each child task. Parent status is an aggregate of task and payment state.

### 3.2 Walk Task status

| Status | Meaning |
| --- | --- |
| `awaiting_assignment` | Paid task exists, no Walker assigned |
| `assigned` | Server assigned a verified eligible Walker |
| `accepted` | Assigned Walker accepted |
| `picked_up` | Dog handover/pickup confirmed |
| `in_progress` | Walk started; GPS tracking active |
| `handover_required` | Safety/emergency handover required before stopping |
| `completed` | Walk completed with required evidence |
| `cancelled` | Task cancelled before it starts under cancellation policy |
| `missed` | Scheduled occurrence could not be completed and was closed by authorized operations |

Rules:

- `in_progress` cannot transition directly to `cancelled`.
- Emergency stop requires the approved dog/customer safety handover flow.
- Walker cannot set `walkerId`, self-assign, or complete a task without the server-authorized transition.
- Existing Partner labels `walking` map to canonical `in_progress` in a temporary read adapter; new writes use `in_progress` only.

### 3.3 Payment status

`unpaid` → `pending` → `paid`; failure may be `failed`; refunds use `partially_refunded` or `refunded`. Only verified server/provider events mutate payment status.

## 4. Time and timezone policy

Proposed source of truth:

- Canonical Zone document must contain an IANA `timeZone` (for example `Asia/Kolkata`) maintained by Central Admin and validated server-side.
- A booking request contains local date/time selection and the applicable IANA timezone only as a display/selection hint; server validates it against the resolved Zone timezone.
- Server converts each valid local occurrence to Firestore `scheduledAt` Timestamp and derives `serviceDateKey` in the Zone timezone.
- Persist `scheduledAt`, `timeZone`, `serviceDateKey`, `durationMinutes`; do not persist competing authoritative `date` and `startTime`.
- If Zone timezone is missing or invalid, fail closed; never silently use device timezone.
- Ambiguous/nonexistent daylight-saving local times must be rejected unless an explicit disambiguation policy is later approved.

## 5. Zone coverage policy

- Pickup latitude/longitude comes from the server-read saved address document, not the request map.
- Resolve against canonical active `service_zones` and verified boundary records.
- Exactly one matching active Zone is required.
- No match: unavailable/out-of-service result.
- More than one match: fail closed; no smallest-polygon or nearest-Zone guess.
- Persist `serviceZoneId` and `cityId` from the authoritative Zone document.
- Re-check Zone state before quote, payment capture/confirmation and task materialization.
- Emergency-suspended Zone blocks new bookings and task assignment. Already-running walks continue under the separate safety/handover process.

## 6. Regular and Immediate plan handling

### Regular

- Require explicit finite `serviceStartDate` and `serviceEndDate`; never infer an unbounded recurring series.
- Calendar Monthly means the selected start date through the day before the same date in the following month (for example, 7th through 6th).
- The request must include a complete occurrence template and a finite service period.
- Proposed V1 cap: no more than **31 calendar days** and **90 occurrences** per Booking request. Requests exceeding the cap must be split into separately quoted periods; no partial task writes.
- If a rolling generation horizon is desired later, it requires a separate versioned contract and idempotent scheduler.

### Immediate

- Immediate/ASAP is a request for operations/availability handling, not a fixed appointment.
- Ignore client device `DateTime.now()` as a confirmed start time.
- Do not create a scheduled Walk Task until Central/authorized operations confirms an actual slot, availability quote is issued, and payment is verified.

## 7. Idempotency and transaction model

- Client generates UUID v4 once when the user submits; retries reuse the same key.
- Scope key to authenticated customer: `booking_idempotency/{sha256(customerUid + ":" + idempotencyKey)}`.
- Store request payload hash, Booking ID, result and created timestamp.
- Same key + same normalized payload returns the original Booking/result.
- Same key + different payload returns `already-exists` / idempotency conflict; no mutation.
- Proposed retention: keep the idempotency record for at least **180 days**; do not TTL-delete while Booking/payment/dispute lifecycle is unresolved.
- Provider webhook idempotency uses provider event/order/payment identifiers separately.
- All parent/task/idempotency/audit/outbox writes must be atomic, or use an explicit staged generation state that cannot become confirmed/assignable until all task writes complete.
- Enforce transaction/write limits before accepting the occurrence count.

## 8. Error contract

Use stable Firebase callable error codes:

- `unauthenticated`: no authenticated customer.
- `permission-denied`: caller does not own referenced pet/address or lacks role authority.
- `invalid-argument`: malformed request or unsupported field.
- `not-found`: pet/address/booking does not exist.
- `failed-precondition`: Zone inactive, invalid boundary/timezone, expired quote, unavailable slot, or state transition not allowed.
- `already-exists`: idempotency key reused with different payload or duplicate provider event conflict.
- `resource-exhausted`: occurrence/write cap exceeded or capacity limit reached.
- `aborted`: concurrent revision/state changed; client may re-read and retry with same idempotency key.

Responses must not expose another customer's pet/address data or internal Walker availability details.

## 9. Required acceptance tests before implementation is called ready

The 40-case matrix in `BOOKING_WALK_TASK_EMULATOR_ACCEPTANCE_TEST_PLAN_2026-11-04.md` remains the baseline. Add explicit cases for:

1. Quote expires before payment initiation.
2. Zone is suspended between quote and payment confirmation.
3. Provider webhook has wrong amount/currency/booking binding.
4. Duplicate provider webhook event.
5. Parent cannot become `confirmed` until every task is materialized.
6. Task generation limit rejects without partial records.
7. Zone timezone missing/invalid.
8. Local time falls into a DST gap or ambiguous overlap.
9. Regular end date is missing, before start, or exceeds 31 days.
10. Same idempotency key with different payload hash.
11. Running task cannot be cancelled without safety/handover.
12. Walker profile Zone preference without server assignment cannot receive task.

Acceptance requires callable response assertions plus Firestore parent/task/payment/idempotency/audit/outbox state assertions. Emulator success is not production security certification.

## 10. Decisions that remain explicitly gated

These are proposed V1 defaults, not silently approved facts:

- Exact serviceType enum values must match current product/service catalog.
- Payment provider/order/webhook schema and currency/amount source.
- Zone timezone field provisioning and source of truth.
- Availability engine and slot capacity model.
- Whether the 10-minute quote TTL and 31-day/90-occurrence cap are accepted.
- Whether `request_pending` Booking is created before availability or only after initial availability discovery.
- Final callable names and versioning policy.
- Refund/cancellation state transitions and monetary policy.

## 11. Rollout boundary

- Synthetic Emulator only until all contract gates and tests are accepted.
- No production Firebase access, data migration, role grants, deployment or app cutover in this contract PR.
- No merge to `main`.
- Admin, Partner and Customer integration remains a later coordinated phase.
