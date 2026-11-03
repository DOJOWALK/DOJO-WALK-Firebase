# DOJO WALK — Zone Visibility Synthetic Emulator Acceptance Report

Date: 2026-11-03
Status: First synthetic Rules acceptance batch executed; one confirmed baseline security failure; callable acceptance remains pending because the trusted read APIs do not yet exist.
Tested code commit: `4b72e295d6cb3818aba7f82e5ccfd0b2e9170d1f`
Branch: `implementation/zone-emulator-first-plan-2026-11-03`
Project: `demo-dojo-zone-visibility-rules` (Firestore Rules Emulator suite)
Separate Auth/Functions fixture project: `demo-dojo-zone-lifecycle`

## 1. Founder approval and execution boundary

The Founder approved the Zone Visibility Authority and Assignment Schema Proposal on 2026-11-03. This report covers only synthetic Emulator tests. No production Rules/Functions implementation, real authority record, migration, app change, deployment, merge, or Zone activation is authorized or performed by this test batch.

## 2. Test code added

- `test/zone_visibility.rules.test.mjs` — synthetic actor matrix for raw geometry reads, internal authority/assignment direct reads, and client forgery.
- Root `package.json` — includes the new suite in `npm test`.
- Existing `functions/test/zone_emulator_harness.test.cjs` remains a separate Auth/Firestore synthetic fixture bootstrap smoke test. It does not invoke Zone read callables.

## 3. Rules Emulator result — exact evidence

GitHub Actions:
- Test Firestore Security Rules run: [41653691172](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41653691172)
- Firestore Rules Tests run: [41653691301](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41653691301)

The primary Rules workflow and the combined geometry/callable workflow reached the Firestore Emulator suite and failed on the same single assertion. A separate Firestore Rules workflow emitted the same failing test output in its job log but its final workflow conclusion was `cancelled`; it is not counted as a second failed workflow:

- Tests: 83
- Passed: 61
- Failed: 1
- TODO: 21
- Cancelled: 0
- Skipped: 0

Confirmed failure:
- Test: `raw Zone geometry cannot be fetched or listed directly by Legacy super_admin only`
- Assertion: direct `getDoc(service_location_boundaries/zone-boundary-secret)` was expected to be denied but succeeded.
- Source cause: current `firestore.rules` allows `service_location_boundaries/{boundaryId}` get/list through `isAdmin()`; `isAdmin()` accepts an active `admin_users/{uid}` with `role == super_admin`.
- This conflicts with the approved policy and the new schema decision: legacy `super_admin` alone must not grant geometry access. Raw boundary reads must move behind the trusted callable authorization layer.

This is an intentional baseline detection, not a reason to weaken the test. The Rules implementation remains unchanged in this batch.

The remaining 21 TODOs include the 10 new callable read authorization cases and pre-existing lifecycle gates. TODO is not PASS. Callable authorization cannot be proven until `listVisibleServiceZones` and `getVisibleServiceZoneBoundary` exist and the Auth/Functions Emulator harness invokes them through the callable SDK.

## 4. Coverage exercised

- Direct raw geometry get/list denied for Founder, Central Admin, City Manager, Supervisor, Walker, Reviewer, Submitter, Customer, inactive Admin, and unauthenticated actor.
- Direct access to internal Founder/assignment collections denied for the synthetic actor matrix.
- Client writes attempting to forge Founder authority or operational assignments denied.
- Legacy active `super_admin` raw boundary read is the one observed failure.

## 5. Coverage not yet executable

The following remain TODO until the trusted callable read APIs and trusted assignment schema implementation exist:
- Founder and Central Admin global scope, active/revoked status.
- City Manager assigned-City scope and reassignment.
- Supervisor exact assigned Zone scope.
- Walker active canonical assignment versus editable onboarding preferences.
- Reviewer exact assignment and submitter self-review denial.
- Submitter own-draft-only scope.
- Revocation/expiry/disablement immediate effect.
- Payload/custom-claim/email/display-name/legacy-role spoof resistance.
- Customer geometry denial through all callable surfaces.
- Guessed IDs, pagination, broad query, and scope-tampering resistance.

## 6. Other exact-head workflow outcomes

- [Trusted Location Geometry and Callable Tests run 41653691294](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41653691294) — FAILURE; root `npm test` failed on the same baseline assertion, so downstream Functions test command did not complete.
- [Zone Auth and Functions Emulator Fixtures run 41653691186](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41653691186) — CANCELLED; no PASS evidence.
- [Firebase Storage Rules Tests run 41653691116](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41653691116) — CANCELLED; no PASS evidence.
- [Firestore Rules Tests run 41653691301](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41653691301) — CANCELLED; job log contains the same failing test output before cancellation.

Only run 41653691172 has a final FAILURE conclusion directly attributable to the new test. Cancellation is not PASS and is not counted as a failure of the test assertion.

## 7. Next safe gate

1. Finish collecting the Auth/Functions synthetic fixture workflow result and preserve exact logs.
2. Review and strengthen the synthetic acceptance cases as needed without changing the approved policy.
3. Only after the test suite is complete and run, begin the separately gated Rules/Functions implementation to satisfy the tests.
4. Re-run all acceptance tests against the implementation; do not merge, deploy, or activate Zones until all required gates pass.

## 8. Explicit non-effects

No `firestore.rules` or `functions/src/index.ts` runtime implementation change was made in this test batch. No production project, real Founder UID, real assignments, customer data, or live Zone was accessed or modified.


## 9. Executable callable contract tests — second synthetic batch

Tested code commit: `9d16165064e37e61bebd3aee210b40a1d3fd40bb`.

Added `functions/test/zone_visibility_callable.test.cjs` and updated `npm run test:zone-emulator` to run it through Firebase Auth + Functions + Firestore Emulators. The suite signs synthetic actors into Auth Emulator, seeds only synthetic authority/assignment/Zone fixtures in demo Firestore, and invokes the proposed callable names through the Firebase callable SDK.

Callable contract under test:
- `listVisibleServiceZones({ pageSize })` returns `data.zones[]` with `zoneId`, scoped by the caller's current authority/assignment.
- `getVisibleServiceZoneBoundary({ zoneId })` or `{ boundaryId }` returns only the authorized Zone/review/draft boundary.
- Denials must be `functions/permission-denied`; caller payload, custom claims, email, display name, and legacy role must not widen access.

Synthetic test actors and scenarios include Founder active/inactive, Central Admin, City Manager, Supervisor, Walker with deliberately conflicting editable onboarding preferences, assigned Reviewer, draft Submitter, Customer, legacy `super_admin`, and custom-claims spoof actor. Revocation/reassignment is tested by changing only synthetic Emulator assignment records and invoking the callable again.

### Exact Auth + Functions Emulator result

[Zone Auth and Functions Emulator Fixtures run 41654893262](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41654893262) — FAILURE (expected baseline: callable APIs are not implemented).

- Functions TypeScript build: SUCCESS.
- Auth, Functions, and Firestore Emulators started with `demo-dojo-zone-lifecycle`.
- Emulator loaded only the five existing legacy exports: `reviewServiceLocationBoundary`, `activateServiceLocation`, `setServiceLocationStatus`, `saveServiceLocationWithNameIndex`, and `manageServiceLocationImportRun`.
- Tests: 12; passed: 2; failed: 10; TODO: 0.
- The two existing synthetic Auth/Firestore fixture bootstrap tests passed.
- The 10 callable contract tests failed because `listVisibleServiceZones` and `getVisibleServiceZoneBoundary` are not exported yet; allowed-call tests returned `functions/not-found`, and expected-denial tests could not receive the required `functions/permission-denied` response.

This confirms the callable tests are executable and currently red against the pre-implementation source. Do not interpret this as an authorization implementation failure: the endpoints do not exist yet. Do not weaken the tests to accept `not-found`; implementation must add the trusted APIs and satisfy the approved policy.

### Other exact-head workflow outcomes

- [Test Firestore Security Rules run 41654893256](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41654893256) — FAILURE; Rules suite: 72 total / 61 passed / 1 failed / 10 TODO. Same legacy `super_admin` direct-boundary-read gap.
- [Trusted Location Geometry and Callable Tests run 41654893293](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41654893293) — FAILURE at root `npm test` due the same Rules gap; downstream Functions suite did not run.
- [Firestore Rules Tests run 41654893307](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41654893307) — FAILURE on the same Rules assertion.
- [Firebase Storage Rules Tests run 41654893333](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41654893333) — SUCCESS.

## 10. Implementation gate remains closed

The synthetic test-first matrix now includes both Firestore Rules direct-access tests and executable Auth/Functions callable contract tests. The current source fails the known legacy direct-read assertion and does not yet export the two scoped read callables. This is the intended pre-implementation baseline.

The next engineering phase may now implement the Rules/Functions changes strictly against these tests, after any remaining test contract refinements. Re-run both emulator suites after implementation. No merge, deployment, real role provisioning, production migration, Admin UI enablement, or Zone activation until all acceptance tests pass and separate release approval is obtained.
