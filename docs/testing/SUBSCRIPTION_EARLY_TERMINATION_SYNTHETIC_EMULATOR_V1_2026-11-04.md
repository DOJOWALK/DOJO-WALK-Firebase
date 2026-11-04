# Subscription Early Termination — Synthetic Emulator Test Record

**Policy source:** POL-029 section 21, proposed early-termination rule  
**Date:** 2026-11-04  
**Status:** Test-only reference oracle; no production implementation.

## Rules and coverage

- Customer may terminate at any time.
- Completed walks use the pre-disclosed Short-Term rate only with affirmative pre-purchase consent.
- Without recorded consent, no retroactive repricing; use agreed subscription allocation.
- Deduct only actual, evidenced, pre-disclosed and legally permissible non-refundable third-party expense.
- No arbitrary percentage penalty or hidden admin fee; deductions cannot exceed captured payment.
- Company-caused failure is separate; without backup and with reschedule declined, refund full affected-walk allocation.
- Nine synthetic cases cover zero completed walks, consent/no-consent, expense eligibility, hidden fee exclusion, over-deduction, company failure, backup/reschedule and idempotency.

## Isolation and limitations

Uses only a demo-* Firestore Emulator project and isolated test collection; explicitly rejects production project dojo-platform-b68a3. This is not production Auth/Functions integration, payment-provider testing, legal advice, or launch approval.

## Gates

Run exact-head CI; obtain Indian consumer-law review; finalize payment allocation and consent capture; only then design production callable integration.
