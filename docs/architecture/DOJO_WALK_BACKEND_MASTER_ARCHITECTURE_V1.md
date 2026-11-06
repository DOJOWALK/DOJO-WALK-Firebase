# DOJO WALK Backend Master Architecture v1.0

**Decision baseline (Founder, 06 Nov 2026)**
- Architecture: Google Cloud + Firebase hybrid.
- Capacity design target: 10,000 concurrent users. This is a test/design target, not a verified current capacity or SLA.
- Migration strategy: preserve existing repositories, Firebase data and working behavior; upgrade incrementally.
- Branch policy: use only the existing `working` branch for implementation. Do not create branches. Keep `main` stable. Merge only after exact-head CI, cross-app contract review, security review and Founder approval.
- Production deployment, live data migration, Firebase Rules release and Cloud infrastructure changes require separate explicit authorization.

## 1. Architecture direction

Use a **modular, event-driven hybrid architecture** with a gradual migration path. Do not split into many microservices at the start.

- Existing Firebase Authentication remains the identity provider.
- Existing Firestore data and legacy booking documents remain readable during the compatibility phase.
- Existing Firebase Functions v2 (Node.js 22, TypeScript) remain the first server-side execution layer for trusted callable operations.
- Introduce Cloud Run as the versioned HTTP API/service layer when the audited API surface and workload justify it. It must validate Firebase ID tokens and enforce server-side authorization.
- Use Pub/Sub for durable domain events and asynchronous fan-out when required; Cloud Tasks for scheduled/retryable work.
- Keep FCM for push delivery and Cloud Storage/Firebase Storage for media.
- Add Memorystore/Redis only after measured cache/locking/ephemeral-state requirements justify it.
- Do not introduce PostgreSQL or dual-write Firestore + SQL in the first migration step. Evaluate Cloud SQL PostgreSQL for strongly relational finance/ledger/reporting domains only after a domain/data migration design, consistency model, backup plan and approval.
- Avoid an API Gateway dependency until routing, quotas, auth and traffic controls require it; start with Cloud Run ingress and documented API versioning.

## 2. Logical service boundaries

1. Identity & Access: Auth identity, roles, permissions, geographic scope.
2. Customer & Walker Profiles: ownership, KYC metadata, addresses, dog profiles.
3. Service Catalog & Zone: state/district/city/zone hierarchy and verified polygon eligibility.
4. Booking: parent booking, quote/availability gates, cancellation and booking status.
5. Walk Task: one scheduled walk occurrence, lifecycle and safe handover evidence.
6. Assignment: sequential offers, acceptance/decline/expiry, backup and escalation.
7. GPS & Tracking: navigation-to-customer vs actual walk route, freshness, retention and failure handling.
8. Payments & Finance: payment verification, refund, ledger, earnings, payout and reconciliation.
9. Notifications: templates, delivery attempts, retry and delivery logs.
10. Operations & Reporting: Central/Admin/Manager views, audit, incidents and analytics.

Keep these as modules with explicit interfaces and ownership; do not create one deployment per module prematurely.

## 3. Trust and data boundaries

- Client apps submit intent; server derives actor UID from verified Firebase Auth.
- Server owns booking IDs, authoritative timestamps, quote, payment state, assignment, task lifecycle and audit events.
- All privileged reads/writes are authorized server-side; hiding UI controls is not security.
- Booking, Walk Task, Assignment and Payment are separate lifecycle domains.
- Use idempotency keys for booking/payment/task generation and deterministic occurrence identifiers where approved.
- Use Firestore transactions for invariants that remain in Firestore. Use an outbox/event publication pattern for reliable cross-service events; do not rely on uncoordinated dual writes.
- Keep PII/KYC private; use short-lived authorized access URLs and audited reads.
- Do not fabricate GPS, ETA, payment success or task completion when source signals are stale or unavailable.

## 4. Existing repository audit — verified from Firebase working branch

Repository: `DOJOWALK/DOJO-WALK-Firebase`; default branch is `main`; the existing `working` branch is present.

- `firebase.json` configures Functions source `functions`, Node.js 22, Firestore rules/indexes, Storage rules, and Auth/Functions/Firestore/Storage emulator ports.
- `.firebaserc` points the default Firebase project alias to `dojo-platform-b68a3`.
- `functions/package.json` uses Node.js 22, TypeScript, Firebase Admin 13 and Firebase Functions 6; build and test scripts exist.
- `functions/src/index.ts` contains callable Functions v2 in `asia-south1`, including existing service-location and zone/admin-scope operations.
- `firestore.rules` contains customer, pet/address, walker, booking, service-zone and admin-scope rules.
- `storage.rules` exists; it restricts walker selfie/KYC uploads to owner paths and denies all other paths by default.
- `firestore.indexes.json` currently contains one composite index for audit log lookup.
- The root test script covers Firestore rules, service zones, zone visibility and booking-contract alignment; a zone emulator test script also exists.
- No Cloud Run service, Cloud SQL instance, Redis, Pub/Sub or Cloud Tasks deployment was verified in this repository audit. This is not proof that no cloud resources exist; live GCP inventory is still required.

## 5. Material audit findings / risks

**A. Booking writes are not yet fully server-authoritative.** The current Firestore rules permit authenticated clients to create a booking if the legacy booking validators pass. Customer currently has a direct-write legacy path. The target callable must be introduced in shadow mode, tested, then coordinated across Customer, Admin and Partner before direct writes are disabled.

**B. Booking contract is not fully reconciled.** The canonical Parent Booking / Walk Task / Assignment / Payment separation is an approved architecture direction, but exact DTO fields, lifecycle transitions, idempotency format, regular schedule semantics, payment provider/webhooks and app reader compatibility still have open decisions. The current booking contract page records a bounded shadow callable approval on 06 Nov; its pre-code checkpoint requires exact legacy DTO reconciliation and idempotency behavior.

**C. Existing Rules contain broad operational capabilities.** Booking updates are allowed through separate customer, Admin and approved Walker paths with different field allowlists. These need a collection-by-collection authorization matrix and negative emulator tests before any tightening. Do not change deployed rules as part of this architecture document.

**D. Role and geographic scope require one canonical policy.** Existing rules include legacy `super_admin` checks while newer zone operations use Central Admin and scoped assignments. Reconcile roles, permission documents and geographic scope before cross-app integration.

**E. Index coverage is not yet proven.** One checked-in composite index is not enough evidence for all Admin, Partner, Customer and operational queries. Inventory actual query shapes and emulator/index failures before adding indexes.

**F. Storage is present, not complete by assumption.** Current rules cover selfie and KYC JPEG paths and default-deny other objects. Audit actual upload formats, access lifecycle, retention, malware/content validation and authorized admin review before widening paths.

**G. Capacity is unverified.** A 10,000 concurrent-user design target needs workload models, location update frequency, read/write amplification, Firestore cost modelling, Cloud Run concurrency/instance caps, queue throughput, quota review and repeatable load tests. Do not claim this capacity is already achieved.

## 6. Phased execution gates

- **P0 — Inventory:** inspect all five repositories on `working`, Firebase/GCP project resources, current CI, deployed rules/functions, app readers/writers and existing PRs. Output: evidence-backed audit matrix.
- **P1 — Contract freeze:** reconcile booking DTO, Parent Booking/Walk Task/Assignment/Payment lifecycles, role/scope matrix, idempotency and event contracts. Unresolved decisions stay explicitly blocked.
- **P2 — Foundation hardening:** emulator baseline, security tests, rules ownership matrix, indexes, secrets, environment separation, logging and alerting.
- **P3 — Shadow backend:** bounded callable/API implementation on `working`; no client cutover and no production write path change until approved.
- **P4 — Domain modules:** booking request, availability/quote, task generation, assignment, GPS, payment, notifications and operations, each behind tests and contracts.
- **P5 — Controlled integration:** one app at a time with compatibility adapters and rollback.
- **P6 — Capacity and resilience:** load, soak, spike, failure, recovery, backup/restore and cost tests.
- **P7 — Release gate:** exact-head CI, security/code review, Founder approval, then separately authorized merge and production deployment.

## 7. Immediate next audit actions

1. Complete five-repository branch/commit/PR/CI and dependency inventory.
2. Map Customer booking writer against Admin and Partner readers and the Firebase callable approval.
3. Inspect all Firestore/Storage rules and test suites; run no production mutations.
4. Inventory live Firebase/GCP resources and regions/quotas before provisioning Cloud Run or any paid infrastructure.
5. Produce API catalogue, data dictionary, event catalogue, RBAC matrix and migration/rollback plan.

**Current status:** Architecture baseline prepared; repository-level Firebase inspection partially complete; cross-repository and live-cloud audit remains in progress. No source code, rules, live data, branch, merge or production deployment was changed by this document.


## 8. Cross-repository branch and integration preflight — 06 Nov 2026

The existing `working` branch was confirmed in all five repositories. GitHub compare results against `main`:

| Repository | Working ahead | Behind main | Changed files in compare |
|---|---:|---:|---:|
| Firebase | 16 commits | 0 | 84 |
| Admin | 5 commits | 0 | 167 |
| Customer | 3 commits | 0 | 85 |
| Partner | 9 commits | 0 | 15 |
| Website | 2 commits | 0 | 2 |

All five working branches are ahead of main and none is behind at the time checked. Do not merge any repository based on this comparison alone; each changed-file set, exact-head CI, open PR/review state, cross-app contract and security gate must be inspected.

App-level technology evidence:
- Admin Flutter app depends on Firebase Core/Auth/Firestore/Functions/Storage and uses HTTP for networking.
- Partner Flutter app depends on Firebase Core/Auth/Firestore/Storage, Geolocator and Google Maps; its root Firebase config declares Functions source and Node.js 22.
- Website is static HTML/CSS/vanilla JavaScript according to its README; its Firebase config is Hosting-only.
- Website README explicitly states booking, payment, contact submissions, login and live tracking require real backend integration and are not simulated as live.
- Customer is Flutter; the working-vs-main compare includes booking flow, schedule validation, idempotency audit and shared booking contract artifacts. Exact source/reader mapping remains to be reviewed file-by-file.

## 9. Audit boundaries

This is a GitHub source/branch comparison, not a live deployment audit. Open-PR query results from the connected account are not a complete repository-wide PR inventory. No CI workflow run was executed or certified in this step. The next gate is a full diff and workflow run review for each repository, followed by live GCP/Firebase resource inventory.