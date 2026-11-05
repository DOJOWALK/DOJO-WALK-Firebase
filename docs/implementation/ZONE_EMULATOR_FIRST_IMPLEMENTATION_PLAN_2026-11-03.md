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

Boundary geometry read visibility was explicitly approved on 2026-11-03 and is recorded in `docs/decisions/ZONE_BOUNDARY_GEOMETRY_READ_VISIBILITY_DECISION_2026-11-03.md`. The remaining work is to verify actual production authority and assignment schemas, then implement and test the approved scope. Routine deactivation authority and emergency suspension authority/Founder-notification requirements were also approved. Technical notification delivery/retry/escalation mechanics remain an implementation-design item, not a reason to weaken immediate Founder notification.

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

1. Implement the Founder-approved boundary geometry visibility matrix as executable Rules/Functions Emulator tests.
2. Securely verify the actual Founder authority document schema and controlled bootstrap/recovery process; never commit real UID or credentials.
3. Confirm legacy Partner `zones` mapping/cutover approach before any migration or client compatibility changes.
4. Define technical notification delivery/retry/escalation details during callable design while preserving the approved requirement that Founder notification is immediate; do not weaken this to a periodic digest.

The three previously Founder-approved defaults in Section 2 and both lifecycle decisions above are fixed; do not reopen them. Build only isolated synthetic test infrastructure while the remaining gates are open; keep runtime deployment, real role provisioning, Admin UI enablement, PR merge, and Zone activation blocked.


### Phase 2 harness design — 2026-11-03

- Added `docs/implementation/ZONE_PHASE_2_AUTH_FUNCTIONS_EMULATOR_HARNESS_2026-11-03.md` as a design-only specification for synthetic Auth + Functions + Firestore Emulator testing.
- Defines isolated emulator topology, synthetic actor fixtures, callable-level assertions, Emergency Suspension safety/notification acceptance matrix, routine deactivation separation tests, revision/idempotency/concurrency checks, and evidence requirements.
- This is a test design artifact only. No Zone lifecycle callable or runtime behavior was implemented in this step. Boundary geometry read visibility has since been Founder-approved. Remaining gates are verified Founder authority schema/bootstrap, Manager/Supervisor/Walker trusted assignment schema, and legacy Partner `zones` mapping/cutover. Notification transport/retry/escalation mechanics remain to be designed without weakening immediate Founder notification.
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


### Founder-approved boundary geometry visibility policy — 2026-11-03

- Founder approved: Founder/CEO and Central Admin can view all Zone boundaries; City Manager can view all Zones in their assigned City only; Supervisor and Walker can view only their own assigned Zone(s), read-only; Customer receives no Zone map or raw polygon.
- Boundary Reviewer remains limited to specifically assigned review items with explicit review permission; submitter self-review remains prohibited. Draft submitter may read only own draft.
- Visibility is not operational authority: Manager/Supervisor/Walker read-only; no implied edit, review, approval, activation, deactivation, or suspension rights.
- Decision recorded in `docs/decisions/ZONE_BOUNDARY_GEOMETRY_READ_VISIBILITY_DECISION_2026-11-03.md`.
- Founder approved the authority/assignment schema proposal on 2026-11-03. Synthetic acceptance tests were built and run before Rules/Functions implementation.
- Scoped read callables and client Rules protections are now implemented on this branch. Exact-head Emulator results are recorded in `docs/implementation/ZONE_VISIBILITY_SYNTHETIC_EMULATOR_ACCEPTANCE_REPORT_2026-11-03.md`.
- Verified code head `35a3def2d1a91bcedd1fefb9fa43436a26991ada`: all five GitHub Actions workflows SUCCESS; Firestore Rules 73 total / 63 passed / 0 failed / 10 pre-existing TODO; Functions 291 passed / 0 failed; callable visibility suite 12/12 passed.
- Production authority bootstrap, real assignment data, legacy Partner mapping, Admin/Partner consumer integration, remaining Zone lifecycle tests, merge, deployment, migration, and Zone activation remain gated.


### Approved visibility source/schema audit — 2026-11-03

- Source audit: `docs/implementation/ZONE_VISIBILITY_SOURCE_SCHEMA_AUDIT_2026-11-03.md`.
- Verified current mismatch: existing `isAdmin()` and legacy boundary reads are `super_admin`-only; existing Admin role allowlist does not include `central_admin`; Functions entry point has only five legacy callable exports and no Zone lifecycle/read API.
- Partner onboarding writes applicant-selected legacy `zoneName`, `zoneNames`, and `zones` IDs into the walker's own profile. Those fields are user-editable preferences, not trusted assignments and must not authorize geometry.
- Production Founder schema/bootstrap and City Manager/Supervisor/Walker authoritative assignment records remain unverified. The synthetic Phase 2 fixture schema is not a production contract.
- Founder approved the schema proposal. Synthetic tests now exist and have been executed. Rules/Functions read-visibility implementation was added only after that test-first gate.
- Production Founder bootstrap and City Manager/Supervisor/Walker assignment writer/revocation workflows remain unverified. Do not provision real roles or migrate legacy data until those workflows are designed and reviewed.


### Authority and operational assignment schema proposal — 2026-11-03

- Added Founder-review proposal: `docs/decisions/ZONE_VISIBILITY_AUTHORITY_AND_ASSIGNMENT_SCHEMA_PROPOSAL_2026-11-03.md`.
- Proposed trusted records: `founder_users/{uid}`; explicit Central Admin permissions in `admin_users/{uid}`; server-owned `admin_scope_assignments` for City Manager / Supervisor; server-owned `walker_zone_assignments`; and `zone_boundary_review_assignments`.
- Recommended read architecture: trusted callable list/get endpoints, with direct client raw-boundary reads denied. The callable must re-read current authority/scope on every request; no authorization from profile preferences or client claims.
- **Founder approval recorded 2026-11-03.** The proposal is approved for synthetic test-first implementation. The current branch now contains scoped read callables and direct-client Rules protections; no production roles, data, Apps, deployment, or activation were changed.


### Visibility implementation and exact-head Emulator verification — 2026-11-03

- Implementation: `listVisibleServiceZones` and `getVisibleServiceZoneBoundary` in `functions/src/index.ts`; direct client access to canonical Zone aggregates, Zone boundary geometry, Founder/assignment records, and Zone audit records denied in `firestore.rules`.
- Role authority is re-resolved from active server records on every callable request. Legacy `super_admin` does not imply Zone visibility. City Manager is City-scoped; Supervisor and Walker are assignment-scoped; reviewer and submitter are exact-boundary scoped; Customer is denied.
- Geometry reads are audited in `service_zone_audit` without storing polygon coordinates. Zone metadata list responses do not include geometry.
- Exact tested code head: `35a3def2d1a91bcedd1fefb9fa43436a26991ada`.
- PASS workflows: Test Firestore Security Rules `41657817742`; Firestore Rules Tests `41657817801`; Firebase Storage Rules Tests `41657817694`; Trusted Location Geometry and Callable Tests `41657817674`; Zone Auth and Functions Emulator Fixtures `41657817770`.
- Counts: Firestore Rules 73 total / 63 PASS / 0 FAIL / 10 TODO (pre-existing lifecycle gates); Functions 291 PASS / 0 FAIL; callable visibility suite 12 PASS / 0 FAIL.
- PR #64 remains Draft / Unmerged. No production deployment, role provisioning, legacy migration, Admin UI enablement, or Zone activation.


### Final expanded visibility regression gate — 2026-11-03

- Final tested code/test SHA: `651825cfe09193f9aff5ee138683cf572b0c7422`.
- Expanded callable coverage now verifies inactive Central Admin, permission revocation, reviewer self-review denial, and stale verified-boundary revision rejection.
- All five workflows PASS on the exact final tested head:
  - Test Firestore Security Rules: `41659707637`
  - Firestore Rules Tests: `41659707626`
  - Firebase Storage Rules Tests: `41659707653`
  - Trusted Location Geometry and Callable Tests: `41659707644`
  - Zone Auth and Functions Emulator Fixtures: `41659707662`
- Final counts: Firestore Rules 73 total / 63 PASS / 0 FAIL / 10 pre-existing TODO; Functions 292 PASS / 0 FAIL; Auth + Functions fixture workflow 13 total PASS (2 fixture bootstrap + 11 callable visibility) / 0 FAIL; Functions build PASS; Storage Rules PASS.
- This final exact-head result supersedes the earlier 35a3 code-head verification above. Full evidence: `docs/implementation/ZONE_VISIBILITY_SYNTHETIC_EMULATOR_ACCEPTANCE_REPORT_2026-11-03.md`.
- PR #64 remains Draft / Open / Unmerged. Production Founder bootstrap, real assignment records, Partner legacy mapping, remaining Zone lifecycle TODOs, Admin/Partner consumer integration, release review, deployment, and Zone activation remain gated.


### Next backend gate — assignment writer authority audit (2026-11-03)

- Source audit confirms the current Functions exports only the two Zone visibility read callables for this feature; no trusted assignment create/transfer/revoke or operational Admin role grant/revoke callables exist yet.
- The approved schema establishes server-owned assignment collections, but does not fully specify which human operational role may mutate each assignment type.
- Cross-check of POL-037 and POL-004 confirms the governance principles (Founder approves senior appointments; Central Operations owns national assignment configuration; City Manager oversees assigned City's Zones; Supervisor is Zone-scoped) but those Notion policies are still DRAFT and do not define an executable permission matrix.
- Created `docs/implementation/ZONE_ASSIGNMENT_WRITER_AUTHORITY_GAP_AUDIT_2026-11-03.md` with source evidence, a proposed writer authority matrix, and a 12-case synthetic acceptance matrix.
- **No assignment writer tests or runtime mutation callables were added in this gate.** Positive-path tests depend on confirmation of the exact mutation actors; implementing an assumed authority matrix could accidentally grant privilege.
- Next: Founder confirms or edits the matrix in the audit, then synthetic assignment-writer Emulator tests are authored and run before any new writer Rules/Functions code.
- No production records, role grants, migration, merge, deployment, Admin/Partner app changes, or Zone activation.


### Final assignment lifecycle hardening — 2026-11-03

- Final tested implementation/test SHA: `ecba60fee042449cac8179a81c7907847f63c84b`.
- Added and passed negative tests for inactive reviewer assignments and expired Supervisor assignments.
- All five workflows PASS: Firestore Rules Tests `41661097531`; Firebase Storage Rules Tests `41661097545`; Test Firestore Security Rules `41661097557`; Trusted Location Geometry and Callable Tests `41661097552`; Zone Auth and Functions Emulator Fixtures `41661097573`.
- Counts: Firestore Rules 73 total / 63 PASS / 0 FAIL / 10 pre-existing TODO; Functions 292 PASS / 0 FAIL; Auth + Functions fixture workflow 13/13 PASS (2 fixture bootstrap + 11 callable visibility); Functions build PASS; Storage Rules PASS.
- This exact-head verification supersedes the previous 651825 code-head result. Full details are in the synthetic acceptance report.
- PR #64 remains Draft / Open / Unmerged. Production Founder bootstrap, real assignments, legacy Partner mapping, remaining lifecycle TODOs, Admin/Partner consumer integration, release review, deployment, and Zone activation remain gated.
