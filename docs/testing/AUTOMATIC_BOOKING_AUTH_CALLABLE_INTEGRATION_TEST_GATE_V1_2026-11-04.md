# Automatic Booking — Authenticated Callable Integration Test Gate

**Status:** BLOCKED — production Booking callable and Zone resolver do not yet exist on this branch.  
**Purpose:** Freeze the real integration acceptance requirements before implementation.  
**Approved policy:** All eligible Active Zones must process ordinary bookings automatically without routine Central Admin approval.

## 1. Repository evidence checked

The current Functions source contains:
- `loadOwnedBookingSourceRecords(db, authenticatedUid, dogId, pickupAddressId)` — trusted UID-scoped pet/address loader.
- `validateAndNormalizeBookingRequest(...)` — pure canonical request composition.
- Existing Zone lifecycle implementation is on a separate implementation branch/PR and is not an ancestor of this Booking stack at present.
- Current `functions/src/index.ts` has no exported customer Booking callable, Automatic Zone Resolver, availability/capacity reservation or Walker assignment callable.

Therefore, an Auth + Firestore Emulator test cannot honestly invoke the real Booking path yet. A test that only invokes a locally invented reference function would not count as callable integration acceptance.

## 2. Required callable contract

When the real callable is implemented, the integration suite MUST:
1. Invoke the exported callable through Firebase Functions Emulator using a synthetic authenticated customer token from Auth Emulator.
2. Accept only canonical customer intent identifiers and schedule data. Reject client-authored customer UID, pet snapshots, pickup snapshots, Zone/Boundary IDs/hashes, timezone, capacity, price, Walker ID or status fields.
3. Load the customer's pet and saved address under `request.auth.uid`; reject missing or foreign IDs without disclosing which foreign record exists.
4. Resolve exactly one eligible Active Zone from server-trusted coverage data:
   - strict-majority of the entire verified building footprint when available;
   - otherwise point fallback only when strictly inside exactly one eligible Zone and safely away from the boundary;
   - ties, overlap, invalid geometry, stale approvals, no eligible Zone or uncertain coverage fail closed into a durable exception outcome.
5. Verify current Zone lifecycle fields and exact Founder approval tuple against the verified Boundary and revalidate versions/hashes at commit.
6. Read trusted India country configuration and pin `Asia/Kolkata`; ignore/reject device/client timezone authority.
7. Check actual time-slot availability and reserve Zone capacity atomically before confirming; concurrent contention cannot oversell.
8. Select only eligible active/approved Walker assigned to the resolved Zone unless a separately approved cross-zone policy exists.
9. Persist durable states and retry/exception records; no silent drop. No Central Admin approval record or online Admin process is required for a normal eligible request.
10. Apply idempotency: same key + same canonical payload returns the original result; same key + changed payload conflicts.
11. Never capture payment before a valid capacity reservation; payment provider integration and payment state transitions require their own approved contract.
12. Do not create a Walk Task or report successful assignment until the relevant assignment/acceptance transition actually succeeds. Immediate remains awaiting operations confirmation.

## 3. Mandatory Auth + Functions + Firestore Emulator scenario matrix

| ID | Synthetic scenario | Required assertion |
|---|---|---|
| INT-01 | Unauthenticated caller | unauthenticated; no writes |
| INT-02 | Customer A submits Customer B pet/address IDs | not-found style denial; no writes |
| INT-03 | Client forges UID/pet/address/Zone/Boundary/timezone/Walker/price | invalid-argument; no writes |
| INT-04 | Canonical valid request in an Active Zone; no Admin fixture | accepted automatically |
| INT-05 | Inactive / suspended / service-disabled Zone | no confirmation or task |
| INT-06 | Verified approval tuple references stale or mismatched Boundary/hash | fail closed |
| INT-07 | Point strictly inside one Zone and away from edge | that Zone resolves |
| INT-08 | Point on edge, near edge, or inside overlapping eligible Zones | exception; no guessed Zone |
| INT-09 | Footprint 70/30 and 51/49 | strict-majority Zone |
| INT-10 | Footprint exactly 50/50, no strict majority, invalid topology | exception; no booking/task |
| INT-11 | Footprint intersection denominator includes uncovered portion | no fragment renormalization |
| INT-12 | Client/device timezone differs from trusted India config | Asia/Kolkata governs |
| INT-13 | Requested slot has capacity | atomic reservation succeeds |
| INT-14 | Requested slot is full | no confirmation; only verified alternatives |
| INT-15 | Two authenticated customers race for one remaining capacity unit | exactly one reservation |
| INT-16 | Same idempotency key and payload replay | one Booking, stable response |
| INT-17 | Same key with changed payload | conflict; no duplicate |
| INT-18 | Eligible primary Walker accepts | assignment state reflects acceptance |
| INT-19 | Primary Walker timeout/no check-in | retry/backup state; no false assignment |
| INT-20 | No eligible Walker | durable exception + alert; no false confirmation |
| INT-21 | Zone/Boundary/approval/footprint changes between resolution and commit | transaction abort/retry; no stale booking |
| INT-22 | Admin account absent/offline | valid ordinary request still processes |
| INT-23 | Immediate request | awaiting operations confirmation; no premature task |
| INT-24 | Every denial/failure case | no forbidden Booking, Walk Task, payment capture, assignment or success notification |

## 4. Required test execution and evidence

- Run Auth, Functions and Firestore Emulators under a `demo-*` project only.
- Use only synthetic users, pets, addresses, Zones, Boundaries, footprints, Walkers and capacity records.
- Invoke the real exported callable using Emulator SDK; do not call internal reference helpers as a substitute.
- Assert exact Firestore document writes, state transitions, forbidden-write absence and response codes.
- Include test count, exact PR head SHA, workflow run/job links and per-scenario result.
- Runtime implementation remains blocked until this suite passes against the real callable.

## 5. Explicit non-approval / safety

This document is a test gate, not approval to invent missing production schema, payment states, Walker cross-zone rules, footprint provenance or timezone configuration path. No production code, Rules, indexes, payment integration, apps, migration, merge or deployment is authorized by this document.
