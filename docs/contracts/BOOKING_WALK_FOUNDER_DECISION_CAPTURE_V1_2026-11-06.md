# DOJO WALK — Booking & Live Walk Founder Decision Capture V1
**Date:** 2026-11-06  
**Status:** Decision worksheet — no new decisions approved by this document  
**Related PR:** [Firebase PR #96](https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/96)  
**Canonical reconciliation:** [Booking & Walk Implementation Contract](https://github.com/DOJOWALK/DOJO-WALK-Firebase/blob/docs/booking-walk-implementation-contract-v1-2026-11-06/docs/contracts/BOOKING_WALK_IMPLEMENTATION_CONTRACT_V1_DRAFT_2026-11-06.md)

## Purpose and rules
This sheet isolates the remaining product/business choices that block the cross-app contract. Existing approved directions are repeated only to avoid reopening them. Recommendations are engineering/product proposals, **not approvals**. Do not implement a proposed value until the decision owner records the selected answer, approver role, date and effective contract version.

## Already approved / established — do not reopen
- India service timezone: `Asia/Kolkata`; authoritative timestamps UTC; preserve service-local date/time on each Walk Task.
- Parent Booking + child Walk Task model; preserve the existing `walks` completed-history collection.
- Sequential single-Walker offer; no simultaneous active offers; authorized manual Operations fallback.
- Customer request receipt is not availability confirmation, quote, payment verification, booking confirmation, assignment or walk start.
- POL-007 Founder-approved Live Walk workflow: assigned Walker, pickup/dog checks and authorized handover before Start; server validates lifecycle; stable separate Walk ID; no client-authoritative lifecycle writes.
- GPS operating targets: 10s target cadence; stale after 30s without accepted update; route deviation >~150m for 3m only with adequate accuracy; customer sharing during active Walk only.
- POL-029 approved cancellation decisions: individual occurrence ≥12h (including exactly 12h) = 100% eligible allocated paid amount; <12h = 50%; after Start no automatic ordinary refund; service failure without backup offers reschedule or 100% affected-walk refund; refund approval ≤₹2,000 Central Admin, >₹2,000 Founder/CEO; subscription renewal manual with explicit customer action.

## Founder / Product decisions

### AP-01 — Parent Booking state enum and legacy mapping
**Current:** OPEN. Candidate values exist, but there is no final enum or legacy mapping.  
**Decision required:** Select canonical parent states and map legacy values (`pending`, `confirmed`, `assigned`, `accepted`, `picked_up`, `walking`, `completed`, `cancelled`). Clarify whether assignment/acceptance/walk progress belong only to child Task/Assignment/Walk rather than parent Booking.  
**Safe recommendation:** Parent Booking holds commercial/order-level state only; child Walk Task and Assignment own per-occurrence dispatch progress; actual Walk owns execution lifecycle. Preserve legacy fields through a versioned adapter.  
**Owner:** Founder/Product + Customer/Admin/Partner owners.  
**Record:** Selected enum: ______ | Legacy map approved: Yes / No | Approver/date: ______

### AP-02 — Walk Task state machine
**Current:** PARTIAL. Parent/child structure and broad workflow direction exist; transition matrix does not.  
**Decision required:** Approve every allowed transition, actor, guard, terminal state and exception path; distinguish events (arrival/handover) from states.  
**Safe recommendation:** Use the POL-007 logical sequence; never permit a client to set lifecycle state directly; preserve incident and operations-review states without silently completing/cancelling an active Walk.  
**Owner:** Founder/Operations + Backend/Partner.  
**Record:** Transition matrix version/link: ______ | Approver/date: ______

### AP-03 — Sequential offer configuration
**Current:** PARTIAL. Single-Walker sequential offer is established; numerical/configuration parameters are open.  
**Decision required:** Response timeout, maximum attempts, retry/pause behavior, candidate ranking/tie-breakers, search widening, travel/rest buffers and customer notification timing.  
**Safe recommendation:** Keep each value configurable by service area and time window; do not hard-code a timeout or ranking weight without Operations evidence. Define a terminal `needs_operations` outcome when eligible candidates are exhausted.  
**Owner:** Founder/Operations.  
**Record:** Timeout: ______ | Max attempts: ______ | Ranking: ______ | Widening: ______ | Approver/date: ______

### AP-04 — Regular recurrence and rolling horizon
**Current:** PARTIAL. Rolling 7-day task-generation direction is selected; recurrence boundaries are open. POL-029 separately says renewal is manual.  
**Decision required:** Service end-date/period, generation window, extension cadence, cancellation/expiry stop condition, horizon exhaustion behavior and renewal interaction.  
**Safe recommendation:** Generate only the approved rolling 7-day horizon idempotently; never create beyond a confirmed service end date; stop future generation after cancellation/expiry; require explicit manual renewal as already recorded in POL-029.  
**Owner:** Founder/Product + Operations.  
**Record:** End-date rule: ______ | Extension rule: ______ | Exhaustion behavior: ______ | Approver/date: ______

### AP-05 — Capacity reservation and expiry
**Current:** PARTIAL. Check availability before quote/payment and reserve offered capacity atomically are established directions; TTL/release behavior is open.  
**Decision required:** Authoritative capacity source, reservation point, reservation TTL, release on payment timeout/failure, retry behavior and contention response.  
**Safe recommendation:** A slot is not confirmed merely because the UI displayed availability. Reserve atomically only at the approved checkout stage; expire/release by a server-owned deadline; recheck before confirmation. Set the actual TTL only after payment-provider timeout and operational timing are known.  
**Owner:** Founder/Operations + Finance + Backend.  
**Record:** Reservation point: ______ | TTL: ______ | Release rules: ______ | Approver/date: ______

### AP-06 — Payment provider and confirmation boundary
**Current:** PARTIAL. Availability → quote → payment → trusted provider verification → confirmation is the approved direction. POL-029 requires full advance payment for Regular/Subscription after availability and authoritative quote; renewal is manual.  
**Decision required:** Provider, payment method(s), webhook/signature verification, payment timeout, reconciliation owner, failure/reversal/refund behavior and exact confirmation boundary.  
**Safe recommendation:** Do not enable payment UI or mark a Booking paid until provider-backed server verification and reconciliation are operational. Keep provider choice open until commercial onboarding and technical verification are complete.  
**Owner:** Founder + Finance + Backend/Security.  
**Record:** Provider: ______ | Payment methods: ______ | Timeout: ______ | Reconciliation owner: ______ | Approver/date: ______

### AP-07 — Idempotency and deterministic IDs
**Current:** PARTIAL. Opaque key + authenticated customer/request hash semantics and deterministic occurrence Task ID direction are recorded; exact format/retention remain open.  
**Decision required:** Key format, storage location, retention, same-key conflict behavior, deterministic Task ID encoding, duplicate provider webhook key and actual Walk ID creation contract.  
**Safe recommendation:** Use cryptographically random opaque request keys; bind to UID + operation + normalized payload hash; reject same key with different payload; backend creates stable Walk ID once; never use client timestamps as ordering authority. Choose retention based on retry, dispute and provider reconciliation requirements before implementation.  
**Owner:** Backend + Security; Founder approval where customer-visible.  
**Record:** Key format: ______ | Retention: ______ | Task ID scheme: ______ | Webhook dedupe: ______ | Approver/date: ______

### AP-08 — Pickup/address source and coordinate rules
**Current:** PARTIAL. Server-side ownership/eligibility and pre-start handover checks are required; exact coordinate precedence and legacy null handling remain open.  
**Decision required:** Authoritative saved-address source, immutable booking snapshot, coordinate precedence, legacy records with missing/partial coordinates, pickup-change limit at Start and accuracy threshold.  
**Safe recommendation:** Fetch the saved address under the authenticated customer's UID on the server and create an immutable booking snapshot. For new bookings, do not bypass service-zone boundary verification when coordinates are absent or invalid; route to correction/review. Preserve legacy fallback only for historical reads, not as proof of new-booking eligibility.  
**Owner:** Founder/Product + Safety + Backend.  
**Record:** Address authority: ______ | Coordinate precedence: ______ | Legacy null policy: ______ | Pickup change rule: ______ | Approver/date: ______

### AP-09 — Roles, field visibility and geographic scope
**Current:** PARTIAL. Semantic boundaries are established; POL-021 remains Draft and exact claims/action matrix is open.  
**Decision required:** Approve resource/action matrix for Customer, assigned Walker, Supervisor, City Manager, Central Operations, Founder, Super Admin, Finance and Support; define field visibility stages, scope resolver, break-glass and audit.  
**Safe recommendation:** Keep Founder ≠ Super Admin ≠ Central Operations. City Manager is limited to assigned City; Supervisor to assigned Zone; Central receives only explicit cross-zone operational permissions; Walker receives assigned tasks only. Backend denies by default if role, active status, scope or record state is missing.  
**Owner:** Founder + Security/Admin owners.  
**Record:** Role matrix version/link: ______ | Break-glass approver: ______ | Approver/date: ______

### AP-10 — Cancellation, refund and active-Walk replacement
**Current:** PARTIAL. POL-029 business outcomes and refund authority are approved; runtime state transitions/provider reversal/legal review remain open.  
**Decision required:** Align occurrence-level cancellation/refund ledger, subscription allocation, active-Walk exception handling, safe-handover proof, no-show grace periods and provider reversal.  
**Safe recommendation:** Implement the approved POL-029 calculation only from actual captured payment and deterministic per-occurrence allocation. Never auto-refund ordinary cancellation after Start; route to Operations. Never stop/reassign an active Walk until safe handover is confirmed and audited. No-show grace periods remain unset until explicitly approved.  
**Owner:** Founder + Finance + Operations/Safety.  
**Record:** Policy implementation version: ______ | No-show grace: ______ | Handover gate: ______ | Approver/date: ______

### AP-11 — Maximum walks per day
**Current:** OPEN. Customer UI caps at 3; normalizer/test coverage accepts up to 4.  
**Decision required:** Select one product maximum and align UI, validator, callable, Rules, quote and tests.  
**Safe recommendation:** Keep the currently user-visible limit of 3 until Product explicitly approves a change; do not accept 4 only because a test helper allows it.  
**Owner:** Founder/Product.  
**Record:** Maximum walks/day: ______ | Approver/date: ______

### AP-12 — Immediate / ASAP semantics
**Current:** OPEN. Candidate normalizer currently returns an operations-confirmation outcome; final service window/task semantics are not approved.  
**Decision required:** Define ASAP as an availability request or a bookable service window, eligible times, customer wording, capacity hold, payment and task creation point.  
**Safe recommendation:** Treat ASAP as a request to find the nearest genuinely available slot; show options and quote; do not create a confirmed task or take payment until capacity and required payment checks pass. Set the exact service window only after Operations defines coverage.  
**Owner:** Founder/Product + Operations.  
**Record:** Service window: ______ | Task creation point: ______ | Customer wording: ______ | Approver/date: ______

## Technical freeze owners (not values to guess in this worksheet)
The following TF items require an engineering/security/operations evidence package after the business decisions above:
- TF-01: exact collection paths, field dictionary, indexes, ownership and history compatibility.
- TF-02: actor × state transition matrix and server command contract.
- TF-03: key storage, transaction boundaries, duplicate/replay handling and ID format.
- TF-04: callable names, request/response/error DTOs and versioning.
- TF-05: GPS accuracy, accepted age, sequence, rate limits, offline/backfill and deviation algorithm.
- TF-06: recipient verification and customer/network-unavailable fallback.
- TF-07: Firebase claims, role resolver, City/Zone scope and negative authorization tests.
- TF-08: incident lead/backup, verified contacts, response targets, restart authority and drills.
- TF-09: retention schedule, deletion, backup expiry, export and legal-hold controls.
- TF-10: authoritative Rules source, Emulator config, indexes, CI evidence, staged rollout and rollback.
- TF-11: separate approval dependencies (POL-006, POL-008, POL-014, POL-016, POL-020).
- TF-12: Android device/background/battery/network/permission test matrix and exact SHA/log evidence.

## Explicit stop conditions
- No production schema, Rules, Functions, indexes, app reader/writer cutover, migration, deployment, main merge or release while the corresponding gate is OPEN/PARTIAL.
- Do not convert recommendations in this worksheet into approved decisions without a dated decision record.
- A green unit/synthetic test is not proof of production integration, payment verification, live GPS or safe handover.
