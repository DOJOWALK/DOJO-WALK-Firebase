# DOJO WALK — Shared Firestore Collection & Ownership Inventory
**Audit date:** 2026-10-31  
**Source branch:** `main`  
**Status:** SOURCE AUDIT / PROPOSED CONTRACT — NOT APPROVED, NOT DEPLOYED

## 1. Scope and evidence
Inspected the Firebase repository's `firestore.rules`, `firebase.json`, `firestore.indexes.json`, and `functions/src/index.ts` on `main`.
- Firestore Rules blob: `9bac26b9e13a97d412a0154ec9af70629e82eb47`
- Functions entrypoint blob: `2b13994aff949f38e626e1929422e5de84755312`
- Firebase config blob: `ec27a2d7b8880c12cc76ebf7c1ea5ac5e05f6ea9`
- Indexes blob: `add7c655c19cb240e35624e23c3e9a1041ef15bf`

This is a repository-source audit only. It does not prove which rules/functions are currently deployed to Firebase project `dojo-platform-b68a3`. Admin SDK functions bypass Firestore client rules. No production data was read or changed.

## 2. Collections explicitly matched by the checked-in Firestore Rules

| Collection / path | Observed purpose and access pattern | Contract status |
|---|---|---|
| `admin_users/{uid}` | Admin identity/role/active flag; self get, active super-admin list/update restrictions | Existing |
| `users/{uid}` | Customer account profile; owner reads/writes restricted fields | Existing |
| `users/{uid}/pets/{petId}` | Customer pet records | Existing |
| `users/{uid}/addresses/{addressId}` | Saved customer addresses | Existing |
| `users/{uid}/pickup_addresses/{addressId}` | Pickup address records | Existing; overlaps conceptually with booking pickup snapshot—do not duplicate address masters |
| `walkers/{uid}` | Walker profile, onboarding/KYC metadata, approval flags, availability/device fields | Existing; sensitive subfields need stricter privacy review |
| `support_requests/{requestId}` | Walker support requests; requester create/read, admin manage | Existing basic intake only |
| `bookings/{bookingId}` | Customer parent booking and schedule templates; customer/assigned approved walker/admin read | Existing parent booking |
| `walk_requests/{requestId}` | Explicitly denied for client read/write | Reserved/blocked; not an implemented offer queue |
| `walker_reviews/{reviewId}` | Customer rating/review for walker | Existing |
| `service_location_boundaries/{boundaryId}` | Boundary geometry and review metadata | Existing |
| `service_location_name_indexes/{indexId}` | Canonical service-location name lookup index | Existing |
| `service_countries/{id}`, `service_states/{id}`, `service_districts/{id}`, `service_cities/{id}`, `service_areas/{id}`, `service_localities/{id}` | Service-location hierarchy | Existing in code; conflicts with latest product direction to use State/UT → District → City → Zone only and no Locality. Requires a separate migration decision; do not silently delete legacy collections. |
| `service_location_import_runs/{runId}`, `service_location_imports/{importId}` | Import run and import staging/records | Existing |
| `customers/{customerId}` | Admin-managed customer record separate from `users/{uid}` | Duplicate identity concept risk; clarify legacy/CRM role before new writes |
| `coupons/{couponId}` | Admin-managed coupons | Existing rules despite product decision “no coupon”; no new coupon feature should be built; migration/legacy retention decision required |
| `payments/{paymentId}` | Admin-managed payment records; customer read | Existing payment record surface; gateway lifecycle/immutability not fully specified |
| `audit_logs/{logId}` | Admin audit records | Existing |

Nested `pets`, `addresses`, and `pickup_addresses` are subcollections under `users/{uid}`, not top-level collections.

## 3. Additional collections referenced by Functions entrypoint
The checked-in `functions/src/index.ts` exports five callable functions, all service-location workflows:
- `reviewServiceLocationBoundary`
- `activateServiceLocation`
- `setServiceLocationStatus`
- `saveServiceLocationWithNameIndex`
- `manageServiceLocationImportRun`

The entrypoint also references supporting collections including:
`service_location_boundary_review_audit`, `service_location_activation_audit`, `service_location_status_audit`, and `planned_nodes`, in addition to the service-location collections above. Some are server-managed/internal and do not appear as standalone top-level rule matches. Treat them as backend-owned; do not let mobile clients write them.

No booking occurrence generation, assignment/offer, offer acceptance, live-walk start, GPS ingestion, OTP handover, completion, incident, push-notification, or walker payout callable/trigger was found in this inspected entrypoint. This statement is limited to this file/repository source snapshot.

## 4. Proposed ownership matrix (requires approval)

| Data domain | Customer App | Firebase trusted backend | Partner App | Admin |
|---|---|---|---|---|
| Customer profile & pets | Create/update own allowed fields | Validate identity/ownership; protect sensitive fields | No access unless a specific assigned-walk snapshot requires it | Least-privilege support/operations access |
| Saved pickup address | Manage own address book | Validate/normalize; snapshot selected address into booking | Read only assigned occurrence pickup snapshot, not whole address book | Operations access only when needed |
| Parent booking | Create pending request; request cancellation through allowed workflow | Validate request, create stable walk occurrences, calculate authoritative state | Read only assigned work summary; no assignment authority | Operations read and authorized interventions |
| Walk occurrence | No direct creation/status mutation | Sole creator/authority; stable occurrence ID, service-local schedule and lifecycle | Read assigned occurrence; actions only via trusted callable | Operations visibility and audited intervention |
| Offer/assignment | Read customer-facing assignment outcome | Atomically create/expire/replace offers and assign one eligible walker | Explicit accept/decline via callable only | Monitor and audited manual resolution |
| Walker profile/KYC | None | Protect KYC paths and authoritative verification state | Own profile; never self-approve | Authorized reviewer only; sensitive access audited |
| Availability | None | Validate active/approved eligibility, conflicts and policy limits | Submit availability preference | Review/override only if policy permits |
| Live GPS | Customer sees permitted live status | Validate, timestamp, sequence, retain canonical location stream | Submit location only for own active walk | Read live operational state with access controls |
| Handover / OTP / completion | Provide/confirm required handover factor | Generate/verify/consume OTP; authorize and idempotently complete | Request actions; never self-assert authoritative completion | Exception review and audit |
| Incidents/support | Customer support channel | Persist incident and route alerts | Create incident/support request | Triage, assign, resolve, audit |
| Payments / walker ledger | Initiate payment and read own payment status | Verify gateway callbacks; maintain immutable ledger and payout batches | Read own verified earnings/payout statements | Finance-authorized review/reconciliation |
| Notifications | Receive own messages | Own event/outbox and token delivery | Register own device token; receive scoped messages | Manage templates/configuration with audit |
| Service locations | Read active service zones | Trusted location functions own hierarchy/index/boundary validation | Read eligible service zone | Authorized service-location management |
| Audit logs | No access | Write server audit events | No access | Read authorized audit records |

## 5. Canonical booking model — proposal, not implementation
Keep the parent booking as the customer purchase/request record:
- `bookings/{bookingId}`: customer, selected service/plan, pet and pickup snapshot, requested schedule templates, payment references, cancellation request, parent-level status.
- Do not overload the parent document with one `date`/`startTime` when it can represent multiple dates or multiple walks per day.

Introduce one backend-owned occurrence record per independently assignable walk:
- Proposed path: `walk_occurrences/{occurrenceId}`.
- Stable `occurrenceId` must be deterministic/idempotent for a booking schedule instance, or generated once and persisted transactionally; never regenerated on app retry.
- Minimum proposed fields: `occurrenceId`, `bookingId`, `customerId`, `assignedWalkerId`, `serviceDate` (local date), `timeZone`, `scheduledStartAt` (Timestamp), `durationMinutes`, `petSnapshot`, `pickupSnapshot`, `status`, `createdAt`, `updatedAt`.
- Exact ID strategy, timezone policy, snapshots, cancellation semantics, and status graph need product/backend approval before code.
- Partner Home and Schedule should read assigned occurrences, not infer today's jobs from parent `date`/ `startTime` fields.
- Keep `walks/{walkId}` as the verified execution/completion record only if backend confirms it as canonical. Do not create a second competing completion collection.
- Canonical live location path must be decided with Admin Live Operations before implementation. Current checked-in rules do not explicitly match `walks`, `walk_locations`, or `walk_occurrences`; client access is therefore denied by default unless another deployed rule/service handles it.

## 6. Immediate mismatches / decisions
1. Customer booking writer uses parent `bookings` with `scheduledAt`, `preferredTime`, `walkSchedules`, `selectedDates`, `dateSchedules`; Partner Home expects legacy `date` and `startTime`. This is a P1 integration mismatch.
2. `walk_requests` is explicitly denied. It must not be treated as an existing assignment-offer queue.
3. Rules contain no explicit matches for `walks`, `walk_locations`, or proposed `walk_occurrences`; do not widen client rules to make current client-side completion work. Prefer trusted backend callables.
4. Functions entrypoint is service-location-only; booking/walk backend lifecycle is not present in this inspected entrypoint.
5. `customers/{id}` and `users/{uid}` may duplicate customer identity. Map existing readers/writers and decide one canonical profile before creating more data.
6. `coupons` remains in rules despite the no-coupon product decision. Hide/remove the UI separately; do not delete existing records until legacy usage is checked.
7. Service-location code includes Locality and Area. Current product direction is Zone with no Locality dropdown. Do not equate Area with Zone or migrate IDs until Admin + Firebase contract is approved.
8. Existing index file has one composite index for `audit_logs`; validate actual query requirements and emulator index errors before adding indexes.

## 7. Safe implementation sequence
1. Approve a versioned schema contract across Customer, Partner, Admin and Firebase teams.
2. Map all current app reads/writes to each collection and field; identify legacy readers before migration.
3. Decide customer identity source (`users` vs `customers`), no-coupon legacy treatment, and service location Area/Zone migration.
4. Define occurrence ID, timezone, assignment/offer states, cancellation and replacement rules.
5. Implement backend-only occurrence generation and atomic assignment/offer lifecycle.
6. Implement trusted start, GPS ingestion, handover OTP, idempotent completion, incident and notification services.
7. Add Emulator rules/functions tests for allowed/denied access, cross-user access, duplicate/concurrent actions, retry/idempotency, and the complete Customer → Backend → Partner → Admin flow.
8. Verify deployed Firebase project, rules release, function region/runtime and indexes in Console/CLI before any deployment.

## 8. Non-actions / safety
- No Firestore Rules, Functions, indexes, app source, production records, or Firebase deployment were modified.
- No collections were created, renamed, deleted, or migrated.
- This document is a proposal based on checked-in source; it is not an approved contract and must not be treated as permission to deploy.
