# Step 165 — District-aware Area/Locality end-to-end audit

## Scope
This is a code-contract audit only. No production Firestore reads, writes, migration, deployment, or merge were performed.

## Findings
- Admin currently carries optional `districtId` on City. Legacy Cities without a District remain supported.
- The trusted Firebase callable still has the legacy Area parent tuple `[countryId, stateId, cityId]` and Locality tuple `[countryId, stateId, cityId, areaId]`.
- The payload allowlist does not currently accept `districtId` on Area. The scanner's District-aware tuple is a proposed migration target, not the live write contract.
- District-aware helpers and read-only preflight scanners exist, but do not constitute production callable migration.
- Area verification requires an active parent City with a verified boundary and containment validation. Existing index ownership and immutable-parent protections must remain transactional.
- Area and Locality migration scanners must be run against an explicitly selected project with appropriate ADC before any migration decision. They have not been run against production; real data counts are unknown.

## Ordered completion checklist
1. Corrected the Area preflight regression test's variable-name expectation in commit `be31ea9bd55f942164fc63a5944ae9b065695081`.
2. Static tests cover scanner document-ID safety, read-error classification, index ownership/tuple validation, pagination, read-only behavior, and Node syntax validation. The corrected test still requires a fresh CI run to confirm.
3. Contract audit confirms the live callable and proposed District-aware index schema are not yet aligned. Do not add `districtId` to Admin Area writes until the callable, allowed fields, parent checks, and index tuple are migrated together.
4. Existing emulator integration suite exercises callable auth, boundary validation, activation, parent consistency, duplicate indexes, and concurrency. The most recent workflow failed one static scanner assertion; 181 of 182 tests passed before the assertion correction. Fresh end-to-end CI is still required.
5. Read-only Area and Locality preflight scripts are available. Run them only after an explicit target project is selected and ADC is configured; inspect the generated reports before any write plan.

## Safe next implementation sequence
- Add emulator tests for District-aware Area create/update/rename, duplicate-name conflicts, parent immutability, City District mismatch, and Locality ancestry.
- Migrate the trusted callable and index helpers atomically, retaining legacy compatibility for unlinked Cities.
- Align Admin Area model/payload/index generation with the new contract and add cross-repository contract tests.
- Run all emulator/rules workflows, then run read-only preflight on the explicitly approved project.
- Only after review and explicit approval, prepare a separately reviewed migration and rollback execution.

## Current result
The contract audit is complete as documentation; the District-aware production callable migration and fresh CI verification are not complete. No production mutation was made.


## Step 165 follow-up — current payload contract regression tests
Added `functions/test/district_area_payload_contract.test.cjs` to lock the current safe boundary:
- Area payloads with `districtId` are rejected by the allowlist until the callable/index migration is coordinated.
- City payloads may carry the optional District parent.
- Legacy Area payloads without `districtId` remain valid.

This test intentionally does not change production behavior. CI for this addition must pass before proceeding to the production callable migration.
