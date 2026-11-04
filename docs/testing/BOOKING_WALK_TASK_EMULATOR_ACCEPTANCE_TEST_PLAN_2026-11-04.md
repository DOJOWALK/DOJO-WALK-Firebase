# Booking + Walk Task Emulator Acceptance Test Plan

**Date:** 2026-11-04  
**Status:** Test plan only — not runtime implementation and not an approval of unresolved contract choices.  
**Base:** canonical Booking field-alignment branch at `11c5a6284d923d7eda54cbbb917e159d96f3d979`.

## 1. Purpose

Define the synthetic Auth + Functions + Firestore Emulator gates for moving from the legacy client-written Booking document to the canonical parent Booking + child Walk Task model.

The canonical vocabulary is taken from Section 12 of `docs/contracts/BOOKING_WALK_TASK_CONTRACT_V1_DRAFT.md`:

- `bookingId`, `walkTaskId`, `customerId`, `walkerId`
- `dogId`, `dogName`, `dogDetails`
- `serviceType`, `bookingPlan`
- `scheduledAt`, `timeZone`, `serviceDateKey`, `durationMinutes`
- `pickupAddressId`, structured `pickupAddress`
- server-resolved `serviceZoneId` and `cityId`

This plan deliberately does not invent the final callable name, status enum, timezone authority, idempotency format, Regular plan horizon, or quote/payment contract.

## 2. Emulator isolation requirements

Every test suite that invokes Functions must:

1. Require a Firebase project ID beginning with `demo-`.
2. Require Auth, Functions and Firestore Emulator host configuration.
3. Explicitly reject `dojo-platform-b68a3`.
4. Use synthetic UIDs, pets, addresses, Zones, bookings and walkers only.
5. Seed and clean up all fixture documents and Auth users.
6. Assert both callable result/error and resulting Firestore state.
7. Never read or write production Firebase.

The existing Zone Emulator harness provides a local pattern for these guards; the Booking suite must use its own unique fixture prefix to avoid collisions.

## 3. Acceptance matrix

### A. Authentication and source-of-truth validation

| ID | Scenario | Expected result | State assertion |
| --- | --- | --- | --- |
| BK-001 | Unauthenticated request | Reject | No Booking or task created |
| BK-002 | Authenticated customer submits valid owned pet ID | Resolve pet under `users/{uid}/pets/{dogId}` | Snapshot name/details originate from pet document |
| BK-003 | Pet ID does not exist | Reject | No parent/task/audit write |
| BK-004 | Pet belongs to another customer | Reject | Other customer's pet is not disclosed or copied |
| BK-005 | Client sends forged `dogName` / `dogDetails` | Ignore or reject client snapshot; use trusted pet record | Persisted dog fields match source pet |
| BK-006 | Client sends legacy aliases `petName`, `petDetails`, `dog` | Reject or ignore under the approved request DTO | No legacy aliases in new writes |
| BK-007 | Saved address belongs to caller | Resolve `users/{uid}/addresses/{addressId}` | Persisted structured address is server-derived |
| BK-008 | Address missing or belongs to another user | Reject | No Booking/task created |
| BK-009 | Client forges pickup map or coordinates | Do not trust supplied map as authority | Persisted address/coordinates match saved address |

### B. Zone coverage and trusted location

| ID | Scenario | Expected result | State assertion |
| --- | --- | --- | --- |
| BK-010 | Pickup point resolves to exactly one active canonical Zone | Continue only after server-side coverage validation | Parent/task use server-resolved `serviceZoneId` and `cityId` |
| BK-011 | No active Zone covers pickup | Reject or return an explicit unavailable result | No payable/assignable task |
| BK-012 | More than one Zone covers pickup | Fail closed pending an approved boundary tie-break policy | No Zone is guessed |
| BK-013 | Client supplies a different Zone/City ID | Ignore or reject client authority | Stored IDs remain server-resolved |
| BK-014 | Zone is suspended/deactivated before confirmation | Do not confirm/assign | No active task is created |

**Dependency:** The current source inspection has not yet established a canonical Booking-to-Zone coverage callable/contract. These tests are blocked until the resolver and ambiguity policy are specified.

### C. Schedule normalization

| ID | Scenario | Expected result | State assertion |
| --- | --- | --- | --- |
| BK-015 | One-Time request with one valid occurrence | Normalize one occurrence | One child task only after approved confirmation gate |
| BK-016 | Choose-Dates request with multiple dates and walks | Normalize every selected date/walk pair | One unique task per valid occurrence |
| BK-017 | Duplicate date/time occurrence | Reject duplicate or apply an explicitly approved dedupe rule | No duplicate task |
| BK-018 | Duration below 20 or above 60 minutes | Reject | No parent/task mutation |
| BK-019 | Missing or malformed time | Reject | No task created |
| BK-020 | Invalid or unsupported timezone | Reject | No device-local fallback |
| BK-021 | DST/timezone conversion edge case | Normalize deterministically using approved timezone source | `scheduledAt` and `serviceDateKey` agree |
| BK-022 | Client sends competing `date`/`startTime` and `scheduledAt` values | Reject ambiguity or use only approved request DTO fields | Persist only canonical schedule fields |

### D. Plan-specific safe behavior

| ID | Scenario | Expected result | State assertion |
| --- | --- | --- | --- |
| BK-023 | Regular plan without bounded end date/period | Return explicit needs-period/confirmation result; do not generate tasks | No unbounded task series |
| BK-024 | Regular plan with approved bounded period | Generate only within approved horizon | Task count and boundaries match period |
| BK-025 | Immediate/ASAP request with device-generated `DateTime.now()` | Keep as operations/availability request; do not treat device time as fixed appointment | No scheduled Partner task |
| BK-026 | Unsupported plan-specific field combination | Reject | No partial writes |

**Blocking contract decisions:** Regular calendar end-date and generation horizon; Immediate confirmation workflow.

### E. Transaction, idempotency and ownership

| ID | Scenario | Expected result | State assertion |
| --- | --- | --- | --- |
| BK-027 | Valid request passes all checks | Parent and approved child task set commit atomically | No orphan parent or child |
| BK-028 | Failure during occurrence/task creation | Entire write rolls back | Parent/task counts unchanged |
| BK-029 | Retry with same idempotency key and same payload | Return original result | Exactly one parent and one task set |
| BK-030 | Same idempotency key with different payload | Reject conflict | Original records unchanged |
| BK-031 | Concurrent duplicate submissions | Exactly one logical booking/task set | No duplicate occurrence |
| BK-032 | Client attempts direct `walk_tasks` create/update | Deny | No client-authored task |
| BK-033 | Client attempts to set `walkerId` or assigned status | Deny | Assignment fields unchanged |
| BK-034 | Server-created task has canonical fields | Persist canonical names only | No `petName`, `petDetails`, `dog`, `type`, duplicate date/time aliases |
| BK-035 | Task identity and parent link | One `walkTaskId` per occurrence, each references `bookingId` | Booking ID is not reused as task ID |

**Blocking contract decisions:** Idempotency key shape, retention, collision behavior, and whether request receipt creates a non-assignable pending task or waits until availability confirmation.

### F. Cross-role read and operational safety

| ID | Scenario | Expected result | State assertion |
| --- | --- | --- | --- |
| BK-036 | Assigned Walker reads own task | Allowed | Only tasks with server-authored `walkerId == auth.uid` |
| BK-037 | Walker reads another Walker's task | Denied | No cross-Walker disclosure |
| BK-038 | Customer reads own Booking/task | Allowed under approved customer read policy | Other customers' records denied |
| BK-039 | Partner profile preference claims a Zone but no server assignment exists | Not eligible for task assignment | Preference does not create authority |
| BK-040 | Historical legacy Booking uses `petName` / `petDetails` | Read adapter displays legacy values | No trusted IDs/Zone/assignment/payment are fabricated |

## 4. Current baseline evidence

The existing `test/booking_contract_alignment.rules.test.mjs` characterizes the current Rules behavior:

- Current Rules reject a canonical client-created Booking payload using `dogName`, `dogDetails`, and `durationMinutes`.
- Current Rules accept the characterized legacy Booking shape using `petName`, `petDetails`, and `duration`.
- Current Rules deny direct client creation of `walk_tasks`.

These are baseline facts about the current Rules, not evidence that the proposed server-side Booking flow exists.

The inspected `functions/src/index.ts` has no Booking or Walk Task creation callable export. It contains location and Zone operations, but no canonical Booking transaction. Therefore callable-level acceptance tests cannot pass until a callable/API contract and implementation exist.

## 5. Decisions required before callable implementation

1. **Callable/API name and request envelope:** exact stable callable name, versioning and response/error shape.
2. **Status enum:** shared Booking and Walk Task statuses, transitions, and Admin/Partner display mapping.
3. **Availability gate:** whether a request creates a non-assignable parent only, or parent plus non-assignable child tasks; exact point at which tasks become assignable.
4. **Timezone authority:** canonical Zone timezone source and IANA validation policy.
5. **Regular plan:** calendar start/end, service period, generation horizon and extension behavior.
6. **Immediate plan:** operations confirmation and conversion to a fixed occurrence.
7. **Idempotency:** key source, storage path, retention, payload hash and replay behavior.
8. **Zone resolver:** point-in-polygon behavior, boundary overlap/tie-break policy, and active/suspended Zone checks.
9. **Quote/payment:** server-issued quote and availability token, expiry, price authority, and payment state transitions. Payment must remain blocked until availability and price are confirmed.

## 6. Implementation order after decisions are approved

1. Pure request validator and One-Time/Choose-Dates occurrence normalizer (no Firestore writes).
2. Unit tests for all malformed input, pet/address ownership, schedule and timezone cases.
3. Emulator callable tests for auth, trusted pet/address snapshots, Zone resolution and availability gate.
4. Atomic parent/task write, idempotency and rollback tests.
5. Firestore Rules tests for client denial and role-scoped reads/updates.
6. Only after Firebase tests pass: update Partner, Admin and Customer adapters in coordinated branches.
7. Historical compatibility and staged rollout plan; no bulk backfill without dry-run and rollback.

## 7. Explicit non-goals

- No production deployment or production data access.
- No production Rules or Functions changes.
- No changes to Customer, Partner or Admin app repositories in this test-plan slice.
- No payment provider integration, pricing change, Walker assignment algorithm change or historical data migration.
- No merge to `main`.

**Gate:** This plan is a test blueprint only. It does not approve unresolved API/status/timezone/idempotency/Regular/Immediate decisions and does not claim any Booking/Walk Task Emulator acceptance test has been run.
