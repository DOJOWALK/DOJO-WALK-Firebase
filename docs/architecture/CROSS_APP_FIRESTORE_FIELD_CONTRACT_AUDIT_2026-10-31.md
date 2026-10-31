# DOJO WALK — Cross-App Firestore Field-by-Field Contract Audit
**Date:** 2026-10-31  
**Status:** SOURCE AUDIT / PROPOSED REMEDIATION — NOT APPROVED, NOT DEPLOYED

## 1. Repositories and source evidence inspected
- Customer `DOJOWALK/DOJO-WALK-Customer`, `main`
  - `lib/features/booking/screens/booking_confirmation_screen.dart`
  - blob SHA `94d45b12c7873fc2d289e164df965c735c0c63cb`
- Partner `DOJOWALK/DOJO-WALK-Partner`, `chore/notion-aligned-structure`
  - `lib/screens/home/partner_home_screen.dart` — blob SHA `c08b300b50b956baca84ad9fa3fa3ca46055e92a`
  - `lib/screens/home/walk_details_screen.dart` — blob SHA `9e99509e1adb507a9c1fdaaf080f44eb46930a83`
  - `lib/screens/home/working_schedule_screen.dart` — blob SHA `0046918047dd62140f078bb7a02f1c5a483e2b83`
  - `lib/features/live_walk/screens/live_walk_screen.dart` — source inspected in the same branch
- Admin `DOJOWALK/DOJO-WALK-Admin`, `main`
  - `lib/features/walkers/services/walker_admin_service.dart` — blob SHA `d87d248ff8cc7f1b265c0db0c8f5abd52b6a3eb5`
  - `lib/screens/live/live_operations_screen.dart` — blob SHA `15bf852258b273f753a45d9b107528dc027829e5`
- Firebase `DOJOWALK/DOJO-WALK-Firebase`, `main`
  - `firestore.rules` — blob SHA `9bac26b9e13a97d412a0154ec9af70629e82eb47`
  - `functions/src/index.ts` — blob SHA `2b13994aff949f38e626e1929422e5de84755312`

This is checked-in source inspection. It does not prove deployed Firebase Rules or Functions are identical. No production documents were read. No application source, Rules, Functions or production data were modified.

## 2. Customer → Firestore: actual booking create contract
Customer creates exactly one parent document at `bookings/{generatedBookingId}` using `bookingRef.set(bookingData)`. In the inspected writer, it does not create one document per walk.

Common fields written:
- `bookingId` (same generated ID), `customerId`
- `walkType: scheduled`
- `bookingPlan`, `serviceType`, `serviceName`
- `petName`, `dogId`, `petDetails` snapshot
- `pickupAddressId`, `pickupAddress` map snapshot
- `scheduledAt` Firestore Timestamp
- `duration` string such as `30 minutes`
- `preferredTime`
- `walkCount`, `walkSchedules`
- `status: pending`, `walkerId: null`, `cancelRequest: null`
- `createdAt: serverTimestamp`

Regular booking additionally writes:
- `frequency: daily`
- `walksPerWeek: 7`
- `walksPerDay`
- `planStatus: pending_confirmation`
- `dailyWalkTemplate`

Choose-dates booking additionally writes:
- `walksPerDay`
- `selectedDates` (date-key strings)
- `dateSchedules` (date Timestamp plus nested walk list)

Walk schedule items are normalized to `walkNumber`, `time`, `duration`, optional `startHour`, `startMinute`, and optional `price`. The first schedule is also copied into the common parent fields.

### Contract issue
The parent record represents a booking request/package and can contain multiple dates and multiple walk slots. It is not a single independently executable walk. Treating this document as one walk causes downstream ambiguity.

## 3. Partner reads/writes: observed contract

### Home — booking reader
Partner Home queries:
`bookings.where('walkerId', isEqualTo: currentAuthUid)`
Then it filters the result using only `data['date']` for today's date and active statuses `assigned`, `accepted`, `picked_up`, `walking`. It sorts using `startTime`.

Customer writer above does not write top-level `date` or `startTime`. It writes `scheduledAt`, `preferredTime`, `walkSchedules`, and possibly `selectedDates`/`dateSchedules`. Therefore an assigned Customer booking may be omitted from Partner Home. **P1 confirmed source mismatch.**

### Walk Details — assignment acceptance
Partner Walk Details reads `bookings/{bookingId}` and its action updates the parent booking status to `accepted`. The UI does not visibly perform a trusted offer-ID/deadline check or atomic assignment claim. The checked-in Firebase rule allows an approved assigned walker to update a limited set of status/progress fields, but it does not enforce an explicit transition graph or single-acceptance transaction. **P1 workflow/security gap.**

### Working Schedule — availability writer
Partner Working Schedule reads `walkers/{uid}.workingSchedule` and writes:
`workingSchedule: { status: active, days: { monday..sunday: { enabled, start, end } } }`
plus `updatedAt`, using a client-side merge write.

The checked-in Firebase `walkers/{uid}` owner-update allowlist includes `availability` but does **not** include `workingSchedule`. Thus this exact client write appears incompatible with the inspected Rules and should be denied by them. This is a **P0/P1 release-blocking integration mismatch to reproduce in Emulator**; do not “fix” by broadly allowing arbitrary walker fields. Either align the client to an approved canonical availability field or add a narrowly validated server-authoritative availability workflow after policy approval.

### Live Walk — completion write
The inspected Partner Live Walk flow writes a walk completion record and updates the parent booking in a batch. Prior source inspection established that its booking update includes fields such as `completedAt`, `dogReturned`, `returnLocationVerified`, `route`, `peeCount`, `poopCount`, `distance`, and `durationActual`. The checked-in booking walker update allowlist includes only `status`, `updatedAt`, `startedAt`, `completedAt`, `walkSchedules`, `walkNotes`, `peeCount`, `poopCount`, `distance`, and `durationActual`; it does not include `dogReturned`, `returnLocationVerified`, or `route`. If the Partner batch includes any disallowed field, the entire batch fails under these Rules. The rules also have no explicit `/walks/{walkId}` match in the inspected source, so client writes to that path are default-denied. **P0 potential completion blocker; verify exact batch in Emulator and use trusted backend completion rather than widening client writes.**

## 4. Admin reads/writes: observed contract
- Walker Admin Service reads `walkers`, `bookings`, `audit_logs`, and `admin_users`.
- Walker approval/rejection/suspension/reactivation is performed by a Firestore transaction that reads the signed-in admin and walker records, updates the walker state, and writes an audit record. Client-side service checks active `super_admin`; Rules independently permit admin walker decisions and audit writes.
- Admin Bookings UI streams the `bookings` collection for the booking table/dashboard.
- Admin Live Operations listens to `walkers` where `isOnline == true`, reads `currentLocation` from each walker document, and queries `walk_locations` by `walkerId`, ordered by `timestamp`, for route points.

### Contract issue
Admin Live Operations expects live location data in two places:
1. `walkers/{uid}.isOnline` and `currentLocation`
2. `walk_locations/{pointId}` with `walkerId`, `latitude`, `longitude`, `timestamp`

The inspected Partner Live Walk screen keeps route points in local memory and saves its route at completion; no corresponding live `walk_locations` ingestion was found in the inspected Partner flow. Therefore Admin live map and Partner GPS are not yet shown to share one live data contract. **P1 operations integration gap.**

## 5. Firebase Rules comparison — field-level summary

| Path | Client writer | Rules observation | Result |
|---|---|---|---|
| `users/{uid}` | Customer profile | Owner create/update allowlists customer profile fields | Broadly aligned; verify every profile field against current Customer writer |
| `users/{uid}/pets/{petId}` | Customer pet profile | Owner create/update require pet fields and types | Validate current pet writer against exact required fields |
| `users/{uid}/addresses/{id}` | Customer saved address | Owner create/update require address fields incl. coordinates | Verify current writer field names/types |
| `users/{uid}/pickup_addresses/{id}` | Customer pickup address | Owner create/update allowlist address fields | Verify current writer; booking snapshot is separate |
| `bookings/{bookingId}` create | Customer | `validBookingBase` + one-time/regular/custom validation | Main payload is structurally intended to match; run exact fixtures in Emulator |
| `bookings/{bookingId}` update | Customer | Customer may update cancellation fields; review fields after completion | Limited; no direct customer assignment writes |
| `bookings/{bookingId}` update | Admin | Admin allowlist includes assignment and selected lifecycle/payment fields | No full lifecycle transaction/callable shown in Functions entrypoint |
| `bookings/{bookingId}` update | Partner | Approved assigned walker can update selected status/progress fields | No offer expiry, atomic claim or complete transition validation |
| `walkers/{uid}` | Partner | Owner allowlist permits `availability`, not `workingSchedule` | Mismatch |
| `walks/{walkId}` | Partner completion | No explicit match in inspected Rules | Default deny unless separately deployed service handles it |
| `walk_locations/{id}` | Admin reader expects data | No explicit match in inspected Rules | No verified client/backend write contract |
| `walk_occurrences/{id}` | Proposed | No explicit match | Not implemented; proposal only |

## 6. Canonical field contract recommendation (not yet approved)

### Keep parent booking
`bookings/{bookingId}` remains the customer request/order and schedule-template document. Customer can create a pending parent booking and read its own booking. It must not independently assign a walker or mark a walk complete.

### Add backend-owned occurrence layer
Proposed collection: `walk_occurrences/{occurrenceId}`, one record for each independently assignable walk. This is a proposal, not an existing collection.
Minimum fields to approve:
- `occurrenceId`, `bookingId`, `customerId`
- `assignedWalkerId`
- `serviceDate` (local date), `timeZone`, `scheduledStartAt` (Timestamp)
- `durationMinutes`
- `petSnapshot`, `pickupSnapshot`
- `status`, `createdAt`, `updatedAt`

Stable occurrence IDs must cover immediate/one-time, multi-date and recurring daily/multiple-per-day cases. Define deterministic/idempotent generation and timezone rules before implementation.

### Ownership
- Customer: create parent booking request; no direct occurrence or assignment writes.
- Firebase trusted backend: validate request, create occurrences, assign/offer atomically, validate start, ingest GPS, verify one-time handover, complete idempotently, record incidents, reconcile payments.
- Partner: read only assigned occurrence/offer; send availability preferences and lifecycle commands through validated backend actions; never self-approve or self-authorize completion.
- Admin: operational visibility and explicitly authorized, audited interventions; do not become an alternate unvalidated mobile writer.

## 7. Prioritized fixes
1. **P0 — Reproduce Partner availability write against Firebase Emulator.** Confirm `workingSchedule` is denied by current rules. Decide canonical availability field and enforce eligibility/change limits.
2. **P0 — Reproduce Partner completion batch against Emulator.** Confirm disallowed booking fields and missing `walks` match; do not loosen Rules broadly.
3. **P1 — Resolve booking parent vs walk occurrence mismatch.** Customer schedule templates need backend-generated per-walk occurrence records; Partner Home/Schedule should consume those records.
4. **P1 — Replace direct status=accepted with trusted offer acceptance.** Require offerId, occurrenceId, deadline, current eligibility and atomic single-walker claim.
5. **P1 — Unify live GPS contract.** Decide whether Admin's `walk_locations` and `walkers.currentLocation` are derived from a single backend-validated ingestion stream.
6. **P1 — Add Emulator end-to-end tests.** Customer booking create → occurrence generation → assignment → Partner read → availability → start → GPS → handover → completion → Admin view. Include cross-user denial, stale offer, duplicate requests and concurrent accepts.
7. **P2 — Audit customer profile/pet/address writes and payment lifecycle fields** against exact Rules allowlists and current app source.
8. Verify deployed Firebase project/rules/functions/indexes before any release.

## 8. No changes performed
- Documentation proposal only.
- No Firestore collection created or migrated.
- No app source, Firestore Rules, Functions or indexes changed.
- No production data accessed or changed.
- No CI/Emulator/device validation was run in this task; all blockers above are source-derived until reproduced.
