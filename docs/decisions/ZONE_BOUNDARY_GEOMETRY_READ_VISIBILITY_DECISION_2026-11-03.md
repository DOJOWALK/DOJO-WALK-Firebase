# DOJO WALK — Zone Boundary Geometry Read Visibility Decision

**Status:** Founder decision required — recommendation only  
**Date:** 2026-11-03  
**Branch:** `implementation/zone-emulator-first-plan-2026-11-03`  
**Parent:** `docs/architecture/DOJO_WALK_CANONICAL_ZONE_BOOKING_INTEGRATION_CONTRACT.md`

## 1. Decision required

Approve the role-based read policy for raw Zone boundary polygon geometry. This document is a recommendation, not an authorization change. It does not modify Firestore Rules or grant access.

## 2. Recommended access matrix

| Actor | Raw polygon read | Scope / condition |
|---|---|---|
| Founder | Allow | All Zones, oversight and exact approval review; active `founder_users/{uid}` record only |
| Central Admin | Allow | All Zones for central operations; active `admin_users/{uid}` with explicit Zone operational permission |
| Designated Boundary Reviewer | Allow | Only boundary documents explicitly assigned to their review queue; active account + explicit boundary-review permission; reviewer cannot review own submission |
| Zone Draft Submitter | Allow | Only own draft boundary before submission; after submission read-only; no ability to set verified fields |
| City / Area Manager | Allow, read-only | Only Zones whose immutable parent City/Area is within their server-verified assignment scope |
| Zone Supervisor | Allow, read-only | Only assigned Zone(s); no boundary write, review, approval, or activation authority |
| Walker / Partner | Deny raw geometry | Receive only server-derived eligibility / assigned Zone reference needed for work; no polygon payload |
| Customer | Deny raw geometry | Booking endpoint resolves coverage server-side; client may receive service-available / unavailable response only |
| Unauthenticated / inactive / revoked actors | Deny | No raw geometry access |

## 3. Security requirements

1. Firestore Rules must deny broad collection reads and enforce document-level scope; query constraints alone must not be treated as authorization.
2. Trusted callable responses must return only the minimum geometry required for a permitted map view; never expose approval metadata, internal audit data, or other Zones' polygons as a side effect.
3. Parent City/Area and Zone assignment scope must be read from trusted server records, not request payload or client claims.
4. Reviewer access is per assigned review request, expires when the request is resolved/reassigned, and cannot be used to self-review.
5. Manager and Supervisor access is read-only and limited to their currently active scope. Scope revocation must take effect without waiting for a client refresh or cached token claim.
6. Walker/Partner and Customer clients must not query `service_location_boundaries` directly. Booking coverage and walk/zone eligibility must be checked by trusted backend.
7. Geometry reads and review/approval access should be auditable; avoid logging full polygon coordinates or personal/customer location data.
8. Do not weaken existing legacy rules or expose City/Area boundary records through a new wildcard rule.

## 4. Product behavior

- Admin boundary editor and reviewer map may render the exact polygon when the actor is authorized.
- Manager/Supervisor map may show the outline only for assigned operational Zones; no editing tools.
- Partner receives only the assigned Zone identifier/name or an eligibility result, not the boundary geometry.
- Customer receives only availability/coverage outcome and valid booking alternatives, not raw service polygons.
- Server-side point-in-polygon resolution remains authoritative for pickup and booking validation.

## 5. Acceptance tests required before implementation

- Founder can read any Zone boundary only while active in `founder_users/{uid}`.
- Central Admin with explicit Zone operational permission can read all Zone boundaries; inactive/revoked Central Admin is denied.
- Designated reviewer reads only assigned pending boundary; unassigned reviewer is denied; submitter cannot review own submission.
- Draft submitter reads own draft only; cannot read another submitter's draft.
- Manager reads assigned City/Area Zones only; another City/Area is denied.
- Supervisor reads assigned Zone(s) only; other Zones are denied.
- Walker, Customer, unauthenticated, inactive, and legacy `super_admin`-only actors cannot read raw polygon documents.
- Direct client list/query and guessed document-ID reads cannot bypass the scope checks.
- Scope revocation blocks subsequent reads.
- Authorized map/callable response excludes unrelated Zone polygons and internal approval/audit fields.

## 6. Founder decision

**Recommended decision:** Approve the access matrix and security requirements above as the baseline policy for Zone boundary geometry reads.

If any role's visibility should differ, specify the role and scope. No Rules or runtime access change will be made until the Founder decision is recorded and the policy is translated into Emulator acceptance tests.

## 7. Explicit non-effects

This recommendation does not grant roles, alter Firestore Rules, create Zone records, implement callables, enable Admin UI, migrate legacy data, deploy, merge PR #64, or activate any Zone.
