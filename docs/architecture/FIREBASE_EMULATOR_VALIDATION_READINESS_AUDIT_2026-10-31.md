# Firebase Emulator Validation Readiness Audit — 2026-10-31

## Scope and evidence
Source-only review of the Firebase repository `main` and Partner branch `chore/notion-aligned-structure`. No emulator was launched from this review, no test command was executed, and no deployed Firebase project was queried or changed. This document is a readiness assessment, not a test result.

## Confirmed emulator setup
- Root `firebase.json` configures Firestore Emulator on port 8080, Auth on 9099, Functions on 5001; Emulator UI is disabled.
- Root `package.json` has `npm test` → `node --test test/*.test.mjs`, with `@firebase/rules-unit-testing`, Firebase SDK and Firebase CLI dependencies.
- Root test directory contains four Rules test files: booking, general Firestore rules, service-location integrity, and walker lifecycle.
- `functions/package.json` has a separate TypeScript build/test setup and an `emulate` script for Functions + Firestore. It is not the same test command as root Rules tests.

## Existing CI workflow overlap
Two workflows independently run the root Firestore Rules Emulator suite:
1. `.github/workflows/firestore-rules-tests.yml` — path-filtered push to main, pull request path filter, and manual dispatch. Explicitly installs Java 21 and runs project `demo-dojo-walker-lifecycle-rules`.
2. `.github/workflows/test-firestore-rules.yml` — also runs on push to main, pull requests, and manual dispatch, with overlapping path filters. It has a separate workflow-lint job and runs the same root `npm test` through the emulator, but does not explicitly set up Java. It uses project `demo-dojo-rules-tests`.

These are overlapping pipelines, not proof of duplicate test execution on every commit: exact trigger paths differ slightly. They create avoidable maintenance/diagnostic complexity and may execute the same test suite twice. Recommendation: retain one canonical emulator workflow, or explicitly split responsibilities (e.g. one rules suite, one workflow-lint-only suite). Do not delete either workflow until its unique checks and recent run history are reviewed.

## P0/P1 contract cases currently missing from inspected test names
The existing root Rules tests cover booking validation, service-location integrity, and walker approval lifecycle. The inspected test names do not show regression cases for:
- Partner owner update to `walkers/{uid}.workingSchedule` (current Firebase main walker owner-update allowlist is known to permit `availability`, not `workingSchedule`).
- Partner completion batch writing `bookings/{bookingId}` fields `dogReturned`, `returnLocationVerified`, `route` and creating `walks/{walkId}`.
- Explicit denial of direct client writes to server-authoritative walk records and progress fields that should be callable-only.
- Atomic/idempotent completion and duplicate submission behavior (Rules alone cannot prove trusted Function transaction behavior).

The Partner branch also contains its own `firestore.rules`, which is not the canonical deployment source. Emulator validation must load Firebase repository `firestore.rules`, never Partner's copy.

## Required Emulator test matrix (before changing Rules)
Use isolated Auth contexts and seed documents with Rules disabled only in test setup. Run against Firebase repo canonical Rules:
1. Approved walker updates only `workingSchedule`: expected DENY under current allowlist; record exact error.
2. Approved walker updates permitted `availability`: expected ALLOW only when all current predicates are satisfied.
3. Approved assigned walker updates booking with `dogReturned`: expected DENY under current allowlist.
4. Approved assigned walker updates booking with `returnLocationVerified`: expected DENY.
5. Approved assigned walker updates booking with `route`: expected DENY.
6. Approved assigned walker creates `walks/{walkId}`: expected DENY by default-deny unless an explicit match exists.
7. Unassigned walker attempts the same booking progress write: expected DENY.
8. Customer attempts to write walk completion or walker progress fields: expected DENY.
9. Customer booking create contract remains allowed only through the existing booking validator; preserve all current booking tests.
10. If a trusted callable is introduced, separately test assignment/eligibility validation, idempotency, stable walk ID, transaction rollback and retry behavior using Functions Emulator integration tests.

Important: tests 1 and 3–6 are expected-denial checks of the current contract, not fixes. Do not loosen client rules simply to make the Partner UI pass. The safe target is to move authoritative completion and route persistence to a trusted backend callable, then test its transaction and idempotency.

## CI improvements to consider
- Consolidate the overlapping root emulator workflows after reviewing recent workflow history.
- Add explicit Java setup to the one retained emulator workflow.
- Keep the emulator project ID clearly non-production and use `emulators:exec --only firestore`.
- Add Partner-to-Firebase contract tests or a shared contract fixture so the app's exact field names are tested against the canonical rules.
- Keep Functions integration tests separate from Rules tests and run both where relevant.
- Require Rules Emulator tests for any future `firestore.rules` or booking/walker contract changes.
- Never deploy Rules/Functions from a test job.

## Exit criteria
- Canonical Firebase Rules suite runs green in CI with emulator logs available.
- Regression tests prove the current unsafe client writes are denied.
- A trusted completion callable has tests for authorization, stable IDs, transaction atomicity, duplicate retries, and invalid transitions.
- Partner UI calls the trusted API and no longer writes privileged completion fields directly.
- Working schedule contract is explicitly decided and tested; do not silently equate it with `availability`.
- No production deployment until separately reviewed and approved.

## Current status
- Emulator configuration and test harness: PRESENT in source.
- CI workflows for Rules Emulator: PRESENT, overlapping.
- Specific Partner workingSchedule/completion regression coverage: NOT FOUND in inspected test names.
- Emulator test execution in this audit: NOT RUN.
- Production Firebase state/deployment: NOT CHECKED.
- Rules/Functions/app source changed by this audit: NO.
