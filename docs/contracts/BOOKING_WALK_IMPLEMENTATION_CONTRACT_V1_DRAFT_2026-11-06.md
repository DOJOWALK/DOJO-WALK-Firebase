# DOJO WALK — Booking & Walk Implementation Contract V1 (Draft)

**Date:** 6 November 2026  
**Status:** CONSOLIDATED ENGINEERING DRAFT — NOT FROZEN / NOT IMPLEMENTATION AUTHORITY  
**Target review branch:** `working`  
**Source baseline:** Firebase `working` at `4bf1cd7e1fc0c04deaf58a2d3178a2c85bbeda78`  
**Related drafts:** PR #73 (canonical Booking/Walk Task fields), PR #93 (Live Walk / DW-SEC-001), PR #94 (Booking/Walk backend + role-scope security)  
**Production:** NO-GO. No Functions, Rules, schema, indexes, data, deployment or app changes are authorized by this document.

## 1. Purpose and precedence

This document consolidates the current Booking, scheduled occurrence, live execution, GPS, event, incident, idempotency and authorization proposals into one review surface.

It does not silently approve candidate collection paths, field names, enums, callable names, GPS quality thresholds beyond already approved operating targets, retention periods, payment rules, or role grants. Where PR #73 and PR #93 use different names or concepts, this contract preserves their semantic distinction and marks unresolved implementation choices explicitly.

**Source precedence for review:**
1. Approved Notion policies and Founder decisions govern product/policy behavior.
2. PR #73 supplies the latest canonical scheduled-occurrence field vocabulary, but still requires policy/contract freeze.
3. PR #93 supplies live tracking and Walker data-separation proposals, not a frozen schema.
4. PR #94 supplies backend-command and role/scope security design proposals, not production authorization.
5. Current code and Rules are compatibility evidence, not proof that current behavior is correct or approved.

## 2. Canonical logical model

| Logical entity | Candidate path | Meaning | Authority |
|---|---|---|---|
| Booking | `bookings/{bookingId}` | Customer's commercial/service request; may contain multiple scheduled occurrences | Trusted backend for authoritative status, quote/payment gates and assignment linkage |
| Scheduled Walk Task | `walk_tasks/{walkTaskId}` | One bounded, scheduled occurrence generated from a Booking | Trusted backend creates and owns lifecycle |
| Live Walk execution | **Path BLOCKED**; stable server-created Walk identity per approved occurrence; existing `walks` history must be preserved | Runtime lifecycle for one approved Walk Task; exact live record/path remains a technical-freeze decision | Trusted backend |
| Location sample / accepted live feed | **Path BLOCKED**; current Admin reads `walk_locations`, while inspected Partner writer does not populate it | Server-accepted live marker/route feed consumed by Customer and Admin; exact feed/history split remains open | Trusted ingestion only |
| Assignment / Offer | **Path BLOCKED** | Separate sequential offer, acceptance, decline, expiry and reassignment domain | Trusted backend |
| Payment | **Path BLOCKED** | Separate payment, refund, reversal and reconciliation domain | Trusted payment integration / backend |
| Lifecycle event | **Path BLOCKED** | Append-only command/state evidence; exact event store and naming remain open | Trusted backend |
| Incident | **Path BLOCKED**; PR #93 candidate only | Restricted safety/operational incident under POL-016 | Trusted backend |
| Customer-safe Walker projection | **Path BLOCKED**; PR #93 candidate only | Minimal profile data visible only during approved stage | Trusted backend |

### 2.1 Non-negotiable identity separation

- `bookingId` identifies the parent customer/commercial request.
- `walkTaskId` identifies one scheduled occurrence.
- Notion's Founder-received architecture direction is one stable, backend-created Walk identity per approved occurrence. `walkId` is distinct from `bookingId` and `walkTaskId`; exact collection/path and runtime record model remain **BLOCKED**.
- Assignment/Offer and Payment are separate logical domains, not fields folded into one ambiguous Booking/Walk status.
- Notion explicitly requires preserving the existing `walks` completed-history/review collection and not repurposing it as scheduled tasks. PR #93's candidate `walks/{walkId}` live-execution path cannot be adopted without an explicit migration decision.
- Retries of Start must return the same committed execution identity/result; they must not create a second Walk.

### 2.2 Scheduled occurrence contract — PR #73 vocabulary

Candidate canonical `walk_tasks/{walkTaskId}` fields:
- Identity/ownership: `walkTaskId`, `bookingId`, `customerId`, `dogId`.
- Immutable snapshots: `dogName`, `dogDetails`, `serviceType`, `bookingPlan`, `pickupAddressId`, `pickupAddress`.
- Service geography: `serviceZoneId`, `cityId`.
- Schedule: `scheduledAt` (Timestamp), `timeZone`, server-derived `serviceDateKey`, `durationMinutes`.
- Dispatch/lifecycle: `walkerId`, `status`, server timestamps and schema version (exact names/types to freeze).

Parent Booking candidate fields include `bookingId`, `customerId`, service/plan inputs, quote/payment state, trusted `serviceZoneId`/`cityId`, and backend-maintained occurrence references. Exact commercial and aggregate status fields remain subject to POL-006/POL-008 and Customer source reconciliation.

Do not write new aliases `petName`, `petDetails`, `dog`, or `type`. Legacy compatibility, if needed, is read-adapter-only; no dual-write policy is approved.

### 2.3 Plan materialization

- One-Time / Choose-Dates inputs normalize into bounded scheduled occurrences.
- Regular plans are not assignable until a bounded calendar period/end date and generation horizon are approved.
- Calendar-month semantics are not a fixed 28-day duration.
- “Immediate” is an availability/operations request, not a schedule inferred from an untrusted device clock.
- Exact duplicate suppression, occurrence count limits and schedule timezone semantics remain BLOCKED pending the frozen booking policy.

## 3. Command and transaction model

All commands below are conceptual responsibilities; callable names and DTOs are not frozen. The architecture direction recorded in Notion separates Parent Booking, Walk Task, Assignment/Offer and Payment.

### Create Booking / resolve availability
Backend must authenticate the Customer, load source Pet and Address records from trusted paths, validate the selected Zone is active and boundary-verified, normalize service-local schedule inputs, calculate the authoritative quote, and verify availability before payment is enabled. The backend must not trust client-supplied customer UID, dog/address snapshots, Zone ancestry, price, payment status or availability result.

Capacity reservation, payment authorization/capture ordering, reservation expiry, race handling and refund behavior require approved commercial policy and are BLOCKED. A UI-only availability check is insufficient.

### Materialize Walk Tasks
A backend-owned, idempotent materializer creates one task per approved occurrence. It must bind the task to the parent Booking, trusted Pet/Address snapshots, active Zone and canonical schedule. Retries must return/reconcile the same occurrence rather than create duplicates. Regular-plan generation horizon remains BLOCKED.

### Assign / reassign Walker
Assignment must be backend-authoritative and transactionally re-check Walker approval/active state, Zone eligibility, capacity, current task state and assignment version. Area/City/Zone scope must be enforced server-side. Auto-assignment → Manager attempt → Central escalation is the approved operating direction; exact timeout, fallback eligibility and customer notification sequencing remain policy gates.

### Start Walk
Require authenticated active/approved assigned Walker, current assignment, valid task/execution relationship, allowed state, pickup validation and required handover evidence. Server timestamp and immutable event are authoritative. A retry with the same idempotency key returns the original committed result. Partner must not directly mutate trusted lifecycle state.

### GPS ingestion

Require authenticated assigned Walker and active execution. Validate coordinate ranges, plausible capture time, accuracy, ordering/sequence, cadence, payload size and rate. Store capture time separately from server receive time. Only accepted samples may update the live marker. Delayed/offline/backfilled points must never move the live marker backwards or be shown as current.

Founder-approved operating targets recorded in Notion:
- Target sample cadence: 10 seconds during an active Walk, subject to OS/network limitations.
- Stale alert: 30 seconds without an accepted update; label delayed/stale, never live.
- Route deviation: greater than approximately 150 metres for 3 minutes, only when GPS accuracy is adequate; this is a review alert, not proof of misconduct.
- Customer sharing window: active Walk only; stop after successful completion or approved safety handoff/exception.

Still BLOCKED: minimum accuracy rule, accepted sample age, out-of-order tolerance, rate limits, offline/backfill behavior, canonical feed collection, historical route access, retention/deletion/legal hold and exact event model. Current Admin `walk_locations` reader and Partner completion-only `walks.route` writer do not form a functioning live feed; do not switch either side until the cross-app migration map and rollback are approved.

### Complete / stop / incident
Completion must require verified final handover and safe dog custody. A running walk cannot be cancelled as an ordinary Booking cancellation. Dog emergency requires safe handover before stop; incident workflow and authorized resolution take precedence over ordinary completion. Completion, task aggregate state, execution state, event and audit evidence must commit atomically where the chosen data model permits. POL-016 controls severity, response, escalation and closure; unresolved items remain BLOCKED.

## 4. Lifecycle and state-machine boundaries

There are four logical state domains and they must not share one ambiguous `status` field:

1. **Parent Booking state** — customer order/request and aggregate occurrence outcome.
2. **Walk Task state** — one scheduled occurrence, readiness and service outcome.
3. **Assignment/Offer state** — candidate offer, active offer, accept/decline/expiry and reassignment history.
4. **Payment state** — provider processing, verification, refund/reversal and reconciliation.

Live GPS/session freshness and incident state are additional operational concerns; they must not be collapsed into Parent Booking or Payment status.

Exact enum strings, allowed transitions, terminal-state rules, reschedule/reassignment behavior, partial multi-task Booking aggregation and state ownership are BLOCKED until the complete actor × from-state × to-state matrix is reconciled with POL-005/POL-006/POL-007 and approved. LIFE-01 and LIFE-02 are Founder-received approval candidates, not final implementation approval; their architecture direction and candidate task states must not be mistaken for a frozen enum/transition matrix.

## 5. Idempotency, concurrency and audit

Every mutating command requires an idempotency key scoped to authenticated actor + command + target resource. The backend must persist a request fingerprint and committed result, reject key reuse with a different payload, and prevent duplicate side effects. Exact key format, persistence path, TTL and replay response are BLOCKED.

Transactions must re-read all authorization, assignment, resource state and version guards at commit time. Use explicit version/concurrency guards for assignment and lifecycle transitions. Events are append-only; corrections use compensating events, not silent mutation/deletion. Actor UID, role snapshot and server timestamps are derived server-side.

## 6. Authorization and data separation

- Customer may read only owned Booking/Task summaries and the minimal assigned-Walker projection permitted during the approved tracking phase.
- Walker may read only assigned tasks and submit commands/evidence for their own current assignment; cannot authoritatively write Booking/Task/Walk lifecycle fields.
- City Manager and Zone Supervisor access is limited to assigned geography and permitted actions.
- Central Operations has cross-zone operational oversight; Super Admin is technical/security administration, not an automatic routine dispatch role.
- Founder/CEO approval is reserved for major decisions and defined escalation gates, not routine walk execution.
- Support and Finance receive purpose-limited case/payment views, not unrestricted Walker KYC, device or raw GPS data.
- Exact role IDs, assignment source, scope inheritance, support case access and Super Admin separation-of-duties must be reconciled with POL-021/POL-037 and current Functions before freeze.

Firestore Rules cannot redact individual fields from a document. Sensitive KYC, finance, emergency, device and precise historical GPS data must be stored separately from customer-safe or general Walker projections. No generic broad Walker document read should expose restricted categories.

## 7. GPS operating direction and privacy gates

Approved operating targets recorded in the live-walk direction:
- Target sample cadence: 10 seconds.
- Stale alert: after 30 seconds without an accepted update.
- Route deviation alert: greater than approximately 150 metres for 3 minutes, only when GPS accuracy is adequate.

These are operational targets, not complete acceptance thresholds. Accuracy ceiling, timestamp age, ordering tolerance, rate limits, battery/offline behavior, customer visibility phase, historical route access, retention, deletion and legal-hold rules remain BLOCKED. Stale location must be labelled stale; never imply live tracking when freshness is unknown.

## 8. Compatibility and migration blockers

Before implementation, complete a source-revision-pinned reader/writer map across Firebase, Customer, Partner and Admin for:
- Booking create/list/detail and all legacy schedule variants.
- `walk_tasks` consumers and task status vocabulary.
- Partner writes to `walks/{walkId}` and Admin reads from `walk_locations`.
- Any writer for `walk_locations`; no matching Partner writer was identified in the PR #93 inspected source snapshot.
- Existing `walkerId`/assignment fields and customer-visible Walker details.
- Current Firestore Rules allowing Customer direct Booking create and Admin/assigned Walker direct lifecycle-field updates.

Do not switch a reader or writer, backfill/migrate records, add dual writes, or remove legacy fields until a per-app rollout order, compatibility adapter, rollback plan and emulator coverage are approved.

## 9. Current source baseline — verified limitations

At Firebase `working` SHA `4bf1cd7e1fc0c04deaf58a2d3178a2c85bbeda78`:
- Booking input normalizer/validator and trusted source-record helpers exist, but the validator itself does not perform Zone resolution, availability/capacity reservation, payment or Booking writes.
- No production Booking creation/resolver, Walk Task materializer, Start/Complete lifecycle callable or GPS ingestion callable was found in the inspected Functions entry point.
- Existing Rules still permit direct Customer Booking creation and selected Admin/assigned Walker Booking lifecycle updates; these are compatibility facts, not an approved target security model.
- Synthetic emulator/reference implementations are not production callable coverage.
- PR #92's reported CI pass is not proof of production booking creation, task lifecycle, payment/provider integration or cross-app behavior.

This source audit does not establish deployed Firebase state or exhaustively inspect every app file.

## 10. Required approvals before implementation

| Gate | Required decision/evidence | Status |
|---|---|---|
| G1 | Confirm Booking parent + Walk Task child; freeze occurrence identity and Regular horizon | BLOCKED |
| G2 | Decide Walk Task vs separate live execution identity/path and stable mapping | BLOCKED |
| G3 | Freeze Booking, Task, execution, event and incident fields/enums/transitions | BLOCKED |
| G4 | Approve POL-005/POL-006/POL-007/POL-008 behavior: availability, capacity, payment, cancellation, handover, payout/refund dependencies | BLOCKED |
| G5 | Approve POL-016 incident severity, safe-handover and closure workflow | BLOCKED |
| G6 | Approve POL-021/POL-037 role IDs, scope, action matrix and separation of duties | BLOCKED |
| G7 | Approve GPS quality, customer visibility, retention, deletion and legal hold | BLOCKED |
| G8 | Complete cross-app reader/writer migration map, rollout and rollback | BLOCKED |
| G9 | Implement Emulator tests for Rules + callable transactions + contention + idempotency + role/scope/state negatives | NOT RUN |
| G10 | Independent review, device E2E, deployed-runtime/IAM verification and separate Founder production GO | NOT STARTED |

## 11. Safe implementation sequence after freeze

1. Record G1–G8 decisions in Notion and update this contract with approved decision IDs.
2. Add contract DTO/state-transition tests without changing production callables.
3. Add Firestore Rules Emulator tests that characterize both current behavior and intended deny-by-default target.
4. Implement backend-only Booking resolver, capacity reservation and idempotent Task materializer in isolated Functions modules.
5. Implement assignment, Start, GPS ingestion, completion and incident commands with transaction tests.
6. Migrate Customer/Partner/Admin readers and writers behind compatibility adapters; run cross-app emulator/integration tests.
7. Run device-level GPS/background/permission tests and independent security review.
8. Obtain separate Founder GO before any production deployment or data migration.

**Current decision: DOCUMENTATION REVIEW ONLY. No implementation, merge to main, deployment or release is authorized.**


## 12. Notion policy reconciliation — review findings (6 November 2026)

This section records the controlling Notion evidence checked after the initial draft. It supersedes any inconsistent candidate assumption in Sections 2–10 above. These Notion pages themselves remain Draft or Approval Candidate where noted; they are not silently promoted to final policy.

| Source | Evidence found | Contract disposition |
|---|---|---|
| [Booking API Contract & Callable Implementation Gate](https://app.notion.com/p/40a756abedb98148a671eacf2248fa8a) | LIFE-01 architecture direction received from Founder on 3 Nov as APPROVAL CANDIDATE; four separate domains: Parent Booking, Walk Task, Assignment/Offer, Payment. Explicitly not implementation authorization. | Reflect four domains; retain formal contract approval and implementation gate as BLOCKED. |
| Same API Gate | Parent Booking with child Walk Tasks; preserve existing `walks` completed-history/review collection; do not repurpose it as scheduled tasks. One stable backend-created Walk identity per approved occurrence. | PR #93's `walks/{walkId}` live-session path remains unapproved. Freeze exact execution path and history split before code. |
| Same API Gate | Regular V1 direction: rolling 7-day task generation; idempotent generator stops after cancellation/expiry. Exact recurrence/end-date constraints remain open. | Do not label the entire Regular horizon as undecided; record rolling 7-day generation as selected direction, with recurrence/renewal limits still BLOCKED. |
| Same API Gate | India service timezone `Asia/Kolkata`; authoritative timestamps UTC plus service-local date/time on each Walk Task. | Use this as the timezone direction; final DTO and date-only semantics still require freeze. |
| [POL-005 Booking & Walker Assignment](https://app.notion.com/p/404756abedb981768393f7a9e823ee10) and [POL-026 Walker Availability & Replacement](https://app.notion.com/p/404756abedb981028befeae66ec00f81) | Sequential hybrid offer to one eligible Walker at a time; no simultaneous active offers. Offer timeout, max attempts, ranking, travel buffers and fallback parameters remain approval decisions. | Keep sequential single-active-offer invariant; do not invent timeout/ranking constants. |
| [POL-006 Customer Booking & Eligibility](https://app.notion.com/p/404756abedb9816d8856d4f4c2de203b) | Draft / Founder approval required. Server authoritative for eligibility, service area, price, booking state and confirmation. | No client-authoritative booking creation/price/status; final customer/commercial gates remain blocked. |
| [POL-012 Payment, Refund & Reconciliation](https://app.notion.com/p/404756abedb981859037eaf00f986267) | Draft specification; digital cashless payments; provider confirmation or authorized reconciliation required; client screenshot/client success message cannot mark payment verified. | Payment is separate domain; gateway, payment timing, refund authority and reconciliation still need Founder/Finance decisions. |
| [POL-029 Cancellation, Rescheduling, No-Show & Refund](https://app.notion.com/p/404756abedb9814289e8d0ed99298b52) | Current draft test cases specify 100% eligible refund at/over 12 hours and 50% at 11h59m; post-start ordinary cancellation is not an automatic refund. Policy approval status must be checked before implementation. | Treat as policy test proposal, not frozen commercial behavior, until approver metadata is verified. |
| [POL-016 Incident & Emergency](https://app.notion.com/p/404756abedb98161a588f93ec13740c5) | Draft / awaiting review; incident lead, backup, response targets, local contacts, restart authority, retention/legal hold and drills remain decisions. | Safety handover principles apply; do not invent SEV response deadlines or mark incident workflow approved. |
| [POL-021 Access Control](https://app.notion.com/p/404756abedb98114ad39e1db6c03d444) and [POL-037 City–Zone Operating Structure](https://app.notion.com/p/404756abedb981da9cd3d8c06277333b) | Role model is proposed: Founder, separate Super Admin, Central Operations, City Manager, Zone Supervisor, Walker, Support, Finance and location roles. Geographic scope and separation of duties are required; exact claims/action matrix remains to freeze. | Preserve Founder ≠ Super Admin ≠ Central Operations; City Manager is City-scoped; Zone Supervisor is Zone-scoped. Do not infer these roles are implemented. |
| [Cross-App Live Tracking & Booking Data Contract — Readiness](https://app.notion.com/p/409756abedb9811bad58c5aea088be62) | Founder-approved operating workflow values: 10s target cadence, stale after 30s, deviation >~150m for 3m with adequate accuracy; customer sharing active-Walk-only; Admin geographically scoped. Exact schema/API/roles/accuracy/offline/retention freeze pending. | Preserve approved operating values; keep feed collection, quality thresholds, backfill and retention blocked. |

### 12.1 Confirmed conflicts / corrections required in source proposals

1. PR #93 candidate `walks/{walkId}` execution path conflicts with Notion's instruction to preserve existing `walks` completed-history/review records. No collection switch is approved.
2. Admin reads `walk_locations`; inspected Partner source stores route in memory and writes a compacted `walks.route` only at completion. This does not establish an end-to-end live feed. Canonical feed must be selected before changing either reader or writer.
3. Booking and Walk Task are not the only domains. Assignment/Offer and Payment must remain separately modeled and audited.
4. Initial draft treated Regular generation horizon as wholly open; Notion has selected rolling 7-day V1 generation direction. Exact recurrence/end-date/renewal behavior remains open.
5. Initial draft did not state the service timezone direction; add `Asia/Kolkata` with UTC storage and service-local task context.
6. Founder-received LIFE-01/LIFE-02 and live GPS operating workflow approvals are approval candidates/direction only; they do not approve exact fields, enums, collection paths, callables, Rules, migrations, merge or production deployment.

### 12.2 Notion decision gates still required

- **AP-01/AP-02:** final Parent Booking and Walk Task enums, complete transition matrix and legacy mappings.
- **AP-03:** sequential offer timeout, attempt limit, ranking/tie-breakers, pause/retry and widening rules.
- **AP-04:** Regular recurrence/end date, rolling-window extension, renewal and horizon exhaustion.
- **AP-05/AP-06:** capacity reservation/expiry and payment provider, trusted verification, payment/confirmation order, reversal/refund.
- **AP-07:** idempotency key format, retention, request binding, deterministic Task/Walk IDs and duplicate webhook behavior.
- **AP-08:** authoritative pickup source, snapshot rules, coordinate precedence, null-coordinate legacy behavior and allowed pickup change.
- **AP-09:** cross-app field visibility, exact role claims, City/Zone scope, break-glass and audit matrix.
- **AP-10:** cancellation/refund/payment reversal and active-walk replacement only after safe handover.
- **AP-11/AP-12:** daily walk-count limit (Customer UI 3 vs normalizer tests up to 4) and Immediate/ASAP semantics.
- **TF-01–TF-12:** exact live record/feed/history path, lifecycle transitions, command API, IDs/idempotency, GPS quality/offline, recipient verification, role/geography, incident, retention and Rules/Emulator/release control.

**Review disposition:** PR #96 remains documentation-only Draft. Notion evidence has refined the architecture direction but has not cleared the full contract freeze. No Functions, Rules, app code, schema, migration, merge to `main`, deployment or device testing is authorized by this review.


## 13. Cross-app source compatibility audit (2026-11-06)

**Audit boundary:** read-only inspection of the exact `working` snapshots below. This section records current source behavior; it does not approve a replacement schema or authorize app/Rules/Functions changes.

| Repository | Audited `working` commit |
|---|---|
| `DOJOWALK/DOJO-WALK-Firebase` | `4bf1cd7e1fc0c04deaf58a2d3178a2c85bbeda78` |
| `DOJOWALK/DOJO-WALK-Customer` | `f7e82bf4183c0e0fd84fc0fdf92df6139da81b02` |
| `DOJOWALK/DOJO-WALK-Partner` | `19fe99b7b8194214868f252294f0fcfd986c1645` |
| `DOJOWALK/DOJO-WALK-Admin` | `af7913e52f0b1c42694938743225800555709507` |

### 13.1 Current reader/writer map

| Domain | Current writer / source | Current reader / consumer | Compatibility result |
|---|---|---|---|
| Parent Booking | Customer `booking_confirmation_screen.dart` directly creates `bookings/{bookingId}` with `bookingRef.set(bookingData)`. Legacy fields include `petName`, `petDetails`, `pickupAddress`, `scheduledAt`, string `duration`, `walkSchedules`, `status=pending`, `walkerId=null`. | Customer booking screens; Partner loads `bookings/{bookingId}`; Admin `FirestoreBookingsDataSource` streams the entire `bookings` collection; Admin Walker service also reads all bookings or filters by `walkerId`. | Existing legacy shape is in use. Do not replace fields without a dual-read/compatibility plan. |
| Booking validation | Firebase contains normalizer, validator, trusted snapshot loader and legacy adapter modules. | No production booking callable is exported from current `functions/src/index.ts`; Customer screen writes directly rather than invoking this server pipeline. | Helpers are not an end-to-end production booking path. The legacy adapter is pure and requires a service-timezone resolver. |
| Walk Task | No production task materializer/writer identified in audited Functions entry point or inspected app flows. Customer stores schedules inside the Parent Booking document. | Partner currently receives a Booking ID and booking-level schedule/details; no child Walk Task read path was identified in inspected Partner flow. | Parent Booking and occurrence-level task are not yet separated at runtime. |
| Assignment / Offer | Customer creates with `walkerId=null`; no booking/offer callable exported from audited Functions entry point. | Admin queries bookings by `walkerId`; Partner opens a booking passed into its detail flow and changes its status to `accepted`. | No sequential offer/acceptance service or server-owned assignment workflow is connected in this snapshot. |
| Walk execution / history | Partner generates a client-side `walks` document ID when the live screen is initialized. On completion it writes `walks/{walkId}` with `bookingId`, walker, timestamps, metrics and compacted `route`; then separately updates the Parent Booking to `completed`. | Existing completed-history/review consumers are not repurposed by this audit. Admin booking summary reads selected Booking fields and supports a `walkId` display field. | Walk ID is not backend-created. Completion is two separate client writes, not one atomic server transition. Preserve existing `walks` history; do not treat it as the scheduled-task collection. |
| Live GPS | Inspected Partner live-walk screen validates GPS locally and appends positions to an in-memory `_route`; it does not write a per-fix feed to Firestore. | Admin Live Operations reads Walker markers from `walkers` (`isOnline=true`, `currentLocation`) and loads route points from `walk_locations` by `walkerId` and `timestamp`. | No connected live-feed writer was found in the inspected Partner live-walk path. Admin's `walk_locations` reader and Partner's completion-only `walks.route` writer are incompatible as a live feed. |
| Payments / refunds / payouts | No Customer payment collection write or gateway integration was found in the audited booking confirmation flow. Firebase `payments` Rules allow create/update/delete only to Admin. | Admin Finance screen explicitly labels its rows as examples and the module as UI prototype only; it states no gateway, settlement, refund API or payout provider is connected. | Payment domain is not operationally integrated. Never infer paid status from the booking request or client UI. |

### 13.2 Firestore Rules compatibility findings

1. Firebase `firestore.rules` on the audited `working` commit has a Booking create rule that accepts the current legacy Customer shape, and permits assigned Walker updates to a limited set of Booking progress fields. The same rules do not define a `match /walks/{...}` or `match /walk_locations/{...}` block; the final recursive rule is default deny. Consequently, the inspected Partner write to `walks/{walkId}` and Admin read from `walk_locations` are not authorized by these Rules.
2. The separate Partner repository's checked-in `firestore.rules` is not a substitute for the Firebase repository's deployed Rules. It also has no `walks` or `walk_locations` rule, and its Booking create rule is explicitly false. Confirm the single authoritative Rules deployment source before any release.
3. Firebase Rules permit Admin writes to `payments`, but that is not a payment-provider verification workflow. A trusted server reconciliation and audit path is still required.

### 13.3 Schema and lifecycle deltas to resolve before implementation

- **Booking DTO:** Customer currently writes a legacy Firestore document. The server validator expects an identifier-only request (`bookingPlan`, `dogId`, `pickupAddressId`, `schedule`) and trusted server-loaded source records. Wire the server path before disabling direct Customer create; retain an explicit adapter for legacy records.
- **Schedule semantics:** Customer UI validates at most 3 walks per day. The Normalizer/Notion decision gate records a 3-vs-4 discrepancy; resolve AP-11/AP-12 before widening or narrowing limits. Immediate/ASAP and Regular currently return an operations-confirmation outcome in the candidate normalizer, not a generated task.
- **Pickup snapshot:** Customer writes a copied `pickupAddress` map; Partner reads that map first, then falls back to top-level coordinates or legacy `location` GeoPoint. Freeze coordinate precedence, address snapshot provenance and null-coordinate behavior before canonicalization.
- **Start/complete events:** Partner detail flow directly sets Booking status to `accepted` before navigation. The inspected live screen starts its local timer/GPS but does not issue a server start command. Completion writes the `walks` history record and then updates Booking status separately. Define server-owned start/complete commands, idempotency and recovery behavior.
- **Walk identity:** Partner currently generates the `walks` document ID on the client. Replace only after a backend-created stable Walk identity and the existing history-preservation mapping are approved.
- **Live GPS:** Decide canonical live feed/session path, write cadence, timestamp/accuracy fields, active-Walk authorization, Admin geographic scope, offline/backfill, stale detection and retention before connecting the Admin reader. Do not simply point Admin at `walks.route`.
- **Assignment:** Keep Parent Booking, Walk Task and Assignment/Offer separate. Define eligible Walker selection, sequential offer timeout/attempts, acceptance, expiration and backup rules before exposing Partner status changes as assignment.
- **Payment:** Keep payment status/provider references server-owned. Freeze provider confirmation, reconciliation, idempotency, refund and payout ledgers before enabling payment UI or booking confirmation.
- **Admin read scope:** Current Admin Booking source streams all Booking documents; Walker service can stream all bookings. This is broader than the proposed City/Zone operating scope and must be reconciled with AP-09 before role expansion.

### 13.4 Evidence paths inspected

- Firebase: `functions/src/index.ts` (blob `d11f3a621c5f4552053107cff4b4631437890000`); `firestore.rules` (blob `67284dba473b3d5c87f201ba4115714bc0`).
- Customer: `lib/features/booking/screens/booking_confirmation_screen.dart` (blob `e7f122e3195e07f7bb5b7edebc6cacae14600e0b`); `lib/features/booking/screens/choose_walk_screen.dart` (blob `bb9c13cbe79b92fe878ceba73795218ed3b89975`).
- Partner: `lib/features/live_walk/screens/live_walk_screen.dart` (blob `9b56a1c96ab5a90c63b4870e3249f52e4d4420f2`); `lib/screens/home/walk_details_screen.dart` (blob `9a872d66a59b8d04e14cb4053a68160f3349721e`).
- Admin: `lib/screens/bookings/booking_data_source.dart` (blob `ccd357363b246120efe1777d205b15939aeddde1`); `lib/screens/live/live_operations_screen.dart` (blob `b97c8ea6e521ca8873ebdaa013c1ab8693d3d515`); `lib/features/finance/screens/finance_operations_screen.dart` (blob `d7337f33171b5d3555d5f3b614afb659e9035734`).

**Audit disposition:** Cross-app runtime compatibility is **BLOCKED** for live GPS, Walk history writes under current Rules, server-owned Booking/Task/Assignment lifecycle, and Payment integration. This is a source inspection, not emulator/device execution. No app code, Functions, Rules, indexes, data, migrations, production deployment or `main` branch changes were made. PR #96 remains documentation-only Draft.
