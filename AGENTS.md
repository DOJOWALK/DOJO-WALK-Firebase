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
