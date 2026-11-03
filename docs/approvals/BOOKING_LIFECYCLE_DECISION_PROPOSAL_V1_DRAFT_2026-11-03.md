# Booking Lifecycle Decision Proposal V1 — Founder Review Draft

**Date:** 03 Nov 2026  
**Status:** PROPOSAL ONLY — not an approved production contract  
**Parent:** [Firebase PR #59 — Cross-app Booking Lifecycle Audit](https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/59)

## Decision principles
1. A Booking is the customer's service request/order. A Walk Task is one scheduled dog-walk occurrence. A Walk record is verified history of an actual walk. Keep their IDs separate.
2. Backend is the authority for assignment, payment verification, lifecycle transitions, timestamps, eligibility and audit.
3. Customer request receipt is not confirmation, payment, assignment or walk start.
4. Use service timezone Asia/Kolkata for India pilot service-local scheduling; persist authoritative instants as UTC and retain service-local date/time context.
5. One active offer per Walk Task, sent sequentially to one eligible Walker. No broadcast race.
6. Operations fallback follows automatic assignment attempts; Central is alerted when configured attempts are exhausted. City/Zone managers remain within assigned geography.
7. A future Walk Task can be reassigned under the approved replacement process. An active walk must never be silently reassigned or stopped without safe dog handover.
8. Keep legacy client behavior unchanged until a versioned contract, migration and rollback plan are approved and tested.

## LIFE-01 — Parent Booking lifecycle
**Recommended canonical states:** request_received → under_validation → awaiting_quote → awaiting_payment → confirmed → service_in_progress → completed. Exception states: cancellation_requested, cancelled, needs_operations, failed.
Customer display must derive from parent + task projections. Preserve raw legacy status in audit/migration metadata. Map pending to request_received only where evidence confirms it meant submitted intent. Map assigned/walker_assigned only if a valid task assignment exists. Do not blindly map accepted, picked_up, walking, in_progress or completed to parent states.

## LIFE-02 — Walk Task lifecycle and transitions
**Recommended normal states:** scheduled → assignment_pending → offer_pending → assigned → walker_en_route → arrived → dog_picked_up → in_progress → handover_pending → completed.
**Exception/terminal states:** assignment_exhausted, needs_operations, cancel_requested, cancelled, interrupted, failed.
Only backend transitions persisted state. Each transition requires actor, role/scope, prior state, preconditions, timestamp, correlation ID and audit event. Arrival/pickup/start/completion should also create immutable event timestamps. Completion requires verified dog return/handover evidence, not a client boolean alone.

## LIFE-03 — Semantics
- accepted is an Offer response, not a Parent Booking or Walk Task state. Backend validates authenticated Walker, open/unexpired offer and current eligibility.
- Successful acceptance atomically closes the offer and commits the one winning Walker to the task.
- picked_up and walking are legacy terms; canonical task event/state terms are dog_picked_up and in_progress.
- walker_assigned, walker_arriving, confirmed and in_progress are rendered from canonical parent/task/offer state, not independently written by app clients.

## LIFE-04 — Sequential assignment policy
- Candidate must be approved, active, available for the service slot, eligible for the zone, not suspended, and not already committed to a conflicting task.
- Send one offer at a time; recheck eligibility at offer creation and acceptance.
- Decline, expiry, revoked eligibility or failed delivery closes that offer before the next candidate is offered.
- Use deterministic ranking: zone eligibility, availability/conflict check, then configured proximity/quality/continuity factors. Do not use unapproved weights.
- After configured automatic attempts fail, set needs_operations and alert Central. Manager may attempt a manual eligible match only within scope; out-of-area action remains Central-only.
- Timeout, max attempts, retry delay, widening radius/zone and ranking weights remain configuration decisions for Operations/Founder. Do not hard-code guessed values. The customer-facing backup wait target remains approximately 5–10 minutes only where primary Walker has failed/no response or navigation has not started; this is not a blanket offer timeout.

## LIFE-05 — When a request becomes assignable
Recommended ordered gate:
1. Backend validates authenticated customer, dog ownership, pickup-address ownership, zone boundary/serviceability and schedule/duration/dog-count constraints.
2. Backend calculates/records a finalized quote and applicable service terms.
3. Availability/capacity is rechecked for each Walk Task.
4. Payment is verified server-side (or an explicitly approved payment mode/authorization gate is recorded).
5. Booking is confirmed and child Walk Tasks are created idempotently.
6. Assignment service may now offer eligible tasks to Walkers.
If a slot is unavailable, do not take payment for that unavailable slot; offer nearby available times. If payment succeeds but task creation is delayed, reconcile by payment reference/idempotency key and retry safely without charging twice. Immediate/ASAP requests require a live availability check; client device time is not authoritative. Regular schedules require a bounded approved service period; do not create an unbounded task series.

## LIFE-06 — Cancellation, refund and payment reversal
Keep separate records/events for cancellation request, cancellation decision, cancellation fee calculation, refund approval, payment reversal and reconciliation. Preserve the agreed 12-hour cancellation framework but leave actual charge/fee schedule blocked until Finance/Founder approval. No cash and no coupon workflow. Central Admin may approve refunds up to ₹2,000 after checks; above ₹2,000 requires Founder/CEO approval. A cancellation request does not itself cancel an active walk. Never stop an active walk until safe dog handover and safety escalation are completed.

## LIFE-07 — Replacement and safe handover
- Before a future walk starts: close/revoke old assignment/offer, select a newly eligible Walker, notify customer, preserve assignment history.
- After navigation begins but before dog pickup: Central/authorized Operations decides replacement; customer receives updated Walker details and ETA.
- During an active walk: no silent reassignment. Walker must safely return/hand over the dog to customer or an explicitly authorized recipient. Capture time, location evidence, recipient confirmation and incident notes where relevant. If safe handover cannot be achieved, invoke incident escalation; do not mark completed or release another Walker to take custody without explicit handover.
- Backup flow must not create two simultaneous custody assignments.

## LIFE-08 — Role, scope and privacy
- Customer: own bookings/tasks only; submit request/cancellation; no assignment/payment/status authority.
- Walker: own profile, offers addressed to self, assigned tasks only; send commands through trusted APIs; no arbitrary walkerId or status writes.
- Zone Supervisor: operational visibility/actions within assigned zone, only explicitly granted permissions.
- City/Area Manager: assigned city scope only; cannot operate outside it.
- Central Operations: cross-zone operations, support, manual assignment/retry/reassignment and escalation, with reason + audit.
- Finance: payment/refund/reconciliation actions only within approved monetary authority.
- Super Admin: technical/security administration; role alone does not grant dispatch or Finance approval.
- Founder/CEO: major policy/exception approvals and reports; not routine Walker performing customer walks.
- Deny by default; enforce in backend and Firestore Rules; protect customer contact/address and dog details by stage and task assignment.

## LIFE-09 — Audit, idempotency, concurrency and retries
Every command/event should include event ID, entity type/ID, task ID where applicable, actor UID/type/role, action, prior/new state, reason, server timestamp, service-local date/time, correlation ID, idempotency key, source app/version and relevant offer/payment reference. Never log secrets or unnecessary private data.
- Customer submit uses a stable client-generated idempotency key bound to authenticated UID; server stores result and returns same booking on retry.
- Offer acceptance uses offer ID + Walker identity; transaction checks offer open/unexpired and task unassigned before atomic winner commit.
- At most one active offer and one assigned Walker per task.
- Duplicate commands return prior result; stale/out-of-order commands are rejected without partial writes.
- Retry transient infrastructure failures with bounded backoff; do not retry business-rule denials.
- Reconciliation jobs detect payment-without-task, task-without-assignment, split completion writes and stale offers; alert Central rather than silently mutating ambiguous records.

## Required approvals still outstanding
| Item | Proposed decision status | Required owner |
|---|---|---|
| LIFE-01…03 state domains and meanings | Recommended; needs Founder/Product sign-off | Founder/Product + app owners |
| LIFE-04 numeric offer timeout/attempts/ranking weights | OPEN — no values invented | Founder/Operations |
| LIFE-05 availability/quote/payment order | Recommended; Finance gate confirmation needed | Founder/Product + Finance |
| LIFE-06 fee schedule and payment-provider reversal behavior | OPEN where policy/provider specifics unresolved | Founder + Finance |
| LIFE-07 safe handover acceptance evidence | Recommended; safety procedure sign-off needed | Operations + Safety |
| LIFE-08 role/action/scope matrix | Recommended; security review needed | Founder + Security/Admin |
| LIFE-09 idempotency retention and retry limits | OPEN for exact numeric retention/limits | Backend + Security |

## Implementation gate after approval
1. Freeze Booking, Walk Task, Offer and Payment DTOs and version them.
2. Update Notion Booking API Contract and relevant POL policies as source of truth.
3. Implement callable/backend transitions and authoritative Rules; remove client direct lifecycle writes only in coordinated app releases.
4. Add emulator tests for every allowed and denied transition, concurrency, expiry, duplicate/retry, geographic scope and handover.
5. Add Customer–Partner–Admin integration fixtures and tests; resolve scheduledAt/preferredTime vs date/startTime via approved adapter, not duplicate ad hoc fields.
6. Obtain exact-head CI, Security review, app-owner review and separate Founder GO before merge/deploy/device testing.

**No production changes are authorized by this proposal.**