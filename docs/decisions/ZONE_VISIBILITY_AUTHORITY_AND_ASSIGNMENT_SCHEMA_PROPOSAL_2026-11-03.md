# DOJO WALK — Founder/CEO and Operational Zone Assignment Schema Proposal

**Status:** FOUNDER-APPROVED — synthetic Emulator acceptance tests first; runtime implementation remains gated on test evidence  
**Date:** 2026-11-03  
**Parent policy:** `docs/decisions/ZONE_BOUNDARY_GEOMETRY_READ_VISIBILITY_DECISION_2026-11-03.md`  
**Source audit:** `docs/implementation/ZONE_VISIBILITY_SOURCE_SCHEMA_AUDIT_2026-11-03.md`

## 1. Purpose

Define the smallest trusted data model needed to enforce the already-approved Zone boundary visibility policy. This is a schema proposal only. It does not grant roles, create production collections, change Firestore Rules, modify Apps, migrate legacy data, or deploy.

## 2. Approved visibility policy — unchanged

| Actor | Geometry scope |
|---|---|
| Founder / CEO | All Cities / all Zones |
| Central Admin | All Cities / all Zones |
| City Manager | All Zones in their assigned City only |
| Supervisor | Their assigned Zone(s) only |
| Walker / Partner | Their currently active assigned Zone(s) only |
| Designated Boundary Reviewer | Only assigned review item(s) |
| Draft submitter | Own draft only |
| Customer | No raw Zone map or polygon |
| Unauthenticated / inactive / revoked | Deny |

Read visibility is not write, review, approval, activation, deactivation, or suspension authority.

## 3. Proposed authoritative collections

### 3.1 `founder_users/{uid}` — Founder / CEO authority

Proposed fields:
- `isActive: boolean`
- `authorityType: "founder_ceo"`
- `permissions: { zoneGeometryReadAll: true, founderApproval: true }`
- `grantedAt: timestamp`
- `grantedBy: uid` (controlled bootstrap custodian; not client input)
- `approvalReference: string` (controlled decision/audit reference)
- `revokedAt: timestamp | null`
- `revokedBy: uid | null`
- `updatedAt: timestamp`

Rules:
- Document ID must equal the Firebase Auth UID.
- No email/display-name matching, no custom-claim-only authority, no fallback to `super_admin`.
- Provisioning and recovery must be out-of-band, independently verified, dual-controlled where operationally possible, and audit-logged.
- Actual Founder UID and recovery custodians must never be committed to GitHub or written into shared Notion.

### 3.2 `admin_users/{uid}` — Central Admin and other Admin identity

Proposed role identifiers:
- `central_admin`
- `city_manager`
- `zone_supervisor`
- Existing `super_admin` remains a separate technical-security role.
- Existing `admin` and `support` must not be auto-mapped to any new operational role.

Proposed common fields:
- `role: string`
- `isActive: boolean`
- `permissions: map` (explicit allowlist, not arbitrary client-editable booleans)
- `createdAt, updatedAt: timestamp`

Central Admin requires explicit `permissions.zoneGeometryReadAll == true` and active membership. This permission is granted only through the approved role-governance workflow; it is not inherited by legacy `super_admin`.

City Manager and Zone Supervisor role membership alone does not grant geometry scope. Their scope comes from active assignment records below.

### 3.3 `admin_scope_assignments/{assignmentId}` — City Manager / Supervisor assignments

Proposed fields:
- `adminUid: string`
- `role: "city_manager" | "zone_supervisor"`
- `scopeType: "city" | "zone"`
- `scopeId: string` (canonical City ID or canonical Zone ID)
- `isActive: boolean`
- `effectiveFrom: timestamp`
- `effectiveTo: timestamp | null`
- `assignedBy: uid`
- `assignmentReason: string`
- `createdAt: timestamp`
- `revokedAt: timestamp | null`
- `revokedBy: uid | null`
- `revocationReason: string | null`

Validation:
- `city_manager` must have `scopeType == "city"`; one active City assignment per Manager, and one active primary City Manager per City.
- `zone_supervisor` must have `scopeType == "zone"`; only assigned Zone(s) are visible. Enforce one active primary Supervisor per active Zone.
- `scopeId` must reference a canonical active hierarchy record; do not use display names.
- Create/revoke/transfer is server-only, transactional, revision-aware, and audited.
- A scope change immediately revokes the prior scope for subsequent reads.

### 3.4 `walker_zone_assignments/{assignmentId}` — operational Walker assignments

Proposed fields:
- `walkerUid: string`
- `zoneId: string` (canonical `service_zones/{zoneId}`)
- `status: "active" | "ended" | "revoked" | "suspended"`
- `isPrimary: boolean` (only if product needs one primary Zone; otherwise omit)
- `effectiveFrom: timestamp`
- `effectiveTo: timestamp | null`
- `assignedBy: uid`
- `assignmentReason: string`
- `createdAt: timestamp`
- `endedAt: timestamp | null`
- `endedBy: uid | null`
- `endReason: string | null`

Validation:
- Only trusted Admin/assignment callables may create, change, end, or revoke an assignment.
- Walker's own onboarding preferences (`zoneName`, `zoneNames`, legacy `zones`) never authorize boundary access.
- Assignment must reference canonical Zone ID, never a display name or unreviewed legacy ID.
- Ended, revoked, suspended, or reassigned Walker cannot read the former Zone geometry.
- Assignment creation must check Walker approved/active status and Zone active status; a Zone suspension blocks new assignment eligibility.

### 3.5 `zone_boundary_review_assignments/{assignmentId}` — reviewer queue

Proposed fields:
- `reviewerUid: string`
- `zoneId: string`
- `boundaryId: string`
- `status: "assigned" | "completed" | "revoked"`
- `assignedBy: uid`
- `assignedAt: timestamp`
- `completedAt: timestamp | null`
- `revokedAt: timestamp | null`

Validation:
- Reviewer must also have active Admin membership and explicit `permissions.zoneBoundaryReview == true`.
- Only assigned review item(s) may be read.
- Boundary submitter cannot review their own submission.
- Reviewer assignment does not grant global Zone map access.

## 4. Proposed read architecture

**Recommendation: trusted callable read API; deny direct client reads of raw boundary documents.**

Proposed callable endpoints:
1. `listVisibleServiceZones` — returns only Zone metadata the actor is allowed to see; paginated.
2. `getVisibleServiceZoneBoundary` — returns the minimum geometry and display metadata for one authorized Zone or assigned review item.

Server authorization sequence:
1. Verify authenticated Firebase Auth UID.
2. Read current active authority records from Firestore on every call.
3. Resolve role and current assignment scope from trusted documents, not request payload or custom claims.
4. Enforce the approved visibility matrix.
5. For City Manager, require Zone's canonical `cityId` to match the active assignment.
6. For Supervisor/Walker, require an active exact Zone assignment.
7. For Reviewer, require the exact assigned boundary/review record and enforce no self-review.
8. For submitter, require exact ownership of an unsubmitted draft.
9. Return only the requested Zone geometry; do not return unrelated Zones, internal approval/audit fields, or customer data.
10. Record an auditable geometry access event at a sensible session/request granularity without logging polygon coordinates.

Firestore Rules target:
- Deny client `get/list/create/update/delete` on `service_location_boundaries` and canonical internal Zone lifecycle collections.
- Functions Admin SDK performs reads only after its own explicit authorization checks; Admin SDK bypasses Rules, so callable code must enforce the matrix itself.
- Customer has no callable route for raw geometry; booking coverage remains server-side.

This architecture prevents a client from widening access by changing a query filter, guessing document IDs, or listing the collection.

## 5. Required Emulator acceptance tests

- Founder active can list/fetch all Zones; inactive, revoked, unprovisioned, spoofed email/displayName/claims denied.
- Central Admin active with explicit permission can list/fetch all Zones; missing permission, inactive account, legacy `super_admin` only denied.
- Manager sees every Zone in assigned City; another City denied; reassignment/revocation immediately removes old scope.
- Supervisor sees assigned Zone only; other Zone denied; reassignment removes previous Zone access.
- Walker preference fields cannot grant access; active server assignment allows own Zone only; end/revoke/suspend removes access.
- Reviewer reads assigned boundary only; unassigned reviewer denied; submitter self-review denied.
- Submitter reads own draft only; after submission cannot change scope or read another draft.
- Customer, unauthenticated, inactive, and revoked actors cannot access raw geometry through Firestore or callable APIs.
- Guessed IDs, direct get/list, broad queries, pagination tampering, and callable payload tampering cannot bypass scope.
- Read-only access cannot mutate Zone/boundary status, revision, approval, assignment, or audit records.
- No scope leak after assignment revocation or role disablement.
- All allowed and denied attempts leave appropriate audit evidence without storing raw geometry in logs.

## 6. Migration and compatibility requirements

- Keep legacy Partner `zones` reads and current `walkers/{uid}` preference fields untouched until a reviewed mapping and compatibility plan exists.
- Create a deterministic mapping table from legacy `zones/{legacyId}` to canonical `service_zones/{zoneId}`; classify unmapped and ambiguous records for manual review.
- Do not infer mapping by matching names, City/Area labels, or list position.
- Backfill assignments only after independent validation of Walker approval, operational assignment, Zone status, and City parent.
- Dry-run counts, duplicate detection, rollback plan, and audit report are required before any production migration.
- Existing app clients must not be broken by changing legacy rules or deleting fields prematurely.

## 7. Founder approval record — 2026-11-03

Founder approved Sections 3.1–3.5, the server-controlled assignment model, trusted callable read architecture, assignment cardinality constraints, and migration guardrails. Approval authorizes synthetic Emulator acceptance tests first. It does not authorize Rules/Functions runtime implementation until the synthetic tests are built and executed, nor production data changes, merge, deployment, or Zone activation.

The next gate is to run the synthetic acceptance matrix against isolated Emulators and record exact commit/workflow/test evidence. Any baseline failures must be documented as current security gaps; they must not be hidden by weakening the approved tests.

## 8. Historical approval request

The original approval request is retained as historical context; it is no longer pending.
1. The proposed collections and fields in Sections 3.1–3.5.
2. The rule that Manager/Supervisor/Walker scope comes only from server-controlled assignment records, never from profile preferences.
3. The trusted callable read architecture with direct client raw-boundary reads denied.
4. The one-active-City-Manager-per-City and one-primary-Supervisor-per-active-Zone constraints.
5. The legacy mapping and migration guardrails.

## 9. Explicit non-effects

This is a proposal only. It does not create collections or records, grant roles, alter Firestore Rules, implement callables, change Admin/Partner apps, migrate production data, merge PR #64, deploy, or activate any Zone.
