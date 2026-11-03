# DOJO WALK — Live Walk Technical Contract v0.2 (Draft)

**Date:** 3 November 2026  
**Status:** ARCHITECTURE DIRECTION APPROVED; IMPLEMENTATION CONTRACT NOT FROZEN  
**Authority:** Founder decision recorded in Notion, 3 Nov 2026  
**Scope:** Non-production technical contract preparation only  
**Production:** NO-GO — separate Founder approval required

Canonical decision record: https://app.notion.com/p/409756abedb9811bad58c5aea088be62

## 1. Decision status and interpretation

Founder approved the recommended architectural direction TF-01 through TF-12. This document translates that direction into a versioned engineering contract draft. It does **not** silently approve unresolved field names, enum strings, callable names, thresholds, retention periods, or policy clauses.

Labels used below:
- **APPROVED DIRECTION** — architectural constraint approved by Founder.
- **PROPOSED** — engineering design candidate; must be reconciled and frozen in Notion before implementation.
- **BLOCKED** — dependent on policy approval, operational input, or a specific Founder decision.

No source code, Firestore Rules, Storage Rules, Functions, app code, production data, or deployment is changed by this document.

## 2. Approved architecture invariants

1. Firebase trusted backend is authoritative for Booking↔Walk linkage and accepted lifecycle transitions.
2. Booking and Walk are separate concepts and state machines.
3. Partner submits authenticated commands and device evidence; it does not authoritatively write lifecycle state.
4. Customer reads only its own booking and the assigned-Walker projection permitted during the approved active tracking phase.
5. Admin access is role- and geography-scoped; Central cross-zone oversight is distinct from Super Admin technical security administration.
6. Customer and Admin live markers derive from one server-accepted location feed; historical route access is separately restricted.
7. Commands are authenticated, assignment/ownership checked, validated, idempotent and audited.
8. Pickup handover validation precedes Start. Verified final handover precedes completion. Dog is never left unattended.
9. Safety incidents are separate auditable records and ordinary completion is blocked until safe handover and authorized resolution.
10. Approved GPS operating values remain: target cadence 10 seconds; stale alert after 30 seconds without accepted update; route deviation alert > approximately 150 metres for 3 minutes when GPS accuracy is adequate.
11. Delayed/offline samples must not be represented as current live position.
12. Non-production Emulator, integration and device evidence precede release review. Production changes require a separate Founder approval.

## 3. Proposed logical data model (not yet frozen)

The following names are **PROPOSED logical responsibilities**, not permission to create collections or migrate data.

| Logical record | Proposed responsibility | Authority |
|---|---|---|
| Booking | Parent customer request, service/commercial snapshot and links to required Walk occurrences | Backend |
| Walk | One actual scheduled/accepted walk occurrence; assignment and lifecycle | Backend |
| Walk location sample | Accepted location point with capture and server-receive timestamps and quality metadata | Backend ingestion |
| Walk event | Append-only lifecycle/command audit event | Backend |
| Walk incident | Safety/operational incident linked to Booking and Walk | Backend |
| Assigned-Walker projection | Minimal customer-safe profile for the currently assigned Walker | Backend projection |

### 3.1 Candidate paths for review

- Existing parent path: `bookings/{bookingId}` — retain as parent record pending compatibility audit.
- Candidate occurrence path: `walks/{walkId}` — existing source writes completion/history documents here; whether this becomes the canonical live Walk record requires a legacy-field and reader migration plan.
- Candidate location path: `walks/{walkId}/locations/{sampleId}` — proposed canonical accepted feed. Existing Admin currently queries `walk_locations`; do not switch readers until compatibility and index plan is approved.
- Candidate event path: `walks/{walkId}/events/{eventId}` — proposed append-only lifecycle evidence.
- Candidate incident path: `walk_incidents/{incidentId}` — proposed separate incident record.
- Candidate public profile path: `walker_public_profiles/{walkerId}` — consistent with the approved DW-SEC-001 separation direction; exact fields and callable/read path remain to be frozen.

**Do not create these paths or update Rules yet.** First complete a full reader/writer inventory and field-by-field compatibility map across Firebase, Partner, Customer and Admin.

### 3.2 Minimum semantic fields (names/types not frozen)

- Booking: stable booking identity, customer owner, service-zone reference, service-local schedule, payment/availability gates, required occurrence references, aggregate status.
- Walk: stable Walk identity, Booking reference, assigned Walker UID, zone reference, current canonical state, server timestamps, handover/completion references.
- Location sample: Walk reference, Walker UID, latitude/longitude, capture timestamp, server receive timestamp, horizontal accuracy, sequence/order metadata, acceptance/rejection reason.
- Event: event identity, Booking/Walk references, actor UID and role snapshot, command/action, prior/new state, server timestamp, idempotency reference, reason/evidence references.
- Incident: Booking/Walk references, reporter, category/severity, opened/resolved timestamps, safe-handover status, resolution authority and audit references.
- Public projection: only approved display name, approved photo reference, safe public Walker code if required, minimal service/zone summary and profile state.

Avoid copying KYC, DOB, gender, private phone/address, bank/payout, emergency contacts, device tokens or internal notes into the public projection.

## 4. Lifecycle contract (semantics approved; exact enums pending)

### 4.1 Booking aggregate

Booking is the parent request/commercial record. It must not be used as the per-walk execution state. Parent aggregate status is derived by backend rules from its linked Walk occurrences and approved booking/payment policies.

### 4.2 Walk occurrence

Logical phases:
1. Awaiting valid assignment.
2. Assigned to one eligible Walker.
3. Accepted by that assigned Walker.
4. Pickup arrival and pickup handover validation.
5. Active walk after trusted Start acceptance.
6. Completion requested.
7. Final handover verified.
8. Completion resolved by backend.
9. Controlled exception/review path for cancellation, failure, incident or disputed evidence.

Exact persisted enum values, allowed from→to transitions, actor permissions, timeout behavior and parent aggregate rules remain **BLOCKED** pending the versioned transition matrix and policy dependencies. UI labels must never be persisted as machine states.

### 4.3 Required transition guards

- Start: authenticated assigned Walker; active valid assignment; eligible Booking/Walk state; pickup arrival evidence; required recipient handover acknowledgement; valid GPS/session prerequisites; idempotency check; backend transaction.
- Location ingestion: authenticated assigned Walker/session; active Walk; valid coordinates and timestamps; quality/rate/order checks; idempotency/order handling; server acceptance timestamp.
- Completion: active Walk; no unresolved safety block; required walk report/evidence; verified final handover; authorized backend resolution; idempotency check.
- Incident: authenticated permitted reporter; linked Booking/Walk; server timestamp; severity/category validation once approved; Central/Admin notification and audit.
- Operations intervention: explicit scoped role, reason code, evidence reference, audit event and permitted transition. No UI-only authorization.

## 5. Trusted command boundary (logical names only)

Proposed command responsibilities; these are **not deployed callable names**:

| Logical command | Purpose |
|---|---|
| arriveAtPickup | Record pickup arrival evidence |
| confirmPickupHandover | Verify Customer/pre-authorized recipient handover |
| startWalk | Validate guards and atomically accept Start |
| appendWalkLocation | Validate and accept a GPS sample |
| raiseWalkIncident | Create incident and trigger approved escalation |
| requestWalkCompletion | Submit completion evidence |
| confirmFinalHandover | Verify safe return/handover acknowledgement |
| resolveWalkCompletion | Resolve terminal completion on backend |
| operationsIntervention | Apply an authorized, reasoned and audited exception action |

Each request must carry authenticated identity from Firebase Auth, a stable resource reference, a client-generated idempotency token for mutating operations, a schema version, and only the evidence needed for that command. Backend must derive actor/role/ownership from trusted auth and server-side membership data, never from client-supplied role fields.

Exact callable names, DTO field names/types, error codes, payload limits, schema compatibility and versioning policy remain **PROPOSED / NOT FROZEN**.

## 6. Idempotency and transaction requirements

**Approved direction:** retry-safe mutating commands; duplicate Start/Completion must not create duplicate active or terminal outcomes.

**Proposed behavior:**
- Scope an idempotency record to authenticated actor + command type + resource identity.
- Store a normalized request fingerprint and the canonical outcome reference.
- Same key + same normalized request returns the prior outcome.
- Same key + different normalized request returns a conflict and creates an auditable security/consistency signal where appropriate.
- State transition, event record and idempotency outcome should commit atomically where Firestore transaction limits permit.
- Define expiry/retention only after policy and retry-window review; do not silently expire a key while a retry can still arrive.

Key format, exact document path, expiry, concurrency behavior and transaction boundaries are **NOT FROZEN**.

## 7. GPS feed and quality semantics

### 7.1 Approved operating values
- Target sample cadence: 10 seconds.
- Stale alert: after 30 seconds without an accepted update.
- Deviation alert: > approximately 150 metres for 3 minutes, only when GPS accuracy is adequate.
- A deviation alert is an operational signal, not proof of misconduct.

### 7.2 Proposed sample handling
- Store device capture time and server receive time separately.
- Preserve reported horizontal accuracy and source/session metadata.
- Only backend-accepted samples update the live marker.
- Delayed/offline/backfilled points must be stored/labelled separately or rejected/quarantined; they must never move the current live marker backwards or appear as a current position.
- Reject malformed coordinates and impossible timestamps; quarantine suspicious ordering rather than silently rewriting history.
- Admin and Customer live projections read from the same accepted feed, filtered by their respective authorization scopes.
- Historical route access is a separate purpose-bound query, not an automatic side effect of live access.

**Blocked parameters:** numeric accuracy ceiling; maximum sample age; out-of-order tolerance; offline queue/backfill policy; rate/size limits; distance calculation and smoothing; exact retention and archive. These require a recorded technical decision and applicable policy approval.

## 8. Recipient verification and safe handover

**Approved direction:** pickup validation before Start; verified final handover before completion; no unattended dog; unresolved recipient availability escalates.

**Proposed contract:**
- Recipient identity/authorization is established before acknowledgement is accepted.
- Acknowledgement is bound to the Booking + Walk + handover phase and has one-time/replay protection.
- Backend records actor, timestamp, method and minimal evidence reference.
- If Customer/pre-authorized recipient is unavailable, Walk remains unresolved and Central/Admin escalation begins.
- Exceptional alternate handover requires verified recipient, authorized decision-maker, reason and audit evidence.

**Blocked:** recipient enrollment, OTP vs in-app confirmation, verification expiry/rate limits, alternate recipient process, escalation contact tree, wait time and override authority. Do not implement a client-only OTP comparison.

## 9. Authorization matrix (semantic; claims not frozen)

| Actor | Allowed scope (approved direction) | Prohibited |
|---|---|---|
| Customer | Own Booking; assigned-Walker projection and live Walk only during allowed phase | Other customers, broad Walker records, unrestricted route history, lifecycle mutation |
| Walker | Own assigned Walk and own command/evidence submission | Other Walkers' data, assignment changes, authoritative state writes |
| Supervisor | Assigned Zone | Other Zones/Cities |
| City Manager | Assigned City and its Zones | Other Cities |
| Central | Cross-zone operational oversight and authorized escalation | Unlogged unrestricted access |
| Super Admin | Technical/security administration under explicit privileged controls | Automatic blanket operational authority or unlogged route access |

Every server operation must validate active account, role, resource relationship, geography and action. Exact claim names, membership source, multi-zone rules, inactive-account behavior, emergency break-glass expiry/review and Founder-only actions remain **NOT FROZEN**.

## 10. Incident and exception handling

- Incident is a separate auditable record linked to Booking and Walk.
- A safety incident blocks ordinary completion until safe handover and authorized resolution are recorded.
- Central/Admin receives the approved escalation.
- Partner cannot silently abandon, complete or erase a safety-blocked Walk.
- Preserve minimal evidence references and append-only event history.

Severity mapping, response SLAs, verified local contact tree, emergency-services guidance, notification channels and incident closure authority depend on POL-008/POL-016 and remain **BLOCKED**.

## 11. Privacy, retention and deletion

- Minimize precise GPS and personal data.
- Separate active live visibility from historical route access.
- Customer access is booking-scoped; Admin access is purpose- and geography-scoped.
- Access to sensitive route history and emergency records must be auditable.
- Do not encode arbitrary retention periods or deletion behavior before POL-014/POL-020 decisions.
- Apply legal hold/deletion exceptions only through approved policy and auditable authority.

## 12. Rules, migration and compatibility

- Deny-by-default Rules; no wildcard or client-authoritative lifecycle writes as a shortcut.
- Rules and callable authorization must agree; UI hiding is not security.
- Inventory every current reader/writer and legacy field before changing a path.
- Preserve existing `walks` history and current Admin `walk_locations` consumers until replacement readers/writers and compatibility plan are tested.
- Any migration must be staged, idempotent, backed up, reconciled and rollback-capable.
- No production migration, Rules/Storage deployment or main merge under this approval.

## 13. Required test gates

DW-SEC-002 has 25 conceptual cases, currently **NOT RUN**. After contract freeze, execute and record:
- Rules Emulator positive/negative ownership, assignment, role and geography tests.
- Functions tests for transition guards, transaction atomicity, duplicate/retry/conflict behavior and audit records.
- Customer/Partner/Admin integration tests against the same contract.
- Android foreground/background location, permission revocation, process death, network loss, delayed samples, stale alerts and recovery tests.
- Safe handover, unavailable recipient, incident and authorized intervention scenarios.
- Regression tests for existing Booking, Walker profile/KYC, Admin operations and legacy route/history consumers.

Each result must include exact commit SHA, emulator/config version, command, environment, test name, expected/actual result and log/evidence. No PASS is claimed by this draft.

## 14. Freeze checklist before implementation

- [ ] Canonical collection paths, field dictionary, types, indexes and security boundaries approved.
- [ ] Booking and Walk enums + exhaustive transition matrix approved.
- [ ] Command names, versioned DTOs, errors and payload limits approved.
- [ ] Idempotency key format, scope, expiry and transaction model approved.
- [ ] GPS accuracy, age, ordering, offline/backfill and rate limits approved.
- [ ] Recipient enrollment/verification and escalation contacts approved.
- [ ] Role claims, membership source, geography resolution and break-glass controls approved.
- [ ] Incident severity, response timing and closure authority approved.
- [ ] Retention/deletion schedule approved under applicable policies.
- [ ] Canonical base SHA, non-production branch, CI gates, device matrix and rollback plan recorded.
- [ ] Policy dependencies reviewed: POL-006, POL-008, POL-014, POL-016, POL-020, POL-021/access control and POL-018/release control.

## 15. Current status

- Architectural direction TF-01 to TF-12: **FOUNDER APPROVED**.
- This v0.2 technical contract: **DRAFT — NOT FROZEN**.
- Code / Rules / Functions / production data changes: **NONE**.
- DW-SEC-002 tests: **25 NOT RUN**.
- Production migration / deployment / main merge / release: **NO-GO; separate approval required**.

**Next action:** resolve the freeze checklist in Notion decision-by-decision, then publish a frozen contract revision. Until then, affected implementation remains blocked.
