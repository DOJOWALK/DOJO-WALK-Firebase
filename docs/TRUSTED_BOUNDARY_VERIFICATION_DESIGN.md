# Trusted Service-Location Boundary Verification — Design

Status: DESIGN ONLY — not implemented, deployed, or production-approved.
Date: 2026-10-17
Branch: `step-123-boundary-verification-design`

## Problem

The Admin app's Dart geometry checks can be bypassed by an authorized client writing directly to Firestore. Firestore Security Rules can enforce roles and document invariants, but should not be treated as a general polygon-topology engine. A boundary must not become `verified` solely because a client writes `verificationStatus: verified`.

## Proposed trust boundary

1. Admin client submits a boundary ID and review decision to a server-side callable Cloud Function; it does not directly write verified fields.
2. Function requires Firebase Authentication and checks `admin_users/{uid}` server-side for `isActive == true` and `role == super_admin`. Never trust role claims supplied in request data.
3. Function loads the pending boundary and owning City or Area. It validates source metadata, coordinate bounds, ring structure, minimum distinct vertices, non-zero area, and self-intersections.
4. For an Area, it loads the owning City and its verified boundary and validates full Area containment using a maintained geometry library with documented coordinate order and edge semantics. It fails closed on missing, invalid, or ambiguous parent geometry.
5. In a Firestore transaction, function rechecks that the boundary is still pending and the owning location/reference has not changed, then writes verification status, reviewer UID, server timestamp, and validation/version metadata.
6. Firestore Rules deny client attempts to set or change protected verification fields. Rules continue to enforce ordinary role authorization and document shape. The Admin app must be migrated to call the function before this rule change is released.
7. Add audit logging for success and rejection, without storing unnecessary sensitive data.

## Geometry requirements

- Use one documented coordinate convention throughout (GeoJSON uses [longitude, latitude]); convert Firestore `{lat, lng}` points explicitly at the boundary between formats.
- Reject non-finite/out-of-range coordinates, fewer than three distinct vertices, duplicate/degenerate rings, zero-area rings, and self-intersections.
- Confirm whether the ring is explicitly closed or implicitly closed; normalize consistently before validation.
- City/Area containment must test the whole Area polygon, not only its vertices or bounding box. Include edge crossings and edge-midpoint/interior checks using a suitable robust geometry library.
- State tolerances and their units. Avoid applying a degree epsilon as though it were a constant distance in metres.
- Keep official-source provenance and manual review requirements separate from geometric validity: a valid polygon is not proof that its source is authoritative.

## Required regression tests

### Callable function tests
- unauthenticated caller rejected
- active super_admin accepted; inactive admin, support, and ordinary admin rejected
- missing boundary / wrong owner / wrong type rejected
- non-pending boundary cannot be re-verified or mutated
- invalid coordinate, too few distinct points, degenerate ring, and self-intersection rejected
- valid simple City polygon accepted
- Area inside City accepted
- Area crossing City edge, outside by a tiny gap, and partly outside rejected
- concave City with an Area crossing a concavity rejected
- missing/unverified City boundary rejected for Area verification
- concurrent change between initial read and commit rejected by transaction re-check
- success writes server-generated verifier UID/time and validation version; caller-supplied verifier metadata is ignored/rejected

### Firestore Rules Emulator tests
- client cannot set a pending boundary to verified
- client cannot edit verification metadata on an already verified boundary
- verified boundary cannot be deleted
- authorized admin can still create/edit only permitted pending-boundary fields
- all existing role and City/Area activation reference tests continue to pass

## Safe implementation sequence

1. Add a Functions workspace, pinned dependencies, emulator configuration, and callable unit tests on a feature branch.
2. Implement and test server-side validation; do not deploy.
3. Update Admin UI/service to call the function and handle validation errors.
4. Tighten Firestore Rules to block direct client verification and add emulator regression tests.
5. Run Functions tests, Firestore Rules Emulator tests, Admin geometry tests, Flutter analysis, and non-deploying Admin Web release build.
6. Review the combined PRs and only deploy after explicit approval, with a rollback plan.

## Explicit non-goals

- No production Firebase changes or deployment.
- No direct edits to `main`.
- No location activation or bulk import.
- No claim that the design has passed executable tests; this document is a design and test plan only.