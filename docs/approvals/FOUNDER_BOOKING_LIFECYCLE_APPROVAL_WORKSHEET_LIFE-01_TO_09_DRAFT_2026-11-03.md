# Founder / Product Approval Worksheet — Booking Lifecycle LIFE-01…LIFE-09

**Date:** 03 Nov 2026
**Status:** Decision worksheet only — all nine decisions remain OPEN until the authorized owner records an explicit choice.
**Parent:** [Firebase PR #59 — Cross-app booking lifecycle audit](https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/59)
**Related Notion gate:** [DOJO WALK — Booking API Contract & Callable Implementation Gate](https://app.notion.com/p/40a756abedb98148a671eacf2248fa8a)

## What is already a design direction (not reopened here)

- Service timezone direction is `Asia/Kolkata`; authoritative timestamps are UTC; Walk Tasks retain service-local date/time context.
- One parent Booking may contain multiple child Walk Tasks; the existing `walks` completed-history/review collection is not repurposed as scheduled tasks.
- Walker assignment direction is hybrid: sequential automatic offers to one eligible Walker at a time, with authorized manual Operations fallback. No simultaneous active offers for one task.
- Customer request receipt is not availability confirmation, finalized quote, payment verification, booking confirmation, Walker assignment, or walk start.
- Until approval, keep existing legacy writers/readers unchanged. No new status writes, task persistence, offer callable, Rules change, merge, deployment, or device testing.

## Decision record instructions

For each LIFE item, the decision owner should record:
1. **Decision:** selected behavior / exact values.
2. **Rejected alternatives:** only where useful to explain the choice.
3. **Approver role:** Founder/Product/Operations/Finance/Safety/Security as listed.
4. **Approval date and contract version.**
5. **Affected apps/repos and migration/rollback impact.**

If no decision is made, leave it **OPEN — implementation blocked**. A comment or worksheet entry is not itself production authorization; implementation, merge, deployment, and device testing remain separate gates.

---

## LIFE-01 — Parent Booking states and legacy mapping

**Owner:** Founder/Product with Customer, Admin and Partner owners
**Question:** What is the one canonical Parent Booking status enum, and how do existing values map without changing their meaning?

Review the existing legacy values and proposed candidates in the parent audit. Explicitly cover at least: `pending`, `confirmed`, `assigned`, `accepted`, `picked_up`, `walking`, `completed`, `cancelled`; decide whether they map to Parent Booking, Walk Task, Assignment/Offer, or are display-only legacy values.

**Safe boundary:** Do not alias or bulk-rewrite legacy values. Keep current flow unchanged until a versioned mapping is approved.

**Decision:** OPEN — implementation blocked
**Selected enum / mapping:**
**Approver + date + version:**

## LIFE-02 — Walk Task states and transition matrix

**Owner:** Founder/Operations with Backend, Partner and Admin owners
**Question:** Which Walk Task states are canonical, and which exact from → to transitions are permitted?

Record normal, terminal and exception states; distinguish persisted state from events such as arrival, pickup, start and completion. Identify actor, authorization, preconditions and side effects for every transition.

**Safe boundary:** No task lifecycle implementation from a list of candidate states alone. Require an explicit transition table and negative tests.

**Decision:** OPEN — implementation blocked
**Selected states + transition table reference:**
**Approver + date + version:**

## LIFE-03 — Meaning of accepted / picked_up / walking

**Owner:** Product with Partner and Backend owners
**Question:** Does `accepted` mean offer acceptance or task acknowledgement? Are `picked_up` and `walking` task states, timestamped events, or legacy display values?

**Safe boundary:** Do not reuse one status across different lifecycle domains without an explicit mapping. Keep offer response separate from physical walk progress.

**Decision:** OPEN — implementation blocked
**Selected semantics and field/event mapping:**
**Approver + date + version:**

## LIFE-04 — Assignment offer parameters

**Owner:** Founder/Operations
**Question:** Set the sequential offer response timeout, maximum attempts, pause/retry behavior, candidate ranking/tie-breakers, and criteria for widening the search.

**Safe boundary:** One active offer per task; only approved, eligible Walkers; stale/expired offers cannot be accepted. Keep values configurable. Do not hard-code guessed timeouts, attempt counts or ranking weights.

**Decision:** OPEN — implementation blocked
**Timeout:**
**Maximum attempts:**
**Pause/retry + widen-search rule:**
**Ranking/tie-breakers:**
**Approver + date + version:**

## LIFE-05 — When a request becomes assignable

**Owner:** Founder/Product with Finance and Operations
**Question:** At what exact point may a request become eligible for Walker assignment relative to service-zone validation, availability/capacity, quote finalization, payment initiation/verification and booking confirmation?

**Safe boundary:** Request receipt alone is not assignable. Define reservation expiry, failed-payment release and recovery if payment succeeds but task creation is delayed. No client-supplied payment or availability status is trusted.

**Decision:** OPEN — implementation blocked
**Required ordered steps + expiry/recovery behavior:**
**Approver + date + version:**

## LIFE-06 — Cancellation, refund and payment reversal

**Owner:** Founder with Finance and Operations; align POL-010/POL-012
**Question:** Define the separate transitions for customer cancellation request, cancellation decision, fee, refund approval, payment reversal and reconciliation.

**Safe boundary:** Do not invent or deploy cancellation charges. Preserve the existing 12-hour policy framework only as a pending policy decision where fee details remain unresolved. Refund authority and thresholds must follow approved policy.

**Decision:** OPEN — implementation blocked
**Selected cancellation/refund/reversal rules:**
**Approver + date + version:**

## LIFE-07 — Replacement and active-walk safe handover

**Owner:** Operations with Safety owner
**Question:** Define the separate process for replacing a Walker before a future walk and replacing/stopping service during an active walk. Specify handover evidence, customer updates and escalation when no safe backup exists.

**Safe boundary:** No silent reassignment during an active walk. Do not mark replacement complete or dog returned without verified safe handover. If no safe handover is possible, follow an approved safety escalation.

**Decision:** OPEN — implementation blocked
**Future-walk replacement rule:**
**Active-walk handover proof + escalation:**
**Approver + date + version:**

## LIFE-08 — Role and geographic-scope matrix

**Owner:** Founder with Security/Admin owners; align POL-021
**Question:** Approve the read/write/action matrix for Customer, Walker, Central Operations, City Manager, Zone Supervisor, Finance and Super Admin, including geographic scope and stage-based privacy.

**Safe boundary:** Deny by default; backend authorization for every protected read/write/action. Super Admin is a technical/security role, not automatically dispatch or Finance approval. City Manager cannot act outside assigned city/zone scope.

**Decision:** OPEN — implementation blocked
**Role × action × scope matrix reference:**
**Approver + date + version:**

## LIFE-09 — Audit events, idempotency, concurrency and retries

**Owner:** Backend + Security + Operations
**Question:** Approve the audit event schema and correlation fields; idempotency key format/retention; duplicate and concurrent request behavior; stale/out-of-order command handling; retry and reconciliation semantics.

**Safe boundary:** No trusted write path until duplicate submissions, concurrent accepts, stale offers, delayed notifications and retry-after-timeout cases are safe and tested. Assignment must have at most one active offer and one winner per task.

**Decision:** OPEN — implementation blocked
**Audit event fields:**
**Idempotency + retention:**
**Concurrency + retry rules:**
**Approver + date + version:**

---

## Consolidated approval status

| Decision | Owner | Status |
|---|---|---|
| LIFE-01 Parent Booking enum + legacy mapping | Founder/Product + app owners | OPEN |
| LIFE-02 Walk Task enum + transitions | Founder/Operations + app owners | OPEN |
| LIFE-03 Accepted / picked_up / walking semantics | Product + Partner + Backend | OPEN |
| LIFE-04 Offer timeout / attempts / ranking | Founder/Operations | OPEN |
| LIFE-05 Assignability vs availability / quote / payment | Founder/Product + Finance/Operations | OPEN |
| LIFE-06 Cancellation / refund / reversal | Founder + Finance/Operations | OPEN |
| LIFE-07 Replacement / safe handover | Operations + Safety | OPEN |
| LIFE-08 Role / scope / privacy matrix | Founder + Security/Admin | OPEN |
| LIFE-09 Audit / idempotency / concurrency / retry | Backend + Security + Operations | OPEN |

**Current gate: BLOCKED.** No decisions have been approved by this worksheet. Once the owners record decisions, reconcile them into the Notion Booking API Contract and relevant POL policies before implementation planning. Exact-head CI, security review, coordinated app-owner review, Founder GO, and separate merge/deployment/device-test approvals remain mandatory.
