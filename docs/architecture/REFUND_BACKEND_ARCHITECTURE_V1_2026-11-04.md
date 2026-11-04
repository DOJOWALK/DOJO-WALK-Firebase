# DOJO WALK — Refund Backend Architecture V1

**Date:** 2026-11-04  
**Status:** Architecture proposal only — not production implementation  
**Policy:** POL-029 cancellation settlement direction (2026-11-05); synthetic policy tests PR #85 and subscription tests PR #87

## 1. Objective

Customer apps submit a cancellation request. Trusted backend code validates ownership and task state, calculates the refund from actual captured payment allocations, obtains role-appropriate approval, submits an idempotent provider request, and reconciles the provider result. No Customer or Walker client may create, approve, execute, or mark a refund complete.

## 2. Business rules

1. Use trusted server time; customer schedule timezone is `Asia/Kolkata`.
2. **Single-occurrence cancellation (existing rule):** remaining time >= 12 hours: 100% of that occurrence's allocated paid amount; remaining time < 12 hours: 50%. Apply separately to each occurrence. This is not an automatic 50% deduction on early termination of the entire subscription.
3. **Customer-initiated early subscription termination:** permit cancellation at any time. Charge verified completed walks only at their agreed subscription allocation/rate. Remove Short-Term/One-Time repricing completely; never retroactively reprice completed walks.
4. Use one customer-facing line item, **Cancellation Charge**, only for actual, evidenced, non-recoverable cancellation-related operational cost that was disclosed before purchase, is legally permissible, and is within a pre-disclosed maximum cap. If no qualifying cost or evidence exists, Cancellation Charge = ₹0. Do not create a separate Refund Processing Fee; ordinary gateway/transaction costs are company operating expenses.
5. A genuinely additional, non-refundable provider refund fee may be considered only if actually charged, itemised within the single Cancellation Charge, pre-disclosed, legally permissible, and not recovered elsewhere. No arbitrary percentage penalty, hidden admin fee, duplicate deduction, or amount above the actual captured payment. Numeric cap is not yet approved and must be set from pilot cost evidence plus legal review.
6. Completed walks are not refunded as unused services; active/started walks and ambiguous past-due occurrences require Operations review and safe handover. Do not invent no-show fees.
7. **Company/Walker service failure:** attempt backup/reschedule; if none is available and the customer declines rescheduling, refund the full allocated paid amount for the affected walk. Do not apply a customer Cancellation Charge to company-caused failure.
8. Refund <= ₹2,000: Central Admin approval. Refund > ₹2,000: Founder/CEO approval. Suspicious cases: escalation regardless of amount.
9. Mark refund complete only after verified provider success and reconciliation.
10. One occurrence may not be refunded twice, including retries with different request keys.
11. Show an itemised calculation before the customer confirms cancellation, record policy version and affirmative checkout consent, and provide a dispute/review route.

## 3. Proposed callable API

All proposed Firebase callable Functions in `asia-south1`, authenticated and App Check protected where supported. Names are proposals, not existing exports.

| Callable | Actor | Purpose |
|---|---|---|
| `requestBookingCancellation` | Customer | Submit explicit confirmation and reason; no amount from client |
| `reviewCancellationRequest` | Authorized Operations/Admin | Resolve active, past-due and exception cases |
| `approveRefundRequest` | Central Admin / Founder/CEO | Approve or reject calculated amount per threshold |
| `executeApprovedRefund` | Trusted backend only | Submit approved refund to provider |
| `reconcileRefundStatus` | Verified webhook / backend | Verify provider status and update ledger |
| `getRefundStatus` | Booking owner / authorized Admin | Read safe status |

Customer request allowlist: `bookingId`, optional `occurrenceIds`, `reasonCode`, `customerConfirmed: true`, `idempotencyKey`. Reject/ignore client-supplied amount, paid amount, cutoff timestamp, payment/provider status, approval actor, role, booking owner, task state and server timestamps. Resolve UID from Firebase Auth.

## 4. Proposed Firestore records

| Collection | Purpose | Client write |
|---|---|---|
| `refund_requests/{requestId}` | Request, calculation snapshot, review and approval state | Denied |
| `refund_ledger/{refundId}` | Financial lifecycle entries | Denied |
| `payment_refund_attempts/{attemptId}` | Provider attempts, provider IDs and safe response metadata | Denied |
| `booking_outbox/{eventId}` | Durable execution/reconciliation work | Denied |
| `booking_audit/{eventId}` | Actor, action, reason and state transitions | Denied |

Use existing `bookings`, `walk_tasks`, `booking_payments` and `booking_operation_exceptions` only after confirming their final schemas. Do not create parallel payment truth or silently modify legacy `payments`.

Minimum fields include booking/customer/occurrence IDs, policy version, server calculation timestamp, INR currency, integer paise amounts, per-occurrence breakdown, status, approval actor/time, provider/refund ID, idempotency-key hash and audit timestamps. Money is integer paise; never use floating-point rupees.

## 5. State machine

```text
requested -> operations_review -> awaiting_approval
requested ---------------------> awaiting_approval
awaiting_approval -> rejected | approved
approved -> provider_submitted
provider_submitted -> provider_pending | succeeded | failed
```

Provider timeout is not proof of failure. Keep pending and reconcile by provider refund ID/idempotency key before retry. Never create a second refund because a network call timed out.

## 6. Calculation and transaction design

- Source is the captured, reconciled payment—not displayed price or client quote.
- Quote/payment ledger must deterministically allocate actual paid amount across occurrences before subscription refunds are enabled.
- Single-occurrence cancellation retains the existing 12-hour rule: >=12h = 100%; <12h = 50%, per occurrence.
- Early termination of the whole subscription: completed walks are charged only at their agreed subscription allocation/rate. Short-Term/One-Time repricing is prohibited.
- One Cancellation Charge may include only actual, evidenced, non-recoverable cancellation-related operational cost, disclosed before purchase, legally permissible, and within a pre-disclosed cap. If evidence is missing or no qualifying cost exists, charge ₹0.
- Ordinary gateway/transaction costs are company operating expenses; do not add a separate Refund Processing Fee. Any genuinely additional provider refund fee must be actually charged, pre-disclosed, lawful, and included within the single Cancellation Charge without duplication.
- Refund = actual captured payment − agreed completed-walk charges − one permitted Cancellation Charge. Company-caused service failure carries no customer Cancellation Charge.
- If any occurrence is active, started, or past-due with ambiguous event history, hold subscription calculation for Operations review.
- Sum of occurrence allocations must equal captured payment total; otherwise block and raise an exception.
- For 50%, round down to whole paise and retain exact calculation breakdown.
- Deterministic allocation of actual captured subscription payment across occurrences remains unresolved and must be approved before production calculations.
- The numeric Cancellation Charge cap is unresolved; determine it from pilot cost evidence and Indian consumer-law review before launch.
- No-show grace/fee, tax/provider-fee deduction and gateway refund SLA remain unresolved; do not implement deductions or fees until separately approved.

Transaction flow:
1. Authenticate; derive customer UID server-side.
2. Transactionally re-read booking, tasks, payment and task states.
3. Validate ownership, task eligibility, captured payment, allocation and customer confirmation.
4. Create one idempotent request for booking + occurrence set; persist hash, not raw secret.
5. Atomically lock/transition affected future tasks, write audit and outbox. Preserve completed tasks; active tasks go to Operations review.
6. Approval is separate and role-authorized; enforce threshold server-side.
7. Provider call occurs outside Firestore transaction using provider idempotency.
8. Verify signed webhook/provider status; reconcile idempotently.
9. Mark ledger succeeded only after verified success and reconciliation. Financial ledger/audit entries are append-only.

## 7. Authorization and Rules

- Customer may request cancellation only for own booking.
- Walker cannot initiate/approve refunds or write financial records.
- Central Admin: up to and including ₹2,000, subject to finalized active role.
- Founder/CEO: required above ₹2,000.
- Suspicious cases: escalation and execution hold.
- Use finalized DOJO WALK role/permission mapping. Existing super_admin checks in service-location callables do not prove refund roles exist.
- Firestore Rules deny all client writes to refund requests, ledger, attempts and outbox. Read is owner-scoped or role-scoped. All checks need Emulator tests.

## 8. Exception behavior

| Condition | Expected behavior |
|---|---|
| Unauthenticated / wrong owner | Reject, no writes |
| Payment not captured | Reject or payment review |
| Allocation mismatch | Block, durable exception |
| Exactly 12h / 11h59m | 100% / 50% |
| Active or ambiguous past-due walk | Operations review |
| Duplicate request | Return existing status |
| Provider timeout | Pending + reconcile |
| Provider success not reconciled | Not completed |
| Stale start/assignment after cancellation | Reject |
| Company failure, no backup | Offer reschedule or full affected-walk refund |
| Suspicious pattern | Escalate, hold |

## 9. Required real integration tests (Auth + Functions + Firestore Emulator)

1. Unauthenticated and wrong-owner requests rejected.
2. Forged amount, payment status, role, timestamps and provider IDs rejected/ignored.
3. Exact 12-hour and just-under boundary.
4. Subscription cutoff per occurrence; completed occurrence excluded.
5. Active/past-due ambiguity routed to review.
6. Captured payment allocation mismatch blocks request.
7. Customer confirmation required.
8. Duplicate and concurrent requests create one refund per occurrence.
9. Approval threshold at ₹2,000 and above; unauthorized Manager/Walker/Central actors rejected as appropriate.
10. Suspicious case cannot auto-execute.
11. Provider timeout reconciles without duplicate refund.
12. Invalid webhook signature rejected; duplicate valid webhook idempotent.
13. Verified provider success updates ledger once; failure never falsely completes.
14. Stale Walker start/assignment cannot revive cancelled task.
15. Company failure without backup offers full affected-walk refund or reschedule.
16. Rules deny direct client writes; customer reads only own safe refund status; audit has actor/reason/server time.

## 10. Implementation gates

A. Approve payment allocation schema, refund collections and role mapping.  
B. Build pure production domain calculator/state machine with unit tests.  
C. Implement actual callable + Auth/Functions/Firestore Emulator integration tests.  
D. Select provider and implement sandbox adapter, signature verification, idempotency and reconciliation.  
E. Integrate Customer/Admin status and approval UI; no client financial writes.  
F. Legal/provider review, monitoring, support runbook, reconciliation reporting and explicit Founder rollout approval.

## 11. Current status

PR #85 synthetic policy oracle: 22/22 passed on its recorded exact commit. This document is architecture only. No production callable, ledger, provider adapter, UI integration, Rules change, migration, merge or deployment is included. This proposal is stacked on PR #85 and must be reviewed with its parent; it is not launch approval.
