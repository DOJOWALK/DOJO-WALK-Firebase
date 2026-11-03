# DOJO WALK — Zone Emulator-First Implementation Plan

Date: 2026-11-03
Status: Implementation plan only — no runtime code, Rules, schema, data, roles, deployment, or production changes.
Parent contract: `docs/architecture/DOJO_WALK_CANONICAL_ZONE_BOOKING_INTEGRATION_CONTRACT.md`
Working branch: `implementation/zone-emulator-first-plan-2026-11-03`

## 1. Objective

Implement the canonical Zone lifecycle safely, beginning with executable Emulator tests and only then adding trusted Firebase Functions/Firestore Rules. Admin UI actions remain disabled until the backend contract passes. Partner and Customer migration is a later compatibility phase.

This plan does not authorize production deployment, Zone activation, role grants, migration/deletion of legacy collections, or PR merge.

## 2. Founder-approved governance defaults

Founder explicitly approved these three defaults on 2026-11-03. They are binding design inputs for the implementation and Emulator acceptance tests:

1. **Zone-name uniqueness:** unique within the selected City. Same normalized name may exist in another City.
2. **Boundary review:** a designated Central Admin reviewer with an explicit boundary-review permission. The submitter cannot review their own boundary. Founder performs final business approval, not routine geometry review.
3. **Founder identity:** an explicit active `founder_users/{uid}` allowlist record provisioned through a separately controlled, audited bootstrap/recovery process. Never infer Founder from email, display name, `super_admin`, or client claims. The exact initial UID and recovery custodians must be verified from Firebase Auth/admin records before any role provisioning.

Additional policy gate still requiring a recorded decision: boundary geometry read visibility. Routine deactivation authority and emergency suspension authority/Founder-notification requirements were explicitly approved on 2026-11-03 and are recorded in the Phase 2 entry gate below. Technical notification delivery/retry/escalation mechanics remain an implementation-design item, not a reason to weaken immediate Founder notification.

## 3. Phase 0 — source and environment freeze

Before writing implementation code:

- Re-fetch the exact current Admin and Firebase source files and record blob SHAs.
- Confirm Firebase Functions v2 entry point, deployed region `asia-south1`, package scripts, Node/runtime version, Emulator Suite versions, and CI workflow commands.
- Inspect actual `admin_users`, Founder identity provisioning, and assignment/scope document schemas without exposing private credentials or personal data.
- Inventory all existing callable exports and Firestore match blocks; preserve legacy City/Area behavior.
- Confirm current branch/PR heads and keep implementation on a dedicated branch.
- Never read, print, copy, or commit service-account private keys or other secrets.

**Exit:** source SHA manifest and reproducible local/CI Emulator commands committed before implementation begins.

## 4. Phase 1 — Emulator acceptance tests first

Founder-approved governance defaults are now fixed inputs. Create isolated test fixtures with synthetic UIDs and deterministic IDs. Tests must not depend on production records.

### 4.0 Initial test scaffold committed

- Added `test/service_zones.rules.test.mjs` with synthetic actor fixtures for Founder, Central Admin, designated reviewer, Area Manager, Supervisor, legacy `super_admin`, Walker, and Customer.
- The executable Rules suite checks that all five canonical Zone collections remain server-write-only: client create/update/delete attempts and forged lifecycle/approval/audit fields are denied for every synthetic authenticated actor; unauthenticated create attempts are denied.
- Added explicit `test.todo` acceptance gates for callable authorization, self-review prevention, exact Founder approval tuple, legacy-role isolation, City-scoped uniqueness, stale revision/hash rejection, idempotency, and concurrency. These require the trusted Zone callable harness and are not represented as passing tests.
- Exact-head CI Emulator evidence is recorded in the Phase 1 execution update below: all four Firebase workflows succeeded on `b1f5bd28f1ff3ae1c58ef6a5446dcd7bb627e884`. The Zone suite reports 10 TODO lifecycle/callable gates; these are not passing tests.

### 4.1 Role and authorization matrix

| Actor fixture | Create/edit draft | Submit Founder review | Review boundary | Founder decision | Activate |
|---|---:|---:|---:|---:|---:|
| Active Central Admin + zone operation permission | Allow | Allow | Only if reviewer permission and not submitter | Deny | Allow only with exact approval |
| Central Admin without reviewer permission | Allow | Allow | Deny | Deny | Allow only with exact approval |
| Designated reviewer who submitted the boundary | Allow draft | Allow | Deny self-review | Deny | No direct authority |
| Active Founder allowlist UID | Oversight/read | No operational submission | No routine geometry review | Allow | No direct operational activation |
| Legacy `super_admin` only | Deny Zone operations by default | Deny | Deny | Deny | Deny |
| Area/City Manager assigned | Read/request within assigned scope only | Deny | Deny | Deny | Deny |
| Area/City Manager unassigned | Deny scoped access | Deny | Deny | Deny | Deny |
| Supervisor assigned | Read/report only | Deny | Deny | Deny | Deny |
| Walker/Partner | No administration | Deny | Deny | Deny | Deny |
| Customer | No administration | Deny | Deny | Deny | Deny |
| Unauthenticated | Deny | Deny | Deny | Deny | Deny |
| Inactive/revoked admin or Founder | Deny | Deny | Deny | Deny | Deny |

### 4.2 Schema, ancestry, and uniqueness

- Valid Country → State → District → City references succeed.
- Missing, inactive where policy forbids, or mismatched parent references fail.
- Parent IDs become immutable after Zone creation.
- Zone name normalization is deterministic and tested for case/whitespace/unicode policy.
- Same normalized name in same City fails; same name in a different City succeeds.
- Unknown fields, oversized strings, malformed IDs, and client-supplied server-owned fields fail.
- Index reservation and Zone creation are atomic; rename releases/reserves indexes transactionally.

### 4.3 Boundary integrity

- Valid polygon draft with provenance succeeds as pending only.
- Too few/many points, invalid coordinate ranges, duplicate/degenerate vertices, self-intersection, zero area, unsupported geometry/antimeridian, wrong Zone owner, and missing provenance fail.
- Geometry canonicalization is deterministic across equivalent supported input representations.
- SHA-256 is calculated server-side from canonical ordered longitude/latitude pairs; never from arbitrary Firestore serialization.
- Draft evidence becomes immutable once submitted for review; corrections create a new boundary document.
- A reviewer cannot review their own submission.
- Verified boundary is bound to exact Zone ID and revision; a new boundary increments revision and clears current approval references.

### 4.4 Founder approval and lifecycle

- Founder decision succeeds only for the exact approval request tuple: Zone ID + revision + boundary ID + boundary hash + request type.
- Wrong UID, stale revision, wrong hash, wrong Zone, rejected/superseded request, duplicate decision, and replay fail.
- Activation succeeds only when Central Admin re-reads and validates the current exact approval and verified boundary in one transaction.
- Valid Zone activation does not require a City service-active flag or City polygon; City parent references must still be valid.
- Routine deactivation, emergency suspension, and reactivation are distinct transitions.
- Emergency suspension immediately blocks new booking eligibility; already-running walks retain the separate safety/handover workflow.
- Old approvals never authorize a changed boundary/revision.

### 4.5 Idempotency and concurrency

- Same actor + operation + request ID + same payload returns the stored prior result.
- Same request ID with a different payload fingerprint fails.
- Concurrent activation attempts yield one valid transition and one safe conflict.
- Boundary replacement during pending approval invalidates the stale approval.
- Actor deactivation/revocation before transaction commit causes denial.
- Audit event, state transition, revision, and idempotency result commit atomically.

### 4.6 Firestore Rules forgery tests

Client SDK create/update/delete must be denied for canonical Zone lifecycle collections:
- `service_zones`
- `service_location_boundaries`
- `service_zone_approval_requests`
- `service_zone_name_indexes`
- `service_zone_audit`

Explicitly test attempts to forge status, `isServiceActive`, revision, hash, verified fields, Founder decision fields, actor identity, timestamps, and audit records. Keep legacy rules behavior intact and test it separately.

**Exit (current):** the Rules-forgery tests execute successfully in CI and default-deny the five canonical Zone collections. Ten callable/lifecycle acceptance gates remain TODO. A synthetic Auth/Firestore fixture smoke harness now exists, but it does not invoke Zone callables and is not proof of lifecycle behavior.

## 5. Phase 2 — implement trusted Firebase backend

Implement separately versioned Zone callables in `asia-south1`; do not overload existing City/Area callables or silently add Zone to legacy generic helpers.

Suggested modules:
- `functions/src/service_zones/schema.ts` — strict payload schemas and enums.
- `functions/src/service_zones/authorization.ts` — authoritative Founder/Central/reviewer/scope checks.
- `functions/src/service_zones/geometry.ts` — polygon validation, canonicalization, hashing.
- `functions/src/service_zones/repository.ts` — transaction and collection operations.
- `functions/src/service_zones/idempotency.ts` — request fingerprint/result persistence.
- `functions/src/service_zones/audit.ts` — append-only audit event construction.
- `functions/src/service_zones/callables.ts` — callable handlers.
- Export only reviewed callables from the existing Functions entry point.

Required callable set:
1. `createServiceZoneDraft`
2. `createServiceZoneBoundaryDraft`
3. `reviewServiceZoneBoundary`
4. `submitServiceZoneForFounderReview`
5. `decideServiceZoneFounderApproval`
6. `activateServiceZone`
7. `requestServiceZoneDeactivation`
8. `suspendServiceZoneForEmergency`
9. `requestServiceZoneReactivation`
10. `reactivateServiceZone`

Every callable must validate authentication, authoritative role record, strict allowlisted payload, parent IDs, expected revision, idempotency key, and transaction preconditions. Actor UID/role must come from verified auth and server records, never request payload.

## 6. Phase 3 — Firestore Rules

- Client writes to canonical Zone, boundary, approval, name-index, and audit documents are denied; trusted callable Admin SDK owns writes.
- Reads are explicitly scoped by role and operational assignment; do not expose full boundary geometry broadly by default.
- No wildcard permission broadening.
- Existing legacy `service_areas`, `zones`, bookings, and walker access remain compatible during the adapter period.
- Rules tests must prove that denied writes cannot be bypassed through alternate paths.

## 7. Phase 4 — Admin integration

Only after backend Emulator suites pass:
- Replace generic `saveServiceLocationWithNameIndex(locationType: zone)` usage with dedicated Zone draft callable.
- Replace direct Firestore boundary draft writes with `createServiceZoneBoundaryDraft`.
- Wire Add Zone save and submit buttons only to the versioned callables.
- Replace illustrative Founder queue rows with live approval-request reads.
- Enforce separate boundary reviewer and Founder actions in UI, while backend remains authoritative.
- Display server-returned Zone revision, boundary hash, request ID, and status for audit support.
- Keep UI disabled if callable contract/version or authorization is unavailable.

## 8. Phase 5 — Partner and Customer adapters (later gate)

Do not migrate legacy Partner `zones` by matching names. Build an explicit reviewed mapping from legacy Zone document IDs to canonical `service_zones/{zoneId}`.

- Partner profile stores canonical `serviceZoneId` and only necessary display/parent references.
- Customer booking request sends selected Zone as a hint; backend resolves service coverage from trusted location and active canonical Zone data.
- Server produces one canonical schedule representation; adapter maps existing `scheduledAt`, `preferredTime`, `walkSchedules`, optional `dateSchedules` to Partner's current `date` / `startTime` needs.
- Booking and Walk Task remain separate identities; one Walk Task per scheduled occurrence.
- Assignment must be a trusted atomic callable with Walker eligibility, Zone compatibility, schedule/capacity conflict, concurrency, idempotency, audit, and reassignment checks.
- Restrict legacy direct client writes only after supported app versions have migrated and rollback is tested.

## 9. CI and evidence requirements

Required CI sequence:
1. formatting/lint/typecheck;
2. schema unit tests;
3. geometry and hash unit tests;
4. Functions authorization/callable Emulator tests;
5. Firestore Rules Emulator tests;
6. transaction/idempotency/concurrency tests;
7. legacy compatibility tests;
8. Functions build and deployment-manifest inspection (build only; no deploy).

Each phase records commit SHA, changed files, exact command/workflow run, test totals, failures, and fetch-back SHA. Never label source inspection as Emulator PASS.

## 10. Release and safety gates

No production deployment, role provisioning, data migration, Zone activation, legacy collection deletion, or PR merge is authorized by this plan. Each requires separate evidence and Founder approval.

Implementation PR must remain Draft until:
- all required Emulator tests pass;
- exact deployed Functions/Rules inventory is reconciled;
- Admin client and backend callable contracts match;
- security review confirms role separation and no privilege escalation;
- Partner/Customer compatibility strategy is tested;
- Notion task evidence is updated and fetch-back verified.

## 11. Phase 0 outcome and immediate next execution task

Phase 0 source inspection is recorded in `docs/implementation/ZONE_PHASE_0_SOURCE_ENVIRONMENT_FREEZE_2026-11-03.md`. The report pins the Admin/Firebase source refs and blob SHAs, confirms the current callable/Rules mismatch, records emulator commands/configuration, and identifies the live Founder identity/deployment checks that cannot be verified from repository source.

### Phase 1 execution result — 2026-11-03

- Exact tested head: `b1f5bd28f1ff3ae1c58ef6a5446dcd7bb627e884`.
- Four workflows succeeded: [Test Firestore Security Rules](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41628633136), [Firestore Rules Tests](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41628632914), [Firebase Storage Rules Tests](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41628632932), and [Trusted Location Geometry and Callable Tests](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41628633037).
- Combined test summary: root Rules suite 50 total / 40 passed / 0 failed / 10 TODO; Functions suite 279 passed / 0 failed.
- The 10 TODO entries are unimplemented Zone callable/lifecycle acceptance gates. Current Rules deny client writes to the five canonical Zone collections for synthetic actors; no trusted Zone lifecycle callable is implemented or proven.
- PR #64 remains Open / Draft / Unmerged. No production deployment, role provisioning, merge, migration, or Zone activation occurred.

### Phase 2 entry gate — before trusted callable implementation

Founder decisions recorded on 2026-11-03:

- **Routine Zone deactivation:** Central Admin may submit a deactivation request; only the Founder may approve it. The Zone is deactivated only after the explicit Founder approval decision is recorded by the trusted backend. Central Admin cannot independently complete routine deactivation.
- **Emergency Zone suspension:** approved as a separate immediate safety action. An authorized Central Admin may temporarily suspend a Zone immediately when an emergency or safety risk requires it. The suspension must create an auditable event recording the Zone, actor, reason, and timestamp, and trigger immediate notification to the Founder. Emergency suspension is not routine deactivation and does not bypass the Founder approval required for routine deactivation.
- **Scope boundary:** suspension blocks new booking eligibility for the affected Zone. Existing in-progress walks must continue through the separate emergency, handover, and safety workflow; suspension must not silently cancel or terminate a running walk.

Remaining policy/authority gates:

1. Confirm boundary geometry read visibility by role/scope.
2. Securely verify the actual Founder authority document schema and controlled bootstrap/recovery process; never commit real UID or credentials.
3. Confirm legacy Partner `zones` mapping/cutover approach before any migration or client compatibility changes.
4. Define technical notification delivery/retry/escalation details during callable design while preserving the approved requirement that Founder notification is immediate; do not weaken this to a periodic digest.

The three previously Founder-approved defaults in Section 2 and both lifecycle decisions above are fixed; do not reopen them. Build only isolated synthetic test infrastructure while the remaining gates are open; keep runtime deployment, real role provisioning, Admin UI enablement, PR merge, and Zone activation blocked.


### Phase 2 harness design — 2026-11-03

- Added `docs/implementation/ZONE_PHASE_2_AUTH_FUNCTIONS_EMULATOR_HARNESS_2026-11-03.md` as a design-only specification for synthetic Auth + Functions + Firestore Emulator testing.
- Defines isolated emulator topology, synthetic actor fixtures, callable-level assertions, Emergency Suspension safety/notification acceptance matrix, routine deactivation separation tests, revision/idempotency/concurrency checks, and evidence requirements.
- This is a test design artifact only. No Zone lifecycle callable or runtime behavior was implemented in this step. Existing open gates remain: boundary geometry read visibility, verified Founder authority schema/bootstrap, and legacy Partner `zones` mapping/cutover. Notification transport/retry/escalation mechanics remain to be designed without weakening immediate Founder notification.
- No production deployment, real role provisioning, migration, PR merge, Admin UI enablement, or Zone activation.


### Phase 2 executable fixture scaffold — 2026-11-03

- Added `functions/test/zone_emulator_harness.test.cjs`: provisions deterministic synthetic Auth identities, writes fixture-only Founder/Admin authority documents to the Firestore Emulator, signs in via the Auth Emulator without custom role claims, checks fixture isolation, and cleans up synthetic records.
- Added root command `npm run test:zone-emulator`; it builds Functions and runs the fixture smoke test under Auth, Functions, and Firestore Emulators using only `demo-dojo-zone-lifecycle`.
- Added `.github/workflows/zone-auth-functions-emulator.yml` to run this isolated fixture suite on relevant pull-request changes and manual dispatch.
- This is executable test scaffolding only. No Zone lifecycle callable has been added or invoked; the 10 callable/lifecycle TODOs remain TODO. The workflow must complete successfully on the exact latest head before fixture setup can be marked verified.
- Remaining blockers and release restrictions are unchanged. No production project, real Founder UID, role provisioning, migration, merge, deployment, Admin UI enablement, or Zone activation.


### Boundary geometry read-visibility decision draft — 2026-11-03

- Added `docs/decisions/ZONE_BOUNDARY_GEOMETRY_READ_VISIBILITY_DECISION_2026-11-03.md`.
- Recommendation: Founder and explicitly authorized Central Admin may read all Zone geometry; designated reviewer only assigned review items; submitter only own draft; City/Area Manager and Supervisor read-only within active assigned scope; Walker/Partner and Customer do not receive raw polygon geometry; backend resolves coverage.
- Includes scoped-read security requirements and Emulator acceptance tests for direct document reads, list/query bypass, guessed IDs, scope revocation, reviewer self-review, and role denial.
- **Pending Founder approval.** This is documentation only; no Firestore Rules, roles, callables, UI, or production access changed. Do not implement the read matrix until approved.
