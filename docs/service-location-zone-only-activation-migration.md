# Service Location Zone-Only Activation Migration

Status: implementation plan; not a production change.

## Required product contract

The admin's canonical service-location form is exactly:

1. State / UT
2. District
3. City
4. Zone

There is no Locality selector. State, District, and City are hierarchy metadata only; none of them can be activated or deactivated as service zones. Only a Zone may be activated/deactivated, and activation requires a valid, server-verified boundary polygon for that Zone.

## Current backend compatibility problem

The existing backend uses legacy collections and types: `service_countries`, `service_states`, `service_districts`, `service_cities`, `service_areas`, and `service_localities`. The current `activateServiceLocation` callable accepts City and Area, and its checks require active Country/State and, for Area, an active City. The current status callable also permits status transitions on legacy hierarchy levels. This is not equivalent to the approved State/UT → District → City → Zone model.

## Safe migration rules

- Do not deploy or run against the production Firebase project as part of this change.
- Do not simply rename Area to Zone in the client: backend boundary records, collection names, ancestry checks, rules, and callers must agree.
- Add explicit emulator regression tests before changing callable behavior.
- Zone activation must validate the active super_admin, zone record, verified boundary record and polygon, and matching State/District/City ancestry.
- State/District/City status changes must be rejected by the public status callable. Their documents remain selectable hierarchy metadata.
- Locality activation must be rejected. Legacy Locality records must not be silently deleted or migrated.
- Zone deactivation must preserve audit logging and use a transaction that checks dependent live bookings/operations before allowing deactivation. Existing active descendant guards must be replaced with domain-appropriate guards, not removed without replacement.
- If the deployed schema still stores Zones in `service_areas`, treat that as an explicitly documented compatibility mapping until a separate schema migration is reviewed. Do not create a second parallel Zone collection without a migration plan.
- Update the Admin client callable names and payloads only after backend behavior and emulator tests are aligned.

## Acceptance tests

1. Unauthenticated and inactive/non-super-admin callers are denied.
2. State, District, and City activation/deactivation requests are rejected without document mutation.
3. Locality activation/deactivation requests are rejected without document mutation.
4. Zone activation fails for missing, pending, rejected, malformed, stale, or mismatched boundary polygons.
5. Zone activation fails when its State/District/City references do not match the selected hierarchy.
6. A valid Zone with a verified boundary can be activated when its hierarchy metadata exists, without requiring State/District/City `isActive` flags.
7. Zone deactivation is denied when protected live operations/bookings depend on it; otherwise it succeeds and writes an audit record.
8. Concurrent activation/deactivation attempts cannot leave a partial status transition.
9. All tests run against Firebase Emulator only; no production project or deployment.
