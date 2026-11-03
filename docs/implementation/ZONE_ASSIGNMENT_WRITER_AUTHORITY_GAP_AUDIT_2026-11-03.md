# DOJO WALK — Zone Assignment Writer Authority Gap Audit

**Date:** 2026-11-03  
**Status:** Evidence audit complete; writer authority matrix requires Founder clarification before assignment mutation callables or their positive-path acceptance tests are implemented.  
**Related approved decision:** `ZONE_VISIBILITY_AUTHORITY_AND_ASSIGNMENT_SCHEMA_PROPOSAL_2026-11-03.md`  
**Current PR:** #64 — Draft / Open / Unmerged.

## 1. Why this audit exists

The approved schema establishes server-owned assignment records and the visibility rules that consume them. The current branch now enforces read scope through trusted callables. It does not yet define or implement the trusted mutation API that creates, transfers, or revokes those records.

A secure writer must know not only which fields are valid, but exactly which operational role may assign each target role and within which geographic scope. The current policy pages do not fully settle that matrix.

## 2. Verified backend source state

Inspected `functions/src/index.ts` on branch `implementation/zone-emulator-first-plan-2026-11-03` (blob SHA `8f5d3b2497b73fb3b09a795dd15ceed7d5c74587`).

- `listVisibleServiceZones` and `getVisibleServiceZoneBoundary` are the implemented Zone visibility callables.
- The helper `activeAssignments` reads active records from `admin_scope_assignments`, `walker_zone_assignments`, and `zone_boundary_review_assignments`.
- No callable currently creates, transfers, ends, or revokes any of those assignment records.
- No callable currently grants/revokes `admin_users.role` or explicit operational permissions.
- Founder provisioning remains explicitly out-of-band; no production Founder UID or recovery custodian is present in source.
- This is source evidence only; it does not assert that production Firestore contains no records.

## 3. Cross-check against current Notion policy/spec pages

### POL-037 — India City–Zone Operating Structure

Current page text labels it **DRAFT — NOT APPROVED, NOT IMPLEMENTED, NOT TESTED**.

It establishes:
- Founder / CEO approves major risks, senior appointments, city/zone expansion and final GO/NO-GO.
- Central Operations manages all cities, staffing, support, quality, reporting and escalations.
- City Manager owns day-to-day operations for one City and oversees its Zone Supervisors.
- Each active Zone must have one named primary Supervisor.
- Supervisor handles only their assigned Zone's walkers, attendance/availability and local incident escalation.
- During a small pilot, one person may temporarily cover multiple duties if the assignment is recorded.

It does **not** define the technical actor allowed to create/revoke each assignment, whether a City Manager can assign a Supervisor in their own City, or whether a Supervisor can assign a Walker.

### POL-004 — Walker / Partner Management

Current page text labels it **DRAFT — Founder approval required**.

It establishes:
- Central Admin / Walker Operations owns the national process, eligibility standards, assignment configuration, exceptions, escalations and records.
- Area Manager coordinates only the assigned Area and handles local readiness/coaching.
- Only Approved + Active walkers are eligible for work.
- Decisions affecting access or worker status need a reason, owner, timestamp and audit record.

It does **not** provide a callable permission matrix for creating, transferring or revoking canonical Zone assignments.

### Partner Onboarding + Location API Contract — Proposal v0.1

Current page text labels it **DRAFT — NOT APPROVED, NOT IMPLEMENTED, NOT DEPLOYED**.

It explicitly treats Partner location selection as onboarding preference/eligibility input and says the canonical backend-owned Zone catalogue and operational assignment source are not yet implemented. It does not authorize onboarding preferences or legacy `zones` IDs to grant geometry access.

## 4. Decisions required before writer implementation

The following proposed default is offered for Founder confirmation. It preserves the documented separation between executive appointments, Central Operations control, and local execution.

| Operation | Proposed authorized actor | Scope / safeguard |
|---|---|---|
| Provision/recover Founder identity | Out-of-band dual-controlled process only | No in-app or self-service bootstrap; UID verified independently; audit evidence kept outside Git/Notion |
| Grant/revoke Central Admin membership or global permissions | Founder-approved controlled process | Never granted by legacy `super_admin` role alone |
| Appoint/revoke City Manager membership and City assignment | Founder approval; Central Admin executes the recorded decision | One active City Manager per City; one active City assignment per Manager |
| Grant/revoke Zone Supervisor membership and Zone assignment | Central Admin | Only active Zones; one primary Supervisor per active Zone; record city/zone scope |
| Assign/end Walker-to-Zone assignment | Central Admin | Walker must be Approved + Active; Zone must be active and boundary-approved; canonical Zone ID only |
| Assign/revoke boundary reviewer | Central Admin | Active reviewer membership + explicit review permission; reviewer cannot be submitter |
| Change another actor's assignment or permissions | Never by that actor | Actor cannot self-assign, self-elevate, or approve own privileged access |

**Important:** This table is a proposed writer authority matrix, not an already-approved policy. The approved schema alone did not specify all of these mutation actors.

## 5. Acceptance tests to write once authority is confirmed

1. Unauthenticated, Customer, Walker, Supervisor, City Manager, legacy `super_admin`, inactive Admin, and revoked Admin cannot call assignment writers unless explicitly listed as authorized for that operation.
2. Authorized Central Admin cannot grant Founder or Central Admin authority, edit `founder_users`, or elevate their own permissions.
3. Founder-only City Manager appointment approval is required before Central Admin can execute a City Manager assignment.
4. One active City Manager per City and one active City assignment per Manager; concurrent duplicate creates fail transactionally.
5. One primary Supervisor per active Zone; Supervisor cannot be assigned to an inactive, unverified, or out-of-scope Zone.
6. Walker assignment requires an Approved + Active profile and active, verified canonical Zone; legacy preference fields never grant access.
7. Reviewer assignment requires active Admin membership and `zoneBoundaryReview`; submitter/reviewer identity collision is rejected.
8. Transfer/revoke closes the prior assignment with actor, timestamp and reason; subsequent visibility calls immediately deny the old scope.
9. All mutations are transactional, revision-aware, idempotent where retried, and append immutable audit events.
10. Client SDK direct writes remain denied for every assignment and authority collection.
11. Role deactivation/suspension invalidates all subsequent reads and prevents new assignments.
12. Concurrent assignment attempts cannot violate the City Manager or primary Supervisor cardinality constraints.

## 6. Next safe implementation sequence

1. Founder confirms or edits the writer authority matrix in Section 4.
2. Add synthetic Auth/Firestore fixtures and callable acceptance tests for every allowed and denied writer path.
3. Run tests against the dedicated Auth, Functions and Firestore Emulators; record baseline failures before implementation.
4. Implement only the tested trusted writer callables and transactional invariants.
5. Re-run all Rules, Functions, Storage, location geometry and Zone Auth/Functions workflows on one exact code SHA.
6. Only after that, adapt Admin/Partner clients. Keep all production roles, migration, merge, deployment and Zone activation gated behind separate release approval.

## 7. Explicit non-effects

This audit adds no runtime code, callable, Firestore Rule, production record, role grant, assignment, migration, app change, deployment, merge, or Zone activation.
