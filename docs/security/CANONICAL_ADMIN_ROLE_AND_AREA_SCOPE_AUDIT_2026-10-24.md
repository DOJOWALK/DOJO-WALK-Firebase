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
