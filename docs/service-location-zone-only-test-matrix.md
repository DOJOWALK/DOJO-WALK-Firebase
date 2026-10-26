# Zone-only callable test matrix

These are the acceptance cases required before replacing legacy City/Area activation. They are deliberately written as a reviewable matrix; they are not yet executable tests and must not be reported as passing.

## Authorization
- Unauthenticated caller cannot activate/deactivate or review a Zone.
- Customer, inactive admin, and non-`super_admin` cannot mutate status.
- Actor is re-read inside the transaction before writes.

## Activation
- Reject `city`, `area`, and `locality` as canonical activation types; accept only canonical `zone`.
- Map canonical Zone to the legacy storage collection only through one explicit adapter.
- Reject missing Zone, invalid parent IDs, mismatched State/District/City ancestry, or a Zone whose City does not match its parent chain.
- Reject missing, unverified, malformed, or owner-mismatched boundary.
- Preserve polygon validity and containment checks where applicable; the Zone polygon must be verified for that Zone.
- State/District/City status flags must not be required for activation because these levels are hierarchy metadata, not service activation switches.
- Re-read actor, Zone, ancestry and boundary in a Firestore transaction; reject stale boundary/ancestry changes.

## Deactivation
- Reject direct status mutations for Country, State, District, City and Locality.
- Allow only Zone deactivation through the status callable.
- Before deactivation, inspect the actual booking/operation schema and block deactivation if live or assigned work would be stranded. Do not invent collection names; determine them from repository schema and tests first.
- Write an audit record containing actor, canonical type `zone`, location ID, previous/new status, timestamp and reason.
- Concurrent activation/deactivation requests must not leave status and audit records inconsistent.

## Boundary review
- Canonical `zone` review must validate that the boundary is attached to the same Zone.
- A verified City boundary must never satisfy Zone activation.
- Rejected boundaries cannot be activated.
- Require a non-empty review note for rejection and a meaningful note for verification, consistent with the existing callable contract.

## Regression / migration
- Keep existing Area/Locality documents; no destructive migration in the callable change.
- Existing Admin client payloads and all call sites must be located and migrated together.
- Run `npm test` only with the Firestore Emulator configured. Never point this test suite at production.
- Run Admin integration tests after the client contract changes.
- No merge/deploy until the emulator suite and Admin checks pass.

## Current blockers to resolve before implementation
1. Confirm all Firestore collections used for bookings, live walks, assignments and zone operations from source/tests.
2. Decide whether legacy `service_areas` records become canonical Zones in place or are migrated to a new collection. Do not mix both approaches.
3. Locate every client caller of `activateServiceLocation`, `setServiceLocationStatus`, and `reviewServiceLocationBoundary`.
