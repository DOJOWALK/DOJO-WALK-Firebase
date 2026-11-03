# DOJO WALK — Approved Zone Visibility: Source Schema Audit

**Date:** 2026-11-03  
**Status:** Source audit completed for the exact refs below; runtime implementation remains blocked.  
**Decision:** `docs/decisions/ZONE_BOUNDARY_GEOMETRY_READ_VISIBILITY_DECISION_2026-11-03.md`  
**Branch:** `implementation/zone-emulator-first-plan-2026-11-03`

## 1. Purpose

Translate the Founder-approved visibility matrix into an implementation-ready schema map without inventing production fields or changing live access. This audit checks repository source only. It does not read live Firestore/Auth records or deployed configuration.

## 2. Exact source refs inspected

| Repository | Ref | File | Blob SHA |
|---|---|---|---|
| Firebase | `implementation/zone-emulator-first-plan-2026-11-03` | `firestore.rules` | `9bac26b9e13a97d412a0154ec9af70629e82eb47` |
| Firebase | same | `functions/src/index.ts` | `2b13994aff949f38e626e1929422e5de84755312` |
| Firebase | same | `functions/src/location_name_index.ts` | `eb0418290fdf82b55336a1236d5555561c9acf95` |
| Firebase | same | `functions/package.json` | `e05c6f142638aa3c483548590385ef6ee0321bff` |
| Partner | `main` | `lib/features/onboarding/screens/work_location_screen.dart` | `9c5d5e12a3fd29785d2001fb20937a7bbb374df5` |
| Partner | `main` | `lib/features/onboarding/screens/personal_details_screen.dart` | Retrieved and inspected; owner onboarding writes legacy zone preference fields |
| Firebase PR | `#64` | head | `596f60426157db120913665764497b5d79f464f2` |

The Firebase source files above are on the implementation branch and currently match the legacy source snapshot for the inspected Rules/Functions files. Partner source is from its `main` branch; it is not yet a canonical Zone integration.

## 3. Verified findings

### 3.1 Founder / CEO authority

- The production Functions entry point does not export or implement a Founder authority resolver.
- Firestore Rules contain no `founder_users/{uid}` match.
- The Phase 2 test scaffold creates synthetic `founder_users/{uid}` documents in the demo Emulator only. This fixture proves test isolation, not a production schema, bootstrap process, recovery custodian, or live Founder UID.
- Therefore the approved Founder/CEO global read cannot yet be implemented safely. Do not infer Founder from email, display name, legacy role, or custom claims.

### 3.2 Central Admin authority

- Existing Rules helper `isAdmin()` requires an active `admin_users/{uid}` document with `role == "super_admin"`.
- Existing Admin user Rules permit only `super_admin`, `admin`, and `support` role values. They do not currently recognize `central_admin`.
- The inspected Functions callable authorization checks active `admin_users/{uid}` with `role == "super_admin"`.
- The Phase 2 test fixture's `central_admin` role is synthetic test data only; it is not a production migration or live grant.
- Consequently, the approved Central Admin global visibility is not currently implemented. Legacy `super_admin` must not be silently promoted to Central Admin.

### 3.3 City Manager / Supervisor scope

- The inspected Firebase Rules and Functions do not establish a verified production assignment document contract for City Manager `cityId` scope or Supervisor `zoneId` scope.
- Repository code search in the Admin repository did not locate a verified assignment contract for `assignedCityId`, `assignedZoneId`, `cityManagerId`, or `supervisorId`. This is a source-search result, not proof that no such records exist in any live database or unindexed source.
- Do not create or trust guessed assignment fields. Before implementing, inspect the actual Admin screens/services, connected Notion build specification, and current non-sensitive schema documentation; then pin exact field names and authority source.

### 3.4 Walker / Partner scope — critical legacy mismatch

- Partner onboarding reads the legacy top-level `zones` collection, filters active documents, and lets the applicant choose a City/Area.
- It derives zone labels from legacy `zoneName` / `name` / `title`, then writes `city`, `state`, `area`, `zoneName`, `zoneNames`, and `zones` (legacy document IDs) into the walker's own `walkers/{uid}` profile.
- Firebase Rules currently allow the walker owner to create/update the legacy profile fields `zoneName`, `zoneNames`, and `zones`.
- These are applicant-selected onboarding preferences, not trusted operational assignments. They cannot authorize raw geometry visibility.
- The approved Walker visibility must use a separate server-controlled active assignment record, or a verified server-authored assignment field with strict owner-write denial and audited reassignment. The canonical Zone ID must be mapped explicitly; never assume a legacy `zones/{id}` is a canonical `service_zones/{id}`.

### 3.5 Current boundary geometry read rule

- `service_location_boundaries/{boundaryId}` currently allows `get,list` only when legacy `isAdmin()` is true (active `super_admin`).
- This does not implement the approved Founder/CEO, Central Admin, City Manager, Supervisor, or Walker scoped visibility matrix.
- Existing boundary data validation accepts legacy `city`, `area`, and `locality` owner types; it is not the canonical Zone boundary lifecycle.
- No `service_zones` Rules match and no `founder_users` Rules match were found in the inspected Rules file. There is no legacy top-level `zones` match in this Rules file; any Partner access to that collection therefore needs separate rule/source verification before migration.

### 3.6 Functions and collections

- The inspected Functions entry point exports only:
  - `reviewServiceLocationBoundary`
  - `activateServiceLocation`
  - `setServiceLocationStatus`
  - `saveServiceLocationWithNameIndex`
  - `manageServiceLocationImportRun`
- The canonical Zone read endpoint and Zone lifecycle callables are not present.
- `location_name_index.ts` defines legacy country/state/district/city/area/locality collections and no canonical Zone type.

## 4. Approved visibility matrix (policy remains unchanged)

| Actor | Approved raw boundary visibility |
|---|---|
| Founder / CEO | All Cities / all Zones |
| Central Admin | All Cities / all Zones |
| City Manager | All Zones in assigned City only |
| Supervisor | Own assigned Zone(s) only, read-only |
| Walker / Partner | Own active assigned Zone(s) only, read-only |
| Boundary Reviewer | Assigned review item(s) only |
| Draft submitter | Own draft only |
| Customer | No Zone map or raw polygon |
| Unauthenticated / inactive / revoked | Deny |

Visibility does not imply edit, review, approval, activation, deactivation, or emergency suspension authority.

## 5. Implementation-ready schema decisions still required

1. **Founder/CEO:** finalize the production `founder_users/{uid}` schema, required authority fields, controlled initial provisioning, two-person or equivalent independent recovery controls, audit evidence, and revocation behavior. Keep actual UID/custodian details out of source control.
2. **Central Admin:** define explicit `central_admin` role/permission schema and migration rules; never infer it from `super_admin`.
3. **City Manager:** identify the authoritative assignment collection and exact City foreign key; one active manager may have the approved assigned City scope, and reassignment/revocation must take effect immediately.
4. **Supervisor:** identify the authoritative supervisor-to-Zone assignment record and lifecycle; no scope from user-editable profile fields.
5. **Walker:** create/confirm server-authored active Walker-to-canonical-Zone assignment, separate from onboarding preference. Reassignment, end date, suspension, and removal must revoke old Zone access.
6. **Boundary Reviewer:** preserve explicit permission + assigned review request + no self-review.
7. **Legacy mapping:** build a reviewed mapping of Partner `zones/{legacyId}` to canonical `service_zones/{zoneId}`, including unmapped/ambiguous records and rollback; no name-only auto-mapping.
8. **Read delivery:** choose between scoped direct Firestore reads and a trusted callable/map response. Whichever approach is chosen must prevent list/query/guessed-ID bypass and stale-scope access. Prefer the smallest payload needed by each actor.

## 6. Required Emulator test plan

- Founder active/inactive/revoked/unprovisioned; spoofed email/displayName/claims; all-Zone read allowed only for active explicit Founder.
- Central Admin active/inactive/revoked; legacy `super_admin` only; explicit permission missing; global read only for approved Central Admin.
- Manager assigned City A reads all City A Zones, cannot read City B; transfer/revocation blocks prior scope.
- Supervisor assigned Zone A reads A only; Zone B denied; reassignment removes A and grants only B.
- Walker applicant preference fields cannot grant access; active server assignment grants only assigned canonical Zone; ended/reassigned/suspended assignment removes access.
- Customer, unauthenticated, inactive, revoked actors denied all raw geometry.
- Boundary reviewer assigned/unassigned and submitter self-review denied.
- Direct document reads, collection list, query constraints, guessed IDs, and callable payload tampering cannot bypass scope.
- Read permissions never grant writes or lifecycle actions.
- Legacy Partner `zones` ID does not resolve to canonical Zone without an explicit mapping record.

## 7. Gate status and safe next action

**Source audit: PARTIAL PASS.** Legacy source contracts and critical mismatches are identified. Live identity documents, manager/supervisor assignment records, deployed Rules/Functions, and legacy-to-canonical Zone data were not queried.

Next safe step: inspect the current Admin and Partner implementation branches and the relevant Notion developer-build specification to locate the authoritative assignment workflow. If none exists, prepare a schema proposal for Founder approval before coding. Then add Emulator fixtures and tests before implementing scoped reads.

**No runtime changes:** no Rules, Functions, roles, Firestore records, migration, UI, deployment, merge, or Zone activation were changed by this audit.
