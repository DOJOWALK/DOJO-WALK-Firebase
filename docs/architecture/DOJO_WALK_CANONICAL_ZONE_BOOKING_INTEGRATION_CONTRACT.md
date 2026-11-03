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


## 12. Cross-app source verification update — 2026-11-03

This section records a read-only verification against the exact source revisions below. It does not change the target contract or claim runtime behavior.

### 12.1 Verified source revisions

| Repository | Ref | File | Blob SHA |
|---|---|---|---|
| DOJO-WALK-Admin | `ui/notion-brand-foundation-2026-10-28` | `lib/features/service_location/services/service_zone_workflow_service.dart` | `77c0f290b764f781aa7fcc672c4ff5d1ec49f6cf` |
| DOJO-WALK-Admin | same | `lib/features/service_location/services/service_location_service.dart` | `02e6a378485633e2593b17684d0585e233acf6d4` |
| DOJO-WALK-Firebase | `main` | `functions/src/index.ts` | `2b13994aff949f38e626e1929422e5de84755312` |
| DOJO-WALK-Firebase | `main` | `firestore.rules` | `9bac26b9e13a97d412a0154ec9af70629e82eb47` |
| DOJO-WALK-Partner | `main` | `lib/features/onboarding/screens/work_location_screen.dart` | `9c5d5e12a3fd29785d2001fb20937a7bbb374df5` |
| DOJO-WALK-Partner | `main` | `lib/screens/home/partner_home_screen.dart` | `9a1c14fe13e05eaa7fd2df55942a20b02ce82074` |
| DOJO-WALK-Partner | `main` | `lib/screens/home/walk_details_screen.dart` | `4443ca2b4520700246c417cb315a6645506a1be1` |
| DOJO-WALK-Customer | `main` | `lib/features/booking/screens/booking_confirmation_screen.dart` | `94d45b12c7873fc2d289e164df965c735c0c63cb` |

Admin PR #51 head at inspection: `ed01648d9ad3e4649b44047da3a53f05a81ae1e0`. PR is open and unmerged; its description requires Draft/no merge/no deployment and defers Firebase integration.

### 12.2 Zone workflow compatibility — confirmed mismatch

Admin Zone client:
- Reads `service_zones`, filtered by `stateId`, `districtId`, and `cityId`.
- Saves through `saveServiceLocationWithNameIndex` with `locationType: zone`.
- Creates a pending `service_location_boundaries` document with `locationType: zone`.
- Calls `submitServiceZoneForFounderReview`, `reviewServiceLocationBoundary`, `decideServiceZoneFounderApproval`, `activateServiceZone`, `requestServiceZoneDeactivation`, `suspendServiceZoneForEmergency`, and `requestServiceZoneReactivation`.

Firebase main at the verified SHA:
- `reviewServiceLocationBoundary` accepts only `city` and `area`; it resolves owners from `service_cities` and `service_areas`.
- Area verification requires an active parent City and a verified City polygon, then checks Area containment.
- `activateServiceLocation` accepts only `city` and `area`; it does not implement the Admin client's Zone lifecycle.
- Firestore Rules `validBoundaryLocation` accepts `city`, `area`, and `locality`, not `zone`.
- Existing boundary draft rules use `isAdmin()`; the inspected rule helper is the existing Super Admin gate, not proof of the Admin PR's intended Central Admin policy.
- No `service_zones` match block was found in the inspected Rules excerpt. A complete Rules tree/runtime test is still required before any claim about all possible access paths.

**Gate:** Admin Zone workflow is not backend-compatible with Firebase main at these SHAs. Do not wire, deploy, or activate Zones against this backend until matching Zone callables, Firestore Rules, approval binding, and Emulator tests exist.

### 12.3 Partner onboarding and booking payload mapping

Partner onboarding reads active legacy `zones`, selects by `city` and `area`, then saves `city`, `state`, `area`, `zoneName`, `zoneNames`, and legacy zone document IDs in `walkers/{uid}`. It does not save canonical `serviceZoneId`, boundary revision, or boundary hash in the inspected screen.

Customer booking confirmation:
- Reads the selected pet from `users/{uid}/pets/{dogId}`.
- Builds `bookings/{bookingId}` directly.
- Writes `scheduledAt`, `preferredTime`, `walkSchedules`, and optional `dateSchedules`.
- Sets `status: pending`, `walkerId: null`.
- Does not write `date` or `startTime` in the inspected payload.

Partner Home:
- Queries `bookings` by `walkerId == uid`.
- Filters today's bookings using `date`.
- Sorts using `startTime`.
- Accepts statuses `assigned`, `accepted`, `picked_up`, `walking`.

Partner Walk Details reads `bookings/{bookingId}` and directly updates booking `status: accepted` before navigation. This confirms the current UI still couples acceptance to the parent Booking; it does not prove a separate Walk Task lifecycle.

Firestore Rules at the verified SHA validate Customer booking create fields including `scheduledAt`, `preferredTime`, `walkSchedules`, `status`, and `walkerId`, but do not require a server-resolved Zone or Founder-approved boundary. The Rules allow an active Super Admin to update `walkerId`, `assignedAt`, and booking status through the booking update allowlist. The Partner reader's `date`/`startTime` fields are not present in the inspected Customer payload.

### 12.4 Confirmed field map and unresolved items

| Domain | Current observed fields | Canonical target / action |
|---|---|---|
| Zone identity | legacy Partner `zones/{id}`; Admin `service_zones/{id}` | Decide stable canonical Zone ID and explicit legacy mapping; do not equate IDs by name |
| Zone hierarchy | Admin: `stateId`, `districtId`, `cityId`; Partner: names `state`, `city`, `area` | Persist canonical parent IDs on Partner profile; retain legacy fields during adapter period |
| Boundary | `locationId`, `locationType`, `points`, `verificationStatus`; Admin expects Zone | Firebase must support Zone owner type and bind verified boundary to exact Zone revision/hash |
| Customer schedule | `scheduledAt`, `preferredTime`, `walkSchedules`, optional `dateSchedules` | Server derives per-occurrence schedule; define adapter for Partner's `date` and `startTime` |
| Assignment | `walkerId`, `assignedAt`, booking `status` | Trusted atomic assignment callable; validate eligibility, Zone, schedule/capacity, concurrency, idempotency and audit |
| Walk identity | Partner Walk Details currently passes `bookingId` | Separate Walk Task ID and parent Booking ID; one task per scheduled occurrence |
| Booking state | Customer creates `pending`; Partner writes `accepted`; Admin aliases normalize display labels | Define canonical state machine and server-owned transition authority before implementation |

### 12.5 Required implementation gates (not executed)

1. Add/verify Firebase Zone callables matching every Admin callable name and payload, including exact Founder approval identity, Zone revision and boundary hash.
2. Update Rules to permit only the intended Central Admin draft writes and server-only verification/approval/activation fields; ensure no client can forge verified state.
3. Add Zone-only boundary geometry and parent-link tests; City must remain a reference parent, not an activation prerequisite unless governing policy explicitly requires it.
4. Define canonical Zone ID mapping from legacy Partner `zones` documents; do not migrate by matching display names.
5. Define a booking request callable and idempotency contract; client Zone IDs are diagnostic only and server coverage resolution is authoritative.
6. Add Customer schedule adapter so Partner reads the same canonical schedule fields; cover one-time, regular, and selected-date booking cases.
7. Define Booking-to-Walk-Task creation and lifecycle, including multiple walks per day and multi-date bookings.
8. Define trusted assignment callable, eligible Walker checks, Zone compatibility, availability/capacity conflict checks, transaction concurrency, idempotency, audit, and reassignment policy.
9. Add Emulator negative and positive tests before staged client migration. Only after supported clients migrate should direct Customer booking create and direct Partner lifecycle writes be restricted.

### 12.6 Verification boundary

This was a source inspection only. No code, Firestore Rules, indexes, Functions, data, permissions, tests, Emulator, production settings, deployment, merge, or device behavior was changed or executed. The source SHA list is the evidence boundary; later commits may change these findings.


## 13. Firebase callable and Rules compatibility matrix — 2026-11-03

### 13.1 Exact Firebase main callable export inventory

Inspected `functions/src/index.ts` at blob SHA `2b13994aff949f38e626e1929422e5de84755312`. The file imports only `location_geometry`, `location_name_index`, and `district_index_pair_preflight` for the service-location implementation. Its exported callable inventory is:

- `reviewServiceLocationBoundary`
- `activateServiceLocation`
- `setServiceLocationStatus`
- `saveServiceLocationWithNameIndex`
- `manageServiceLocationImportRun`

The inspected index contains no Zone-specific callable export. In particular, the Admin Zone workflow's expected names are not present in this index:

| Admin Zone workflow callable | Firebase main result | Reason |
|---|---|---|
| `submitServiceZoneForFounderReview` | ABSENT from inspected index | No matching export in the index callable inventory |
| `decideServiceZoneFounderApproval` | ABSENT from inspected index | No matching export in the index callable inventory |
| `activateServiceZone` | ABSENT from inspected index | Existing export is `activateServiceLocation` with City/Area contract |
| `requestServiceZoneDeactivation` | ABSENT from inspected index | Existing status callable is generic and does not implement Zone approval workflow |
| `suspendServiceZoneForEmergency` | ABSENT from inspected index | No matching export in the index callable inventory |
| `requestServiceZoneReactivation` | ABSENT from inspected index | No matching export in the index callable inventory |
| `reviewServiceLocationBoundary` | PRESENT, WRONG CONTRACT for Zone | Accepts only City/Area boundary owners |
| `saveServiceLocationWithNameIndex` | PRESENT, WRONG CONTRACT for Zone | Allowed types are Country/State/District/City/Area/Locality; Zone is not a supported type |
| `setServiceLocationStatus` | PRESENT, WRONG CONTRACT for Zone | Allowed types are Country/State/District/City/Area/Locality; Zone is not a supported type |

This inventory is a finding about the inspected `functions/src/index.ts` revision. Before implementation, re-check the deployed Functions inventory and all source modules/build entry points; do not assume that an uninspected deployment or alternate entry point is identical.

### 13.2 Existing callable contracts and authorization

**`saveServiceLocationWithNameIndex`**
- Input: `locationType`, optional `locationId`, and `payload`.
- Supported types: `country | state | district | city | area | locality`.
- Validates payload, parent references, and name-index consistency; creates new records inactive and prevents client payloads from controlling activation/boundary fields.
- Callable authorization accepts an active `admin_users/{uid}` whose role is `super_admin` or `admin`.
- Result: `{ ok, locationId, locationType }`.
- Zone cannot be passed as a supported type without a coordinated schema/function change.

**`reviewServiceLocationBoundary`**
- Input: `boundaryId`, `decision: verified | rejected`, non-empty `notes` (maximum 2,000 characters).
- Requires active `super_admin`; does not implement Central Admin / Founder separation.
- Accepts only `city` and `area` boundary owners.
- Verifies polygon validity and source metadata; Area verification additionally requires an active parent City and containment within the City polygon.
- Updates the boundary, owner `verifiedBoundaryId`, and review audit transactionally.
- Result: `{ ok, boundaryId, locationId, locationType, decision }`.

**`activateServiceLocation`**
- Input: `locationType: city | area`, `locationId`.
- Requires active `super_admin`.
- Requires a verified boundary. City requires active Country/State and active District when linked. Area requires an active parent City, verified City boundary, and Area-within-City containment.
- Re-reads ancestry and geometry in a transaction and writes activation audit.
- Result: `{ ok, locationId, locationType }`.
- This is explicitly not the approved Zone-only activation contract.

**`setServiceLocationStatus`**
- Input: `locationType`, `locationId`, boolean `isActive`.
- Requires active `super_admin`.
- Supports Country/State/District/City/Area/Locality; City/Area activation must use `activateServiceLocation`.
- Enforces parent/child status guards, but does not provide Founder approval or Zone boundary revision/hash checks.

### 13.3 Firestore Rules contract at inspected main SHA

Inspected `firestore.rules` blob SHA `9bac26b9e13a97d412a0154ec9af70629e82eb47`.

- `isAdmin()` means signed-in user with active `admin_users/{uid}` and role exactly `super_admin`. It does not include a distinct Central Admin permission.
- Admin role values in `admin_users` are constrained to `super_admin | admin | support`; no explicit `central_admin`, `area_manager`, or `supervisor` authorization model appears in the inspected helper.
- `validBoundaryLocation` accepts `city | area | locality`; it does not accept `zone`.
- Boundary draft create/update rules use `isAdmin()`. Client-side create is therefore not evidence of Central Admin draft authorization.
- Boundary verification/rejection client writes are not allowed by the update rule; trusted callable uses Admin SDK. This is directionally sound, but the callable currently authorizes only Super Admin.
- `service_cities`, `service_areas`, and other hierarchy records are client read-only; writes go through trusted Functions. No `service_zones` match block was found in the inspected Rules source.
- The Rules source does not enforce the canonical Founder approval document, Zone revision, boundary hash, or Zone-only activation conditions because those records/contracts are not present in this implementation.

### 13.4 Required callable design before coding

Do not rename the current City/Area callables in place or silently route Zone actions through them. Add a separately versioned Zone workflow with explicit contracts:

1. **Save Zone draft** — input: parent `stateId`, `districtId`, `cityId`, Zone name, stable optional `zoneId`; server validates parent chain, name uniqueness, and immutable parent links. New Zone is inactive and has no verified boundary.
2. **Create/update boundary draft** — input: `zoneId`, boundary draft geometry, source type/name/reference, and expected Zone revision. Draft writes are Central Admin-scoped; clients cannot set verification, approval, activation, revision, or hash fields.
3. **Review boundary** — input: `zoneId`, `boundaryId`, decision, notes, expected Zone revision. Trusted server validates polygon topology/coordinates, binds the exact boundary to the Zone, increments revision, computes canonical geometry hash, and writes immutable audit evidence.
4. **Submit Founder review** — input: `zoneId`, expected revision, boundary ID/hash, evidence summary. Server snapshots the exact tuple; submission cannot be edited in place.
5. **Founder decision** — input: approval request ID, exact Zone ID/revision/boundary hash, decision, reason. Only authorized Founder identity can approve/reject; decision is immutable and replay-safe.
6. **Activate Zone** — input: Zone ID and approval request ID. Server transaction re-reads actor, Zone, revision, boundary, hash, approval, parent IDs, and readiness; rejects stale/revoked/replayed approvals and concurrent changes. City is a hierarchy parent only and its own service-active flag or polygon must not be an operational prerequisite unless the approved policy is changed.
7. **Deactivate/suspend/reactivate** — explicit reason and actor; distinguish routine deactivation, emergency suspension, and reactivation. Reactivation requires a current valid approval or a new Founder decision according to the governance policy; do not silently reuse an obsolete approval.

All callable results should return stable identifiers and server-authoritative state, e.g. `{ ok, zoneId, zoneRevision, boundaryId, boundaryHash, approvalRequestId, status }`. Use structured `HttpsError` codes; clients must not infer authorization from UI visibility.

### 13.5 Authorization and audit matrix to implement/test

| Actor | Save/edit Zone draft | Submit review | Verify boundary | Founder decision | Activate/deactivate |
|---|---:|---:|---:|---:|---:|
| Founder | Oversight only unless separately granted | Review | No routine boundary operation | Yes | Approval authority only; operational action follows Central workflow |
| Central Admin | Yes | Yes | Authorized reviewer only if separation-of-duties policy permits | No | Yes, after exact Founder approval |
| Area/City Manager | Assigned-area scoped request/read only | No | No | No | No |
| Supervisor | Assigned-Zone operational read/report | No | No | No | No |
| Walker/Partner | No | No | No | No | No |
| Customer | No | No | No | No | No |

This table is a proposed enforcement matrix derived from the governance policy; role claims and exact admin document schema must be reconciled before code. Do not treat the existing `admin` role as equivalent to Central Admin without an explicit mapping decision.

Every state transition must write an immutable audit record with actor UID and role, action, target Zone ID, prior/new status, Zone revision, boundary ID/hash, approval request ID, reason, server timestamp, and idempotency/request ID. Audit writes must be atomic with the state transition.

### 13.6 Emulator acceptance matrix — required, not run

- Callable export/deployment manifest matches the Admin client callable names and region `asia-south1`.
- Active Central Admin can create/edit a draft; inactive or wrong-role actors are denied.
- Area Manager is denied outside assigned scope; Supervisor, Walker, Partner, and Customer are denied all administrative mutations.
- Zone boundary draft accepts only valid parent-linked Zone ID and supported geometry; client-supplied verified/approved/active/hash/revision fields are rejected.
- Valid polygon review binds the exact boundary to the Zone; malformed, self-intersecting, out-of-range, underspecified, or wrong-owner polygons are rejected.
- Boundary replacement increments Zone revision and invalidates earlier approval.
- Founder approval is bound to exact Zone ID + revision + boundary ID + canonical boundary hash; mismatched, stale, revoked, duplicate, or replayed decisions fail.
- Zone activation succeeds with a valid Zone polygon and exact current approval even if the City has no operational service-active flag or City polygon.
- Activation fails for missing/unverified/invalid Zone boundary, missing approval, hash/revision mismatch, wrong Zone/parent IDs, inactive/invalid hierarchy references, unauthorized actor, or concurrent revision change.
- Routine deactivation, emergency suspension, and reactivation have distinct allowed transitions and audit events.
- Direct Firestore writes cannot forge boundary verification, Founder approval, activation, or audit records.
- Every callable is tested for unauthenticated, unauthorized, malformed payload, duplicate retry, and concurrent update cases.

### 13.7 Evidence boundary

This update is based on Firebase `functions/src/index.ts` SHA `2b13994aff949f38e626e1929422e5de84755312` and `firestore.rules` SHA `9bac26b9e13a97d412a0154ec9af70629e82eb47`. No Functions, Rules, indexes, data, permissions, tests, Emulator, deployment, merge, or production configuration were changed or executed. Admin client callable names are taken from the previously inspected Admin Zone workflow source revision recorded in Section 12; the Admin source file must be re-fetched at its exact branch SHA before implementation.
