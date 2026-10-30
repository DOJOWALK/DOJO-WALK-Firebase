# DOJO WALK Booking & Walk Firestore Field Contract — Draft

**Status:** Draft / Not approved for implementation  
**Date:** 2026-10-30  
**Repository:** `DOJOWALK/DOJO-WALK-Firebase`  
**Branch:** `docs/booking-walk-backend-plan-2026-10-30`  
**Related:** `docs/BOOKING_WALK_BACKEND_IMPLEMENTATION_PLAN_2026-10-30.md`  
**Production:** No schema migration, Rules change, Function deployment or production write is authorized by this document.

## 1. Contract authority

This document separates:
- **Existing observed fields/behavior:** found in inspected app or Firebase source.
- **Required contract behavior:** constraints already identified by the cross-app readiness review and POL-007 draft.
- **Proposed field names:** suggestions only; they are not approved canonical schema.

POL-006, POL-007 and POL-026 remain Draft / approval pending. The exact booking state machine, assignment authority, handover evidence, override policy, GPS cadence/freshness/retention and customer visibility are not yet approved. Consequently, this document intentionally does not invent final status enums, numeric thresholds, or required handover fields.

## 2. Existing observed data (not a canonical contract)

| Area | Observed in source | Contract concern |
|---|---|---|
| Booking | `bookings/{bookingId}` | Existing booking document is used by Customer, Partner and Admin; lifecycle authority is split across client Rules permissions. |
| Customer pickup | `pickupAddress.latitude`, `pickupAddress.longitude` | Partner parser supports nested coordinates and legacy fallback; canonical null/legacy migration policy is unresolved. |
| Assignment | `walkerId` on booking | Must be validated against current assignment by trusted backend at every lifecycle command. |
| Booking lifecycle | `status`, `startedAt`, `completedAt` | Current Rules permit Admin and assigned approved Walker updates; this must be replaced after contract approval. |
| Walk | `walks/{walkId}` | Partner currently writes a compacted `route` array at completion; stable walk identity and server lifecycle are unresolved. |
| Walker live marker | `walkers/{walkerId}.currentLocation` | Admin reads this for map markers; Partner source audit did not find an in-walk write. |
| GPS history | Admin reads `walk_locations` filtered by `walkerId`, timestamp ordered, capped at 300 | Partner source audit did not find corresponding in-walk point writes; canonical keying/index/cadence/retention unresolved. |
| Audit | `audit_logs` | Existing audit pattern exists for Walker admin actions; lifecycle event schema and actor authority need a dedicated contract. |

## 3. Proposed document boundaries (not approved)

### A. `bookings/{bookingId}`
Booking/customer/payment/assignment record. Keep existing booking identity and customer-facing booking details; authoritative status and assignment changes must be server-controlled.

Potential fields to standardize:
- `customerId` — existing observed.
- `walkerId` — existing observed assignment reference; nullability and assignment history need definition.
- `pickupAddress` — existing observed object; canonical coordinate representation must be finalized.
- `status` — existing observed but enum and transition graph not approved.
- `createdAt`, `updatedAt` — confirm actual usage/type and server authority before standardizing.
- `assignedAt`, `startedAt`, `completedAt` — existing Rules allow these fields; server timestamp semantics and nullability must be defined.
- `walkId` — proposed stable link to the operational walk; creation timing and immutability require approval.

Do not add a field or change a status value in production until the data dictionary and migration plan are approved.

### B. `walks/{walkId}`
Operational walk record, linked to exactly one booking.

Potential fields:
- `bookingId` — proposed required immutable link.
- `walkerId` — proposed assigned Walker identity, checked against booking at start and throughout active walk.
- `status` — proposed operational state; exact enum/transitions pending POL-007.
- `startedAt`, `completedAt` — proposed server timestamps.
- `startEventId`, `completionEventId` — optional linkage to immutable events; naming/necessity pending.
- `routeSummary` — proposed compact summary only if approved; do not treat client-submitted route as authoritative evidence.

### C. `walk_locations/{locationEventId}`
Proposed append-only GPS sample collection. The document key, partitioning, sample ordering, deduplication, read model and TTL/retention are unresolved.

Candidate fields (all proposed):
- `walkId`
- `bookingId`
- `walkerId`
- `latitude`
- `longitude`
- `accuracyMeters`
- `capturedAt` (device capture time; untrusted until validated)
- `receivedAt` (server receive timestamp)
- `sequence` or idempotency token

Rules: no client may write arbitrary GPS for another Walker/walk. Only the authenticated currently assigned Walker may submit permitted samples through a trusted validation path. Stale samples must never be presented as live. Exact read authorization and customer map visibility require policy approval.

### D. `walk_events/{eventId}`
Proposed append-only event log.

Candidate fields:
- `bookingId`
- `walkId`
- `eventType`
- `actorUid` (derived from verified auth context, never trusted from client input)
- `actorRole` (derived from authoritative role record)
- `serverCreatedAt`
- `idempotencyKey` or request fingerprint
- `metadata` (strict allow-list; no arbitrary client payload)

Event names and metadata schema must be generated from the approved state machine. Client update/delete should be denied.

## 4. Contract invariants required before implementation

1. Every operational walk is linked to one booking and one current assigned Walker.
2. A missing booking ID cannot produce an unlinked completed walk.
3. The server re-reads booking, assignment and Walker eligibility before start and completion.
4. Reassignment invalidates the previous Walker's ability to start, update or complete that walk.
5. A walk has at most one successful start and one successful completion; retries are idempotent.
6. Booking transition, walk transition and immutable lifecycle event are committed atomically.
7. Actor identity, role and authoritative timestamps are derived server-side.
8. Customer and Walker access is limited to records permitted by the approved relationship and area/zone policy.
9. GPS samples are validated and freshness-aware; no stale location is represented as current.
10. Completion requires the approved safe-handover condition; its exact evidence is still a policy decision.
11. Client writes to authoritative lifecycle, assignment, payment and audit fields are denied.
12. Existing legacy pickup coordinate formats are handled by an explicit compatibility/migration rule, not an indefinite silent fallback.

## 5. Decisions deliberately left unresolved

| Decision | Current state | Required approver / source |
|---|---|---|
| Booking status enum and transition graph | Not approved | POL-006 / POL-007 |
| Walk status enum and transition graph | Not approved | POL-007 |
| Assignment writer and reassignment semantics | Not approved | POL-006 / POL-007 |
| Exact start prerequisites and pickup validation | Not approved | POL-007 |
| Safe handover definition and evidence fields | Not approved | POL-007 / POL-016 |
| Emergency stop/override behavior | Not approved | POL-016 / POL-026 |
| Stable walk ID creation and idempotency format | Not approved | Shared data contract |
| GPS cadence, accuracy and stale thresholds | Not approved | POL-007 + privacy review |
| GPS retention, deletion and route archive | Not approved | Privacy/data retention policy |
| Customer live tracking visibility | Not approved | POL-007 |
| Central/City Manager/Zone Supervisor access scope | Not approved | Role governance + POL-004 |
| Legacy booking/pickup migration | Not approved | Data migration plan |

## 6. Required next gates

**Gate 1 — Policy decisions:** Obtain approval for POL-006, POL-007 and relevant incident/override clauses. Do not infer approval from this draft.

**Gate 2 — Freeze state machine:** Publish exact booking and walk states, transition table, command preconditions, failure codes and role permissions.

**Gate 3 — Freeze field dictionary:** Confirm field names, types, required/optional/null behavior, server/client ownership, immutable fields, indexes and retention.

**Gate 4 — Rules emulator tests:** Prove clients cannot mutate authoritative lifecycle fields; prove legitimate booking create, customer cancellation request and review paths still work.

**Gate 5 — Functions emulator tests:** Implement transactional, idempotent start/complete commands and test reassignment, race, retry and rollback.

**Gate 6 — GPS contract:** Approve sample schema, cadence, stale threshold, retention, customer visibility and area-scoped access before implementing GPS writer/readers.

**Gate 7 — App integration:** Partner, Admin and Customer consume the same versioned contract. Do not ship one app's interpretation independently.

## 7. Explicit no-go list

Until approvals and gates are complete:
- No production Firestore schema migration.
- No production Rules or Functions deployment.
- No client lifecycle behavior treated as authoritative.
- No claim that Admin live GPS works end-to-end.
- No new GPS collection or indexes deployed to production.
- No use of a stale GPS point as a live marker.
