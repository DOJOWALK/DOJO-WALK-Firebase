# Shared Booking, Assignment & Admin Role Contract — Draft

**Date:** 2026-11-02  
**Status:** Draft for cross-team review. Not approved, not implemented, not deployed.  
**Scope:** Source-of-truth alignment proposal for Firebase, Admin, Customer and Partner. This document does not change Firestore Rules, callable functions, app behavior, or business policy.

## 1. Authority and existing decisions

This draft must remain subordinate to the current Notion policy pages:

- POL-005 — Booking & Walker Assignment Policy: https://app.notion.com/p/404756abedb981768393f7a9e823ee10
- POL-021 — Access Control, Admin Roles & Privileged Account Security Policy: https://www.notion.so/404756abedb98114ad39e1db6c03d444
- POL-026 — Walker Availability, Booking Assignment & Replacement Policy: https://app.notion.com/p/404756abedb981028befeae66ec00f81
- POL-037 — India City–Zone Operating Structure & End-to-End Flow: https://app.notion.com/p/404756abedb981da9cd3d8c06277333

POL-005 already selects the **Hybrid Offer Model**: automatic sequential offer to one eligible Walker at a time, with authorized manual intervention as an exception. This draft does not reopen that decision.

Founder approval is still required where the policies say so. This draft is not evidence of approval.

## 2. Verified current source facts

The following are source observations, not target design:

1. Customer booking confirmation currently writes a document under `bookings/{bookingId}` with `bookingId`, `customerId`, `status: pending`, `walkerId: null`, `cancelRequest: null`, and `createdAt`.
2. Admin `AuthGate` currently admits an account when `admin_users/{uid}.isActive == true`; it does not check role.
3. Firebase Rules `isAdmin()` currently requires an active `admin_users/{uid}` with `role == super_admin`.
4. Admin Walker privileged actions also check active + `super_admin`.
5. Firestore Rules currently allow `admin_users.role` values `super_admin`, `admin`, and `support`. The reviewed rules do not yet demonstrate the full POL-021 role/scope matrix.
6. Admin Bookings screen is a list/filter view. Its human-readable labels are not a canonical backend enum.
7. Booking Rules permit customer cancellation-request updates only while the existing booking status is `pending`, `confirmed`, or `assigned`; customer review updates are separately allowed after `completed`.
8. Admin Rules allow selected direct updates to booking `status`, `walkerId`, and `assignedAt`. This permission is not an atomic assignment workflow.
9. Partner currently performs some booking lifecycle writes directly from the client. A server-authoritative walk-task lifecycle contract is still required.
10. Firebase Functions source currently exports five service-location/import callables; no booking assignment callable was found in the reviewed `functions/src/index.ts`.

## 3. Proposed canonical booking lifecycle — for review only

The following logical lifecycle is proposed for cross-app mapping. It is not a claim that these exact values are implemented in production:

| Logical state | Meaning | Expected authority |
|---|---|---|
| `draft` | Customer is still preparing request | Customer app / server validation |
| `submitted` | Request received, not yet validated | Server |
| `validated` | Required booking and service data passed validation | Server |
| `searching_walker` | Assignment engine is finding an eligible Walker | Server |
| `offer_pending` | Exactly one time-limited Walker offer is open | Server |
| `assigned` | A Walker accepted and server committed the assignment | Server transaction |
| `in_progress` | Authorized walk start accepted by backend | Trusted walk API |
| `completed` | Completion accepted after required checks | Trusted completion API |
| `cancelled` | Cancellation completed under approved policy | Server / authorized workflow |
| `needs_operations` | Automated assignment could not safely finish | Server; Central Operations handles |
| `failed` | Terminal technical/business failure with reason | Server |

### Mapping rule

Do not bulk-rename or reinterpret existing status strings until all current writers, readers, Rules, indexes, analytics and migration behavior have been inventoried. Preserve legacy compatibility through an explicit adapter where approved. Never let a UI label become an implicit backend state.

### Booking versus walk identity

Keep `bookingId` and `walkId` distinct. A booking may represent a customer request or plan; each scheduled service occurrence/task must have its own stable identity under an approved contract. Do not create duplicate IDs or collections until the existing Booking + Walk Task Contract and trusted completion proposal are reconciled.

## 4. Hybrid sequential assignment contract

### Required invariants

- Only an approved, active, eligible Walker may receive an offer.
- One booking may have at most one open offer at a time.
- Offer creation, acceptance, expiry, decline, cancellation and reassignment are server-authoritative and auditable.
- A declined, expired or cancelled offer cannot later be accepted.
- Acceptance must re-check booking state, offer state/expiry, Walker eligibility, availability and schedule conflicts inside one atomic server transaction.
- Concurrent accept attempts must result in exactly one winner.
- Duplicate/retried requests must be idempotent.
- Notification delivery delay must never revive an expired offer.
- Candidate exhaustion moves the booking to an operations exception state; do not claim assignment or confirmed availability.
- Manual retry/reassignment is restricted to authorized roles, requires a reason and creates an audit event.
- No silent reassignment during an active walk. Safe handover requirements apply before any active-walk replacement/stop.

### Candidate eligibility inputs to validate

Use the approved canonical source fields after schema mapping; do not assume that `isActive && isApproved` alone proves full eligibility. Eligibility must cover at least:

- approved and current KYC / required documents;
- onboarding and required training completion;
- active, not suspended/offboarded/safety-restricted;
- service zone eligibility against the active approved zone boundary;
- schedule, timezone, breaks, leave and holidays;
- accepted booking overlap and required travel/buffer;
- dog/service suitability and capacity;
- current availability revision/version.

### Still awaiting policy-owner approval

Do not hardcode these values until approved and made configurable:

- offer timeout;
- maximum sequential attempts;
- pause/backoff between attempts;
- candidate ranking weights and tie-breakers;
- search widening rules;
- minimum backup coverage / escalation thresholds;
- ownership and deadlines for each operations alert.

## 5. Proposed role and scope matrix — derived from POL-021, not implemented

| Role | Intended authority | Explicit boundary |
|---|---|---|
| Founder / CEO | Company-wide oversight; major policy, budget, senior appointments, risk and expansion approvals | Not routine dispatch or day-to-day booking operations |
| Super Admin | Privileged technical account/role administration, security configuration and audit | Separate technical security role; not automatically Central Head or Finance approver |
| Central Head / Central Operations | Cross-city operational oversight, City Manager coordination, support escalation, quality and consolidated reporting | Cannot grant self Super Admin or bypass backend controls |
| City Manager | Assigned City and its approved Zones | No access to another City without explicit scope grant |
| Zone Supervisor | Delegated operational actions within assigned Zone | No cross-zone/city authority by default |
| Finance | Approved payment, refund and reconciliation actions/views | No self-approval; follow refund authority policy |
| Support | Customer/Walker support views and explicitly permitted actions | No privileged assignment, approval or finance powers by default |
| Location preparer / reviewer / verifier | Explicitly separated location workflow duties | Separation of duties; scope-limited |
| Walker | Own offers and assigned service records, stage-specific data | No access to unrelated customer or Walker records |

Authorization should be evaluated server-side for every protected read/write using: active account + role + assigned scope + permitted action + current record state. Deny by default. UI navigation is not a security boundary.

### Current implementation gap

The reviewed Firebase Rules only demonstrate `super_admin` as `isAdmin()`; the rules' admin role allowlist contains `super_admin`, `admin`, and `support`. No verified City/Zone scope enforcement was found in the reviewed booking authorization path. The Admin UI gate and Firebase authorization are inconsistent. Do not simply broaden `isAdmin()` to every role.

## 6. Cross-app responsibilities

| Component | Intended responsibility |
|---|---|
| Customer | Submit request, see truthful server status, request cancellation where allowed, see assigned Walker only after committed assignment |
| Firebase backend | Validate booking, enforce state transitions, select candidate, create/expire offers, atomically accept, write audit records |
| Admin | Role/scope-filtered visibility, assignment attempt history, authorized retry/reassign with reason, exception queue |
| Partner | Publish availability through an approved contract, receive own offer, accept/decline, access only assigned task data, call trusted walk lifecycle APIs |
| Notifications | Deliver server-created offer/status events; never serve as authority for assignment |
| Audit | Record actor, role/scope, action, reason, prior/new state, timestamps, correlation/idempotency identifiers |

## 7. Security and privacy requirements

- Never trust client-supplied Walker ID, price, role, scope, eligibility, assignment status or timestamps.
- Customer can read only own bookings and approved stage-specific assignment details.
- Walker can read only own offers and assigned records with stage-specific fields.
- City Manager and Zone Supervisor queries must be restricted to assigned geographic scope by backend/Rules, not just client-side filters.
- Do not expose full customer phone, address or dog details before the approved access stage.
- Every privileged action must have a server-verified actor and immutable audit evidence.
- Client-side direct writes to protected lifecycle fields should be removed only after a compatible trusted API and migration path exist.

## 8. Acceptance test plan — not yet run

1. Inactive admin denied.
2. Active non-super-admin cannot access super-admin-only operation.
3. City Manager cannot read/write another City.
4. Zone Supervisor cannot read/write another Zone.
5. Central Operations can access only explicitly granted central operations actions.
6. Finance cannot approve its own restricted transaction.
7. Customer cannot read another customer's booking.
8. Walker cannot read another Walker's offer or assigned task.
9. Unapproved, suspended or training-incomplete Walker is ineligible.
10. Out-of-zone Walker is ineligible.
11. Leave, schedule conflict, overlap or insufficient buffer blocks eligibility.
12. Only one active offer exists per booking.
13. Declined/expired offer cannot be accepted later.
14. Concurrent acceptance produces exactly one winner.
15. Duplicate acceptance/retry is idempotent.
16. Delayed notification cannot revive an expired offer.
17. Candidate exhaustion creates an operations exception, not a false assignment.
18. Manual override requires authorization, scope and reason.
19. Active-walk reassignment requires safe handover evidence.
20. Customer sees assigned only after server commit.
21. Cancellation request is accepted only for canonical allowed states.
22. All privileged state changes produce audit events.
23. Rules deny direct client mutation of server-owned assignment fields.
24. No sensitive customer data is exposed before approved assignment stage.

## 9. Known cross-app mismatch requiring resolution

- Customer booking creation currently begins at `pending`; POL-005 lifecycle begins with a richer server validation/assignment sequence.
- Customer cancellation UI recognizes more statuses than the Firebase Rules allow. The UI and Rules must be reconciled against the approved canonical state machine; do not widen Rules speculatively.
- Admin screen labels do not map one-to-one to the proposed lifecycle.
- Partner direct booking lifecycle writes conflict with the intended server-authoritative walk-task model.
- Existing Rules' `isApprovedWalker()` helper checks active + approved flags only and must not be mistaken for full assignment eligibility.

## 10. Safe implementation order

1. Policy owners approve the open policy values and confirm POL-005 / POL-021 / POL-026 / POL-037 alignment.
2. Inventory every booking/status writer and reader across all four repositories and Firebase Rules.
3. Agree a versioned Booking + Walk Task schema and explicit legacy adapter.
4. Implement server-side role/scope authorization and negative tests.
5. Implement assignment offer/accept/expiry/next-candidate transactions and idempotency.
6. Integrate Customer, Admin and Partner to trusted APIs; remove direct client writes only after integration is verified.
7. Run emulator/unit/integration/CI tests and security review.
8. Only after full setup is complete, conduct controlled device testing. Production deployment and PR merge require explicit approval.

## 11. Change control

This PR is documentation-only. It does not change Rules, Functions, Firestore schema, app source, indexes, deployment workflows or production data. Keep it draft until cross-team review and policy approval. No PR merge, production deployment or device testing is authorized by this document.
