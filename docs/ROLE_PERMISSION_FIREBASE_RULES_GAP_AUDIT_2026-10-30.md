# Role Permission vs Firebase Rules & Functions — Source Gap Audit
Date: 2026-10-30
Status: Draft / source review only / NOT approved for production
Repository: DOJOWALK/DOJO-WALK-Firebase
Reviewed ref: main (file-level blob SHAs recorded below)
Related draft: ROLE_ACTION_PERMISSION_MATRIX_DRAFT_2026-10-30.md

## Scope and evidence
Reviewed current GitHub source on `main`:
- `firestore.rules` blob `104467bab5dcc66c01a1f0f70df321ac0b193249`
- `functions/src/index.ts` blob `2b13994aff949f38e626e1929422e5de84755312`
- `firebase.json` blob `ec27a2d7b8880c12cc76ebf7c1ea5ac5e05f6ea9`
- No `storage.rules` file was found at repository root.
This is a review of repository source only. It does not establish which rules/functions are deployed in Firebase production, nor whether all deployment configuration is represented here.

## Executive result
The current backend authorization model is materially narrower and structurally different from the draft role/action matrix. The rules and inspected callables primarily authorize an active `super_admin`, customers as owners, and approved walkers. The matrix's Founder/CEO, Central Operations, City Manager, Zone Supervisor, Support, Finance, Location Preparer/Reviewer, and Service Identity permissions are not implemented as a consistent role + scope + action + record-state authorization system in the inspected source.

Critical issue for the future walk lifecycle: approved walkers can directly update selected booking lifecycle fields from the client. That conflicts with the draft POL-007 direction for server-authoritative start/complete transitions. Do not connect live tracking or payment settlement to this client-write model.

## Findings

### F-01 — Role taxonomy mismatch
Evidence: `firestore.rules` helper `isAdmin()` requires `admin_users/{uid}.isActive == true` and `role == 'super_admin'`. The `admin_users` update rule permits role values only `super_admin`, `admin`, `support`. The inspected callables repeat the active `super_admin` check.
- Matrix roles not represented in backend authorization: Founder/CEO, Central Head/Operations, City Manager, Zone Supervisor, Finance, Location Preparer, Location Reviewer, and dedicated Service Identity.
- `admin` and `support` values exist in the document allow-list but do not satisfy `isAdmin()`; no distinct action-level authorization was found for them in the reviewed rules.
Risk: UI role labels or document values could be mistaken for effective backend permissions; adding operational roles only in UI would not enforce them.
Required: define canonical role IDs, assignment lifecycle, scope schema, and a shared server-side authorization helper before adding roles.

### F-02 — No city/zone scope enforcement in general admin access
Evidence: `isAdmin()` checks active + super_admin only. Admin list/read grants in users, walkers, bookings and support requests use `isAdmin()`; no City/Zone scope comparison is present in those checks.
Risk: current super_admin access is effectively global. Future city/zone roles cannot safely inherit these broad rules.
Required: enforce scope at the data layer and callable layer, including query-compatible ownership/scope fields; deny cross-city/zone reads and writes. Do not rely on client-side filters.

### F-03 — Walker can directly mutate booking lifecycle fields
Evidence: `match /bookings/{bookingId}` has an `allow update` for `isApprovedWalker()` where `resource.data.walkerId == request.auth.uid`. Its allowed changed keys include `status`, `startedAt`, `completedAt`, `walkSchedules`, `walkNotes`, counts, distance and duration.
Risk: a client-side approved Walker can attempt lifecycle state/time updates without a server command validating current booking state, idempotency, pickup checks, handover, GPS freshness, or a corresponding immutable event. Rules restrict field names but do not implement the full POL-007 transition contract.
Required: move start/pause/resume/complete/handover/incident transitions to authenticated callable/API commands with transactional validation and immutable event writes; remove direct client authority over trusted lifecycle fields after a compatible migration.

### F-04 — Admin booking writes are broad and not action-specific
Evidence: booking admin update permits status, walkerId, assignedAt, startedAt, completedAt, cancelRequest, adminNotes, price, totalPrice, paymentStatus, paymentId, schedules and planStatus for any `isAdmin()` actor.
Risk: one super_admin permission bundles dispatch, lifecycle override, pricing and payment-state mutation. No separate Founder/Central/Manager/Finance approval boundary or scoped assignment authority is enforced here.
Required: split actions into server-side commands and permission checks; payment status/IDs must be trusted-gateway/backend-only; add amount thresholds and separation-of-duties checks per approved policy.

### F-05 — Missing booking/walk server commands in inspected Functions entry point
Evidence: `functions/src/index.ts` exports service-location callables including `reviewServiceLocationBoundary`, `activateServiceLocation`, and `setServiceLocationStatus`. No booking assignment, walk start, walk completion, handover, GPS ingestion, or incident lifecycle callable was found in the inspected entry point.
Risk: the reviewed source does not provide the server-authoritative lifecycle surface required by POL-005/POL-007.
Required: design commands and data contracts first; validate assigned Walker, booking state, schedule, pickup/drop checks, idempotency key, server timestamps, event/audit writes and safe handover in transactions.

### F-06 — Location workflow is super_admin-only, not Founder/Central separation
Evidence: `reviewServiceLocationBoundary`, `activateServiceLocation`, and `setServiceLocationStatus` require active `super_admin`. The review callable records reviewer and decision; activation callable validates boundary/ancestry and records activation audit.
Risk: technical super_admin currently performs both review and activation. This does not implement POL-037's distinct Founder GO/NO-GO and Central Operations activation gates.
Required: after policy approval, separate reviewer/Founder approval from Central activation; bind approval to an immutable location revision/hash; re-check actor scope and approval inside the activation transaction.

### F-07 — Legacy location hierarchy differs from current Zone requirement
Evidence: `setServiceLocationStatus` supports country, state, district, city, area, locality; activation callable handles city/area and boundary review supports city/area. This source does not show the latest State/UT → District → City → Zone model as the sole operational hierarchy.
Risk: continuing to add operational roles against legacy City/Area/Locality paths could preserve a mismatched hierarchy.
Required: reconcile the current Zone-only policy and migration plan before changing rules or callables. Do not silently reinterpret Area as Zone.

### F-08 — No explicit walk_locations / walk_events authorization contract found
Evidence: the reviewed `firestore.rules` excerpt defines bookings and walk_requests (deny all), but no dedicated matches for `walk_locations`, `walk_events`, or `walks` were found in the file review.
Risk: role-scoped GPS visibility, location write identity, retention, immutable event access and incident privacy are not established by this source.
Required: define separate rules for Walker self-write (only assigned active walk), customer read (only their active/completed walk as policy allows), scoped operations read, and service-only trusted event writes; add retention and stale-location semantics.

### F-09 — Audit model is incomplete across business actions
Evidence: walker admin decisions and service-location review/activation have audit paths in related source, but booking lifecycle and payment commands/events were not found in the inspected Functions entry point. Firestore rules must also be checked for immutable audit collections and direct write denial in their full context.
Risk: no unified, immutable, actor/scope/action/before-after audit guarantee across operational and financial decisions.
Required: server-generated audit records for every sensitive action; clients must not create, update or delete trusted audit records. Include actor role, scope, reason, correlation/idempotency key and record revision.

### F-10 — Storage security rules not present at expected root path
Evidence: `storage.rules` returned 404; `firebase.json` configures Firestore rules and indexes but does not declare a Storage rules path in the fetched file.
Risk: cannot assess KYC/document/photo access control from this repository snapshot.
Required: locate the authoritative Storage rules/configuration or add a separately reviewed Storage policy before handling private identity documents.

## Permission matrix implementation snapshot

| Matrix role | Source implementation status | Notes |
|---|---|---|
| Founder/CEO | Missing | No distinct Founder authorization/approval found |
| Super Admin | Partial / present | Active role check; broad global permissions |
| Central Head / Operations | Missing as distinct role | No cross-city operational action model |
| City Manager | Missing | No city scope enforcement |
| Zone Supervisor | Missing | No zone scope enforcement |
| Walker / Partner | Partial / present | Own profile and approved-walker booking access; lifecycle client writes remain |
| Support | Partial / incomplete | Role string allowed, but does not satisfy isAdmin; support request access currently admin-wide |
| Finance | Missing | Payment fields included in broad admin booking update; no Finance-only checks |
| Location Preparer | Missing | No distinct preparer role found |
| Location Reviewer / Verifier | Partial / incomplete | Boundary reviewer callable is super_admin-only |
| Service Identity | Not assessed / not found | No explicit callable identity model in reviewed entry point |

## Required remediation order (no code changes in this audit)
1. Approve canonical role IDs, assignment model and geographic scope fields (POL-021/POL-037).
2. Approve booking/walk state machine and command contract (POL-005/POL-007).
3. Define payment authority and separation-of-duties thresholds.
4. Design scoped Firestore + Storage rules; deny direct client writes to trusted lifecycle/payment/audit fields.
5. Implement server commands with transactional state validation, idempotency and immutable events.
6. Add emulator tests for role × action × scope × state, including direct REST/SDK bypass, inactive accounts, cross-zone attempts, reassignment, duplicate completion, payment tampering, incident/handover and audit immutability.
7. Verify deployed Firebase rules/functions/configuration against the reviewed commit before any production rollout.

## Acceptance tests required before approval
- Inactive admin and unknown role are denied.
- `admin` / `support` cannot inherit super_admin privileges.
- City Manager cannot read or mutate another City; Zone Supervisor cannot access another Zone.
- Walker cannot read another Walker's booking or write booking status/start/completion/payment fields directly.
- Only assigned active Walker can submit location for an active walk; stale/late/replayed location cannot appear as current.
- Customer can read only their own booking/walk and permitted tracking window.
- Finance cannot assign walkers; operations cannot change gateway-confirmed payment state.
- Founder approval is bound to the exact Zone revision; Central activation fails without it.
- Duplicate start/complete requests are idempotent; invalid transitions fail.
- Audit records are server-written and immutable; failed audit write rolls back the protected state change.
- Incident/handover paths preserve dog-safety requirements and cannot be represented as ordinary completion.

## Final gate
NO-GO for production role expansion or live booking/walk integration based on this source snapshot. This document is an evidence-based gap list, not a claim about deployed production state. No Firestore rules, Cloud Functions, Firebase data, deployment, or production configuration was changed.
