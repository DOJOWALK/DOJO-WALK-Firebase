# DOJO WALK — Zone Visibility Synthetic Emulator Acceptance Report

Date: 2026-11-03
Status: Founder-approved visibility Rules/Functions implementation added on the branch; exact-head synthetic Emulator acceptance suites PASS. Production release gates remain closed.
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


## 11. Founder-approved visibility implementation — exact-head verification

Implementation code head: `35a3def2d1a91bcedd1fefb9fa43436a26991ada`.
PR: [#64 — Draft / Open / Unmerged](https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/64).

### Runtime changes now present on the implementation branch

- Added `listVisibleServiceZones` callable in `functions/src/index.ts`.
  - Resolves active Founder authority from `founder_users/{uid}`.
  - Resolves Central Admin only with active `admin_users/{uid}` and explicit `permissions.zoneGeometryReadAll`.
  - Resolves City Manager from exactly one current City assignment.
  - Resolves Supervisor from current active Zone assignment(s).
  - Resolves Walker from active/approved Partner profile plus current `walker_zone_assignments`; editable onboarding `zoneName/zoneNames/zones` preferences are ignored.
  - Does not grant visibility to legacy `super_admin`, `admin`, or `support` by role alone.
  - Returns only canonical Zone metadata, no polygon coordinates or internal assignment records; validates canonical schema version and uses scoped pagination.
- Added `getVisibleServiceZoneBoundary` callable.
  - Checks current role and assignment on every call.
  - Uses `verifiedBoundaryId + verifiedBoundaryRevision + boundaryHash` binding for Zone-scoped map reads.
  - Reviewer reads only explicitly assigned review boundary and cannot read own submission.
  - Submitter reads own unsubmitted draft only.
  - Customer, inactive/revoked, legacy-only, unassigned, and out-of-scope actors are denied.
  - Writes a `service_zone_audit` access event without polygon coordinates before returning geometry.
- Firestore Rules now deny direct client reads of canonical `service_zones`, Zone boundary documents, Founder authority, assignment, approval, name-index, and Zone audit collections. Legacy non-Zone City/Area boundary access is retained for existing workflows.
- Zone boundary create/update/delete through client SDKs is denied; Zone lifecycle evidence remains server-owned.
- `admin_users` role, active-state, and permission changes are no longer allowed through direct client updates; only safe profile fields remain client-updatable.

### Exact-head GitHub Actions results

All five workflows completed SUCCESS on the exact implementation/test head `35a3def2d1a91bcedd1fefb9fa43436a26991ada`:

- [Test Firestore Security Rules — 41657817742](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41657817742) — SUCCESS.
- [Firestore Rules Tests — 41657817801](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41657817801) — SUCCESS.
- [Firebase Storage Rules Tests — 41657817694](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41657817694) — SUCCESS.
- [Trusted Location Geometry and Callable Tests — 41657817674](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41657817674) — SUCCESS.
- [Zone Auth and Functions Emulator Fixtures — 41657817770](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41657817770) — SUCCESS.

Exact test totals from the combined geometry/callable workflow:
- Firestore Rules: 73 total / 63 passed / 0 failed / 10 TODO.
- Functions: 291 passed / 0 failed / 0 TODO. This includes the 12-test Zone visibility callable suite: 12 passed / 0 failed.
- Functions TypeScript build: SUCCESS.
- Storage Rules workflow: SUCCESS.

The 10 Rules TODO entries are pre-existing Zone lifecycle/approval gates outside this read-visibility implementation; they are not counted as PASS. All new Zone visibility direct-read and callable cases are executable and passing.

### Remaining release gates — not completed

1. Secure production Founder UID bootstrap/recovery and controlled production role provisioning.
2. Verify production City Manager/Supervisor/Walker assignment data and assignment writer/revocation workflows.
3. Complete legacy Partner `zones` to canonical `service_zones` mapping and reviewed cutover; no name-based automatic mapping.
4. Implement and test the remaining Zone lifecycle TODOs, including boundary review, Founder approval, activation, deactivation, emergency suspension, notification delivery/retry/escalation, and reactivation.
5. Adapt Admin/Partner consumers to the callable contract and verify their integration; keep UI actions disabled until paired integration tests pass.
6. Run full release/security review before merge/deployment.

PR #64 remains Draft / Unmerged. No production Firestore data, real authority records, migration, deployment, Admin UI enablement, or Zone activation was performed.


## 12. Expanded authorization regression suite — final exact-head PASS

Final tested implementation/test code SHA: `651825cfe09193f9aff5ee138683cf572b0c7422`.

The callable contract suite was expanded beyond the initial 10 callable cases to 11 executable callable tests, covering:
- Inactive Central Admin denial.
- Immediate loss of Central Admin geometry visibility when the explicit permission is revoked.
- Reviewer self-review denial, even when the reviewer is assigned that exact boundary.
- Stale verified-boundary revision rejection, even for Founder.
- Global list behavior for canonical Zone records while keeping the stale-boundary fixture in a separate City.
- Full synthetic fixture cleanup, including geometry access audit events.

### Exact final test results

All five workflows completed SUCCESS on this exact head:

- [Test Firestore Security Rules — 41659707637](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41659707637) — SUCCESS.
- [Firestore Rules Tests — 41659707626](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41659707626) — SUCCESS.
- [Firebase Storage Rules Tests — 41659707653](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41659707653) — SUCCESS.
- [Trusted Location Geometry and Callable Tests — 41659707644](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41659707644) — SUCCESS.
- [Zone Auth and Functions Emulator Fixtures — 41659707662](https://github.com/DOJOWALK/DOJO-WALK-Firebase/actions/runs/41659707662) — SUCCESS.

Final exact totals from the combined Emulator workflow:
- Firestore Rules: 73 total / 63 passed / 0 failed / 10 TODO.
- Functions: 292 passed / 0 failed / 0 TODO.
- Auth + Functions fixture workflow: 13 total / 13 passed / 0 TODO (2 synthetic fixture bootstrap tests + 11 callable visibility tests).
- Functions TypeScript build: SUCCESS.
- Storage Rules: SUCCESS.

The 10 Firestore Rules TODO entries are the pre-existing Zone lifecycle/approval gates; they remain explicitly outside the completed read-visibility scope and are not counted as PASS. All 11 callable visibility tests pass, including the expanded inactive-admin, permission-revocation, self-review, reassignment, and stale-boundary cases. The other 2 passing tests are synthetic Auth/Firestore fixture bootstrap checks.

This exact head supersedes the earlier 2026-11-03 exact-head results in Sections 3 and 11 for current implementation verification. The earlier baseline and intermediate failures remain in this report as historical test-first evidence.

PR #64 remains Draft / Open / Unmerged. The current branch contains no production role provisioning, production data writes, migration, deployment, Admin UI enablement, or Zone activation.
