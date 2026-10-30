# Role × Action × Scope × State — Firebase Emulator Test Plan
Date: 2026-10-30
Status: Draft test specification — NOT approved, implemented, or executed
Repository: DOJOWALK/DOJO-WALK-Firebase
Target branch: docs/booking-walk-backend-plan-2026-10-30
Depends on:
- ROLE_ACTION_PERMISSION_MATRIX_DRAFT_2026-10-30.md
- ROLE_PERMISSION_FIREBASE_RULES_GAP_AUDIT_2026-10-30.md
- POL-021 Access Control (Draft)
- POL-037 City–Zone Operating Structure (Draft)
- POL-004 Walker / Partner Management (Draft)
- POL-005 Booking & Walker Assignment (Draft)
- POL-007 Walk Lifecycle & Live Tracking (Draft)

## 1. Purpose and non-goals
Define the emulator acceptance suite that must exist before backend role expansion or booking/walk integration. Every permission decision is evaluated across:
1. authenticated identity and active account;
2. canonical role grant;
3. explicit City/Zone/resource scope;
4. action permission;
5. current record state;
6. required independent approval;
7. immutable audit write.

This document is a test plan, not implementation. No production data, Firestore Rules, Functions, IAM, or deployment configuration is changed. Do not treat a passing emulator suite as proof that production has the same rules deployed.

## 2. Test environment
- Firebase Emulator Suite only: Auth + Firestore + Functions (and Storage once authoritative Storage rules are located).
- Use a dedicated demo project ID, e.g. `demo-dojo-role-authz`; never use `dojo-platform-b68a3` as a test project.
- Node test runner with `@firebase/rules-unit-testing`; Functions tests use the Functions emulator and callable client.
- Seed fixtures through emulator rules-disabled admin context only. Never seed production.
- Every test starts from a clean emulator state or uses isolated document IDs.
- CI must fail closed if emulator host is missing, project ID is not prefixed `demo-`, or any Firebase production credential/config is detected.
- Record commit SHA, Node version, Firebase CLI version, emulator versions, test count and result in CI artifacts.

## 3. Canonical fixture model (proposed)
Do not implement until schema and policies are approved. These fixtures express test relationships, not final Firestore schema.

### Identities
- `founder-1`: active Founder/CEO.
- `superadmin-1`: active Super Admin.
- `central-1`: active Central Operations, cross-city grant.
- `manager-a`: active City Manager assigned to City A.
- `manager-b`: active City Manager assigned to City B.
- `supervisor-a1`: active Zone Supervisor assigned Zone A1.
- `supervisor-a2`: active Zone Supervisor assigned Zone A2.
- `walker-a1`: approved/active Walker assigned a booking in Zone A1.
- `walker-a2`: approved/active Walker assigned Zone A2.
- `walker-b1`: approved/active Walker assigned Zone B1.
- `support-1`: active Support, Case C-1 only.
- `finance-1`: active Finance, finance resources only.
- `preparer-1`: Location Preparer assigned Zone revision Z-A1-v2.
- `reviewer-1`: independent Location Reviewer assigned same revision.
- `inactive-manager`: inactive City Manager.
- `unknown-role`: active account with unrecognized role.
- `service-walk-command`: runtime identity restricted to walk command resources.

### Geography and records
- City A: Zones A1 and A2.
- City B: Zone B1.
- Customer C-A owns booking BA in Zone A1.
- Customer C-B owns booking BB in Zone B1.
- BA has walker-a1 assigned; BB has walker-b1 assigned.
- Walk WA belongs to BA; Walk WB belongs to BB.
- Zone A1 revision v2 is prepared but not reviewed; a separate fixture has review approval but no Founder GO; a third has Founder GO for exact revision/hash but not yet activated.

## 4. Test notation
- **ALLOW** means request succeeds and only intended fields/resources are exposed or changed.
- **DENY** means Rules/Function rejects request; no protected document or audit side effect is committed.
- **CONDITIONAL** means test cannot be enabled until a policy decision is approved. Keep it skipped with an explicit reason, never silently pass.
- For query tests, verify both returned document set and query behavior. A client-side filter is not an authorization test.
- For every denied transaction, assert protected record unchanged and no success audit exists.
- For every successful sensitive mutation, assert audit event exists and is immutable.

## 5. Role × action × scope × state acceptance matrix

| Actor | Action / resource | Correct scope/state | Expected | Negative control |
|---|---|---|---|---|
| Founder | Read company launch summary | Company summary, no unnecessary PII | ALLOW | Direct customer PII bulk read DENY |
| Founder | Record GO for Zone A1 revision v2 | Reviewer approved exact revision/hash | ALLOW after policy approval | GO for changed hash or unreviewed revision DENY |
| Founder | Execute routine booking dispatch | Any booking | DENY by default | Same request via SDK/REST also DENY |
| Super Admin | Manage privileged admin account | Controlled two-person workflow | CONDITIONAL | Self-grant/self-activation DENY |
| Super Admin | Routine City/Zone booking operations | Any City | DENY by default | UI visibility must not change result |
| Central Ops | Read booking exception summary | All explicitly assigned operating cities | ALLOW | Read unrelated PII / raw historical GPS DENY unless case purpose |
| Central Ops | Reassign booking | Current state permits reassignment; candidate eligible and same service Zone | ALLOW through callable only | Cross-zone Walker, completed/cancelled booking, direct client write DENY |
| City Manager A | Read booking | City A only | ALLOW | City B booking DENY |
| City Manager A | Reassign booking | City A booking, allowed state, eligible Walker in correct Zone | CONDITIONAL on approved delegation | City B / wrong Zone / completed booking DENY |
| Zone Supervisor A1 | Read active Zone operations | Zone A1 only | ALLOW | Zone A2 and City B records DENY |
| Zone Supervisor A1 | Request backup/reassignment | Zone A1 booking in eligible exception state | Req / callable workflow | Direct walkerId update DENY |
| Walker A1 | Read assigned booking BA | Assigned, active, within permitted time window | ALLOW | Read BB or another Walker's BA DENY |
| Walker A1 | Start walk WA | Assigned to A1, booking valid, schedule window open, pickup checks complete | ALLOW via command | Wrong Walker, early/late window, cancelled/reassigned booking DENY |
| Walker A1 | Complete WA | Active walk; required safe handover evidence valid | ALLOW via command | No handover, already completed, wrong walk/booking DENY |
| Walker A1 | Update booking status/start/completed/payment fields directly | Any state | DENY | Try REST and SDK field patch |
| Walker A1 | Submit GPS | Assigned active walk WA; monotonic event time and valid accuracy | ALLOW via authenticated endpoint | GPS for WB, inactive walk, replayed/old/future event DENY |
| Support | Read case C-1 | Assigned case and masked/minimum fields | ALLOW | Other case, full KYC, payment secrets, route history DENY |
| Support | Refund / payout / assign Walker | Any | DENY | Callable direct invocation DENY |
| Finance | Read settlement / refund record | Assigned finance scope | ALLOW | Customer live GPS / Walker KYC DENY |
| Finance | Execute refund | Approved request, limit and independent approval satisfied | CONDITIONAL | Self-approval, duplicate refund, amount over limit DENY |
| Location Preparer | Create/edit draft Zone revision | Assigned revision before submission | ALLOW | Edit submitted/approved immutable revision DENY |
| Location Preparer | Approve own revision | Same revision prepared by actor | DENY | Alternate endpoint / direct document update DENY |
| Reviewer | Verify Zone revision | Assigned revision; independent reviewer | ALLOW | Review own prepared revision DENY |
| Reviewer | Activate Zone | Any revision | DENY | Direct status update DENY |
| Central Ops | Activate Zone | Exact revision has independent verification + Founder GO + readiness checks | ALLOW via callable | Missing/expired/mismatched approval DENY |
| Service identity | Write walk event | Only callable-owned event collection and valid command correlation | ALLOW | Read unrelated customer data or mutate roles DENY |
| Inactive/unknown role | Any privileged action | Any scope/state | DENY | No fallback role or legacy `admin` alias |

## 6. Detailed emulator suites

### A. Authentication and role integrity
- unauthenticated request denied for every protected collection/callable.
- inactive account denied even when role and scope match.
- unknown role denied.
- legacy `admin` and `support` strings do not inherit `super_admin`.
- user cannot create/update their own admin role, active flag, scope grants or approval fields.
- role grant change is audited, requires independent approval, and invalidates stale authorization on subsequent requests.
- revoked role/scope is effective immediately for new requests.
- client-supplied `actorUid`, `role`, `cityId`, `zoneId` cannot override trusted claims/grants.

### B. Geographic scope
- City Manager A query returns only City A records.
- City Manager A cannot get/list City B records by known document ID, collection query, collection group, or alternate endpoint.
- Supervisor A1 cannot read Zone A2 or B1, even within City A.
- Central Ops can read only explicitly granted cities.
- Walker can access own profile and assigned work only; assignment to Zone A1 does not authorize Zone A2.
- scope missing, malformed, inactive or conflicting with resource ancestry => deny.
- moving a Walker or booking between Zones invalidates old scope immediately; stale cached client data grants no access.
- nested documents inherit and validate parent scope; do not trust a child-supplied cityId/zoneId without checking its parent.

### C. Booking and assignment state
- Customer creates only own valid booking in allowed initial state.
- Customer cannot assign walkerId, set price/payment status, or create a confirmed booking.
- assignment callable checks booking state, service Zone, Walker approved/active/available, schedule overlap, capacity and idempotency.
- manual reassignment requires allowed exception state, authorized actor scope and reason; no reassignment after walk starts/completes.
- candidate Walker from another Zone denied unless a specific approved cross-zone exception is recorded.
- client cannot patch authoritative assignment or lifecycle fields.
- concurrent assignment requests yield one winner; losing request returns stable conflict and does not create duplicate audit/event.

### D. Walk lifecycle and handover
- start only from eligible assigned state and correct Walker.
- start requires booking ID + stable walk ID + idempotency key; missing IDs denied.
- repeated start with same idempotency key returns same result; conflicting duplicate denied.
- pickup confirmation and required safety checks must be present before transition.
- complete requires active walk and required return/handover evidence; no dog may be left unattended.
- recipient unavailable, dog missing, injury or other incident routes to incident state, not ordinary completion.
- completed/cancelled/incident-locked records reject invalid transitions.
- operations cannot force-complete without explicit, separately approved emergency workflow and complete audit.
- event creation and booking/walk state update commit atomically; simulated audit/event write failure rolls back state.

### E. GPS privacy, integrity and freshness
- only authenticated assigned Walker can submit points for that active walk.
- customer can read only permitted active tracking for own booking; access closes at policy-defined point.
- Zone Supervisor sees only active operational location in own Zone, and only for operational purpose.
- Central access to historical route is case/incident-bound and audited; Support has no raw route access by default.
- reject points for unknown walk, wrong Walker, completed/cancelled walk, malformed coordinates, impossible accuracy, future timestamp, replayed sequence or out-of-order timestamp.
- stale location is labelled stale/unavailable; never render as current.
- verify retention/deletion job and export permissions once retention policy is approved.
- location reads and exports are auditable where policy requires.

### F. Finance and payment integrity
- customer/Walker/operations clients cannot write gateway-confirmed payment state or payment IDs.
- only trusted payment webhook/finance callable can create payment state transitions.
- verify webhook signature/idempotency and duplicate notification behavior in Functions emulator.
- Finance cannot change assignment or walk state.
- Operations cannot approve/execute refund outside delegated policy.
- refund preparer cannot approve own request; threshold over delegated limit requires Founder approval if policy confirms.
- duplicate refund/payout requests do not double execute; failed provider call leaves auditable pending/retry state.
- hide sensitive bank/payment data from roles without explicit need.

### G. Zone revision approval and activation
- preparer may edit only draft assigned revision.
- reviewer must be different UID from preparer.
- Founder GO is bound to exact revision ID/hash, City and Zone.
- any polygon/metadata change after review invalidates review and GO.
- Central activation denied without current independent review + Founder GO + required capacity/readiness checks.
- City Manager/Supervisor cannot activate directly.
- Super Admin cannot silently substitute for Founder or Central role.
- every submit/review/GO/activate/suspend action creates immutable audit evidence.

### H. Audit integrity and failure behavior
- clients cannot create/update/delete trusted audit records.
- server event contains actor UID, resolved role, scope, action, target, before/after revision, reason, correlation ID, idempotency key and server timestamp as applicable.
- actor role/scope are resolved server-side, not accepted from client body.
- audit write failure aborts protected state transition.
- audit records are immutable to all human roles; read access is scoped and minimized.
- denied attempts do not leak protected document fields in error messages.

## 7. Minimum test file layout (proposed)
```
test/
  authz/
    role_integrity.rules.test.mjs
    city_zone_scope.rules.test.mjs
    booking_assignment.rules.test.mjs
    walk_lifecycle.rules.test.mjs
    gps_privacy.rules.test.mjs
    finance_separation.rules.test.mjs
    zone_approval.rules.test.mjs
    audit_immutability.rules.test.mjs
functions/
  test/
    authz_callable.test.ts
    booking_walk_commands.test.ts
    payment_commands.test.ts
```
Use shared fixtures/helpers for identities, scope grants, bookings, walks, Zones, and assertions. Do not duplicate authorization logic inside test helpers; tests must call real Rules and real emulator Functions.

## 8. CI and release gates
1. Run formatting/lint and unit tests.
2. Start Auth, Firestore, Functions emulators; Storage emulator after rules source is located.
3. Run all Rules tests against deployed-to-emulator rules, not mocks.
4. Run callable integration tests against Functions emulator.
5. Run direct REST/SDK negative bypass tests.
6. Require zero unexpected skips; every conditional test must reference an unresolved policy decision.
7. Upload emulator logs and test report; redact secrets and customer-like personal data.
8. Branch protection requires all checks on exact commit SHA.
9. Before production, compare deployed rules/functions hashes/config with approved source commit and run a separate staged rollout approval. Emulator PASS alone is not production approval.

## 9. Blockers / decisions required
- Approve canonical role IDs and whether one person can hold multiple roles/scopes.
- Approve exact scope grant schema and how City/Zone ancestry is stored.
- Approve which role can manually assign/reassign and what exceptions permit cross-zone coverage.
- Approve walk state transitions, pickup checks, safe handover evidence and incident lock behavior.
- Approve GPS visibility windows, stale threshold, retention and export rules.
- Approve finance thresholds, preparer/approver separation and payment-provider webhook design.
- Approve Founder GO + Central activation process and exact Zone revision identity.
- Locate authoritative Storage rules and KYC/document access policy.
- Reconcile legacy Country/State/City/Area/Locality source with current State/UT → District → City → Zone product requirement.

## 10. Current readiness assessment
- Existing emulator rules tests in the repository cover Walker lifecycle decision rules; they do not establish this full role × scope × action matrix.
- Existing Flutter Admin emulator integration is separate and does not prove City/Zone authorization or booking/walk lifecycle.
- This new suite is a specification only. No test code was added and no emulator test was run for this plan.
- Current gate: **NO-GO** for role expansion, live walk integration, or production rule changes until policy decisions, schema, implementation and emulator evidence are complete.

## 11. Completion checklist for implementation phase
- [ ] Founder / Security / Operations approve matrix and policy exceptions.
- [ ] Canonical role/scope schema approved.
- [ ] Rules and callable authorization helpers implemented on a feature branch.
- [ ] Direct client lifecycle/payment writes removed or safely migrated.
- [ ] All A–H suites implemented and run against emulators.
- [ ] CI passes on exact PR head SHA.
- [ ] Storage rules reviewed and tested.
- [ ] Staging deployment and production source parity verified.
- [ ] Explicit production release approval recorded.
