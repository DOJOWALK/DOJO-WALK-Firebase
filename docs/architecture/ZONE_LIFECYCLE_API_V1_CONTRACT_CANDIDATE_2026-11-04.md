# DOJO WALK — Zone Lifecycle API v1 Contract

Date: 2026-11-04\
Status: **Founder approved for synthetic Emulator acceptance-test freeze only**\
Approval scope: Contract fields, callable names, workflow statuses, geometry canonicalization and explicit `zoneEmergencySuspend` permission are approved as the test target. This is not approval to implement runtime Functions/Rules, merge, deploy, provision production authority, or modify `main`.

Parent: `docs/implementation/ZONE_LIFECYCLE_API_CONTRACT_GAP_REGISTER_2026-11-04.md`\
Base contract branch: `implementation/zone-emulator-first-plan-2026-11-03`

## 1. Purpose and boundary

This document is the frozen v1 contract target for the ten synthetic Emulator acceptance tests. It defines exact callable names, request fields, candidate document shapes, workflow states and canonicalization choices accepted by Founder for test authoring. The tests must not silently fork this contract.

The tests use only synthetic Firebase Auth identities and a Firebase `demo-*` Emulator project. They must assert callable outcomes and durable Firestore state, revision, audit and idempotency evidence where applicable.

## 2. Contract-wide callable envelope

**Request envelope for every state-changing callable:**

| Field | Type | Rule |
|---|---|---|
| `requestId` | string | Required; 1–128 chars; scoped to authenticated actor + callable operation |
| `expectedRevision` | integer | Required for an existing Zone; must equal current Zone revision at transaction commit |
| operation fields | allowlisted object fields | Strict validation; reject unknown fields |

- Actor UID comes only from verified Firebase Auth context.
- Idempotency identity is `actorUid + callableName + requestId`.
- Payload fingerprint is SHA-256 over a deterministic canonical representation of validated request fields, excluding transport metadata.
- Same identity + same fingerprint returns the stored original response; same identity + different fingerprint returns `already-exists`.
- Create Zone is the only operation without an existing Zone revision; `expectedRevision: 0` asserts absence.
- Successful state-changing responses use `{ ok: true, requestId, zoneId, revision, workflowStatus, replayed }`; create-boundary also returns `boundaryId`; approval/decision responses also return `approvalRequestId`.
- Error codes use Firebase callable canonical codes: `unauthenticated`, `permission-denied`, `invalid-argument`, `not-found`, `failed-precondition`, `already-exists`, `aborted`, `internal`.

## 3. Canonical callable API

| Callable | Authorized actor | Operation fields |
|---|---|---|
| `createServiceZoneDraft` | Active Central Admin + `zoneOperations` | `stateId, districtId, cityId, name`; `expectedRevision:0` |
| `createServiceZoneBoundaryDraft` | Active Central Admin + `zoneOperations` | `zoneId, points, sourceType, sourceName, sourceReference`; current Zone `expectedRevision` |
| `reviewServiceZoneBoundary` | Active assigned reviewer + `zoneBoundaryReview`; cannot be submitter | `zoneId, boundaryId, decision:"verified"|"rejected", notes`; current Zone `expectedRevision` |
| `submitServiceZoneForFounderReview` | Active Central Admin + `zoneOperations` | `zoneId, boundaryId`; current Zone `expectedRevision` |
| `decideServiceZoneFounderApproval` | Active Founder allowlist UID + `founderApproval` | `approvalRequestId, zoneId, revision, boundaryId, boundaryHash, requestType, decision, notes` |
| `activateServiceZone` | Active Central Admin + `zoneOperations` | `zoneId`; current Zone `expectedRevision` |
| `requestServiceZoneDeactivation` | Active Central Admin + `zoneOperations` | `zoneId, notes`; current Zone `expectedRevision` |
| `suspendServiceZoneForEmergency` | Active Central Admin + explicit `zoneEmergencySuspend` | `zoneId, reason, severity:"SEV-1"|"SEV-2"|"SEV-3"|"SEV-4"`; current Zone `expectedRevision` |
| `requestServiceZoneReactivation` | Active Central Admin + `zoneOperations` | `zoneId, reason`; current Zone `expectedRevision` |
| `reactivateServiceZone` | Active Central Admin + `zoneOperations` | `zoneId`; current Zone `expectedRevision` and exact Founder reactivation approval |

This is the canonical Zone API. Legacy City/Area callables `reviewServiceLocationBoundary` and `setServiceLocationStatus` do not authorize Zone lifecycle actions. Direct client Boundary writes remain denied.

## 4. Canonical document model

### 4.1 `service_zones/{zoneId}`

Fields: `schemaVersion` (1), immutable `stateId, districtId, cityId`, `name`, server-computed `normalizedName`, `workflowStatus`, server-authored `isServiceActive` (true only when status is `active`), monotonically increasing `revision`, `currentBoundaryId`, `verifiedBoundaryId`, `verifiedBoundaryRevision`, `verifiedBoundaryHash`, `approvedRevision`, `approvedBoundaryId`, `approvedBoundaryHash`, `approvedRequestId`, optional `suspensionReason, suspensionSeverity`, server-authored `createdBy, updatedBy, createdAt, updatedAt`.

### 4.2 `service_location_boundaries/{boundaryId}`

Fields: `locationType:"zone"`, `locationId` and `zoneId` (same canonical Zone ID), `zoneRevision`, monotonic per-Zone `revision`, ordered `points`, `sourceType` (`governmentGis`, `governmentCadastralMap`, `importedGeoJson`, `manuallyDrawn`), `sourceName, sourceReference`, `verificationStatus` (`pending|verified|rejected|superseded`), server SHA-256 `geometryHash`, `submittedBy, submittedAt, reviewedBy, reviewedAt, reviewNotes, createdAt, updatedAt`.

Submitted Boundary evidence is immutable. Corrections create a new Boundary document/revision. Client writes are denied; callable Admin SDK writes only.

### 4.3 `service_zone_approval_requests/{approvalRequestId}`

Fields: immutable exact tuple `zoneId, revision, boundaryId, boundaryHash`; `requestType` (`activation|routine_deactivation|reactivation`); `status` (`pending|approved|rejected|changes_required|superseded`); server-authored `requestedBy, requestedAt, decidedBy, decidedAt, decision, notes, createdAt, updatedAt`.

Only one pending request per Zone and request type. A newer relevant Zone/Boundary revision supersedes the old request and prevents its approval.

### 4.4 `service_zone_name_indexes/{indexId}`

Candidate ID: `{cityId}_{sha256(normalizedName)}`. Fields: `cityId, normalizedName, zoneId, createdAt, updatedAt`. Reservation and Zone create/rename commit atomically. Name normalization is Unicode NFKC, trim leading/trailing whitespace, collapse internal Unicode whitespace to one ASCII space, and locale-independent case-fold. Display name remains as entered after trim. Same normalized name is unique within City; identical name in another City is valid.

### 4.5 Idempotency, audit and notification

- `service_zone_idempotency/{recordId}`: SHA-256 of `actorUid|callableName|requestId`; fields `actorUid, callableName, requestId, payloadFingerprint, response, createdAt, expiresAt`; retention 90 days.
- `service_zone_audit/{eventId}`: append-only `zoneId, action, actorUid, actorAuthority, requestId, fromRevision, toRevision, fromStatus, toStatus, reason, createdAt`; no raw polygon coordinates or secrets.
- `service_zone_notification_outbox/{notificationId}`: durable `zoneId, eventId, recipientAuthority:"founder", channel, status, attemptCount, nextAttemptAt, lastErrorCode, createdAt, deliveredAt`.

## 5. Zone workflow state machine

Statuses: `draft`, `boundary_review_pending`, `founder_review_pending`, `approved`, `active`, `deactivation_pending`, `inactive`, `suspended`, `reactivation_pending`.

Transitions:
1. Create → `draft`.
2. Submit Boundary → `boundary_review_pending`.
3. Reviewer verifies and Central submits exact Founder request → `founder_review_pending`.
4. Founder approves activation request → `approved`.
5. Central activates after transactional exact-tuple recheck → `active`.
6. Central requests routine deactivation → `deactivation_pending`; Founder approval records `inactive`.
7. Central emergency suspension → `suspended` immediately; outbox notification is durably created in same transaction.
8. Central requests reactivation → `reactivation_pending`; Founder approves exact request; Central reactivates → `active`.

Rejection/changes-required are approval-request outcomes, not Zone statuses. A changed parent or Boundary invalidates prior approval and requires a new review/approval cycle. Running Walk Tasks are not cancelled by suspension.

## 6. Geometry canonicalization v1

- Validate finite coordinates within legal latitude/longitude ranges; canonical/hash order is longitude then latitude.
- Round to 7 decimal places; remove redundant consecutive duplicate vertices; require explicit ring closure; reject self-intersection, zero-area and degenerate rings; normalize exterior ring orientation and rotate to lexicographically smallest start vertex before serialization.
- Hash input: UTF-8 JSON array of canonical `[longitude, latitude]` pairs, no whitespace, fixed decimal rendering; SHA-256 lowercase hex.
- Store `geometryCanonicalizationVersion:1`.
- Holes and multipolygons are out of v1 scope; one simple polygon exterior ring only.

## 7. Emergency notification behavior

Emergency suspension transaction atomically writes Zone state, audit event, idempotency response and notification outbox record. Dispatcher attempts immediate delivery, then retries at 1 minute, 5 minutes, 15 minutes and 1 hour; after five failures it marks `escalation_required` and notifies Central operations for manual recovery. Notification failure never rolls back the safety suspension.

**Deferred integration detail:** provider and delivery channel are intentionally not selected in this contract. Acceptance tests verify the durable outbox, retry metadata and observable escalation contract only; they do not send external notifications or depend on a provider.

## 8. Explicit non-effects

This approval is limited to freezing the contract as the target for synthetic Emulator acceptance tests. It does not authorize runtime Functions/Rules implementation, Admin UI enablement, production provisioning, migration, Zone activation, deployment, PR merge, or changes to `main`. A separate Founder approval is required for implementation and again for any production deployment or merge.
