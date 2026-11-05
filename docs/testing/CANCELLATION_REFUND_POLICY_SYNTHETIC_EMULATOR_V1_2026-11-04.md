# Cancellation & Refund Policy — Synthetic Emulator Test Record

**Policy source:** Notion POL-029 — Booking Cancellation, Rescheduling, No-Show & Refund Policy\
**Decision date:** 2026-11-05\
**Test scope:** Synthetic reference oracle using an isolated demo Firestore Emulator project.\
**Status:** Test-only reference suite; latest recorded correction removes whole-subscription early-termination logic from this suite.

## Approved business rules represented

- Trusted server time in `Asia/Kolkata`.
- **Individual scheduled-walk cancellation only:** at least 12 hours before that occurrence (inclusive) → 100% of its allocated paid amount; less than 12 hours → 50%.
- The individual-occurrence 12-hour rule does **not** define or calculate early termination of an entire subscription.
- Whole-subscription early termination is covered separately by PR #87 using the single cost-based **Cancellation Charge** model: completed walks use agreed subscription allocation; no Short-Term/One-Time repricing; only qualifying, disclosed, evidenced and legally eligible cancellation cost may be charged, otherwise ₹0.
- Active or past-due ambiguous individual occurrences require Operations review; the synthetic oracle does not invent a fee or refund.
- Company/Walker failure: attempt backup; if no backup is available, customer may choose reschedule or full refund of the affected walk.
- Refund authority: up to and including ₹2,000 Central Admin; above ₹2,000 Founder/CEO; suspicious cases escalated.
- Refund completion requires successful provider status and reconciliation.
- One occurrence may not be refunded more than once.

## Test coverage

The current individual-occurrence suite contains 18 synthetic tests. It covers the exact 12-hour boundary, under-12-hour partial refund, trusted timestamp use, active/completed/past-due states, company failure remedies, customer confirmation, approval routing, provider reconciliation, duplicate refund prevention, over-refund prevention, and stale events.

Whole-subscription settlement cases are maintained in the separate PR #87 suite (9 synthetic cases). Do not combine the two policy scopes.

## Isolation and limitations

- Uses only a `demo-*` Firebase project and Firestore Emulator.
- Uses isolated `test_cancellation_refund_policy_*` collections.
- Explicitly rejects production project ID `dojo-platform-b68a3`.
- Does not import or invoke production refund Functions, Payment Gateway, Customer App, Admin App, actual refund provider adapter, or production data.
- A passing synthetic suite is **not** production integration, legal compliance, or launch approval.
- Deterministic allocation of actual captured subscription payment across occurrences remains unresolved and must be approved before production calculations.
- The numeric Cancellation Charge cap requires pilot cost evidence and Indian consumer-law review.
- No-show grace/fee, provider refund SLA, and any tax/provider-fee deduction remain unresolved and are intentionally not implemented.

## Required next gates

1. Keep individual-walk cancellation and whole-subscription termination as separate policy/test scopes.
2. Resolve PR #86/#87/#88 dependency branches and rerun exact-head CI.
3. Approve deterministic payment allocation, role mapping, and Cancellation Charge cap/disclosure.
4. Build the real Auth + Functions + Firestore Emulator integration suite against exported production callables.
5. Obtain legal/payment-provider review before publishing enforceable customer terms.
