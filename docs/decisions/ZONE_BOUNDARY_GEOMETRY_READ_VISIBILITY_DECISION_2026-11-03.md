# DOJO WALK — Zone Boundary Geometry Read Visibility Decision

**Status:** Founder-approved policy — implementation and Emulator verification pending\
**Decision date:** 2026-11-03\
**Branch:** `implementation/zone-emulator-first-plan-2026-11-03`\
**Parent:** `docs/architecture/DOJO_WALK_CANONICAL_ZONE_BOOKING_INTEGRATION_CONTRACT.md`

## 1. Approved policy

The Founder has explicitly set the Zone boundary visibility policy. The Central Admin's global visibility was separately confirmed. This policy governs viewing only; it does not grant editing, review, approval, activation, deactivation, or suspension powers.

## 2. Approved access matrix

| Actor | Raw Zone boundary map visibility | Scope / condition |
|---|---|---|
| Founder / CEO | Allow | All Cities and all Zones; identity must be explicitly authorized and active through the controlled Founder/CEO authority mechanism. No identity inferred from email, display name, or client claims. |
| Central Admin | Allow | All Cities and all Zones; active Central Admin with explicit Zone operational permission. |
| City Manager | Allow, read-only | All Zones belonging to that Manager's assigned City only; no other City's Zones. |
| Zone Supervisor | Allow, read-only | Only the Zone(s) explicitly assigned to that Supervisor. |
| Walker / Partner | Allow, read-only | Only their own currently assigned operational Zone; no other Zone. |
| Designated Boundary Reviewer | Allow | Only boundary documents explicitly assigned to their review queue; active account + explicit boundary-review permission; cannot review own submission. |
| Zone Draft Submitter | Allow | Own draft boundary only before submission; after submission, read-only according to the review workflow; cannot set verified fields. |
| Customer | Deny | No Zone boundary map or raw polygon is shown. Customer receives only booking availability/coverage result and valid alternatives. |
| Unauthenticated / inactive / revoked actors | Deny | No raw geometry access. |
| Legacy `super_admin` without the new explicit permission | Deny | Legacy role alone grants no canonical Zone geometry visibility. |

**Scope rules:** Manager scope is City-based. Supervisor and Walker scope is Zone-based. The server must resolve these scopes from authoritative active records; client-supplied City/Zone IDs or claims cannot widen access. If a Walker has no active assignment, no Zone geometry is returned.

## 3. Separate permissions — visibility is not authority

- Founder/CEO and Central Admin global visibility does not automatically grant every operational or approval action.
- City Manager, Supervisor, and Walker have read-only visibility only within their approved scope.
- Boundary review remains restricted to a separately permissioned reviewer assigned to the specific review request; submitter self-review is prohibited.
- Draft submission rights do not grant boundary verification rights.
- Routine Zone deactivation remains Founder-approval-only.
- Emergency Zone suspension remains a separate, explicitly authorized Central Admin safety action with immediate Founder notification and mandatory audit.
- Customer receives no internal Zone geometry.

## 4. Security requirements

1. Firestore Rules must deny broad collection reads and enforce document-level scope; query constraints alone are not authorization.
2. Trusted callable responses must return only the minimum geometry required for an authorized map view; never expose unrelated Zones, approval metadata, internal audit data, or customer location data.
3. Founder/CEO, Central Admin, City Manager, Supervisor, Walker, and reviewer authority/scope must be resolved from trusted active server records, not request payload or client claims.
4. Manager access is restricted to the Manager's assigned City. Supervisor and Walker access is restricted to their assigned Zone(s).
5. Scope revocation or reassignment must block subsequent reads without relying on stale client claims.
6. Customer clients must not query `service_location_boundaries` or receive polygon geometry through any API.
7. Geometry reads and review/approval access should be auditable; do not log full polygon coordinates or personal/customer location data.
8. No wildcard rule may broaden access to legacy City/Area boundaries or unrelated Zone documents.
9. Walker visibility is assignment-dependent; assignment end, suspension, or reassignment must remove the former Walker's access.
10. No direct client write to Zone or boundary lifecycle fields is allowed.

## 5. Product behavior

- Founder/CEO and Central Admin operations maps may show all Zone polygons.
- City Manager map shows all Zones in the Manager's assigned City only.
- Supervisor and Walker maps show only their assigned Zone(s), read-only.
- Boundary reviewer sees only assigned review item(s) and required comparison context, not unrestricted Zone data.
- Customer app shows no Zone map or polygon; backend performs authoritative point-in-polygon and service eligibility checks.
- Server-side point-in-polygon resolution remains authoritative for pickup and booking validation.

## 6. Emulator acceptance tests required before Rules implementation

- Active authorized Founder/CEO can read all Zone boundaries; inactive/revoked or unregistered identity is denied.
- Active Central Admin with explicit Zone operational permission can read all Zone boundaries; inactive/revoked or legacy-role-only actor is denied.
- City Manager can read every Zone in assigned City and is denied every Zone in another City.
- Supervisor can read assigned Zone only and is denied other Zones.
- Walker can read own active assigned Zone only; no assignment, ended assignment, reassignment, or suspension removes access.
- Designated reviewer reads only assigned pending boundary; unassigned reviewer is denied; submitter cannot review own submission.
- Draft submitter reads own draft only and cannot read another submitter's draft.
- Customer, unauthenticated, inactive, revoked, and legacy `super_admin`-only actors cannot read raw polygon documents.
- Direct document-ID reads, collection list/query, guessed IDs, and alternate callable paths cannot bypass scope.
- Scope revocation blocks subsequent reads.
- Authorized map/callable responses exclude unrelated polygons and internal approval/audit fields.
- No read permission accidentally grants create/update/delete, review, approval, activation, deactivation, or suspension.
- Booking coverage remains correct while Customer receives no raw polygon.

## 7. Remaining implementation prerequisites

The policy is approved, but implementation remains blocked until:
1. The Founder/CEO authority record schema and controlled bootstrap/recovery are securely verified.
2. The Manager, Supervisor, and Walker assignment/scope schemas are confirmed against the actual app/backend records.
3. The callable read API and Firestore Rules strategy are designed and tested in Emulator.
4. Existing legacy Partner `zones` IDs are mapped through a reviewed compatibility plan; no name-based automatic mapping.

## 8. Explicit non-effects

This decision records the read-visibility policy only. It does not itself grant roles, alter Firestore Rules, create Zone records, implement callables, enable Admin UI, migrate legacy data, deploy, merge PR #64, or activate any Zone.
