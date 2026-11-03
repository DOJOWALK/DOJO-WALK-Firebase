# DOJO WALK — Live Walk Candidate Schema & Field Dictionary v0.1 (Draft)

**Date:** 3 November 2026  
**Status:** PROPOSAL ONLY — NOT FROZEN  
**Authority:** Founder-approved architectural direction TF-01–TF-12; exact schema remains unapproved  
**Repository:** `DOJOWALK/DOJO-WALK-Firebase`  
**Branch:** `feat/dw-sec-001-walker-data-separation`  
**Production:** NO-GO — no production schema, Rules, Functions, data, migration or deployment changes authorized

## 1. Purpose and decision boundary

This document proposes a field dictionary for review. It translates approved architecture into reviewable data responsibilities; it does not approve exact collection paths, field names, types, enum values, indexes, TTL, retention, API DTOs or migration behavior.

Labels:
- **Approved direction:** architectural constraint already approved in Notion.
- **Candidate:** proposed name/type for technical review only.
- **Blocked:** must not be implemented until the named decision/policy dependency is resolved and the frozen contract is approved.

No Firestore/Storage Rules, Functions, app code, production data or indexes are changed by this document. No tests are run by documenting this proposal.

## 2. Proposed logical record map

| Logical record | Candidate path | Authority | Purpose |
|---|---|---|---|
| Booking | `bookings/{bookingId}` (existing parent; compatibility review required) | Trusted backend | Customer request, commercial/service snapshot and occurrence references |
| Walk occurrence | `walks/{walkId}` (candidate canonical path; legacy records exist) | Trusted backend | One actual walk execution and assignment |
| Accepted location sample | `walks/{walkId}/locations/{sampleId}` | Trusted backend ingestion | Accepted GPS evidence; shared live-feed source |
| Walk event | `walks/{walkId}/events/{eventId}` | Trusted backend | Append-only lifecycle and command evidence |
| Incident | `walk_incidents/{incidentId}` | Trusted backend | Safety/operational incident record |
| Customer-safe Walker projection | `walker_public_profiles/{walkerUid}` | Trusted backend | Minimal assigned-Walker details |
| Restricted Walker records | DW-SEC-001 target collections | Trusted backend / scoped owner workflows | Operational, KYC, finance, emergency and device separation |

**Compatibility warning:** current source has Partner completion writes to `walks/{walkId}`, while Admin reads `walk_locations`; no matching writer was found in the inspected Partner source. Do not switch either reader or writer until a complete cross-app migration/compatibility map and rollback plan are approved.

## 3. Candidate field dictionary

### 3.1 Booking — `bookings/{bookingId}`

| Candidate field | Candidate type | Authority / notes |
|---|---|---|
| `customerId` | string | Backend-owned immutable owner UID |
| `serviceLocationId` | string | Backend-validated active service-zone reference |
| `pickupAddress` | map | Customer input snapshot; exact subfields require existing booking contract reconciliation |
| `schedule` | map or array | Service-local schedule snapshot; reconcile current top-level/nested schedule variants |
| `serviceSnapshot` | map | Server-priced/service-approved snapshot; exact commercial fields depend on approved policy |
| `paymentReference` | string or null | Backend/payment-provider reference; never trust client amount/status |
| `walkIds` | array<string> | Backend-maintained references to occurrence records |
| `aggregateState` | string | Backend-derived; exact enum and aggregation rules BLOCKED |
| `createdAt`, `updatedAt` | timestamp | Server-controlled timestamps |

**Do not freeze:** Booking state enum, price/payment fields, schedule shape, cancellation/refund fields or walk-count constraints until POL-006/POL-008 and the current Customer booking normalizer/UI contracts are reconciled.

### 3.2 Walk occurrence — candidate `walks/{walkId}`

| Candidate field | Candidate type | Authority / notes |
|---|---|---|
| `bookingId` | string | Backend-owned parent reference |
| `customerId` | string | Backend-derived owner reference; avoid redundant copies unless query need is justified |
| `assignedWalkerId` | string | Backend assignment only |
| `serviceLocationId` | string | Backend-validated Zone reference |
| `scheduledStartAt` | timestamp | Backend-normalized service-local schedule |
| `scheduledEndAt` | timestamp | Backend-normalized; duration rules policy-dependent |
| `state` | string | Backend-owned; exact enum/transition table BLOCKED |
| `assignmentVersion` | integer | Candidate optimistic concurrency/version guard |
| `startedAt` | timestamp or null | Server timestamp only |
| `completionRequestedAt` | timestamp or null | Server timestamp only |
| `completedAt` | timestamp or null | Server timestamp only after verified handover and backend resolution |
| `pickupHandoverRef` | string or null | Reference to restricted handover evidence |
| `finalHandoverRef` | string or null | Reference to restricted handover evidence |
| `activeLocationSampleId` | string or null | Backend pointer to latest accepted sample, if denormalization is justified |
| `schemaVersion` | integer | Candidate document contract version |
| `createdAt`, `updatedAt` | timestamp | Server-controlled |

One Walk identity must be stable for the actual scheduled occurrence. Backend, not Partner, creates/resolves it. Exact ID strategy and one-walk-per-occurrence uniqueness enforcement remain BLOCKED pending idempotency and booking-occurrence decisions.

### 3.3 Accepted location sample — candidate `walks/{walkId}/locations/{sampleId}`

| Candidate field | Candidate type | Authority / notes |
|---|---|---|
| `walkerId` | string | Backend-derived from active assignment |
| `latitude`, `longitude` | number | Validated coordinate pair |
| `capturedAt` | timestamp | Device capture time, validated |
| `receivedAt` | timestamp | Server receive/accept time |
| `horizontalAccuracyM` | number or null | Device-reported accuracy |
| `sequence` | integer or null | Candidate per-session ordering signal |
| `sessionId` | string | Candidate tracking-session reference |
| `acceptanceState` | string | Candidate accepted/quarantined/rejected taxonomy; exact values BLOCKED |
| `qualityReason` | string or null | Machine-readable quality reason; taxonomy BLOCKED |
| `schemaVersion` | integer | Candidate payload version |

Only backend-accepted samples may update the current live marker. Delayed/offline/backfilled samples must not appear as current position or move the live marker backwards. Numeric accuracy ceiling, maximum sample age, ordering tolerance, offline policy, rate/size limits, retention and archive remain BLOCKED. Approved operating values remain target 10 seconds, stale alert after 30 seconds, and deviation alert > approximately 150m for 3 minutes when accuracy is adequate.

### 3.4 Walk event — candidate `walks/{walkId}/events/{eventId}`

| Candidate field | Candidate type | Authority / notes |
|---|---|---|
| `bookingId`, `walkId` | string | Backend references |
| `eventType` | string | Backend-defined event taxonomy; exact values BLOCKED |
| `actorUid` | string | Derived from authenticated identity |
| `actorRoleSnapshot` | string | Server-resolved role snapshot; exact role IDs BLOCKED |
| `fromState`, `toState` | string or null | Backend transition evidence |
| `commandId` | string | Candidate idempotency/command reference |
| `reasonCode` | string or null | Controlled taxonomy; exact values BLOCKED |
| `evidenceRefs` | array<string> | Restricted evidence references only; no raw secrets |
| `createdAt` | timestamp | Server timestamp |

Events are append-only to clients. Corrections must be represented by a new compensating event, not silent mutation/deletion.

### 3.5 Incident — candidate `walk_incidents/{incidentId}`

| Candidate field | Candidate type | Authority / notes |
|---|---|---|
| `bookingId`, `walkId` | string | Backend-linked references |
| `reportedByUid` | string | Authenticated reporter |
| `category`, `severity` | string | Controlled taxonomy; POL-016 decision required |
| `status` | string | Exact incident lifecycle BLOCKED |
| `reportedAt`, `resolvedAt` | timestamp or null | Server timestamps |
| `safeHandoverState` | string | Explicit safety state; taxonomy BLOCKED |
| `assignedResponderId` | string or null | Authorized responder reference |
| `resolutionCode` | string or null | Approved closure reason |
| `evidenceRefs` | array<string> | Restricted evidence references |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

Incident must block ordinary completion until safe handover and authorized resolution. Severity, response SLA, contact tree, notification channels and closure authority depend on POL-016 and remain BLOCKED.

### 3.6 Customer-safe Walker projection — `walker_public_profiles/{walkerUid}`

| Candidate field | Candidate type | Authority / notes |
|---|---|---|
| `displayName` | string | Approved display name, not legal-name assumption |
| `profilePhotoRef` | string or null | Customer-safe asset reference only |
| `publicWalkerCode` | string or null | Only if product need is approved |
| `serviceSummary` | map | Minimal customer-safe summary |
| `zoneSummary` | map or null | Service-area label; never home/exact live location |
| `profileState` | string | Candidate published/unpublished state; exact values BLOCKED |
| `updatedAt` | timestamp | Server-controlled |

No phone, email, DOB, gender, home address, KYC status/evidence, bank/payout, emergency contacts, device tokens, internal notes, exact live location or raw eligibility evidence. Customer access should be backend-mediated after validating booking ownership, current assignment and permitted tracking phase; direct collection list/query is not proposed.

## 4. Cross-cutting field and data rules

1. Identity references use Firebase Auth UID strings; clients cannot assert role, scope, assignment or ownership.
2. Server timestamps are authoritative for accepted state changes and receive time. Device capture time is evidence, not server truth.
3. All mutating commands require an idempotency token; exact storage, expiry and fingerprint fields remain BLOCKED.
4. Do not duplicate sensitive fields into customer-facing projections.
5. Do not store raw OTPs, authentication tokens, secrets, bank details or raw KYC documents in lifecycle/event records.
6. Avoid denormalization until a concrete query and index need is documented.
7. Every field needs a named writer, reader, classification, retention basis and deletion/legal-hold rule before schema freeze.
8. Field-level access cannot be used to redact a Firestore document; separate sensitive data into separate documents/collections.

## 5. Existing-source compatibility items to resolve

| Existing source shape / behavior | Risk | Required resolution |
|---|---|---|
| Partner writes legacy `walks/{walkId}` with final route/count/timing fields | Candidate canonical Walk path may collide with historical document shape | Inventory all readers/writers; define legacy-vs-canonical version discriminator and idempotent migration |
| Admin reads `walk_locations` by `walkerId` and timestamp | No writer identified in inspected Partner source | Find actual writer or formally retire only after consumer migration and approval |
| Partner directly updates Booking status and completion fields | Conflicts with trusted backend authority | Replace only after callable/API and policy contract are frozen; no direct client lifecycle writes |
| Booking has legacy top-level/nested schedule and coordinate variants | Ambiguous normalization and timezone semantics | Reconcile Customer, Firebase normalizer, Partner parser and approved booking contract |
| Existing `walkers/{uid}` contains mixed profile/operational/sensitive-capable fields | Whole-document read cannot redact fields | DW-SEC-001 migration inventory, scoped readers/writers and rollback plan |
| Admin reads broad online Walker documents and route history | Excessive data exposure / geographic scope risk | Purpose-scoped Admin projection/API and role+zone authorization design |

## 6. Required decisions before freeze

- [ ] Approve exact canonical paths and legacy coexistence/version strategy.
- [ ] Approve exact field names/types/required-vs-optional/null semantics for Booking and Walk.
- [ ] Freeze complete Booking and Walk enums, transition matrix and aggregate derivation.
- [ ] Freeze occurrence identity, stable Walk ID and idempotency storage/key/expiry.
- [ ] Freeze callable names, request/response DTOs, error codes and schema compatibility.
- [ ] Freeze GPS accuracy ceiling, sample-age/order/offline/rate limits and retention after POL-014/POL-020.
- [ ] Freeze recipient enrollment/verification and escalation/override mechanics under applicable policy.
- [ ] Freeze role claims, membership source, geographic scope and emergency access under POL-021.
- [ ] Freeze incident taxonomy, SLA and closure authority under POL-016.
- [ ] Map all current app readers/writers and indexes; specify migration, reconciliation, rollback and cutover.
- [ ] Define Emulator, Functions, cross-app and Android background-location tests; execute and attach evidence.
- [ ] Obtain explicit Founder approval of the frozen contract before implementation changes beyond documentation/inventory.

## 7. Policy dependencies

- POL-006 / POL-008: booking, service and commercial rules — verify current approved clauses before dependent fields.
- POL-014 / POL-020: privacy, data access, retention and deletion — retention fields/TTL must remain unset until approved.
- POL-016: incident severity, escalation and resolution.
- POL-021: role, privileged access, geographic scope and emergency access.
- POL-018: release and production approval controls.

A technical proposal cannot approve or supersede these policies. Any policy still Draft remains a blocker for dependent behavior.

## 8. Current verification and release status

- Documentation proposal only.
- No source code, Rules, Functions, app, production data, index, migration, workflow, merge or deployment changed.
- No tests executed; DW-SEC-002 conceptual 25 cases remain NOT RUN.
- Technical schema contract: NOT FROZEN.
- Production: NO-GO.

## 9. Review request

Review each candidate path and field as **Approve / Amend / Defer**. A field must not be treated as approved merely because it appears in this document. After decisions are recorded in Notion, publish a new version with a frozen field dictionary and matching Emulator acceptance criteria.
