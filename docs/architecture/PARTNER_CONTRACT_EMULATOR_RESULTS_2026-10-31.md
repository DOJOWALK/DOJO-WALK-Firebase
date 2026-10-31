# Partner Contract Emulator Results — 2026-10-31

## Tested commit
`b60c1677c9ae995e5de6a5632fb4fd8bad21d27c`

Added test file: `test/partner_contract.rules.test.mjs`.

## Actual GitHub Actions results
Both independent GitHub Actions workflows completed successfully against the same commit:

- `Firestore Rules Tests`, run `41163739555`: SUCCESS.
- `Test Firestore Security Rules`, run `41163739487`: SUCCESS.
- Both jobs ran Firestore Emulator tests and both logs report 86 tests, 86 passed, 0 failed, 0 skipped.
- Both logs explicitly show Partner contract test cases 45–52 passed, including all eight new cases.

## What the passing tests prove
Against the checked-in Firebase repository `firestore.rules` loaded by the emulator:
1. Partner-style `workingSchedule` update is denied.
2. Walker `availability` update is allowed for the seeded approved walker.
3. `dogReturned`, `returnLocationVerified`, and `route` booking updates are denied.
4. Walker create of `walks/{walkId}` is denied because there is no applicable explicit allow rule.
5. An unassigned walker cannot update the seeded booking.
6. An assigned approved walker can update the tested allow-listed status field.

These are security regression results, not a product fix. The denied writes remain denied by design under current Rules. Do not loosen client Rules to make the current Partner implementation pass.

## Important limitation
The passing tests prove behavior of the repository Rules source in Firestore Emulator, not deployed production Rules, not the production Firebase project, and not a complete Partner app integration. They do not test a trusted completion callable because no such callable currently exists in the inspected Firebase Functions entrypoint.

## Workflow duplication observation
Both overlapping workflows ran the same 86-test suite on this commit. This confirms duplicate execution for this push. No workflow was deleted or changed in this update. Consolidation should preserve the workflow YAML lint check and emulator suite, and be reviewed separately.

## Next implementation sequence
1. Decide canonical Partner schedule contract: retain `workingSchedule` with trusted callable, or align the UI to a backend-owned availability contract. Do not silently map one field to another.
2. Define trusted completion callable contract: authenticate assigned approved walker; validate active occurrence and allowed state transition; require safe handover proof/OTP verification server-side; persist one stable walk ID; write completion and parent status atomically; return same result on retry.
3. Add Functions Emulator tests for authorization, invalid transitions, idempotency, duplicate requests, transaction rollback, and concurrent completion.
4. Change Partner app to call the trusted API; remove direct privileged client writes only after app and backend integration tests pass.
5. Re-run Rules + Functions Emulator suites. Production deploy requires separate approval.

## Status
- Rules Emulator suite: PASS (86/86 in each of two workflows).
- New Partner contract regression tests: PASS (8/8).
- Deployed Rules verification: NOT CHECKED.
- Trusted completion callable: NOT IMPLEMENTED.
- Production Rules/Functions deployment: NOT PERFORMED.
