# DOJO WALK — Zone Emulator-First Implementation Plan

Date: 2026-11-03
Status: Implementation plan only — no runtime code, Rules, schema, data, roles, deployment, or production changes.
Parent contract: `docs/architecture/DOJO_WALK_CANONICAL_ZONE_BOOKING_INTEGRATION_CONTRACT.md`
Working branch: `implementation/zone-emulator-first-plan-2026-11-03`

## 1. Objective

Implement the canonical Zone lifecycle safely, beginning with executable Emulator tests and only then adding trusted Firebase Functions/Firestore Rules. Admin UI actions remain disabled until the backend contract passes. Partner and Customer migration is a later compatibility phase.

This plan does not authorize production deployment, Zone activation, role grants, migration/deletion of legacy collections, or PR merge.

## 2. Working defaults to validate before implementation

These defaults are the recommended design choices carried forward for implementation planning. Treat them as pending explicit Founder confirmation if they differ from an already-recorded governance decision:

1. **Zone-name uniqueness:** unique within the selected City. Same normalized name may exist in another City.
2. **Boundary review:** a designated Central Admin reviewer with an explicit boundary-review permission. The submitter cannot review their own boundary. Founder performs final business approval, not routine geometry review.
3. **Founder identity:** an explicit active `founder_users/{uid}` allowlist record provisioned through a separately controlled, audited bootstrap/recovery process. Never infer Founder from email, display name, `super_admin`, or client claims. The exact initial UID and recovery custodians must be verified from Firebase Auth/admin records before any role provisioning.

Additional policy gates still requiring a recorded decision: deactivation approval threshold, emergency suspension notification SLA, and boundary read visibility.

## 3. Phase 0 — source and environment freeze

Before writing implementation code:

- Re-fetch the exact current Admin and Firebase source files and record blob SHAs.
- Confirm Firebase Functions v2 entry point, deployed region `asia-south1`, package scripts, Node/runtime version, Emulator Suite versions, and CI workflow commands.
- Inspect actual `admin_users`, Founder identity provisioning, and assignment/scope document schemas without exposing private credentials or personal data.
- Inventory all existing callable exports and Firestore match blocks; preserve legacy City/Area behavior.
- Confirm current branch/PR heads and keep implementation on a dedicated branch.
- Never read, print, copy, or commit service-account private keys or other secrets.

**Exit:** source SHA manifest and reproducible local/CI Emulator commands committed before implementation begins.

## 4. Phase 1 — write failing Emulator tests first

Create isolated test fixtures with synthetic UIDs and deterministic IDs. Tests must not depend on production records.

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

**Exit:** all tests exist and fail for the expected missing implementation reasons; test harness itself passes lint/type checks.

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

## 11. Immediate next execution task

Perform Phase 0 source/environment freeze and add Phase 1 failing test scaffolding on a dedicated implementation branch. Do not begin Functions/Rules implementation until test fixtures, role authority schema, and source SHA manifest are verified. Keep all work isolated from `main`.
