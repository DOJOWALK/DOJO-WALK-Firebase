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
