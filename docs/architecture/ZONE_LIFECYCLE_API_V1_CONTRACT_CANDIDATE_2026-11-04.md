# DOJO WALK — Zone Lifecycle API v1 Contract Candidate

Date: 2026-11-04  
Status: **Candidate for Founder review — not approved for implementation**  
Parent: `docs/implementation/ZONE_LIFECYCLE_API_CONTRACT_GAP_REGISTER_2026-11-04.md`  
Base contract branch: `implementation/zone-emulator-first-plan-2026-11-03`

## 1. Purpose and boundary

This document converts already-approved lifecycle semantics into one reviewable API/schema candidate. It proposes exact names and document shapes where the source documents leave a naming choice open. It does not change runtime code, Rules, data, indexes, roles, apps, production, or deployment.

Do not write the ten executable lifecycle tests against this candidate until Founder approval. If a field or transition is not acceptable, amend this document first; do not silently fork the API in tests and Functions.

## 2. Contract-wide callable envelope

**Candidate request envelope for every state-changing callable:**

| Field | Type | Rule |
|---|---|---|
| `requestId` | string | Required; 1–128 chars; scoped to authenticated actor + callable operation |
| `expectedRevision` | integer | Required for an existing Zone; must equal current Zone revision at transaction commit |
| operation fields | allowlisted object fields | Strict validation; reject unknown fields |

- Actor UID comes only from verified Firebase Auth context.
- Idempotency identity is `actorUid + callableName + requestId`.
- Payload fingerprint is SHA-256 over a deterministic canonical representation of the validated request fields, excluding transport metadata.
- Same identity + same fingerprint returns the stored original response; same identity + different fingerprint returns `already-exists` (candidate error mapping).
- Create Zone is the only operation without an existing Zone revision; candidate uses `expectedRevision: 0` to assert absence.
- Successful state-changing responses use `{ ok: true, requestId, zoneId, revision, workflowStatus, replayed }`; create-boundary also returns `boundaryId`; approval/decision responses also return `approvalRequestId`.
- Error codes should use Firebase callable canonical codes: `unauthenticated`, `permission-denied`, `invalid-argument`, `not-found`, `failed-precondition`, `already-exists`, `aborted`, `internal`. Exact per-condition mapping must be covered by tests.

## 3. Candidate callable API

| Callable | Authorized actor | Candidate operation fields |
|---|---|---|
| `createServiceZoneDraft` | Active Central Admin + `zoneOperations` | `stateId, districtId, cityId, name`; `expectedRevision:0` |
| `createServiceZoneBoundaryDraft` | Active Central Admin + `zoneOperations` | `zoneId, points, sourceType, sourceName, sourceReference`; current Zone `expectedRevision` |
| `reviewServiceZoneBoundary` | Active assigned reviewer + `zoneBoundaryReview`; cannot be submitter | `zoneId, boundaryId, decision:"verified"|"rejected", notes`; current Zone `expectedRevision` |
| `submitServiceZoneForFounderReview` | Active Central Admin + `zoneOperations` | `zoneId, boundaryId`; current Zone `expectedRevision` |
| `decideServiceZoneFounderApproval` | Active Founder allowlist UID + `founderApproval` | `approvalRequestId, zoneId, revision, boundaryId, boundaryHash, requestType, decision, notes` |
| `activateServiceZone` | Active Central Admin + `zoneOperations` | `zoneId`; current Zone `expectedRevision` |
| `requestServiceZoneDeactivation` | Active Central Admin + `zoneOperations` | `zoneId, notes`; current Zone `expectedRevision` |
| `suspendServiceZoneForEmergency` | Active Central Admin + explicit emergency-suspension permission (candidate: `zoneEmergencySuspend`) | `zoneId, reason, severity:"SEV-1"|"SEV-2"|"SEV-3"|"SEV-4"`; current Zone `expectedRevision` |
| `requestServiceZoneReactivation` | Active Central Admin + `zoneOperations` | `zoneId, reason`; current Zone `expectedRevision` |
| `reactivateServiceZone` | Active Central Admin + `zoneOperations` | `zoneId`; current Zone `expectedRevision` and exact Founder reactivation approval |

**Compatibility note:** This is a canonical v1 API, not a promise to preserve the current Admin wrapper. The wrapper's legacy `reviewServiceLocationBoundary` and `setServiceLocationStatus` calls must be replaced for Zone actions. Direct client Boundary writes must be removed before the UI is enabled.

## 4. Candidate collection/document model

### 4.1 `service_zones/{zoneId}`

| Field | Type / meaning |
|---|---|
| `schemaVersion` | integer, candidate value 1 |
| `stateId, districtId, cityId` | immutable canonical parent IDs |
| `name` | display name |
| `normalizedName` | server-computed normalized value |
| `workflowStatus` | enum in Section 5 |
| `isServiceActive` | server-authored; true only when `workflowStatus == "active"` |
| `revision` | monotonically increasing integer |
| `currentBoundaryId` | current submitted/verified boundary, if any |
| `verifiedBoundaryId` | exact verified boundary, if any |
| `verifiedBoundaryRevision` | Boundary revision bound to this Zone |
| `verifiedBoundaryHash` | server-computed SHA-256 hash |
| `approvedRevision` | Zone revision approved by Founder |
| `approvedBoundaryId` | exact approved Boundary |
| `approvedBoundaryHash` | exact approved hash |
| `approvedRequestId` | exact Founder approval request |
| `suspensionReason, suspensionSeverity` | present only while emergency-suspended |
| `createdBy, updatedBy` | server-authored UID |
| `createdAt, updatedAt` | server timestamps |

### 4.2 `service_location_boundaries/{boundaryId}`

| Field | Type / meaning |
|---|---|
| `locationType` | literal `"zone"` during compatibility period |
| `locationId`, `zoneId` | both equal canonical Zone ID during compatibility period |
| `zoneRevision` | Zone revision to which this Boundary belongs |
| `revision` | monotonic Boundary revision for the Zone |
| `points` | ordered polygon vertices |
| `sourceType` | `governmentGis`, `governmentCadastralMap`, `importedGeoJson`, or `manuallyDrawn` |
| `sourceName, sourceReference` | required provenance |
| `verificationStatus` | `pending`, `verified`, `rejected`, or `superseded` |
| `geometryHash` | server-computed SHA-256 over canonical ordered longitude/latitude pairs |
| `submittedBy, submittedAt` | server-authored submitter and timestamp |
| `reviewedBy, reviewedAt, reviewNotes` | server-authored reviewer evidence |
| `createdAt, updatedAt` | server timestamps |

After submission, the Boundary evidence is immutable. Corrections create a new Boundary document and new revision. Client writes are denied; callable Admin SDK writes only.

### 4.3 `service_zone_approval_requests/{approvalRequestId}`

| Field | Type / meaning |
|---|---|
| `zoneId, revision, boundaryId, boundaryHash` | immutable exact approval tuple |
| `requestType` | candidate enum: `activation`, `routine_deactivation`, `reactivation` |
| `status` | `pending`, `approved`, `rejected`, `changes_required`, `superseded` |
| `requestedBy, requestedAt` | server-authored request evidence |
| `decidedBy, decidedAt, decision, notes` | server-authored Founder decision evidence |
| `createdAt, updatedAt` | server timestamps |

Only one pending approval request per Zone and request type is allowed (candidate). A newer relevant Zone/Boundary revision supersedes the old request and prevents its approval.

### 4.4 `service_zone_name_indexes/{indexId}`

- `indexId` candidate: `{cityId}_{sha256(normalizedName)}`.
- Fields: `cityId, normalizedName, zoneId, createdAt, updatedAt`.
- The index reservation and Zone create/rename commit atomically.
- Normalization candidate: Unicode NFKC, trim leading/trailing whitespace, collapse internal Unicode whitespace to one ASCII space, and locale-independent case-fold. Display name remains as entered after trim.
- Same normalized key is unique within City; identical name in another City is valid.

### 4.5 Idempotency, audit and notification

- `service_zone_idempotency/{recordId}` candidate record ID: SHA-256 of `actorUid|callableName|requestId`.
- Fields: `actorUid, callableName, requestId, payloadFingerprint, response, createdAt, expiresAt`.
- Retention candidate: 90 days; do not delete records before expiry. Expiry/cleanup is operational maintenance, not permission to replay an expired request as a new mutation without a defined policy.
- `service_zone_audit/{eventId}`: append-only server record with `zoneId, action, actorUid, actorAuthority, requestId, fromRevision, toRevision, fromStatus, toStatus, reason, createdAt`; no raw polygon coordinates or secrets.
- `service_zone_notification_outbox/{notificationId}`: durable Founder notification request with `zoneId, eventId, recipientAuthority:"founder", channel, status, attemptCount, nextAttemptAt, lastErrorCode, createdAt, deliveredAt`. Provider/channel and retry schedule remain to be selected; emergency suspension is safety-effective even if delivery is temporarily failing, while retry/escalation stays visible and durable.

## 5. Candidate Zone workflow state machine

Candidate `workflowStatus` values:
- `draft`: Zone exists; no current submitted boundary.
- `boundary_review_pending`: current Boundary submitted and awaiting designated reviewer.
- `founder_review_pending`: current Boundary verified and exact approval request pending.
- `approved`: exact Founder approval recorded; Central activation action remains.
- `active`: booking eligible, provided all runtime eligibility checks pass.
- `deactivation_pending`: routine deactivation request awaits Founder decision.
- `inactive`: routine deactivation approved; not booking eligible.
- `suspended`: emergency suspension active; not booking eligible for new bookings.
- `reactivation_pending`: Central requested reactivation; Founder approval pending.

Candidate transitions:
1. Create → `draft`.
2. Submit Boundary → `boundary_review_pending`.
3. Reviewer verifies → `founder_review_pending` after Central submits exact Founder request.
4. Founder approves activation request → `approved`.
5. Central activates after transactional exact-tuple recheck → `active`.
6. Central requests routine deactivation → `deactivation_pending`; Founder approval decision records `inactive`.
7. Central emergency suspension → `suspended` immediately; outbox notification is durably created in same transaction.
8. Central requests reactivation → `reactivation_pending`; Founder approves exact reactivation request; Central reactivates → `active`.

Rejection/changes-required are approval-request outcomes, not Zone lifecycle statuses. A changed parent or Boundary invalidates the previous approval and requires a new review/approval cycle. Running Walk Tasks are not cancelled by suspension.

## 6. Candidate geometry canonicalization

- Input coordinates are validated as latitude/longitude pairs within legal ranges; persisted/canonical hash order is longitude then latitude as required by the approved plan.
- Candidate canonicalization: finite decimal numbers only; round to 7 decimal places; remove redundant consecutive duplicate vertices; require explicit ring closure; reject self-intersection, zero-area and degenerate rings; normalize exterior ring orientation and rotate to lexicographically smallest start vertex before serialization.
- Candidate hash input: UTF-8 JSON array of canonical `[longitude, latitude]` pairs, no whitespace, fixed decimal rendering; SHA-256 lowercase hex.
- Canonicalization version is stored as `geometryCanonicalizationVersion: 1` on Boundary.
- Holes and multipolygons are out of v1 scope; one simple polygon exterior ring only.

The rounding, ring closure, orientation, start-vertex and no-holes choices above are **new technical recommendations**, not previously Founder-approved product policy. They require review before tests are written.

## 7. Candidate notification behavior

- Emergency suspension transaction writes Zone state, audit event, idempotency response and notification outbox record atomically.
- A separate dispatcher sends the notification immediately after commit; failure increments attempt count, stores safe error code, schedules retry and raises an observable escalation.
- Candidate retry schedule: immediate attempt, then 1 minute, 5 minutes, 15 minutes, 1 hour; after five failures mark `escalation_required` and notify Central operations for manual recovery. Never roll back the safety suspension because a notification provider is unavailable.
- Founder notification channel, provider and acknowledgement definition remain unresolved and require explicit operations/security sign-off.

## 8. Open review items before approval

1. Approve or change the common request envelope and response shape.
2. Approve or change the Zone/Boundary/approval/index/idempotency/audit/outbox collection fields.
3. Approve the candidate status enum and transition table.
4. Approve or change Unicode normalization and geometry canonicalization details.
5. Approve the emergency notification provider/channel and retry/escalation policy.
6. Confirm whether emergency suspension needs a separate explicit permission `zoneEmergencySuspend` or is included in `zoneOperations`. The plan says authorized Central Admin, but does not name a separate permission bit.

## 9. Explicit non-effects

This candidate does not authorize test implementation, runtime Functions/Rules changes, Admin UI enablement, production provisioning, migration, Zone activation, deployment, PR merge, or changes to `main`. Once Founder approves the exact contract, create the ten synthetic callable acceptance tests first and execute them against isolated Emulators.
