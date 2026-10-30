# DOJO WALK Booking & Walk Backend Implementation Plan

**Status:** Draft — architecture review required  
**Repository:** `DOJOWALK/DOJO-WALK-Firebase`  
**Base:** `main`  
**Scope:** Trusted backend commands and Firestore authorization for booking lifecycle, walk lifecycle, GPS and audit events.  
**Production status:** No production changes authorized or made by this document.

## 1. Current source audit (2026-10-30)

The current Functions entry point (`functions/src/index.ts`) contains callable functions for service-location workflows. The inspected exports include boundary review, service-location activation/status and import/name-index workflows. No booking lifecycle or live-GPS callable endpoint was found in that entry point.

The current `firestore.rules` booking match permits:
- Customer booking creation under the existing booking validators.
- Customer updates to limited cancellation-request and review fields.
- Admin updates to a list that includes booking status, walker assignment, start/completion timestamps and payment-related fields.
- An approved assigned Walker to update a list that includes booking status, start/completion timestamps and walk metrics/notes.

This means the client-facing rules currently permit lifecycle field updates by Admin/assigned Walker. A trusted backend command model is required before treating lifecycle transitions as server-authoritative.

The inspected rules contain a deny-all match for `walk_requests`. No dedicated `walk_locations` or `walk_events` lifecycle model was established by this audit. The Admin/Partner source audit separately found a mismatch between the Admin route reader and Partner GPS writer.

## 2. Safety constraints

1. Do not deploy Functions or Firestore Rules to the production Firebase project as part of this plan.
2. Do not alter or migrate existing production booking documents.
3. Do not create a new production collection schema until the shared data contract and relevant policies are approved.
4. Every command must authenticate the caller and re-check authorization and current state inside a Firestore transaction where state changes are made.
5. Client devices must not be authoritative for assignment, booking status, walk start/completion, handover, payment status or audit actor identity.
6. GPS must never be shown as live when its freshness cannot be established. Stale/offline state must be explicit.
7. Do not persist unnecessary precise location data. Retention, access scope and customer visibility require policy approval.

## 3. Proposed command surface (names are provisional)

### `startWalk`
Input (provisional): booking identifier, idempotency key, client-reported start evidence and optional device metadata.

Trusted backend must:
- Require an authenticated, active, approved Walker.
- Read booking and Walker records inside a transaction.
- Confirm the booking is in an allowed start state and is assigned to this Walker now.
- Reject missing booking IDs, cancelled/completed bookings, reassigned bookings and duplicate starts.
- Validate the approved pickup/start requirements once POL-007 and the canonical booking contract specify them.
- Create or bind exactly one stable walk identifier.
- Record server timestamp and append an immutable lifecycle event.
- Return the canonical walk identifier and server-confirmed state.

### `completeWalk`
Input (provisional): booking/walk identifiers, idempotency key, completion evidence and handover details.

Trusted backend must:
- Re-check authenticated assigned Walker and current booking/walk state.
- Reject unknown, mismatched, cancelled, already-completed or reassigned walks.
- Validate required safe handover evidence before completion.
- Commit walk completion, booking transition and audit/event record atomically.
- Make retries idempotent and return the already-committed result when the same request is retried.
- Never accept a client-supplied actor UID, authoritative timestamp or final booking status as truth.

### GPS ingestion (endpoint and storage shape pending approval)
Trusted backend must:
- Authenticate the assigned Walker and verify the active walk.
- Validate coordinate ranges, timestamp plausibility, accuracy and sequence/idempotency.
- Reject writes for inactive, cancelled, completed or reassigned walks.
- Apply rate/cadence limits and prevent arbitrary writes to another Walker's feed.
- Store only the minimum required location fields.
- Define explicit retention, access, and stale-location rules before implementation.

## 4. Proposed data separation — NOT an approved schema

The following separation is a discussion model only:
- `bookings/{bookingId}`: customer booking, payment and assignment state.
- `walks/{walkId}`: operational walk state and summary.
- `walk_locations/{locationEventId}`: time-series GPS samples, scoped to walk and Walker.
- `walk_events/{eventId}`: append-only lifecycle events.
- Incident records: separate restricted-access records, subject to POL-016 and incident workflow approval.

Do not create these collections or migrate existing data based only on this proposal. First approve exact field names, required/optional/null semantics, IDs, indexes, retention and security rules in the shared cross-app data dictionary.

## 5. Firestore Rules changes required after contract approval

- Remove client permission for Admin/Walker to directly mutate authoritative booking lifecycle fields.
- Permit customers to update only approved customer-owned fields (e.g. cancellation request/review) under strict field allow-lists.
- Permit assigned Walker access only to their authorized booking/walk reads and explicitly non-authoritative operational inputs.
- Deny client writes to authoritative walk status, assignment, server timestamps, audit actor fields and payment status.
- Make lifecycle events append-only and prevent client edit/delete.
- Restrict GPS reads/writes by customer, assigned Walker and authorized operational roles; scope checks must use canonical assignment and area/zone policy.
- Preserve deny-by-default behavior for unknown collections and fields.
- Verify query authorization as well as document-level access; UI filtering is not an authorization boundary.

## 6. Emulator test matrix

### Authentication and authorization
- Unauthenticated caller cannot start, complete or upload GPS.
- Customer cannot invoke Walker commands.
- Unapproved/inactive Walker is denied.
- Approved but unassigned Walker is denied.
- Previously assigned Walker is denied after reassignment.
- Admin role/scope is checked against the approved role policy; do not assume every Admin role has global authority.

### State and integrity
- Missing booking ID / walk ID is rejected.
- Cancelled, expired, completed or invalid-state booking is rejected.
- Start before required booking/assignment checks is rejected.
- Duplicate start with same idempotency key creates only one walk.
- Conflicting duplicate start is rejected.
- Completion without required handover evidence is rejected.
- Duplicate completion is idempotent.
- Client cannot forge actor UID, server timestamp, assignment, payment state or lifecycle status.
- Invalid coordinate, out-of-range coordinate, impossible timestamp and stale sequence are rejected.
- GPS write after completion/cancellation/reassignment is rejected.
- A denied event/audit write rolls back the lifecycle state change in the same transaction.
- A retry after network interruption does not create duplicate walks/events.

### Privacy and access
- Customer can read only the live walk linked to their own booking, according to approved visibility policy.
- Walker can read/write only the current assigned walk's permitted fields.
- Out-of-zone operational users cannot read unrelated live GPS.
- Unauthorized clients cannot list the entire GPS collection.
- Stale location is returned/labeled as stale, never represented as current.

## 7. Required decisions before coding

The following must be resolved in the shared contract and controlling policies:
1. POL-006 / POL-007 approval and exact start, completion, reassignment and handover rules.
2. Canonical booking status state machine and allowed transitions.
3. Stable `walkId` generation and idempotency-key semantics.
4. Exact pickup identity / recipient / safety checks and what constitutes acceptable handover evidence.
5. Canonical GPS schema, upload cadence, accuracy threshold, stale threshold and route archive requirements.
6. Customer live-map visibility and what happens when GPS permission/network is lost.
7. City/zone role authorization and data scope for Central Admin, City Manager and Zone Supervisor.
8. Location retention/deletion, incident access and audit retention.
9. Whether existing `bookings` fields can be safely retained during a staged migration.

## 8. Implementation sequence and gates

**Gate A — Contract approval:** Resolve the decisions above; freeze a versioned cross-app data dictionary.

**Gate B — Rules tests first:** Add emulator tests that prove direct client lifecycle writes are denied while existing customer booking/review behavior remains valid.

**Gate C — Callable command tests:** Implement and test start/complete commands against Auth + Firestore Emulators, including transaction rollback and idempotency.

**Gate D — GPS ingestion and read model:** Implement after GPS schema, privacy and retention approval.

**Gate E — App integration:** Update Partner writer, Admin live reader and Customer tracking against the same contract; do not infer success from one app's local state.

**Gate F — Release readiness:** Exact-head CI, security review, migration/rollback plan, explicit Founder approval, then separately authorized staging/production deployment.

## 9. Acceptance criteria

- All lifecycle transitions are server-authoritative.
- A Walker cannot start/complete a booking they are not currently assigned to.
- Assignment changes invalidate prior Walker access immediately.
- Start/completion and event/audit writes are atomic and idempotent.
- Clients cannot forge lifecycle status, actor identity or server timestamps.
- GPS is authenticated, scoped, validated, freshness-aware and retention-controlled.
- Emulator tests cover positive, negative, race, retry, rollback and privacy cases.
- Admin, Partner and Customer apps consume the same approved contract.
- No production deployment occurs without explicit authorization.

## 10. Audit limitation

This is a source-code audit of the repository's current `main` branch and selected files, not a live production database audit. It does not prove which deployed Functions/Rules version is active in Firebase. Verify deployed versions separately before any release decision.
