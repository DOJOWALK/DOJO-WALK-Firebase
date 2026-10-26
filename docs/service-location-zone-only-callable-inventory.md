# Zone-only activation: backend call-path inventory

Reviewed against `functions/src/index.ts` on 2026-10-26. This is an implementation inventory, not a claim that the migration is complete.

## Existing callable paths

| Callable | Existing accepted types | Existing boundary rule | Legacy dependency |
| --- | --- | --- | --- |
| `activateServiceLocation` | `city`, `area` | Requires matching verified boundary; validates polygon; Area must be covered by City polygon | Requires active Country and State; City activation may require active District; Area activation requires active City and City boundary |
| `setServiceLocationStatus` | `country`, `state`, `district`, `city`, `area`, `locality` | Does not itself verify a boundary | Parent status checks and active-child guards; Locality activation validates Country/State/City/Area ancestry |
| `reviewServiceLocationBoundary` | Boundary review record | Requires active `super_admin`, review note, and verified/rejected decision | Boundary record stores a `locationType`; current type guard is City/Area |

## Migration mapping (proposed; requires review)

- Canonical Zone likely maps to the existing `service_areas` collection during a staged migration, because Area records already have parent `cityId`, `verifiedBoundaryId`, and `isServiceActive` fields.
- The current Area boundary is typed `area`; do not change boundary type to `zone` until all callable validators, boundary-review logic, existing documents, Admin callers, and tests are migrated together.
- A Zone should be validated against its exact State/District/City ancestry. Legacy Country fields can remain compatibility metadata temporarily, but Country/State/District activation flags must not gate Zone activation under the new product contract.
- The canonical admin flow must not expose Locality as a selector. Existing Locality documents should be retained for compatibility until dependency/use analysis proves they can be safely retired.

## Implementation sequence

1. Add callable tests proving hierarchy activation/deactivation and Locality status changes are rejected under the new contract.
2. Define a compatibility adapter for canonical `zone` requests to the legacy `area` storage model, with an explicit type mapping and strict ancestry validation.
3. Update `activateServiceLocation` to accept the canonical Zone operation only, while preserving polygon validation and transaction re-reads. Do not allow City activation as a service zone.
4. Update `setServiceLocationStatus` to permit only Zone deactivation (and reject hierarchy/Locality status changes); ensure live booking/operation guards are verified before deactivation.
5. Update boundary review to accept Zone as a canonical type through the compatibility adapter; prevent City boundary verification from being treated as Zone activation.
6. Update and run the full Functions test suite using only the Firestore/Functions Emulator.
7. Align Admin client payloads and remove the Locality selector; run Admin web and integration checks.
8. Keep the PR draft until the full emulator suite and Admin checks pass. Do not deploy or merge as part of this task.

## Explicit non-goals

- No production Firestore writes, production data migration, or deployment.
- No deletion of legacy Area/Locality records.
- No silent collection rename or parallel `service_zones` collection creation.


## Follow-up source inspection (2026-10-26)

- Confirmed callable exports in `functions/src/index.ts`: `activateServiceLocation`, `setServiceLocationStatus`, and `reviewServiceLocationBoundary`.
- Confirmed status/boundary audit collections in this file: `service_location_activation_audit`, `service_location_status_audit`, and `service_location_boundary_review_audit`.
- The source uses dynamic collection references (`child.collection`, `collection`, and `SERVICE_LOCATION_COLLECTIONS[parentType[i]]`), so a literal-only grep is not sufficient to determine every read/write.
- No literal `bookings`, `walks`, `live_walks`, or `walker_assignments` collection reference was found in this source file. This is **not proof** that live operations are absent: booking guards may live in other functions, repositories, or use differently named collections.
- Admin repository search surfaced existing location audit/inventory documents, including `STEP_177_SERVICE_LOCATION_UI_WORKFLOW_AUDIT.md`, `STEP_232_SERVICE_LOCATION_DIRECT_WRITE_AUDIT.md`, and `STEP_128_ADMIN_SERVICE_LOCATION_CODE_INVENTORY.md`. These must be read before changing callable payloads.
- Customer repository search surfaced address-form and home-screen files, but search excerpts alone do not establish callable usage. Full client call-site inspection is still required.
- No backend behavior has been changed in this step. The current branch remains a documentation-only migration plan; emulator tests have not been executed.

## Required next inspection before code changes

1. Read the Admin inventory and direct-write audit docs and inspect the current Admin call sites for all three callables.
2. Search the full backend and all client repositories for callable names, boundary payload types, and legacy `areaId` usage.
3. Confirm the actual booking/live-walk collection schema and the intended compatibility strategy: in-place legacy `service_areas` storage versus a new `service_zones` collection.
4. Only then add executable emulator tests against the chosen contract, update callables and client callers as one coordinated PR, and run CI/emulator validation.


## Admin caller inspection findings (2026-10-26)

Read-only inspection of the Admin repository's current default branch found these concrete caller contracts:

- `lib/features/service_location/services/service_location_service.dart` calls `setServiceLocationStatus` with `locationType`, `locationId`, and `isActive`.
- The same service calls `activateServiceLocation` with `locationType` and `locationId`.
- `lib/features/service_location/services/service_location_boundary_service.dart` calls `reviewServiceLocationBoundary` with `boundaryId`, `decision`, and `notes`; boundary ownership is currently validated as `city` or `area` in the service.
- `lib/features/service_location/models/service_location_models.dart` describes the current hierarchy as Country → State → District → Service City → Service Area → optional Locality/Village, with legacy City records potentially missing `districtId`.
- `lib/features/service_location/screens/service_location_screen.dart` still exposes District status toggles and Area service-status toggles. That UI conflicts with the approved contract that only Zone has service activation/deactivation.
- The Admin service's current trusted-save schema still has legacy `area` and `locality` fields; no verified end-to-end canonical `zone` contract has been established.

## Migration decision / implementation gate

This evidence confirms that changing only the Firebase callable would break the Admin client contract, while changing only the Admin UI would be rejected by the current backend schema. Therefore this PR must remain documentation-only until a coordinated contract is chosen.

Recommended low-risk migration direction for the next design review:
1. Preserve existing `service_areas` documents and their IDs; do not rename/delete live data.
2. Introduce a canonical API-level type `zone` through an explicit compatibility adapter, initially mapping to existing Area storage only if each legacy record's parents and verified polygon are validated.
3. Hide/remove all non-Zone activation toggles in Admin and replace Area labels with Zone only after backend compatibility tests pass.
4. Keep District as hierarchy metadata, not a service-activation toggle; preserve existing records and audit their legacy status fields rather than bulk rewriting them.
5. Before adding a live-booking deactivation guard, inspect all booking/walk repositories and their actual schema. No booking collection name or guard has been assumed here.
6. Add executable emulator tests only after these contracts and the exact test fixtures are aligned; run CI in the PR branch and review failures before any merge.

These are recommendations, not applied runtime changes. No Firebase production data or deployment was touched.


## Cross-repository scan: status and boundary call sites (2026-10-26)

The Admin default branch scan confirms these legacy UI/API uses:

- District list UI invokes `setDistrictStatus`; this is incompatible with the approved rule that District is metadata only.
- Area list UI invokes `setAreaServiceStatus` and opens boundary management with `locationType: 'area'`.
- City list UI still has service status controls and boundary management with `locationType: 'city'`.
- Admin boundary model and service explicitly accept only `city` and `area`.
- Admin service calls the three trusted callables by name, but uses existing legacy payload types.

This means the migration is not a safe one-file backend edit. Admin UI, service methods, boundary model/service, backend callable allowlists, Firestore rules, and tests need a coordinated change.

## Release safety finding

The Admin's historical `LOCATION_MASTER_STATUS.md` documents an automatic Firestore Rules deployment workflow on pushes to `main` when rules/config files change, without a required production-environment approval/confirmation gate. This historical finding needs a fresh workflow inspection before release; until then, avoid merging changes to `firestore.rules`, `firebase.json`, or the deployment workflow. This PR currently changes documentation only.

## Updated next action

Create a dedicated contract proposal and test mapping before runtime edits. The proposal must:
1. Settle whether Zone is an API alias for legacy Area documents or a new collection.
2. Specify whether city boundary is only parent containment evidence or remains independently activatable (the approved requirement says only Zone is activated).
3. Define a safe transition for existing City/Area active flags and boundaries, with no bulk destructive rewrite.
4. Define the exact Firestore booking/live-operation queries before any Zone deactivation guard is implemented.
5. Include a CI/release gate review that prevents accidental Rules deployment.

No runtime code, rules, workflows, production data, or deployments were changed by this scan.


## Booking / live-operation dependency scan (2026-10-26)

A cross-repository scan of the Admin source and its existing assignment investigation found:

- Admin booking screens and dashboard read the `bookings` collection.
- Admin live operations reads `walkers` and `walk_locations`; the latter is a GPS history collection and should not be mistaken for the authoritative booking state.
- Admin's running-booking status set explicitly includes `in_progress`, `active_walk`, `walking`, and `walk_started`.
- The existing Admin Step 199 investigation records that no authoritative booking-assignment writer was found in the inspected app paths; it explicitly says this is not proof that no external/manual writer exists.
- Therefore, a Zone deactivation guard must not be implemented by querying only GPS records or by assuming that every assigned booking has a `walks` document. The booking schema and all deployment repos still need a complete authoritative-writer check.

### Safe next implementation boundary

Before coding a live-operation query into `setServiceLocationStatus`, establish which fields on `bookings` identify the service location (canonical zone / legacy area / city) and which statuses mean pending, assigned, confirmed, in-progress, completed, cancelled, or failed. Then add emulator fixtures matching those real fields. If location fields are missing or inconsistent on legacy bookings, the safe behavior is to block deactivation for manual review rather than silently allow it.

This is a source-level finding only. No booking documents were read or modified, no runtime code changed, and no tests were run as part of this scan.


## Booking-location schema audit follow-up (2026-10-26)

Read-only cross-repository evidence from Admin's `docs/STEP_197_BOOKING_LOCATION_MIGRATION_CONTRACT.md` and Customer's `lib/features/booking/screens/booking_confirmation_screen.dart` confirms a critical blocker:

- The current Admin booking allowlist does not include `serviceCityId`, `serviceAreaId`, or a canonical service-location reference.
- Customer booking creation builds a booking document with `bookingId`, `customerId`, schedule fields, `status: pending`, and `walkerId: null`; the reviewed location contract says the booking location is presently represented through address-related fields, not a trusted zone ID.
- Admin booking screens read bookings and show status/walker details; the reviewed screen is not the assignment writer. Assignment write ownership is still not proven across all repositories or external/manual paths.
- Legacy walker profiles may carry `city`, `area`, `zoneName`, `zoneNames`, and `zones` IDs, but these fields do not establish a reliable booking-to-zone relationship.

### Consequence for deactivation guard

Do **not** implement a query that assumes a booking already has `serviceZoneId`, `serviceAreaId`, or `serviceCityId`. That would miss legacy bookings and could allow unsafe deactivation. Do not infer the booking's zone from free-text address, GPS history, walker profile, or an unreviewed legacy zone-name match.

Before any runtime guard is coded, the coordinated contract must choose one of these safe approaches:

1. **Canonical booking-zone reference:** add a trusted, server-validated optional `serviceZoneId` for new bookings and define a reviewed migration/reconciliation process for legacy bookings; unknown legacy records block deactivation or require manual review.
2. **Fail-closed operational review:** while booking-to-zone mapping is unavailable, do not allow automated deactivation where live/assigned bookings could be affected; require an audited Central Admin review with a documented verification checklist.

Any future deactivation transaction must check authoritative booking status and assignment/operation records, not only `walk_locations` GPS records. It must cover the known running statuses (`in_progress`, `active_walk`, `walking`, `walk_started`) and any additional canonical statuses discovered in the complete status-transition audit. This status list is not yet certified exhaustive.

### Gate status

- Booking schema evidence: **partial audit complete**.
- Trusted booking-to-zone reference: **not present in reviewed contract**.
- All booking status writers/transitions: **not yet exhaustively verified**.
- Executable emulator tests: **not run**.
- Runtime code, rules, live data, deployment, merge: **unchanged**.

This finding is a blocker, not permission to guess a schema or ship a partial guard.


## Assignment-writer audit follow-up (2026-10-26)

Cross-checked Admin's existing Step 198/199 audit documents against current indexed paths. Findings are bounded to the repositories/branches and files inspected:

- Customer booking creation sets `status: pending` and `walkerId: null`; its booking flow reads/displays assignment state but no writer was found.
- Admin booking, dashboard, and live-operations screens primarily read booking records. The reviewed walker-admin service updates walker profile state and audit logs, not booking assignment.
- Partner home consumes bookings already assigned to the signed-in UID. Partner walk-details changes status to `accepted`; navigation updates lifecycle status; live-walk creates/updates a separate walk record. These reviewed paths do not choose or assign `walkerId`.
- Existing rules reportedly permit Admin booking updates for allowlisted fields including `walkerId` and `assignedAt`; permission to write is not an assignment algorithm.
- The current review still has not identified an authoritative assignment writer. This could be a missing application feature, a manual workflow, or an external/unindexed service. Do not state it is definitively absent organization-wide.

### Implementation gate updated

Before implementing the zone deactivation guard or any assignment behavior:
1. Confirm with the project owner whether a separate backend, automation, manual Admin workflow, or external service currently assigns bookings.
2. If no supported writer exists, design one trusted server-side assignment transaction/callable; do not let Customer/Partner clients assign themselves.
3. Establish a canonical, server-validated booking-to-zone reference and explicit legacy handling.
4. Specify allowed booking status transitions and reassignment/cancellation policy.
5. Test authorization, walker approval/active state, zone ancestry and active state, schedule/availability, idempotency, concurrency, and audit logging in Emulator.
6. Keep this PR draft and do not merge/deploy or touch production data.

### Status

- Repository path audit: **existing audit documents re-read and reconciled**.
- Authoritative assignment writer: **not found in inspected paths; owner/external workflow confirmation required**.
- Canonical booking-zone reference: **not established**.
- Runtime changes/tests: **not performed**.


## Assignment lifecycle audit follow-up (2026-10-26)

Read the Admin repository's existing Step 198/199/200 assignment audits. They are planning/audit documents, not proof of a deployed assignment implementation. Their findings align with the current read-only scan:

- Customer booking creation initializes `status: pending` and `walkerId: null`.
- Admin booking, dashboard, and live-operations paths reviewed are readers; the reviewed walker-management service changes walker profile state and audit logs, not booking assignment.
- Partner booking queries consume pre-existing assignments. Partner walk-details/navigation code changes lifecycle status, while live-walk code creates/updates a separate walk record.
- The reviewed Firebase Functions source did not reveal an assignment callable. Existing Firestore Rules allow certain Admin assignment-field updates, but permission to write is not evidence of a working assignment workflow.
- The known lifecycle mentions include `pending`, `assigned`, `accepted`, and running states such as `in_progress`, `active_walk`, `walking`, and `walk_started`. This is a partial inventory, not a certified exhaustive status allowlist.

### Critical implementation gate

The authoritative booking-assignment writer and its deployment location are **not confirmed**. Before modifying booking rules or introducing an assignment callable, the owner/team must confirm whether assignment currently happens through another backend, manual Admin workflow, script, or is not yet implemented. A partial repository search cannot answer that conclusively.

Do not narrow booking rules, add a new assignment endpoint, or change status transitions based only on this audit. That could break an external workflow or create two competing assignment paths. Likewise, do not implement Zone deactivation by querying only a guessed location field or the `walk_locations` GPS collection.

### Next safe step

Finish the read-only inventory of all booking status writers and Admin booking update permissions in the current branches; then record the external/manual assignment decision as an explicit contract gate. After that, coordinate an approved canonical booking-to-zone mapping and fail-closed deactivation behavior with executable Emulator tests.

Gate status:
- Assignment writer: **unconfirmed**
- Status transition inventory: **partial**
- Booking-to-zone reference: **not established in reviewed contract**
- Runtime/rules changes and Emulator tests: **not done**
- Production data/deployment/merge: **unchanged**


## Status-writer and authorization evidence matrix (2026-10-26)

| Surface reviewed in existing repository audit | Evidence | Confidence / limitation |
| --- | --- | --- |
| Customer booking creation | Creates `status: pending`, `walkerId: null` | Confirmed in inspected booking confirmation path |
| Customer booking display | Reads booking and assignment fields | Read path; not assignment |
| Admin booking screen/dashboard/live operations | Reads booking status, walker ID/name, and live-operation data | Reviewed paths are readers; not proof every Admin file is covered |
| Admin walker-management service | Updates walker profile state and writes audit log; has booking read stream | Not an assignment writer in the reviewed method |
| Partner booking list | Queries bookings assigned to current UID and consumes statuses including `assigned` / `accepted` | Consumer path |
| Partner walk-details/navigation | Updates lifecycle status such as `accepted` and walk progression | No `walkerId` assignment found in reviewed paths |
| Partner live-walk record | Writes a separate walk record carrying the current Walker UID | Must not be mistaken for assigning the parent booking |
| Firestore Rules | Existing contract permits some Admin booking updates including assignment fields | Permission is not proof of an implemented assignment UI/service; exact current deployed rules revision remains unverified |
| Firebase Functions source inspected | Location-management callables found; assignment callable not found in inspected file | Does not exclude another repo, deployment, branch, or external/manual process |

### Safe operational conclusion

At present, the evidence supports neither claiming “automatic assignment is implemented” nor claiming “no assignment exists anywhere.” The exact operational assignment path remains an unresolved dependency.

No booking status or assignment field should be rewritten as part of the Zone migration until this dependency is resolved. In particular:
- Do not infer that a `walks/{id}` record is equivalent to a booking assignment.
- Do not assume the status list in this document is exhaustive.
- Do not narrow Firestore Rules based solely on repository search; first identify and preserve any legitimate trusted/manual workflow.
- Do not allow Zone deactivation to pass when the affected booking set cannot be determined reliably.

### Exit criteria before runtime implementation

1. Identify and verify the actual assignment operator/path (Admin UI, callable, external backend, script, or documented manual process).
2. Obtain the exact allowed booking status transitions and assignment/reassignment policy.
3. Confirm the current rules/workflow revision and whether any external writer depends on it.
4. Define trusted booking-to-zone mapping and the fail-closed treatment of legacy/ambiguous bookings.
5. Implement coordinated emulator tests only after these contracts are resolved.

This matrix records evidence and blockers; it does not claim runtime tests passed or production behavior was verified.
