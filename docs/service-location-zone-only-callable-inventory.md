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
