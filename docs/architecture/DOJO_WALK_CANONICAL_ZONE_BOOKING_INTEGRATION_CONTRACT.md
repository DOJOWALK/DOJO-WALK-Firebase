# DOJO WALK — Canonical Zone + Booking Integration Contract

**Status:** Draft architecture contract; review required before implementation  
**Branch:** `architecture/canonical-zone-booking-contract`  
**Base:** Firebase `main` at `bdfea488990864c4f5670a98fb147eefd1453334`  
**Scope:** Shared contract for Admin, Firebase, Partner, and Customer  
**Change boundary:** Documentation only. No runtime code, Firestore Rules, data, indexes, deployment, app behavior, or PR merge changed.

## 1. Purpose and governing decisions

This document reconciles the approved DOJO WALK operating policy with the currently inspected application contracts. It is a target contract, not a claim that the target schema or workflow is already deployed.

Governing product rules:
- Service hierarchy is **State/UT → District → City → Zone**.
- **Zone is the only service activation unit.** State, District, and City are reference hierarchy, not independently activated service coverage.
- Every Zone must have its own reviewed, verified polygon.
- Founder approval must bind to the exact Zone ID, Zone revision, and boundary hash.
- A city manager's authority is limited to their assigned area; Central Admin retains cross-zone operational control.
- A customer booking must be validated against the authoritative active Zone before it can become payable/confirmed.
- A Booking and an individual Walk Task are distinct concepts. A booking may contain multiple scheduled walks; each execution needs its own Walk identity and lifecycle.
- Do not delete, rename, or bulk-convert legacy collections or IDs as part of this contract.

## 2. Evidence-based current state

### 2.1 Admin location model

Inspected Admin main:
- `lib/features/service_location/models/service_location_models.dart`
- `lib/features/service_location/services/service_location_service.dart`

Current model describes:
`Country → State → District → Service City → Service Area → optional Locality`.

Current collections include:
- `service_countries`
- `service_states`
- `service_districts`
- `service_cities`
- `service_areas`
- `service_localities`
- `service_location_boundaries`

The Admin service calls `activateServiceLocation` with a location type and ID. Its comments describe City and Area boundary activation. This is not yet the approved Zone-only activation contract.

### 2.2 Firebase location contract

Previously inspected Firebase Functions export `activateServiceLocation`, accepts legacy `city | area`, and uses `service_cities` / `service_areas`. The existing boundary review path has City/Area assumptions. It must not be treated as compliant with Zone-only activation without a reviewed redesign.

### 2.3 Partner onboarding

The existing Partner onboarding contract has legacy `zones` references and walker profile fields such as `city`, `state`, `area`, `zoneName`, `zoneNames`, and `zones` IDs. These are legacy compatibility data, not proof of a canonical verified Zone membership.

### 2.4 Customer booking and Partner consumption

Inspected Customer booking confirmation writes a booking document directly and initializes the booking as `status: pending`, `walkerId: null`. The inspected Partner Home query consumes bookings by `walkerId` and reads date/time fields including `date` and `startTime`; Partner lifecycle screens update booking status after assignment. Customer's existing booking fields include scheduling representations such as `scheduledAt`, `preferredTime`, `walkSchedules`, and `dateSchedules`. A complete field-by-field payload mapping and status translation must be verified against the exact current source revisions before implementation.

### 2.5 Assignment

Bounded searches and the recorded Admin audit documents did not identify an authoritative assignment writer in the inspected paths. Admin UI reads bookings; Partner consumes assignments; Firebase Rules permitting assignment-field writes is not an assignment algorithm. An external/manual assignment process may still exist and must be confirmed before building a replacement.

Related audit documents in Admin:
- `docs/STEP_197_BOOKING_LOCATION_MIGRATION_CONTRACT.md`
- `docs/STEP_198_WALKER_ASSIGNMENT_PATH_AUDIT.md`
- `docs/STEP_199_ASSIGNMENT_WRITER_DEEP_SEARCH.md`
- `docs/STEP_200_BOOKING_ASSIGNMENT_SECURITY_CONTRACT.md`

## 3. Target canonical location model

### 3.1 Logical hierarchy

`service_states/{stateId}`
  → `service_districts/{districtId}`
  → `service_cities/{cityId}`
  → `service_zones/{zoneId}`

The collection name `service_zones` is a **proposed target**, not a confirmed deployed collection. It must be approved after inspecting all existing Zone data, IDs, references, indexes, rules, Functions, and consumers.

Proposed Zone fields (names are proposed until schema review):
- `stateId`, `districtId`, `cityId`: immutable parent references.
- `name`: display name.
- `isServiceActive`: server-controlled operational status; only Zone uses this as service activation.
- `revision`: monotonically increasing Zone configuration revision.
- `verifiedBoundaryId`: reference to the exact verified boundary document.
- `boundaryHash`: server-computed canonical geometry hash.
- `createdAt`, `updatedAt`: server timestamps.

Do not add independent service activation flags to State, District, or City. Existing legacy fields may remain during compatibility migration, but must not silently grant service coverage.

### 3.2 Boundary verification

Use the existing boundary storage only after field-level compatibility inspection; `service_location_boundaries` is a candidate existing collection, not a finalized schema contract.

A boundary review must:
1. Validate polygon geometry (at least three unique valid vertices; production geometry rules must also reject self-intersection, degeneracy, and invalid topology).
2. Confirm the Zone's parent chain and boundary ownership.
3. Compute the canonical geometry hash on trusted server code.
4. Set verified metadata server-side, including reviewer, timestamp, revision, and hash.
5. Invalidate/revoke verification whenever the polygon or parent identity changes.
6. Never trust client-supplied verified flags, hashes, revision, or approval metadata.

### 3.3 Founder approval

Approval record must be bound to:
- exact `zoneId`;
- exact Zone `revision`;
- exact `boundaryHash`;
- approval actor and timestamp;
- explicit approval state and revocation state.

A changed polygon, parent, or revision invalidates the old approval. Approval for one Zone must never authorize another Zone or a later boundary revision. Final approval collection/path and fields require schema review.

### 3.4 Activation gate

A trusted callable must atomically re-read and verify:
- caller has the explicitly authorized Central Admin operational permission;
- Zone exists and its parent references are valid;
- Zone's own boundary is verified and current;
- Founder approval exactly matches Zone ID, revision, and boundary hash and is not revoked/stale;
- operational readiness requirements are satisfied;
- no concurrent edit invalidated the values during activation.

City's service-active flag or City polygon must not be a separate service activation prerequisite if the parent hierarchy is valid. Parent reference integrity remains mandatory. Only the Zone's service status changes.

The existing `activateServiceLocation` endpoint should not be repurposed by guesswork. Decide whether to introduce a versioned Zone-specific callable or perform a documented compatible transition after auditing every caller.

## 4. Legacy compatibility and migration

No automatic mapping is authorized.

| Existing data | Target treatment |
|---|---|
| `zones` and walker `zones` IDs | Preserve; inventory IDs, parent meaning, active state, and consumers. Map only with explicit reviewed evidence. |
| `service_areas` | Preserve; do not assume Area equals Zone. Determine whether an Area contains one or multiple operational Zones. |
| `service_cities` | Preserve as City hierarchy records; remove operational activation dependency only through a versioned migration. |
| `service_location_boundaries` | Preserve; inventory owner type, geometry, revision, hash, verification and references before reuse. |
| Existing bookings | Preserve historical location fields and reads. Do not backfill canonical Zone IDs without deterministic evidence and an audit trail. |
| Walker profiles | Preserve legacy fields while adding canonical Zone coverage only after Partner migration and server validation are ready. |

Migration phases:
- **M0 Inventory:** export/read-only inventory of all collection documents, references, IDs, indexes, rules, Functions, and app consumers.
- **M1 Mapping proposal:** deterministic old-to-new mapping with unmatched, ambiguous, duplicate, and multi-zone cases explicitly listed.
- **M2 Compatibility adapter:** read both legacy and canonical shapes; writes remain on the currently supported path.
- **M3 Staging migration:** emulator/staging only; dry-run counts, referential-integrity checks, rollback plan, and test evidence.
- **M4 App cutover:** Partner and Admin updated; Customer booking validation callable deployed; old clients handled by an explicit compatibility window.
- **M5 Enforcement:** after supported clients are migrated and monitored, deny obsolete client writes and retire legacy paths only with separate approval.

Production migration, activation, deletion, deployment, and cutover require explicit Founder approval.

## 5. Target booking contract

### 5.1 Booking versus Walk Task

- **Booking**: customer purchase/request, pet and service intent, calendar period, payment/refund state, and overall booking status.
- **Walk Task**: one scheduled execution under a Booking, with its own `walkId`, assigned walker, pickup/check-in, GPS session, lifecycle events, completion, incident and payout evidence.

Do not duplicate one Booking into multiple unrelated bookings merely to represent multiple walks. Final collection path (embedded schedule vs `walks/{walkId}` or another structure) must be chosen after inspecting current walk records, payment, notification, and reporting dependencies.

### 5.2 Customer request

Customer sends intent only:
- saved pickup address ID (or validated coordinates/address according to the approved address contract);
- pet IDs;
- requested date/time slots and schedule/frequency;
- duration and calendar-period intent;
- idempotency key;
- optional client-observed Zone ID for diagnostics only.

Customer must not choose authoritative Zone coverage, set verified boundary metadata, set approval data, or assign a walker.

### 5.3 Trusted booking validation

A trusted callable must:
1. Authenticate the customer.
2. Verify address and pet ownership.
3. Validate coordinates and resolve the Zone server-side using the current verified polygon.
4. Confirm Zone active and approval matches current Zone revision/hash.
5. Confirm pickup is inside the Zone polygon.
6. Check schedule, service availability, and capacity before creating any payable/confirmed booking.
7. If unavailable, return structured nearby valid slots; do not create a payable booking.
8. Create a pending request with server-owned Zone/boundary/validation metadata.
9. Enforce idempotency so retries do not create duplicate bookings.

Proposed server-owned metadata (final names pending):
- resolved `serviceZoneId`;
- Zone revision;
- boundary ID and hash;
- validation version and timestamp;
- coverage decision/reference;
- request fingerprint/idempotency key.

Do not trust a client-supplied Zone ID as the resolution result.

### 5.4 Scheduling compatibility

The current Customer and Partner date/time field mismatch must be resolved before release. Produce a field map for:
- booking calendar period and timezone;
- individual walk date;
- start/end time and duration;
- recurring schedule expansion;
- status and assignment state.

Partner Home currently depends on `date` and `startTime` for its queried assigned bookings. Customer's scheduling fields include `scheduledAt`, `preferredTime`, `walkSchedules`, and `dateSchedules`. Do not ship a callable that writes only the Customer shape while Partner still expects the legacy shape. Use a versioned adapter or coordinated app release.

## 6. Target assignment security contract

Before implementation, Founder/Product Owner must confirm whether assignment is currently manual, external, automatic, or absent.

If a trusted assignment endpoint is required:
- only an authenticated, active, explicitly authorized Central Admin or approved automated service may invoke it;
- customer and Partner clients cannot assign or reassign;
- transactionally re-read booking/walk state and ensure it is eligible and unassigned;
- verify walker approval, active status, suspension state, onboarding completion, Zone coverage, and schedule/capacity;
- reject stale or ambiguous legacy location records into a manual-review queue;
- prevent concurrent assignment from overwriting the winner;
- write server timestamps and append-only audit event;
- idempotent retry must not replace another assigned walker;
- reassignment and assignment cancellation require separate explicit policy.

Do not assume approval/active field names. Audit deployed walker and admin documents first. Do not grant Area/City Managers cross-zone assignment authority.

## 7. Ownership and write boundaries

| Actor/system | Allowed responsibility | Must not do |
|---|---|---|
| Customer App | Submit booking intent; read own booking and walk status | Resolve authoritative Zone, set approval, assign walker, write trusted validation metadata |
| Partner App | Read assigned Walk Tasks; accept/decline within policy; write constrained walk lifecycle/GPS events | Assign self, change Zone/approval, alter booking price/payment or other walker's task |
| Admin App | Manage hierarchy drafts, review status, invoke authorized operational actions, view bookings/tasks | Directly write trusted activation/assignment fields if server endpoint owns them |
| Firebase trusted backend | Resolve Zone, validate booking, activation/assignment transactions, server timestamps, audit events | Trust client-authoritative status, Zone, boundary hash, or actor claims |
| Founder | Approve exact Zone revision/hash; approve reserved high-impact decisions | Routine walk execution or bypass audit controls |

Exact Firebase custom claims, `admin_users` roles, Central Admin permission names, and actor scopes must be reconciled with deployed authorization before code changes.

## 8. Required acceptance tests

### Zone and approval
- Valid Zone with verified polygon and matching Founder approval activates.
- Valid Zone does not require a City polygon or City service-active flag.
- Missing, malformed, self-intersecting, stale, or changed Zone boundary denies activation.
- Missing, revoked, wrong-Zone, wrong-revision, or wrong-hash approval denies activation.
- Invalid parent chain and unauthorized caller deny activation.
- Concurrent Zone edit prevents stale activation.
- State/District/City cannot independently activate service.

### Booking eligibility
- Unauthenticated customer, wrong address owner, and wrong pet owner are denied.
- Forged client Zone ID is ignored; server resolution is authoritative.
- Inactive Zone, missing polygon, stale approval, outside-polygon pickup, invalid coordinates, or missing Zone mapping cannot create payable booking.
- Unavailable slot returns alternatives and creates no payable booking.
- Repeated idempotency key does not create duplicate bookings.
- Legacy booking reads/history remain intact.

### Assignment and lifecycle
- Unauthorized admin, Customer, and Partner cannot assign.
- Unapproved/inactive/suspended/incomplete walker is rejected.
- Zone mismatch and schedule/capacity conflict are rejected.
- Concurrent assignment has one winner.
- Retry cannot overwrite another winner.
- Partner only sees/acts on assigned tasks and cannot change trusted assignment fields.
- Booking and each Walk Task lifecycle remain consistent; GPS start/stop, emergency handover, completion and payout evidence are auditable.

### Cross-app regression
- Admin displays booking and task state consistently.
- Partner receives all assigned scheduled Walk Tasks even when the booking contains multiple dates.
- Customer sees availability, payment eligibility, assigned walker and per-walk status correctly.
- Notifications and payment initiation use the same canonical IDs and state transitions.
- Old supported clients do not silently lose bookings during migration.

## 9. Decisions required before implementation

1. Confirm current assignment method: manual, external backend, automatic, or none.
2. Approve target collection name and whether a Zone is a new entity or a reviewed subdivision/mapping of existing Area/legacy Zone records.
3. Confirm exact Zone boundary document shape, hash canonicalization, revision rules, and approval record path.
4. Confirm Central Admin authorization role/claims and Founder approval mechanism.
5. Confirm Booking-to-Walk Task storage shape and recurring schedule expansion.
6. Confirm exact current Customer booking payload, Partner date/time fields, and status mapping with source-level tests.
7. Confirm walker approval, active, suspension, onboarding, coverage and schedule field names.
8. Define availability/capacity policy and what happens when no Zone or walker is eligible.
9. Define legacy booking/walker compatibility period and rollback criteria.

## 10. Implementation sequence and gates

1. Finish source inventory and exact field-level mapping across all four repositories.
2. Resolve the nine decisions above with Product Owner/Founder.
3. Publish a versioned shared schema and callable request/response contract.
4. Implement Zone boundary/approval/activation in Firebase Emulator tests.
5. Implement Partner onboarding adapter and Admin Zone UI against the same contract.
6. Implement Customer booking callable and migrate the Customer client.
7. Implement/confirm trusted assignment and Booking-to-Walk Task lifecycle.
8. Run cross-app integration, rules, emulator, regression, and security tests.
9. Stage and monitor; produce exact commit SHAs and test evidence.
10. Request separate approval for PR merge, production deploy, data migration, activation, and old-path enforcement.

## 11. Non-goals and safeguards

This document does not:
- create or rename Firestore collections;
- change Firestore or Storage Rules;
- implement callables or app UI;
- migrate or delete legacy documents;
- activate any Zone;
- change user/admin permissions;
- deploy to Firebase;
- merge any PR.

**Exit criterion:** Implementation may begin only after the unresolved decisions are closed, exact source field mappings are attached, and all affected app owners agree to the same versioned contract.
