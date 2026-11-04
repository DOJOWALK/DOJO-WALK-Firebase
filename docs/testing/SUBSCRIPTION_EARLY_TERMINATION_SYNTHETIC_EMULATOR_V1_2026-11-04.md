# Subscription Early Termination — Synthetic Emulator Test Record

**Policy source:** POL-029 section 21, single Cancellation Settlement model (2026-11-05)  
**Date:** 2026-11-05  
**Status:** Test-only reference oracle; no production implementation.

## Rules and coverage

- Customer may terminate at any time; future not-yet-started occurrences stop after cancellation is confirmed.
- Completed walks are charged only at their agreed subscription allocation. Short-Term/One-Time repricing is prohibited.
- One customer-facing Cancellation Charge may include only actual, evidenced, non-recoverable cancellation-related operational cost that was pre-disclosed, legally permissible, and within the disclosed cap. If any eligibility condition is missing, charge zero.
- Ordinary gateway/transaction costs are company operating expenses; there is no separate automatic Refund Processing Fee.
- Company-caused failure is separate; without backup and with reschedule declined, refund the full affected-walk allocation and apply no customer Cancellation Charge.
- Nine synthetic cases cover zero completed walks, subscription allocation/no repricing, cost/cap limit, missing eligibility evidence, no separate refund fee, over-deduction prevention, company failure, backup/reschedule and idempotency.
- The numeric Cancellation Charge cap is intentionally not set by this test suite; it requires pilot cost evidence and legal review.

## Isolation and limitations

Uses only a demo-* Firestore Emulator project and isolated test collection; explicitly rejects production project dojo-platform-b68a3. This is not production Auth/Functions integration, payment-provider testing, legal advice, or launch approval.

## Gates

Run exact-head CI; obtain Indian consumer-law review; finalize deterministic allocation of actual captured payment and customer-facing cap disclosure; only then design production callable integration.
