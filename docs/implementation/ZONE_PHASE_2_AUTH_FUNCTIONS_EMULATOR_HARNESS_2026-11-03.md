# DOJO WALK — Phase 2 Auth + Functions Emulator Harness

Date: 2026-11-03
Status: Test-harness design and acceptance matrix only. No Zone lifecycle callable implementation, production data access, role provisioning, deployment, or activation.

## 1. Purpose and safety boundary

Prepare an isolated Firebase Auth + Functions + Firestore Emulator harness for the canonical Zone lifecycle. The harness will exercise trusted callable authorization using synthetic Firebase Auth identities and synthetic Firestore authority documents. It must not use real Founder UIDs, real credentials, production project IDs, or production data.

This document is not authorization to implement or deploy runtime lifecycle behavior. The open policy/authority gates listed in the implementation plan remain binding.

## 2. Emulator topology

Use the repository's existing Firebase Emulator configuration:

- Auth: 9099
- Functions: 5001
- Firestore: 8080
- Project ID: a dedicated demo ID such as `demo-dojo-zone-lifecycle`
- Functions region: `asia-south1`

The test runner should build Functions before starting the Emulator suite. Tests should connect the Firebase client SDK to Auth and Functions Emulators and use callable HTTPS functions through the SDK, not call private implementation functions directly.

Firestore fixture setup/teardown may use the Emulator Admin SDK. Test data must be namespaced with deterministic synthetic IDs and cleared between tests. No emulator test may point at `dojo-platform-b68a3`.

## 3. Synthetic identity and authority fixtures

Use deterministic, clearly synthetic Auth UIDs:

- `test-founder-allowed`
- `test-founder-inactive`
- `test-central-admin-authorized`
- `test-central-admin-inactive`
- `test-boundary-reviewer`
- `test-boundary-submitter`
- `test-area-manager-scoped`
- `test-supervisor-scoped`
- `test-legacy-super-admin`
- `test-walker`
- `test-customer`
- unauthenticated context

Authority must be derived from trusted Firestore documents read by callable code, not from client-supplied fields or custom claims alone. The test fixtures may create synthetic `founder_users/{uid}` and `admin_users/{uid}` records only inside the Emulator. The real Founder schema/bootstrap process remains an open security gate and must be verified before production implementation.

## 4. Callable test contract

The harness should invoke the exported callable endpoints through `httpsCallable` after signing in to the Auth Emulator. Expected callable errors must be asserted by Firebase Functions error code, not by matching only display text.

For every state-changing callable, assert both:
1. the callable response/error; and
2. the resulting Firestore documents, revisions, booking eligibility, and immutable audit evidence.

Never treat an expected denial as a passing authorization test unless the protected state is also proven unchanged.

## 5. Emergency suspension acceptance matrix

Once the callable is implemented, tests must prove:

| Actor / scenario | Expected result |
|---|---|
| Unauthenticated actor | Denied; no state or audit mutation |
| Customer, Walker, Supervisor, Area Manager | Denied; no state or audit mutation |
| Legacy `super_admin` without explicit Central Admin authority | Denied |
| Inactive Central Admin | Denied |
| Authorized active Central Admin, valid emergency reason | Temporary suspension accepted |
| Authorized Central Admin, missing/blank/oversized reason | Invalid argument; no mutation |
| Repeated identical suspension request | Idempotent result; no duplicate state transition/audit event |
| Concurrent suspension attempts | One coherent final state; no conflicting revisions or duplicate transition |
| Suspended Zone booking eligibility | New booking rejected by trusted backend |
| Existing in-progress walk | Not silently cancelled or terminated |
| Successful suspension | Audit event records Zone ID, actor UID, reason, timestamp, action, and resulting revision |
| Founder notification | Immediate notification request is durably recorded and dispatched through the approved notification path; delivery failure is observable and retryable |
| Notification dispatch failure | Suspension remains safety-effective; failure/retry is recorded and escalated, never silently dropped |

Notification provider, delivery retry policy, and escalation mechanics must be selected during implementation design. The approved product requirement remains immediate Founder notification; it must not be downgraded to a periodic digest.

## 6. Routine deactivation separation tests

- Central Admin may create a deactivation request but cannot complete routine deactivation.
- Only an explicitly authorized active Founder identity can approve.
- Approval must be bound to the exact Zone ID, request ID, expected revision, and decision.
- A stale revision, wrong request, forged Founder field, legacy `super_admin`, or client-supplied approval must fail.
- The Zone becomes deactivated only after the trusted backend records the explicit Founder approval.
- Emergency suspension must not be accepted as a substitute for routine deactivation approval.

## 7. Cross-cutting security and consistency tests

- Founder identity is never inferred from email, display name, legacy role, or client claims.
- A boundary submitter cannot review their own boundary.
- Reviewer permission is explicit and independent of generic admin access.
- Zone name uniqueness is scoped to City: same normalized name rejected within one City; same name allowed in a different City.
- Stale boundary revision/hash is rejected.
- Every state transition uses transaction-safe expected revision checks.
- Duplicate idempotency keys cannot create duplicate approval, audit, or notification events.
- Client direct writes to canonical Zone collections remain denied by Firestore Rules.
- Audit records are server-authored and immutable to clients.
- No action may expand a manager's authority outside assigned scope.

## 8. Required test execution sequence

1. Verify Emulator project ID and ports before test start.
2. Build Functions TypeScript.
3. Start Auth, Functions, and Firestore Emulators only.
4. Seed synthetic Auth users and Firestore authority fixtures.
5. Run callable authorization matrix.
6. Run lifecycle state, revision, idempotency, and concurrency tests.
7. Run booking-eligibility and in-progress-walk safety tests.
8. Run notification outbox/dispatch failure and retry tests.
9. Verify Firestore Rules deny client forgery.
10. Clear fixtures and stop Emulators.

Each report must record exact commit SHA, workflow run, commands, test totals, skipped/TODO count, and emulator project ID. No TODO may be counted as passed.

## 9. Current blockers before runtime callable implementation

- Boundary geometry read visibility by role/scope is not yet approved.
- Actual Founder authority document schema and controlled bootstrap/recovery must be securely verified.
- Legacy Partner `zones` mapping/cutover is unresolved.
- Notification delivery provider and technical retry/escalation mechanics need a documented implementation decision while preserving immediate Founder notification.

Until those gates are closed, only isolated synthetic harness design and non-production test scaffolding are permitted. Do not enable Admin Zone actions, grant real roles, migrate production data, merge the implementation PR, deploy Functions/Rules, or activate Zones.


## 10. Phase 2 executable fixture scaffold — 2026-11-03

A non-production Auth/Firestore fixture smoke test has been added at `functions/test/zone_emulator_harness.test.cjs`. It provisions deterministic synthetic Auth users and fixture-only authority documents, signs each identity in through the Auth Emulator, checks fixture isolation, and cleans up the synthetic records. It intentionally does not invoke Zone callables because those exports do not yet exist and the security/schema entry gates remain open.

Run from the repository root:

```bash
npm run test:zone-emulator
```

The command builds Functions and executes the fixture test under Auth, Functions, and Firestore Emulators using project ID `demo-dojo-zone-lifecycle`. The test refuses to run unless the active project ID starts with `demo-` and the Auth/Firestore Emulator host variables are present. This is fixture/bootstrap smoke coverage only; it is not evidence that callable authorization, suspension, Founder notification, or Zone lifecycle behavior works.
