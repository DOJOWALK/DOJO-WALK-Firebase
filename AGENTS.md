# DOJO WALK Firebase — AI Contributor Instructions

## Project scope
This repository contains Firebase backend configuration, Firestore security rules, indexes, Cloud Functions, and emulator-based rules tests. The root `firebase.json` configures Functions on Node.js 22 and Firestore rules/indexes. The root `package.json` provides `npm test` using Node's test runner for `test/*.test.mjs`.

## Required workflow
1. Read the relevant rules, indexes, function source, tests, and existing GitHub Actions workflow before proposing a change.
2. Keep changes narrowly scoped. Preserve existing collection names, document shapes, callable contracts, and app compatibility unless the task explicitly authorizes a coordinated migration.
3. Add or update emulator tests for every security-rule behavior change, including allowed and denied cases.
4. Run `npm ci` when a lockfile is present, then `npm test`. Use the repository's existing Firebase Emulator and CI workflows; do not invent production test credentials.
5. Report exact commands and results. Never label a test PASS unless it actually ran successfully.

## Security and release boundaries
- Never weaken Firestore or Storage access controls to make an app flow pass.
- Default to deny; validate authentication, ownership, role, field allowlists, and immutable fields as appropriate.
- Never commit service-account JSON, API keys, tokens, customer data, or real KYC/media files.
- Never run `firebase deploy`, change production project targets, rotate credentials, or modify GitHub secrets without explicit owner approval.
- Treat `dojo-platform-b68a3` and all production resources as protected.
- Do not change Storage Rules, Firestore Rules, indexes, or Functions together unless the task explains and tests the compatibility impact.

## Pull requests
Work on a feature branch, never directly on `main`. Include scope, security impact, tests run, test results, deployment impact, and rollback notes. Keep production deployment manual and approval-gated.


## Mandatory DOJO WALK engineering operating rules (Notion-aligned)

The Notion AI Engineering Control Center and Four Team AI Coding Instructions are the operating source of truth. Central Task Register: https://app.notion.com/p/2f476768c6f14aec9e70bf04afd83df8

Before editing:
- Read the assigned task, linked spec/policy and relevant team page; inspect this repository's current source, root instructions, working tree, active branch, recent commits and open PRs.
- Record the task ID, repository, exact active branch, current commit SHA, scope, acceptance criteria, dependencies and test plan.
- Continue the exact active branch recorded for the task. Do not create a replacement branch merely because a chat/session changed. Check for duplicate or overlapping work first.
- If a required product decision, backend contract or approval is missing, stop and report BLOCKED with the precise question. Do not guess.

During and after implementation:
- Make the smallest safe change within the assigned task. Do not silently change product policy, API/data contracts, schema, permissions, security rules or payment behavior.
- Coordinate shared contract changes with the owning team before parallel client work. Team 01 owns shared backend contracts; consuming teams must use approved versioned contracts.
- Never force-push, delete branches, close historical PRs or overwrite unmerged work without explicit approval.
- Run relevant checks and record exact commands/workflows, timestamps, results and the exact commit SHA tested. Use PASS only for checks that actually passed; use FAIL for failures and NOT RUN for checks not executed.
- PR/handoff notes must include task ID, scope, risk, affected repositories, branch, PR, exact SHA, contract/schema version where relevant, test evidence, blockers and rollback notes.
- Obtain independent review for security, permissions, payments, KYC, GPS/location and data-migration changes. Merge and production deployment require the required human approval.
- A green CI result applies only to the checks run on that exact SHA; it is not blanket production-readiness approval.

Do not mark work complete until acceptance criteria, required test evidence, review/approval, PR/release state and receiving-team handoff are accurately recorded.
