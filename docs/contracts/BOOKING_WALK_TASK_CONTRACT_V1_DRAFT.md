# DOJO WALK Booking + Walk Task Contract V1 (Draft)

**Status:** Architecture direction approved; field/status contract is Draft and not approved for production.
**Date:** 2026-10-31
**Scope:** Customer booking request, parent booking, scheduled walk occurrences, Admin/Partner compatibility.

## 1. Architecture decision

Use one parent booking document and one child task document per scheduled walk occurrence.

- Parent: `bookings/{bookingId}`
- Child: `walk_tasks/{walkTaskId}`
- Do not repurpose `walks/{walkId}`: the current Partner app reads that collection for completed-walk review history.
- Every child task contains `bookingId`; a parent may have multiple tasks.
- Partner's Today/Schedule work list should be driven by assigned child tasks, not by interpreting the first date/time on a parent booking.
- Admin retains the parent request view and exposes its child tasks/occurrences.

## 2. Occurrence expansion

### One-Time
Create one child task for every walk entry on the selected service date.

### Choose-Dates
Create one child task for every walk entry in every `dateSchedules[*].walks[*]`. The first selected date is not a substitute for the complete schedule.

### Regular
Keep `dailyWalkTemplate` on the parent. Generate child tasks only for a confirmed, bounded service period. The recurring end-date/calendar semantics and generation horizon are still open decisions; never create an unbounded stream.

## 3. Parent document compatibility

During migration, preserve the current Customer legacy request fields where valid:

- `bookingId`, `customerId`, `walkType`, `bookingPlan`, `serviceType`, `serviceName`
- `petName`, `dogId`, `petDetails`
- `pickupAddressId`, map-valued `pickupAddress`
- `scheduledAt`, `duration`, `preferredTime`, `walkCount`, `walkSchedules`
- initial `status`, `walkerId`, `cancelRequest`, `createdAt`
- applicable Regular fields: `frequency`, `walksPerWeek`, `walksPerDay`, `planStatus`, `dailyWalkTemplate`
- applicable Choose-Dates fields: `walksPerDay`, `selectedDates`, `dateSchedules`

Trusted identity, server timestamps, initial state, price/quote, assignment and task IDs must not be accepted as authoritative client input.

## 4. Proposed child task fields

This is a candidate schema, not a finalized DTO:

| Field | Meaning |
| --- | --- |
| `walkTaskId` | Firestore child document ID |
| `bookingId` | Parent booking reference |
| `customerId` | Derived from authenticated caller |
| `dogId` | Verified pet reference |
| `dogName`, `dog` | Server-derived display snapshot for legacy Partner readers |
| `serviceDateKey` | Local YYYY-MM-DD key for day filtering |
| `scheduledAt` | Canonical occurrence instant (Firestore Timestamp) |
| `timeZone` | IANA timezone for the service location |
| `startTime` | Legacy display value, derived from canonical occurrence |
| `durationMinutes` | Validated integer, 20–60 |
| `pickupAddressId` | Verified saved-address reference |
| `pickupAddress` | Structured address snapshot |
| `pickupAddressText` / `location` | Display-only string for current Partner compatibility |
| `pickupLatitude`, `pickupLongitude` | Optional verified coordinate pair |
| `walkerId` | Null until authorized assignment |
| `status` | Pending until availability/confirmation and assignment workflow |
| `createdAt`, `updatedAt` | Server timestamps |

## 5. Known reader drift to resolve

Current source inspection found:

- Customer sends `scheduledAt` and `preferredTime`; Partner Today currently filters by `date` and reads `startTime`.
- Customer sends `petName` / `petDetails`; Partner expects `dogName` / `dog`.
- Customer sends `serviceType` / `bookingPlan`; Partner reads `type`.
- Customer sends map-valued `pickupAddress`; Partner currently expects a string then falls back to `location` or `zoneName`.
- Partner active-list statuses are `assigned`, `accepted`, `picked_up`, `walking`; Customer initial state is `pending`. Canonical lifecycle and Admin label mapping remain unapproved.
- Admin reads parent booking records and optionally displays `amount`, `totalAmount`, or `price`; no server-authoritative quote contract is approved here.

## 6. Security and transactional requirements

1. Callable requires Firebase Auth; derive customer UID from auth context.
2. Verify pet exists under `users/{uid}/pets/{petId}`.
3. Verify saved address exists under `users/{uid}/addresses/{addressId}`; derive trusted snapshot from that record.
4. Validate every date and every walk in every selected date; duration 20–60; valid non-empty time; no malformed or duplicate occurrence.
5. Validate plan-specific required/forbidden fields and consistency between top-level duration and each schedule entry.
6. Create parent and all child tasks atomically within Firestore transaction/write limits.
7. Idempotency must prevent duplicate parent/task creation on retries. Key format, retention, and ID generation need approval.
8. Client must not create tasks, assign walkers, change task owner, or forge server-owned fields.
9. Partner reads only tasks assigned to its authenticated walker UID and updates only approved progress fields.
10. Availability confirmation must precede assignability. Booking request receipt must not be represented as confirmed booking or payment success.

## 7. Rollout sequence

1. Approve detailed DTO, task status enum, time-zone model, regular booking horizon, and idempotency behavior.
2. Implement callable and emulator tests in Firebase Functions/Firestore.
3. Implement Firestore Rules and task security tests.
4. Update Partner Today/Schedule/Walk Details to use child tasks; preserve existing walks review history.
5. Update Admin parent/child booking view and assignment flow.
6. Switch Customer writer only after callable integration tests pass.
7. Backfill eligible historical records separately, with dry-run, counts, idempotency and rollback.
8. Release behind staged rollout/feature flag; no production data migration without verified rollback.

## 8. Open decisions

- Canonical task status enum and Admin/Partner transition mapping.
- UTC Timestamp + IANA timezone + local date key policy, including service-zone timezone source.
- Regular plan end date and task-generation horizon.
- Idempotency key shape, retention, and server-generated ID strategy.
- Exact pickup display snapshot shape and compatibility adapter.
- Whether child task documents are created at request time in a non-assignable pending state or only after availability confirmation. Existing Customer copy says request received and team will confirm; proposed safe default is pending/non-assignable until confirmation.
- Firestore Rules deployment source of truth: Partner repository contains a separate Rules copy; do not assume it is deployed.

## 9. Non-goals

- No production deployment.
- No direct mutation of Customer PR #29 or Firebase PR #43.
- No merging, deleting branches, or rewriting historical bookings.
- No payment/price authority changes.
- No assignment algorithm changes until lifecycle and availability contract are approved.

## 10. Evidence

- Customer writer: `DOJOWALK/DOJO-WALK-Customer`, branch `chore/remove-app-language-file`, `lib/features/booking/screens/booking_confirmation_screen.dart`.
- Partner Today reader: `DOJOWALK/DOJO-WALK-Partner`, `lib/screens/home/partner_home_screen.dart`.
- Partner Walk Details reader: `DOJOWALK/DOJO-WALK-Partner`, `lib/screens/home/walk_details_screen.dart`.
- Partner Rules copy denies booking create and limits assigned walker progress updates; verify active deployed Rules separately.
- Admin parent reader: `DOJOWALK/DOJO-WALK-Admin`, `lib/screens/bookings/bookings_screen.dart`.
- Existing Firebase callable code is in `functions/src/index.ts`; no booking callable was present in the inspected main version.

**Gate:** This document records the approved architecture direction only. It is a Draft contract. Do not implement a breaking cutover or deploy until open decisions are resolved and the coordinated test matrix passes.


## 11. Customer source-of-truth path and callable feasibility check — 2026-10-31

Read-only inspection of Customer PR #29 branch `chore/remove-app-language-file` confirms:

- Selected pet is read from `users/{auth.uid}/pets/{dogId}`.
- Saved addresses are managed by Customer's AddressService at `users/{auth.uid}/addresses/{addressId}`. The address model stores label, flatHouse, buildingSociety, area, landmark, city, pincode, pickupInstructions, and optional latitude/longitude.
- Customer currently submits the full address map supplied by the UI, but the server callable should ignore that map as authority and load the saved address document by the authenticated UID and supplied address ID.
- The Customer writer creates a client-side booking document ID, reads the pet document, derives `petDetails` from that record, and directly writes the parent booking.
- Choose-Dates sends all `dateSchedules` as Timestamp date plus nested `walks` entries containing walkNumber, time and integer duration. The Customer UI validates each selected date and each walk (20–60 minutes; 1–3 walks/day), but the callable must repeat every validation.
- Regular sends `dailyWalkTemplate`, `frequency: daily`, `walksPerWeek: 7`, `walksPerDay`, and `planStatus: pending_confirmation`. The inspected writer does not send a service end date or bounded calendar period.
- Immediate requests use `preferredTime: ASAP` and client `scheduledAt: DateTime.now()`; this is not a customer-selected fixed walk start time.

### Callable implementation gate — do not bypass

The following are now source-confirmed: pet path, saved-address path, address fields, Choose-Dates nested schedule shape, and current Regular/Immediate payload limitations.

A callable that creates assignable tasks immediately would still be unsafe because:
1. Regular has no confirmed end date/booking period, so a finite task series cannot be generated correctly.
2. Immediate has no fixed start time; it must remain a request awaiting availability/operations confirmation, not become a scheduled Partner task from the client clock.
3. Canonical task statuses and Admin/Partner transition mapping remain unapproved.
4. Timezone policy and service-zone timezone source remain unapproved.
5. Idempotency key format and retention remain unapproved.
6. Existing Customer PR #29 uses client-generated parent ID and has no idempotency key; migration behavior must be coordinated before changing its writer.

### Safe next implementation slice

Implement and test a pure server-side request validator / occurrence normalizer first, with no Firestore writes. It should reject malformed input and return normalized One-Time / Choose-Dates occurrences; Regular and Immediate should be explicitly marked as awaiting bounded period / operations confirmation until the missing inputs are approved. Then add the callable transaction only after the contract gate is approved.

**No callable, app code, Firestore Rules, live data, or production deployment was changed by this audit.**


---

## 12. Canonical cross-app field alignment — 2026-11-04

**This section supersedes conflicting field-name suggestions in Sections 3–5 and 11.**
Customer, Partner, Admin and Firebase must use one shared DTO vocabulary. A field must not be renamed differently by each app. New writes use canonical names only; legacy names are accepted only by a temporary read/migration adapter and are never dual-written.

### 12.1 Canonical dog identity and details

| Canonical field | Type / source | Rule |
| --- | --- | --- |
| `dogId` | string; selected pet document ID | Same field in Customer request, Booking and Walk Task |
| `dogName` | string; trusted pet record snapshot | Server reads `users/{uid}/pets/{dogId}`; client display value is not authoritative |
| `dogDetails` | map; allowlisted trusted pet snapshot | One structured field shared by all apps; do not use `petName`, `petDetails`, or `dog` in new writes |

`dogDetails` is a display/operational snapshot built from approved pet fields (for example breed, age, size, and relevant care notes where those fields exist). The implementation must inspect the actual pet schema and allowlist fields; it must not copy private or unrelated pet-document fields wholesale. The canonical pet record remains the source of truth; snapshots preserve what was booked.

### 12.2 Canonical shared vocabulary

| Concept | Canonical field | Do not introduce as a parallel new-write field |
| --- | --- | --- |
| Parent booking identifier | `bookingId` | `id`, alternate booking key |
| Individual scheduled walk identifier | `walkTaskId` | Reusing `bookingId` or legacy review-history `walks/{walkId}` |
| Customer identity | `customerId` | Client-supplied owner UID |
| Walker identity | `walkerId` | `partnerId` |
| Dog identity | `dogId` | `petId` |
| Dog display name | `dogName` | `petName` |
| Dog details snapshot | `dogDetails` | `petDetails`, `dog` |
| Service type | `serviceType` | `type` |
| Booking plan | `bookingPlan` | App-specific plan aliases |
| Occurrence instant | `scheduledAt` (Firestore Timestamp) | Separate authoritative `date` + `startTime` |
| Duration | `durationMinutes` (integer, 20–60) | `duration` in a different unit or duplicate duration field |
| Service timezone | `timeZone` (IANA ID) | Device-local timezone inferred by each app |
| Local day filter key | `serviceDateKey` (YYYY-MM-DD, server-derived) | Client-authored `date` |
| Saved pickup reference | `pickupAddressId` | App-specific address ID |
| Pickup snapshot | `pickupAddress` (same structured map shape) | String-valued `pickupAddress`, `location`, or `zoneName` as substitutes |
| Canonical Zone | `serviceZoneId` (server-resolved) | Client-selected Zone as authority |
| City reference | `cityId` (server-resolved from Zone) | Client-supplied City as authority |
| Task state | `status` (shared enum, still a separate approval gate) | Different Customer/Partner status meanings |

The display labels such as “Today”, “6:30 AM”, dog name, or formatted address are UI formatting only. They are derived from canonical values and are not separately authoritative fields. In particular, Partner must derive its display time from `scheduledAt` using `timeZone`; `serviceDateKey` is the indexed day-filter key generated by trusted server code.

### 12.3 Parent Booking versus Walk Task field ownership

**Parent `bookings/{bookingId}`:** booking-level intent and commercial record, including `bookingId`, `customerId`, `dogId`, `dogName`, `dogDetails`, `serviceType`, `bookingPlan`, `pickupAddressId`, `pickupAddress`, booking period/plan inputs, quote/payment state, and server-owned `serviceZoneId` / `cityId` after coverage validation.

**Child `walk_tasks/{walkTaskId}`:** one executable occurrence, including `walkTaskId`, `bookingId`, `customerId`, `dogId`, `dogName`, `dogDetails`, `serviceZoneId`, `cityId`, `scheduledAt`, `timeZone`, `serviceDateKey`, `durationMinutes`, `pickupAddressId`, `pickupAddress`, `walkerId`, and `status`. All identity, location, schedule, dog snapshot and assignment values are server-validated/copied from the parent and trusted source records. Walker assignment remains null until the authorized assignment workflow runs.

A parent may contain multiple scheduled tasks. Partner's operational lists query assigned `walk_tasks`; Admin can view the parent and its child tasks. Do not create a new Booking per walk and do not reuse completed-walk review history in `walks/{walkId}`.

### 12.4 Schedule payload normalization

- One-Time and Choose-Dates inputs are normalized by trusted server code into individual occurrences.
- Every occurrence stores one `scheduledAt` Timestamp, one integer `durationMinutes`, one `timeZone`, and one server-derived `serviceDateKey`.
- Nested Customer input may contain date/time selection fields, but those are request DTO fields only; the persisted Walk Task uses the canonical occurrence fields above.
- Do not persist both `scheduledAt` and independently editable `date`/`startTime` as competing sources of truth.
- Immediate/ASAP requests are requests for operations/availability handling, not a fixed occurrence inferred from the Customer device clock.
- Regular plans remain non-assignable until a bounded calendar period/end date and generation horizon are supplied and approved.

### 12.5 Legacy compatibility rule

For historical records only, a temporary adapter may read:
- `petName` → canonical display `dogName`;
- `petDetails` or legacy `dog` → canonical display `dogDetails`;
- `type` → `serviceType`;
- legacy `date` + `startTime` → display/diagnostic schedule only where no canonical `scheduledAt` exists;
- string `pickupAddress` or `location` → display-only legacy address.

The adapter must not silently fabricate `dogId`, `serviceZoneId`, `cityId`, trusted coordinates, availability, price, or assignment. It must not dual-write legacy and canonical names. Historical documents are not bulk-renamed by this contract. Remove read fallbacks only after all supported app versions, reports, Functions and historical views are verified.

### 12.6 Alignment acceptance gates

Before app cutover, Emulator/API contract tests must prove:
1. Customer request resolves the selected `dogId` to the trusted pet record and produces exactly one `dogName` + `dogDetails` representation.
2. Firebase persists the same canonical field names on parent and child task; no `petName`, `petDetails`, `dog`, or `type` aliases are written.
3. Partner reads `dogName` and `dogDetails` and derives date/time from `scheduledAt` + `timeZone`.
4. Admin reads the same parent/task vocabulary without a separate rename layer.
5. Legacy-only historical fixtures remain readable through the adapter, without creating false trusted Zone/assignment/payment fields.
6. Missing, malformed, or mismatched dog/address/schedule references are rejected and leave protected Firestore state unchanged.

**Scope boundary:** This is a documentation contract alignment only. It does not modify Customer, Partner, Admin app code, Firebase runtime code, Rules, data, production configuration, or deployments. The canonical field names are now aligned in this draft; the shared task status enum, timezone source, bounded Regular period, and idempotency details remain separate gates.
