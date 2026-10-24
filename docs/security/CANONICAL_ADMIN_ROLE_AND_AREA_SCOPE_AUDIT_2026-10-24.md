# Canonical Admin Roles and Area Scope — Audit

Date: 2026-10-24
Status: AUDIT FINDINGS ONLY — no authorization behaviour changed

## Verified from source

Reviewed:
- `firestore.rules` on `main`, blob `104467bab5dcc66c01a1f0f70df321ac0b193249`
- `functions/src/index.ts` on `security/first-area-founder-approval-2026-10-24`, blob `5108bba023947b3a28a7735018a120cf0e676a49`
- Admin `lib/core/auth/admin_identity.dart` on `feature/admin-fresh-architecture-2026-10-24`

The current authorization gate is legacy `admin_users/{uid}` with `isActive == true` and `role == "super_admin"`. The callable `reviewServiceLocationBoundary` checks that condition both before work and again in its transaction. `activateServiceLocation` also requires the same legacy role. Firestore Rules `isAdmin()` uses the same legacy role, and the current Admin UI gate does too.

The first-Service-Area Founder GO callable uses a separate trusted record, `company_authorities/founder_ceo`, and does not by itself implement general company role permissions.

## Blocker: Area assignment schema is not yet verified

The reviewed source does not establish a canonical server-owned record for:
- the user's canonical role (`founder_ceo`, `central_admin`, `area_manager`);
- active/revoked assignment status;
- the exact Area IDs assigned to an Area Manager;
- the trusted actor and timestamp for granting/revoking that assignment;
- how documents such as bookings, walkers, and live operations resolve to a canonical Area ID.

Do not guess these fields or infer assignment from a client-supplied Area ID. A UI-only filter is not authorization.

## Protected-resource linkage findings (verified in current Rules/schema)

- `bookings/{bookingId}` admin reads/writes are currently gated by the broad legacy `isAdmin()` helper. The booking create schema contains pickup-address fields and booking/walker identifiers, but the reviewed booking Rules do not establish a trusted canonical `areaId` field for authorization.
- Walker profile Rules allow free-text fields such as `area`, `zoneName`, `zoneNames`, and `zones`. These are not a safe basis for access control because text labels can be ambiguous or client-supplied.
- Service Location hierarchy does use canonical document IDs: Area documents reference `cityId`, and Locality documents reference `areaId`. Those are useful trusted links only when written/validated by the trusted location workflow.
- Consequently, the present booking and walker shapes do not yet provide sufficient verified evidence to enforce Area Manager scope across all booking/walker operations. A manager-supplied Area ID or a free-text walker area must never be accepted as proof of scope.

## Required contract before implementation

1. Define one server-owned, non-client-writable role/assignment record and a controlled Admin-SDK provisioning/revocation procedure. Store Area assignments as canonical Area document IDs, with actor, timestamp, active/revoked state and audit history.
2. Add and validate canonical resource links before scoping queries: bookings need a trusted Area ID derived from the validated service location/pickup workflow; walkers need an explicit canonical Area assignment or verified multi-Area assignments. Resolve Locality → Area → City ancestry from trusted documents. Plan a safe backfill/reconciliation for existing records; do not guess from free-text labels.
3. Define the permission matrix for Founder/CEO, Central Admin, and Area Manager; explicitly reserve Founder-only operations.
4. Implement equivalent checks in Firestore Rules and every privileged callable Function. Functions using Admin SDK bypass Firestore Rules and must check permissions themselves.
5. Add emulator tests for inactive/revoked access, client self-elevation, unauthorized grants, Central Admin attempting Founder-only changes, Area Manager allowed assigned Area/descendants, denied sibling/unassigned Area reads and writes, and launch GO bypass attempts.
6. Run Rules and Functions emulator suites and review results on the exact PR head. Keep changes unmerged and undeployed until reviewed.

## Safety status

- No production records, rules, or Functions were changed by this audit.
- No canonical role migration or Founder UID was guessed.
- PR #34 remains draft and unmerged; the Founder first-Area GO gate is not equivalent to the full role/scope authorization system.
- This document is a blocker record, not a claim that authorization is complete.

## Proposed implementation contract — NOT YET IMPLEMENTED

This section is a design proposal based on the source audit above. These collection and field names are proposed, not claims about existing production data.

### A. Canonical membership record

Proposed server-owned document: `admin_memberships/{uid}`

Required fields:
- `role`: exactly `founder_ceo`, `central_admin`, or `area_manager`;
- `isActive`: boolean; revoked users are inactive rather than silently deleted;
- `assignedAreaIds`: array of canonical `service_areas/{areaId}` document IDs; required and non-empty for Area Managers, empty for Founder/CEO and Central Admin;
- `grantedByUid`, `grantedAt`, `updatedByUid`, `updatedAt`;
- optional `revokedAt`, `revokedByUid`, `revocationReason` for lifecycle/audit clarity.

Only a controlled trusted backend/Admin-SDK provisioning path may create or change membership, role, active state, or assignments. Client Firestore Rules must deny client create/update/delete for this collection. The backend must reject self-grant/self-elevation and require the granting actor's permission. Keep immutable audit events for grants, changes, and revocations. Do not treat `admin_users/{uid}` or a user-editable profile field as authority after a controlled migration is approved.

Founder first-Area GO remains an additional launch approval gate; membership as Founder alone must not implicitly skip the existing target-bound approval/audit flow.

### B. Resource-to-Area contract

- **Booking:** propose a trusted `serviceAreaId` field (or one consistently chosen canonical field name) written only by a trusted booking/assignment backend after resolving the selected pickup address to a verified service Locality and then validating Locality → Area → City ancestry and active coverage. Never accept the submitted Area ID as proof. If pickup cannot be resolved unambiguously, mark the booking for reconciliation and do not grant Area Manager access to it.
- **Walker:** propose server-managed `assignedAreaIds` using canonical Area document IDs, with verification/audit metadata. A walker's free-text `area`, `zoneName`, `zoneNames`, or `zones` may remain display-only but must never authorize access. Define whether multiple Area assignments are allowed and have the trusted onboarding/assignment workflow validate each ID.
- **Locality and location records:** validate the authoritative parent references from Firestore documents at the backend boundary; do not infer parentage from labels, PIN codes, geocoding text, or client-provided IDs alone.
- **Existing records:** create a dry-run inventory first. Auto-link only records with an unambiguous, verifiable canonical relationship from trusted data. Put ambiguous/missing cases into a review queue; do not bulk-guess, delete, or silently expose them. Record counts, reasons, and before/after identifiers for every migration batch.

### C. Query and enforcement contract

Firestore Rules do not filter unauthorized documents out of broad queries. Area Manager clients must issue queries constrained by the assigned canonical Area IDs and resource Area field; rules must independently validate every returned document's Area scope. If the query shape or Firestore Rules limitations cannot safely express the intended scope, use a trusted callable/query endpoint or a server-maintained per-Area index with explicit access checks—never fall back to a broad collection query.

Every privileged callable Function must use the same canonical authorization helper and enforce the same role/scope rules itself, because Admin SDK access bypasses Firestore Rules. Validate the actor again inside transactions when a permission-sensitive operation relies on mutable authorization state. Define Founder-only actions explicitly; Central Admin must not be able to alter Founder authority, approve their own elevation, or bypass the first-Area GO gate.

### D. Safe rollout sequence

1. **Inventory only:** count current admin, booking, walker, and location records; identify actual booking creation/update paths and all privileged callables; no writes.
2. **Schema + migration dry run:** add proposed validators and a report-only reconciliation script; report eligible, ambiguous, and invalid records without changing production.
3. **Emulator-first implementation:** add canonical authorization helpers and tests for every role, revoked membership, self-elevation, unauthorized grants, assigned Area, sibling/unassigned Area, descendants, booking/walker query boundaries, and Founder GO bypass attempts.
4. **Compatibility bridge:** decide and test a time-bounded legacy migration/rollback plan. Do not simply switch all callers from `admin_users` to the new collection while existing admins could be locked out or privileged users over-authorized.
5. **Reviewed data migration:** only after dry-run counts and record-level reconciliation are reviewed; preserve an audit trail and a tested rollback/export plan.
6. **Staged deploy and verification:** deploy Rules and Functions in a coordinated sequence, verify the exact deployed revisions and smoke tests, then enable new Admin UI flows. Keep PRs unmerged/un-deployed until CI, review, and migration readiness are established.

### E. Acceptance gates (all required)

- No client can create/change its own role, active status, Founder authority, or Area assignment.
- A revoked/inactive membership immediately fails Rules and callable checks.
- Area Manager can access assigned Area and approved descendants only; sibling/unassigned Area bookings, walkers, and operations are denied on both reads and writes.
- Central Admin cannot perform Founder-only actions; Founder launch approval is target-bound, auditable, revocable, and consumed as designed.
- Existing records that cannot be mapped unambiguously remain inaccessible to Area Manager scope until reconciled.
- Rules + Functions emulator tests pass on the exact candidate commit, and production deployment parity is verified separately.

**Status of this proposal:** documentation only. No schema, Rules, Functions, production data, PR merge, or deployment changed by adding this contract.

## Additional source audit — booking write path and callable inventory (2026-10-24)

Verified against `firestore.rules` on `main` (blob `104467bab5dcc66c01a1f0f70df321ac0b193249`) and the Functions source on the review branch:

- The current `match /bookings/{bookingId}` Rules permit a signed-in client to create a booking when `validBookingBase(bookingId)` and one of the booking-plan validators pass. The reviewed booking creation rule does not require a trusted server-derived canonical Area link.
- The reviewed Functions entry point exports callable operations for Service Location boundary review, initial-area Founder approval/revocation, Service Location activation/status, location save/name-index, and location import-run management. It does not currently export a booking-creation callable.
- This means the trusted booking-to-Area link cannot safely be solved by adding a field to the client payload alone. Before enforcing Area Manager booking scope, the design must either introduce a trusted booking creation/validation backend and safely migrate clients, or demonstrate another existing trusted booking-write path. Do not accept a client-supplied `serviceAreaId` as authority.
- Current Rules allow broad legacy-admin reads of bookings and walkers through `isAdmin()`; the helper is based on active `admin_users/{uid}` with role `super_admin`. Area Manager scope is not currently expressed by those rules.
- Walker creation is owner-written under the current Rules and accepts several free-text location fields. Any canonical walker Area assignment must be written by a trusted administrative/backend workflow, not by the walker's own profile submission.

**Implementation consequence:** treat trusted booking creation / legacy booking compatibility as a separate migration workstream with emulator coverage. Do not change booking create Rules to require a field until the customer app and trusted backend are coordinated, otherwise valid bookings could fail or malicious clients could still forge the field.

