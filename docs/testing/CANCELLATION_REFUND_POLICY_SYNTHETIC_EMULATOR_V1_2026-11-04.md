# Cancellation & Refund Policy — Synthetic Emulator Test Record

**Policy source:** Notion POL-029 — Booking Cancellation, Rescheduling, No-Show & Refund Policy  
**Decision date:** 2026-11-04  
**Test scope:** Synthetic reference oracle using an isolated demo Firestore Emulator project.  
**Status:** Test proposal committed in this PR; no test execution result is implied by the presence of this document.

## Approved business rules represented

- Trusted server time in `Asia/Kolkata`.
- Cancellation at least 12 hours before the walk (inclusive) → 100% of the occurrence's allocated paid amount.
- Cancellation less than 12 hours before the walk → 50% of the occurrence's allocated paid amount.
- Completed walks excluded from ordinary mid-subscription refunds.
- Mid-subscription cancellation applies the cutoff separately to each future occurrence.
- Active or past-due ambiguous occurrences require Operations review; the synthetic oracle does not invent a fee or refund.
- Company/Walker failure: attempt backup; if no backup is available, customer may choose reschedule or full refund of the affected walk.
- Refund authority: up to and including ₹2,000 Central Admin; above ₹2,000 Founder/CEO; suspicious cases escalated.
- Refund completion requires successful provider status and reconciliation.
- One occurrence may not be refunded more than once.

## Test coverage

The suite contains 22 synthetic acceptance tests, including exact 12-hour boundary, under-12-hour partial refund, trusted timestamp use, active/completed/past-due states, subscription occurrence allocation, company failure remedies, customer confirmation, approval routing, provider reconciliation, duplicate refund prevention, over-refund prevention, and stale events against cancelled tasks.

## Isolation and limitations

- Uses only a `demo-*` Firebase project and Firestore Emulator.
- Uses isolated `test_cancellation_refund_policy_*` collections.
- Explicitly rejects production project ID `dojo-platform-b68a3`.
- Does not import or invoke production Functions, Payment Gateway, Customer App, Admin App, Firestore Rules, actual refund provider adapter, or production data.
- A passing synthetic suite is **not** production integration, legal compliance, or launch approval.
- Discount allocation must be finalized and shared by the quote/ledger implementation before production. The test oracle requires the actual paid amount to be allocated deterministically to each occurrence.
- No-show grace period/fee, provider refund SLA, and any provider-fee/tax deduction remain unresolved and are intentionally not implemented.

## Required next gates

1. Run the exact-commit GitHub Actions workflow and inspect logs.
2. Review the policy calculations and unresolved decisions.
3. Design actual refund ledger/provider adapter and role-authorized approval callables.
4. Add Auth + Functions + Firestore Emulator integration tests against the real exported callable.
5. Obtain legal/payment-provider review before publishing enforceable customer terms.
