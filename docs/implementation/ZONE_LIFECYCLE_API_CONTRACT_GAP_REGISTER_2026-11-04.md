# DOJO WALK — Zone Lifecycle API Contract Gap Register

Date: 2026-11-04  
Status: Documentation-only audit; **not an executable API contract and not implementation authorization**.  
Base: `implementation/zone-emulator-first-plan-2026-11-03` at `c4d7a6facb08cdd738534371c5af01ad2735fcf4`.

## 1. Purpose

This register records what the current Admin client, Firebase source, synthetic fixtures, approved decisions, and existing tests actually establish. It prevents the next acceptance-test phase from inventing request fields, document paths, status enums, revision semantics, or idempotency behavior.

The next implementation gate remains: finalize one canonical, versioned Zone lifecycle API contract; then write and execute the ten synthetic Emulator acceptance tests; only after those tests exist and run may trusted Rules/Functions implementation begin.

No runtime code, Firestore Rules, indexes, production records, roles, app behavior, deployment, migration, activation, or merge to `main` is authorized by this document.

## 2. Pinned source evidence

| Source | Ref / SHA | What it establishes |
|---|---|---|
| Firebase Functions entry point | integration branch `functions/src/index.ts` (source inspected 2026-11-04) | Existing exports include legacy City/Area callables and assignment/visibility callables; the ten canonical lifecycle callables are not implemented/exported. |
| Firebase assignment callable tests | `functions/test/zone_assignment_writers_callable.test.cjs`, blob `803a0e2a471155caead4debaa263cf70d46bf13f` | Synthetic authority/assignment fixtures and several canonical Zone/Boundary field spellings; these tests cover assignment writers, not lifecycle. |
| Firebase lifecycle Rules tests | `test/service_zones.rules.test.mjs`, blob `537a0519a3ab4cc8e124b7ca65af139fd04410c6` | Five canonical collections are client-write-denied; ten lifecycle gates remain `test.todo`. |
| Approved authority proposal | `docs/decisions/ZONE_VISIBILITY_AUTHORITY_AND_ASSIGNMENT_SCHEMA_PROPOSAL_2026-11-03.md`, blob `a3fb3854e5041027db4915117e1091bb5833b08d` | Approved visibility matrix, Founder allowlist concept, assignments, reviewer separation, and migration guardrails. |
| Emulator-first plan | `docs/implementation/ZONE_EMULATOR_FIRST_IMPLEMENTATION_PLAN_2026-11-03.md`, blob `d1cc0136d5ff0ce9dba29d03e24529781ea403a7` | Approved lifecycle semantics, required callable inventory, test-first and release gates. |
| Canonical integration contract | `docs/architecture/DOJO_WALK_CANONICAL_ZONE_BOOKING_INTEGRATION_CONTRACT.md`, blob `c7bf9186225e443bbb40b33618c41f4ff374ecfc` | Explicitly labels target collection/fields and approval path as proposed pending schema review. |
| Admin Zone workflow service | Admin ref `ui/notion-brand-foundation-2026-10-28`, blob `77c0f290b764f781aa7fcc672c4ff5d1ec49f6cf` | Existing UI wrapper payloads and the current direct-write boundary draft path; this is a client contract snapshot, not proof of backend support. |

## 3. Existing Admin client request shapes (observed, not endorsed)

The Admin service currently sends these payloads:

| Client action | Callable / write | Observed payload |
|---|---|---|
| Save Zone draft | `saveServiceLocationWithNameIndex` | `{ locationType: "zone", locationId?, payload: { stateId, districtId, cityId, name } }` |
| Create boundary draft | Direct Firestore `service_location_boundaries.add` | `{ locationId, locationType:"zone", points, sourceType, sourceName, sourceReference, verificationStatus:"pending", createdAt, updatedAt }` |
| Submit for Founder review | `submitServiceZoneForFounderReview` | `{ zoneId }` |
| Review boundary | `reviewServiceLocationBoundary` | `{ boundaryId, decision:"verified"|"rejected", notes }` |
| Founder decision | `decideServiceZoneFounderApproval` | `{ zoneId, decision, notes }`; client decisions include `approve`, `reject`, `changes_required`, `deactivate`, `reactivate` |
| Activate | `activateServiceZone` | `{ zoneId }` |
| Request routine deactivation | `requestServiceZoneDeactivation` | `{ zoneId, notes }` |
| Legacy deactivation path | `setServiceLocationStatus` | `{ locationType:"zone", locationId:zoneId, isActive:false }` |
| Emergency suspension | `suspendServiceZoneForEmergency` | `{ zoneId, reason, severity:"SEV-1"|"SEV-2"|"SEV-3"|"SEV-4" }` |
| Request reactivation | `requestServiceZoneReactivation` | `{ zoneId, reason }` |

Important: the client wrapper calls names that are absent from the inspected Functions exports. Its payloads therefore do not establish callable behavior. The boundary draft is currently a direct client write, while the approved implementation plan requires canonical Zone lifecycle writes to be server-owned. The legacy `reviewServiceLocationBoundary`, `activateServiceLocation`, `saveServiceLocationWithNameIndex`, and `setServiceLocationStatus` must not be assumed to support canonical Zone lifecycle semantics.

The Admin wrapper does not expose a dedicated `createServiceZoneDraft`, `createServiceZoneBoundaryDraft`, or `reactivateServiceZone` method. These are contract mismatches to resolve, not reasons to silently reuse legacy callables.

## 4. Observed schema spelling conflicts — canonical choice still blocked

The current sources use overlapping but non-identical field names:

| Concept | Observed spellings | Why this is unresolved |
|---|---|---|
| Zone status | `status`, `workflowStatus`, `isServiceActive` | Status lifecycle enum and the relationship between workflow state and booking eligibility are not pinned. |
| Boundary hash | Zone `boundaryHash`; Boundary `geometryHash`; Admin read model `submittedBoundaryHash` / `approvedBoundaryHash` | No canonical hash field, canonicalization version, or authoritative storage location is selected. |
| Boundary revision | Zone `verifiedBoundaryRevision`; Boundary `revision` and `zoneRevision`; Admin read model `revision` | It is unclear whether these represent Zone config revision, boundary document revision, or the revision the boundary belongs to. |
| Boundary ownership | `locationType:"zone"` + `locationId`; or `zoneId` | Canonical ownership tuple and compatibility rules are not frozen. |
| Verification state | `verificationStatus`; Admin read model exposes Zone-level verified/approved fields | Boundary review result and Zone workflow state must be separate, with a defined binding between them. |
| Approval | Proposal says exact Zone/revision/hash/request type; Admin payload sends only `zoneId` + decision + notes | Backend must resolve and persist an immutable exact approval tuple; request payload alone is insufficient. |
| Name uniqueness | Plan requires normalized name unique within City | Normalization algorithm, Unicode policy, index document ID/key, rename transaction and collision response are not specified. |

The assignment test fixtures demonstrate useful synthetic examples, but fixture spellings are not sufficient authority to choose production schema. In particular, a test fixture containing `status:"active"` and `isServiceActive:true` does not settle the lifecycle state machine.

## 5. Approved semantic invariants (fixed; do not reopen)

1. Hierarchy is State/UT → District → City → Zone; Zone is the only service activation unit.
2. Founder/CEO and Central Admin can view all Zones; City Manager sees only Zones in their assigned City; Supervisor and Walker see only their active assigned Zone(s); reviewer sees only assigned review item(s); Customer sees no raw polygon.
3. Visibility does not grant mutation, review, approval, activation, deactivation, or suspension authority.
4. Founder authority is an active explicit `founder_users/{uid}` allowlist record. Never infer it from email, display name, custom claims alone, or legacy `super_admin`.
5. Central Admin requires active membership and explicit operational permission; legacy `super_admin` alone is not Central Admin or Founder.
6. Boundary submitter cannot review their own submission. Reviewer requires active Admin membership, explicit boundary-review permission, and exact review assignment.
7. Founder approval is bound to the exact Zone ID + Zone revision + Boundary ID + canonical Boundary hash + request type.
8. Activation re-reads and validates current Zone, parent references, verified Boundary and exact current Founder approval transactionally.
9. New Boundary revision invalidates old approval.
10. Routine deactivation is requested by Central Admin and completed only after explicit Founder approval.
11. Emergency suspension is a separate immediate Central Admin safety action, with auditable actor/reason/time and immediate Founder notification; it blocks new bookings but does not terminate an in-progress walk.
12. Same normalized Zone name is unique within one City; the same normalized name is allowed in another City.
13. Idempotent retry by same actor + operation + request ID + same payload returns the original result; same request ID with a different payload fingerprint is rejected.
14. Concurrent activation yields one valid transition and one safe conflict.
15. Synthetic Emulator tests precede trusted Functions/Rules implementation. Production provisioning, deployment, migration, activation, PR merge and `main` changes remain separately gated.

## 6. Contract decisions still required before executable lifecycle tests

These are implementation-contract blockers, not new product-policy questions:

### 6.1 Callable request/response envelope
- Whether all ten callables accept a common `requestId` / `expectedRevision` envelope, and exact names/types/limits.
- Whether create operations accept caller-provided stable IDs or generate IDs server-side.
- Exact success response fields, error-code mapping, replay response shape, and conflict response shape.
- Strict unknown-field rejection and maximum payload sizes.

### 6.2 Canonical Zone and Boundary documents
- Final Zone fields, including canonical lifecycle status enum and separate booking-eligibility boolean/derivation.
- Final Boundary fields, ownership tuple, immutable submission evidence, verification metadata and revision relationship.
- Canonical geometry representation and SHA-256 byte serialization, coordinate order, numeric precision, ring closure, and canonicalization version.
- Whether Zone revision increments on every configuration edit, boundary submission, approval, activation, suspension, deactivation and reactivation, or only on defined configuration changes.

### 6.3 Approval request and state machine
- Exact collection path and document ID strategy for Founder approval requests.
- Exact approval request type enum and decision enum; clarify how `changes_required`, rejection, routine deactivation and reactivation differ.
- Whether approval requests are one-shot, supersedable, revocable, or versioned; exact duplicate-decision behavior.
- State transition table for draft → boundary pending/reviewed → Founder pending/decided → active/inactive/suspended → reactivation pending/reactivated.
- Explicit distinction between boundary reviewer action and Founder business decision.

### 6.4 Name index and idempotency
- Exact name-index collection path/key format and normalization algorithm.
- Atomic create/rename/release behavior and conflict semantics.
- Exact idempotency collection path, document key, payload fingerprint algorithm, retention period and replay behavior.
- Whether request IDs are unique per actor+operation or globally unique.

### 6.5 Emergency notification
- Delivery channel(s), notification record path, provider abstraction, retry schedule, escalation/dead-letter behavior, and what constitutes acknowledged notification.
- Preserve the already-approved immediate Founder notification requirement; technical delivery failure must create an auditable retry/escalation condition and must not silently downgrade to a digest.

### 6.6 Compatibility and Admin client
- Replace direct Zone Boundary draft writes with the approved trusted callable path before enabling UI actions.
- Replace legacy City/Area callables for Zone lifecycle; do not overload them.
- Align Admin read model fields with the final backend schema.
- Confirm whether legacy `setServiceLocationStatus` remains City/Area-only and remove Zone use from this wrapper.

## 7. Ten required Emulator acceptance tests

The existing ten `test.todo` gates remain the acceptance baseline. Replace each TODO with executable positive and negative tests only after Sections 6.1–6.6 are resolved:

1. Central Admin with Zone-operation permission can create a Zone draft; missing/inactive permission is denied.
2. Central Admin without boundary-review permission cannot review a boundary.
3. Boundary submitter cannot review their own submitted boundary, even if assigned.
4. Active Founder allowlist UID can decide only the exact current approval request tuple.
5. Legacy `super_admin` without Founder/Central authority cannot approve or activate.
6. City Manager lifecycle/read scope is limited to assigned City; cross-City request is denied.
7. Same normalized Zone name is rejected within one City but allowed in another City.
8. Stale Boundary revision/hash cannot be approved or activated; changed Boundary invalidates old approval.
9. Same idempotency request and payload replays original result; changed payload under same request ID is rejected.
10. Concurrent activation attempts produce exactly one valid state transition, with the loser receiving a safe conflict/replay result.

Tests must use deterministic synthetic Auth UIDs and Emulator-only Firestore documents. The harness must fail closed unless project ID begins `demo-`, Auth and Firestore Emulator hosts are set, and the production project `dojo-platform-b68a3` is explicitly rejected.

## 8. Recommended order of work

1. Resolve and record the API/schema decisions in Sections 6.1–6.6.
2. Add a single canonical contract document with exact callable input/output schemas, collection schemas, enums, transition table, hash and idempotency algorithms.
3. Generate synthetic fixtures directly from that contract.
4. Replace the ten TODOs with callable Emulator tests and run them against the current missing-endpoint baseline. Record expected `not-found` failures separately from harness failures.
5. Only after tests are executable and their baseline is captured, implement Functions/Rules on a dedicated branch.
6. Keep Admin buttons disabled until backend tests and Admin↔Firebase contract tests pass.

## 9. Explicit non-effects

This register does not select unresolved field names or state enums, implement or export callables, change Rules, create production documents, provision real users, migrate legacy data, enable Admin UI, activate Zones, deploy, merge PRs, or change `main`.


## 10. Reconciliation with the deeper Phase 1 / Phase 2 plans

A second pass against `ZONE_EMULATOR_FIRST_IMPLEMENTATION_PLAN_2026-11-03.md` (blob `d1cc0136d5ff0ce9dba29d03e24529781ea403a7`) and `ZONE_PHASE_2_AUTH_FUNCTIONS_EMULATOR_HARNESS_2026-11-03.md` (blob `a2631beb19b39d8d54a8e1dc09d8308c3e408d37`) narrows several gaps. These items are already specified at the semantic/algorithm level and must not be re-opened as blank decisions:

### 10.1 Already pinned by the implementation plan

- Every state-changing callable validates an expected revision and an idempotency key, in addition to authentication, authoritative role record, strict allowlisted payload, parent IDs and transaction preconditions.
- Geometry hash algorithm family is SHA-256 over canonical ordered longitude/latitude pairs, computed server-side. It is **not** a hash of arbitrary Firestore serialization.
- Boundary draft evidence becomes immutable after submission; corrections create a new Boundary document.
- A new Boundary revision increments the Zone revision and clears current approval references.
- Name-index reservation, Zone creation, and rename/release are transactional; same normalized name is unique within City only.
- State transition, revision, audit event and idempotency result commit atomically.
- A successful Founder approval is exact to Zone ID + revision + Boundary ID + Boundary hash + request type.
- Routine deactivation requires a Central Admin request followed by Founder approval. Emergency suspension is immediate, separate, blocks new booking eligibility, and does not terminate an in-progress walk.
- Emergency suspension must durably record an immediate Founder notification request. Delivery failure must remain observable, retryable and escalated; it cannot be silently dropped or downgraded to a digest.
- Emulator callable tests must assert both callable response/error and resulting Firestore state/audit evidence. An expected denial is not sufficient if protected state is not also proven unchanged.

### 10.2 Remaining precision gaps (do not overstate as wholly unspecified)

| Area | Already fixed | Still needs exact contract detail |
|---|---|---|
| Expected revision | Required on state-changing callables; transaction preconditions | Exact field name/type for each callable, whether create uses an explicit absent/zero sentinel, and response revision shape |
| Idempotency | Actor + operation + request ID + same payload replays; conflicting payload fails; atomic persistence | Exact request field name, document path/key, fingerprint canonicalization, retention and response replay envelope |
| Geometry hash | Server SHA-256 over canonical ordered longitude/latitude pairs | Coordinate numeric precision/serialization, ring closure and hole policy, orientation/start-vertex normalization, canonicalization version |
| Boundary revisions | New submitted Boundary creates a new revision and invalidates approval | Exact distinction among Zone revision, Boundary revision, and Boundary's bound Zone revision fields |
| Name uniqueness | Normalized key scoped to City; transactional reservation/release | Exact Unicode normalization/case-fold/whitespace algorithm, index path/key, collision error code |
| Approval | Exact tuple and distinct reviewer vs Founder roles | Approval collection path/ID, request type and decision enums, supersede/revoke rules, exact duplicate-decision behavior |
| Lifecycle | Routine deactivation, emergency suspension and reactivation are distinct | Complete canonical status enum/table and precise allowed transitions, including whether a rejected request leaves Zone state unchanged |
| Notification | Immediate durable notification request; observable retry/escalation | Provider/transport, outbox document schema, retry schedule, escalation owner and acknowledgement definition |
| API envelope | All state-changing calls require expected revision and idempotency key | Common vs per-call request envelope, stable ID generation, success/error response fields and strict unknown-field handling |

### 10.3 Current test reality (reconfirmed)

The current `test/service_zones.rules.test.mjs` blob `537a0519a3ab4cc8e124b7ca65af139fd04410c6` contains five server-write-only collection checks and exactly ten `test.todo` entries. It does not yet exercise lifecycle callable behavior. The Functions assignment-writer suite and the Phase 2 fixture smoke suite are separate tests; neither substitutes for those ten lifecycle acceptance gates.

The Phase 2 fixture smoke test uses synthetic Auth identities and fixture-only authority documents, but does not call lifecycle endpoints. The callable-presence baseline PR #68 is an additional inventory test that expects `functions/not-found` for the ten missing endpoint names; it is not a lifecycle acceptance test.

## 11. Updated safe next step

The remaining work is now a **contract freeze**, not further broad discovery. Produce a versioned API contract draft that:
1. carries forward every fixed semantic and algorithmic requirement in Section 10.1;
2. selects explicit field names, document paths, enums, error codes and canonicalization details only where the source evidence supports them;
3. clearly labels any still-open product/security decision rather than silently selecting it;
4. aligns the Admin wrapper to the approved canonical API as a later, separately tested integration change.

Do not implement lifecycle Functions/Rules or enable Admin UI actions until the exact contract is reviewed and the ten synthetic callable acceptance tests are written and run.
