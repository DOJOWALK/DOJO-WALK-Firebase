# Founder/CEO First Service Area Approval Gate

Status: IMPLEMENTED ON REVIEW BRANCH; NOT MERGED; NOT DEPLOYED
Branch: `security/first-area-founder-approval-2026-10-24`
Date: 2026-10-24

## Enforced flow

1. A trusted operator provisions `company_authorities/founder_ceo` using Firebase Admin SDK with exactly `{ uid: "<Firebase Auth UID>", isActive: true, updatedAt: <server timestamp> }`. Do not use email as the authority key. The record is intentionally not writable by app clients.
2. Founder/CEO calls `approveInitialServiceAreaLaunch` with the exact `areaId` and a written GO reason (10–1000 characters).
3. The callable checks the trusted authority record, inactive target Area, active and matching Country/State/City ancestry, verified Area and City boundaries, and Area polygon containment. It refuses to create a first-area approval if an Area is already active.
4. It creates an immutable-by-client approval record in `service_area_launch_approvals/{approvalId}` and sets singleton `company_launch_control/initial_service_area` to `approved`. Prior approval documents remain available for audit.
5. Founder/CEO may revoke a pending, unused GO using `revokeInitialServiceAreaApproval` with a written reason. Revocation blocks activation. A new GO may then be issued; the old approval remains recorded as revoked.
6. `activateServiceLocation(locationType: "area")` re-reads the control/approval and location ancestry in the same Firestore transaction. The first Area must match the approved Area, Country, State, City, City District value, and both verified boundary IDs. Approval consumption, activation and audit are committed atomically.
7. The control status becomes `consumed`. That first approval cannot be revoked or reused. Subsequent Area activations do not reuse the first-area GO; they continue to require all existing trusted geometry/hierarchy checks.

## Security properties

- Missing or malformed launch-control state fails closed for Area activation.
- The operational `super_admin` role does not itself confer Founder/CEO approval authority.
- Clients cannot create or modify the authority, approval, launch-control or audit records under the current default-deny Firestore Rules.
- The approval is target-bound and invalidated if ancestry or boundary references drift before activation.
- Concurrent first-area activation attempts serialize on the singleton control document.
- This does not authorize production activation, merge or deployment.

## Emulator tests

The updated callable integration test covers: activation without GO denied; operational admin cannot issue GO; configured Founder/CEO can approve; pending GO can be revoked; revoked GO blocks activation; a fresh GO can be consumed by the exact Area; control and approval end in `consumed`; audit events are written.

Run from `functions/` with the Firestore Emulator configured:
`npm test`

The existing integration harness uses callable requests with synthetic `request.auth` UIDs against Firestore Emulator. This is **not** yet an end-to-end Firebase Auth Emulator sign-in/token test. A dedicated Auth Emulator integration test remains required before calling the full authentication test gate complete.

## Provisioning / deployment checklist

- Confirm the actual Founder/CEO Firebase Auth UID with the owner; never guess it.
- Provision the singleton authority record through a controlled Admin SDK procedure and record who performed it.
- Run Functions build and all tests, including Firestore Rules tests and an Auth Emulator sign-in flow.
- Review the exact PR head and CI results.
- Deploy only with explicit release authorization, then verify the deployed Functions/Rules revision independently.
- Do not set launch GO in production merely because the callable is merged.

## Remaining known gap

The cross-app canonical roles (`founder_ceo`, `central_admin`, `area_manager`) and server-enforced Area Manager assigned-Area scope are a separate authorization workstream tracked by Admin issue #5 and must be implemented/tested before granting Area Manager access. This branch does not claim that role/scope work is complete.
