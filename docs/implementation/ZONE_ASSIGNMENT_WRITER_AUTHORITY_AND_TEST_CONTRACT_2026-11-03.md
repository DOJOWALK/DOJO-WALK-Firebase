# Zone Assignment Writer — Approved Authority Matrix and Emulator Test Contract

**Date:** 2026-11-03  
**Status:** Founder approval received in chat (“Ok karo”); synthetic acceptance suite added; baseline Emulator execution pending.  
**Scope:** Test-first only. No trusted writer callable or runtime Rules change is included in this step.

## Approved authority matrix

| Operation | Authorized actor | Required guard |
|---|---|---|
| Provision/recover Founder identity | Out-of-band dual-controlled process only | No in-app/self-service bootstrap; independently verified UID; separately retained audit evidence |
| Grant/revoke Central Admin membership or global permissions | Founder-approved controlled process | Legacy super_admin is not authority; Central Admin cannot grant this privilege |
| Appoint/revoke City Manager membership and City assignment | Founder approves; Central Admin executes | One active City Manager per City and one active City assignment per Manager; approval bound to target UID + City |
| Grant/revoke Zone Supervisor membership and Zone assignment | Central Admin | Active canonical Zone only; one primary Supervisor per active Zone |
| Assign/end Walker-to-Zone assignment | Central Admin | Walker must be Approved + Active; Zone must be active and boundary-verified; canonical Zone ID only |
| Assign/revoke boundary reviewer | Central Admin | Active membership + explicit zoneBoundaryReview; no self-review |
| Self-assignment / self-elevation | Prohibited | No actor can assign itself or change its own privileged permissions |

Founder appointment approval is a distinct authorization event. Central Admin may execute only the exact approved target UID + City pair. Founder identity provisioning and Central Admin global privilege provisioning remain outside application callables.

## Callable contract under test

The synthetic acceptance suite defines these intended callable operations:

- approveCityManagerAppointment — Founder-only; creates a one-use approval bound to target UID, City, reason, actor and server timestamp.
- assignCityManager — Central Admin-only; consumes the matching Founder approval and creates the City-scoped assignment transactionally.
- assignZoneSupervisor — Central Admin-only; enforces active Zone and one primary Supervisor.
- assignWalkerToZone — Central Admin-only; requires Approved + Active Walker and active, verified canonical Zone.
- assignBoundaryReviewer — Central Admin-only; requires active reviewer membership, explicit review permission, and independent reviewer identity.
- revokeZoneAssignment — Central Admin-only; requires a reason, closes the assignment with server timestamp and actor, and writes an audit event.

These names and payloads are an implementation contract for tests, not a claim that the callable endpoints already exist.

## Acceptance coverage

The new functions/test/zone_assignment_writers_callable.test.cjs suite exercises:

1. Founder-only City Manager appointment approval and denial of Central Admin approval attempts.
2. Central execution only against the exact Founder-approved target UID + City pair.
3. Central Admin-only Supervisor assignment, inactive Zone denial, and self-assignment denial.
4. One-primary-Supervisor-per-Zone cardinality.
5. Walker Approved + Active and active/verified Zone preconditions.
6. Legacy super_admin and onboarding preferences do not authorize writer operations.
7. Reviewer explicit permission and submitter/reviewer self-review denial.
8. Customer, Walker, Supervisor, City Manager and inactive Central Admin mutation denial.
9. Central Admin cannot elevate itself or grant Founder authority.
10. Reasoned revocation, closed assignment state and audit evidence.
11. Malformed IDs and empty reasons rejected.
12. Direct client writes to authority, assignment, approval and audit collections denied.

All fixtures use synthetic Auth identities and Firestore documents in a demo-* Firebase Emulator project. The harness explicitly refuses the production project ID dojo-platform-b68a3.

## Execution sequence

1. Run the new suite against the current read-only backend to record the baseline missing-writer failures.
2. Inspect and correct any test harness/setup failures before interpreting callable failures.
3. Implement writer callables and transactional constraints only after baseline evidence is captured.
4. Run the writer suite plus all existing Rules, Functions, Storage, geometry and visibility suites on one exact commit SHA.
5. Keep PR #64 Draft / Open / Unmerged. No production roles, assignments, migration, deployment, Admin/Partner UI enablement, or Zone activation is authorized by this test work.

## Explicit non-effects

No runtime Rules or Functions were changed by adding this test contract. No production Firestore/Auth data was read or modified for the synthetic acceptance tests.