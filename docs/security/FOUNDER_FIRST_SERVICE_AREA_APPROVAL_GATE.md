# Founder/CEO First Service Area Approval Gate — Design and Test Gate

Status: DESIGN REQUIRED / NOT IMPLEMENTED / NOT DEPLOYED  
Date: 2026-10-24  
Base: Firebase `main` (reviewed trusted callable source; see current `functions/src/index.ts`)

## Purpose

The company operating policy requires written Founder/CEO GO before the first Service Area is activated. Existing `activateServiceLocation` enforces an active `admin_users/{uid}` record with `role == super_admin`, verified boundary metadata, hierarchy and polygon containment. That is not equivalent to a separate, auditable Founder/CEO business approval.

This document intentionally does not change production behavior. The technical identity mapping for Founder/CEO and Central Admin must be resolved against the existing account/role model before implementation.

## Security invariants required before implementation

1. **Deny by default:** City/Area activation must not proceed if the policy-required first-area approval cannot be resolved and validated.
2. **Server-authoritative identity:** Approval must be created by a trusted backend callable; clients must not write or edit approval documents directly.
3. **Exact target binding:** Approval binds to the exact Service Area ID and its canonical ancestry (Country, State, District if applicable, City, Area) and policy/version.
4. **Verified actor:** The backend validates the authenticated UID against the canonical Founder/CEO identity/role record. Do not infer Founder/CEO from `super_admin`, email text, UI role, or client-supplied fields.
5. **Auditability:** Record actor UID, target IDs, decision, server timestamp, reason, evidence reference, policy version, and any revocation/supersession event. Preserve prior records.
6. **No replay or scope drift:** Activation transactionally re-reads the approval and all target/ancestor records; rejects revoked, superseded, mismatched, stale, or already-consumed approvals where the policy requires one-time use.
7. **Atomicity:** Approval consumption and activation/audit writes must be transactionally consistent. If the transaction fails, neither activation nor approval consumption should partially succeed.
8. **Routine operations remain distinct:** This first-area business GO is not a blanket permission for all future areas. Define the later-area approval rule explicitly before implementation; do not silently broaden approval scope.
9. **Area Manager deny until scoped:** Area Manager access remains denied for privileged location operations until canonical assigned-Area scope is defined and enforced in backend and rules.
10. **Deployment parity:** A passing local test or source commit does not prove the deployed Firebase Rules/Functions revision. Record deployed revision and environment evidence separately.

## Data-model questions that must be answered before code

- What canonical document/field represents Founder/CEO identity and role today?
- Is there one Founder/CEO account or a controlled set of authorized approvers?
- Who can revoke or supersede an approval, and what reason/evidence is mandatory?
- Does the first approval bind to a single Area, or to an Area launch package including City, capacity/readiness checklist, and pilot date?
- After the first Area is live, what approval rule applies to each additional Area?
- Is approval one-time/consumable, or does it remain valid until revoked? Choose explicitly.
- Which canonical role and scope fields will be used for Central Admin and Area Manager? No client-side-only role values.

## Required Emulator integration matrix

Run against Firebase Auth + Firestore Emulator and the callable Functions, with a clean isolated dataset. Capture commit SHA, emulator versions/config, authenticated UID/role/scope, input, expected result, actual result, and logs for every case.

| Case | Expected result |
|---|---|
| Unauthenticated activation | DENY |
| Inactive admin or wrong role | DENY |
| Founder/CEO identity not canonically configured | DENY / BLOCKED with explicit reason |
| No written approval for first Area | DENY |
| Valid approval for exact Area and current ancestry | ALLOW only after all existing geometry/hierarchy checks pass |
| Approval for a different Area | DENY |
| Approval target ancestry changed after approval | DENY and require re-review |
| Approval revoked/superseded | DENY |
| Approval already consumed, if one-time policy chosen | DENY |
| Client attempts direct approval create/update/delete | DENY by Firestore Rules |
| Concurrent duplicate activation | At most one effective activation/audit outcome; no duplicate consumption |
| Area Manager outside assigned Area | DENY |
| Area Manager inside assigned Area but lacks a specific delegated permission | DENY |
| Active super_admin without Founder GO | Must not bypass the business approval gate |
| Geometry missing/unverified/invalid or Area outside City | DENY |
| Ancestor becomes inactive during activation | DENY / transaction retry followed by revalidation |

## Implementation sequence

1. Resolve and document the canonical role/identity decision in Company Master / Owner Control Center.
2. Add a pure validation module for approval payload and scope invariants with unit tests.
3. Implement trusted callable(s), Firestore Rules protecting approval/audit collections, and transactionally guarded activation.
4. Implement canonical Area Manager scope resolution and negative tests; keep unsupported role operations denied.
5. Add Emulator tests for every matrix row, including Auth identity changes and concurrency.
6. Run `npm test` and all relevant Firebase Rules/Functions CI checks.
7. Review Admin client adapter only after the backend callable contract is stable.
8. Record deployed Rules/Functions revision and perform read-only production parity verification. Deployment requires separate authorized approval.

## Current evidence and release status

- Source inspection confirms `activateServiceLocation` currently checks active `super_admin`, hierarchy, verified boundary and polygon containment, and creates a server-side activation audit event.
- Source inspection did not establish a separate Founder/CEO approval record enforced during activation.
- Area Manager assigned-Area authorization was not established by this review.
- Existing `functions/test/activate_service_location.integration.test.cjs` is a callable integration suite that refuses to run without `FIRESTORE_EMULATOR_HOST` and exercises the callable's `.run()` handler against Firestore Emulator data. Its helper supplies a synthetic `request.auth` context; it does **not** establish end-to-end Firebase Auth Emulator sign-in/token validation. It also does not test the unimplemented Founder/CEO approval gate or Area Manager scope.
- The CSV import integration suite similarly invokes callable `.run()` with a constructed auth context. Do not describe these as end-to-end Firebase Auth integration.
- Geometry unit tests and callable/Firestore Emulator tests are useful existing coverage, but they do not prove the new approval matrix passes.
- Production deployment parity is not verified.

**Release status: NO-GO.** This design note is not implementation, test PASS, approval, or deployment evidence. Do not merge/deploy or change launch status on the strength of this document.
