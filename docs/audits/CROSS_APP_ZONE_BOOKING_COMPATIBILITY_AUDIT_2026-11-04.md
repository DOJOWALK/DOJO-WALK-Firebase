# DOJO WALK — Cross-App Zone & Booking Compatibility Audit
**Date:** 2026-11-04  
**Status:** Evidence-based audit; implementation not started  
**Scope:** Firebase, Admin, Partner, Customer repositories  
**Safety boundary:** Documentation only. No Rules/Functions runtime changes, app code changes, migrations, role grants, production reads/writes, deployment, or merge to `main`.

## 1. Executive result

The canonical Zone Lifecycle implementation in Firebase is not yet end-to-end integrated with the existing Admin, Partner, and Customer applications.

The inspected application code still uses legacy service-location / zone models:
- Admin uses `service_countries`, `service_states`, `service_districts`, `service_cities`, `service_areas`, `service_localities`, plus legacy City/Area activation callables.
- Partner onboarding reads `zones` and stores zone names/IDs on the Walker profile.
- Customer booking confirmation writes a pending document directly to `bookings`; the inspected payload does not include a canonical `zoneId`.
- Firebase canonical Zone documents are in `service_zones`; client SDK read/write is explicitly denied by Firebase Rules. Scoped callable reads and trusted assignment records are the intended authority.

**Conclusion:** Do not enable canonical Zone operations in the existing apps yet. First complete the API contract adapters and Emulator integration tests described below.

## 2. Source evidence and inspected revisions

| Repository | Ref / revision | Inspected file | Evidence |
|---|---|---|---|
| Firebase | `implementation/zone-lifecycle-functions-emulator-2026-11-04`, commit `b6d05d8158a438bb7eb09484f9d8446fbbac2186` | `functions/src/index.ts` | Exports canonical scoped Zone read/assignment and legacy service-location callables |
| Firebase | same | `firestore.rules` | `service_zones` is server-only; booking create has legacy schema validation |
| Admin | `main`, blob `c966597975a37a056e9ee27d8625caefc46a4101` | `lib/features/service_location/services/service_location_service.dart` | Uses legacy collections and calls `activateServiceLocation` |
| Admin | `main`, blob `874e80238d2b9dd0c1f6d8db3a6243b892c5e7eb` | `lib/features/service_location/screens/service_location_screen.dart` | Tabs include Countries, States, Districts, Cities, Areas/Sub-districts, Localities/Villages |
| Partner | `main`, blob `9c5d5e12a3fd29785d2001fb20937a7bbb374df5` | `lib/features/onboarding/screens/work_location_screen.dart` | Queries `zones` where `isActive == true`; saves `zoneName`, `zoneNames`, `zones` to Walker profile |
| Partner | `main`, blob `9a1c14fe13e05eaa7fd2df55942a20b02ce82074` | `lib/screens/home/partner_home_screen.dart` | Reads bookings by `walkerId == uid`; displays booking `zoneName` fallback |
| Partner | `main`, blob `7b02a8bfb4fe80ab04d72f59966e2e09c848ffd0` | `firestore.rules` | Legacy `/zones` is public-readable; booking walker updates are field-limited |
| Customer | `main`, blob `94d45b12c7873fc2d289e164df965c735c0c63cb` | `lib/features/booking/screens/booking_confirmation_screen.dart` | Creates `bookings/{id}` directly with pending status and null walker |
| Firebase | same | `firestore.rules` | Booking create requires legacy booking fields and has no canonical Zone/availability check in the inspected validation helper |

These are source snapshots, not evidence that the four applications have been built or tested together.

## 3. App-by-app findings

### 3.1 Admin

**Observed**
- Service-location service exposes legacy collections for Country, State, District, City, Area, Locality.
- `_activateTrustedBoundaryLocation` invokes `activateServiceLocation` with `locationType` and `locationId`.
- Legacy Firebase callable implementation handles City/Area geometry activation; it is not the canonical Zone lifecycle API.
- UI tabs still expose Areas/Sub-districts and Localities/Villages.

**Risk**
- An Admin operator could create/activate a legacy Area and assume that it is a canonical service Zone.
- Legacy activation must not be presented as Zone activation or as Founder-approved Zone lifecycle.

**Required adapter**
- Retain the hierarchy selectors State/UT → District → City → Zone.
- Introduce a distinct canonical Zone service using the canonical callable API; do not repurpose `activateServiceLocation`.
- Zone list/detail reads must call `listVisibleServiceZones` and `getVisibleServiceZoneBoundary` with server pagination/scope. Never query `service_zones` directly from the client.
- Create/review/Founder approval/activate/deactivate/suspend/reactivate controls must map to their dedicated canonical callable endpoints and display server-returned state/revision.
- UI permissions must be presentation only; server authorization remains authoritative.

### 3.2 Partner

**Observed**
- Work Location queries `zones` with `isActive == true`.
- It filters using string fields `city` and `area`, derives state and zone names, then stores `city`, `state`, `area`, `zoneName`, `zoneNames`, `zones`, and `travelMode` on `walkers/{uid}`.
- Partner home queries `bookings` by `walkerId == uid` and uses `booking.zoneName` as display fallback.
- Partner Rules allow reads from legacy `zones`; this does not grant access to canonical `service_zones`.

**Risk**
- Walker profile preferences can be mistaken for authoritative Zone assignment.
- The Partner app may show legacy Zones that are not active canonical Zones.
- A Walker could be shown work outside their server-authored assignment if app-side profile arrays are treated as authority.

**Required adapter**
- Work-location selection may record preferred City/Zone preferences, but must not create or mutate authoritative assignment.
- Canonical Zone availability and Walker eligibility must be checked server-side.
- Assignment authority is `walker_zone_assignments` with active server-authored records; never trust profile `zones`, `zoneNames`, or client-submitted Zone IDs as assignment proof.
- Partner home should receive only bookings permitted by trusted assignment and booking authorization. Add a dedicated scoped callable/query contract if existing Firestore query/rules cannot safely express it.
- Keep booking display Zone name as denormalized display metadata only; stable `zoneId` is the relationship key.

### 3.3 Customer

**Observed**
- Booking confirmation reads the selected dog, creates a new `bookings` document, and writes fields including `bookingId`, `customerId`, `walkType`, plan/service fields, dog/pickup details, `scheduledAt`, duration, schedules, `status: pending`, `walkerId: null`, and `createdAt`.
- The inspected payload does not contain canonical `zoneId`, canonical `cityId`, or a server-issued availability/quote token.
- Firebase Rules validate the legacy booking shape and status, but the inspected rule helper does not verify that a supplied location resolves to an active canonical Zone or that a Walker/slot is available.

**Risk**
- A syntactically valid booking could be created without proving it belongs to a currently serviceable canonical Zone.
- Client-side location/availability checks can be stale or forged.
- Payment must not be enabled until server-side Zone eligibility and slot availability are confirmed.

**Required adapter**
- Resolve pickup coordinates/address to exactly one active canonical Zone server-side.
- Validate that Zone is active/serviceable and that the requested date/time/duration/dog count is eligible.
- Return a short-lived server-issued availability/quote token bound to customer, Zone, pickup, requested schedule, price, and expiry.
- Booking creation must consume/validate that token and write immutable canonical `zoneId`, `cityId`, and resolved location snapshot from trusted server data.
- Preserve separate `bookingId` and `walkId`; do not assign a Walker from client input.
- Keep payment initiation disabled until availability and price are server-confirmed. Booking state/payment state transitions must remain server-authoritative.
- Do not introduce a new callable payload until the Customer booking contract and Rules tests are updated together.

## 4. Canonical model mapping

| Concept | Legacy app representation | Canonical target | Authority |
|---|---|---|---|
| State | `state` string | `stateId` + canonical State record | Firebase hierarchy |
| District | often omitted/string | `districtId` + canonical District record | Firebase hierarchy |
| City | `city` string | `cityId` + canonical City record | Firebase hierarchy |
| Zone | `zoneName`, `zones[]`, legacy `zones/{id}` | `service_zones/{zoneId}` | Canonical Zone lifecycle |
| Walker preferences | `walkers/{uid}.zones[]` etc. | preference-only fields, if retained | Walker may edit within allowed profile fields |
| Walker assignment | inferred from profile values | `walker_zone_assignments` active records | Trusted Functions only |
| Booking location | pickup address and optional display name | trusted `zoneId`, `cityId`, pickup snapshot | Server-resolved at booking |
| Booking | direct customer Firestore write | validated booking contract | Rules + trusted server checks |
| Walk | may be inferred from booking | distinct `walkId` | Trusted lifecycle |

Do not migrate or delete legacy fields until all consuming screens, Rules, callable contracts, reporting, and historical booking readers have been inventoried.

## 5. Canonical callable integration surface

The Firebase implementation exports the following lifecycle endpoints (synthetic Emulator implementation; production deployment not authorized):
1. `createServiceZoneDraft`
2. `createServiceZoneBoundaryDraft`
3. `reviewServiceZoneBoundary`
4. `submitServiceZoneForFounderReview`
5. `decideServiceZoneFounderApproval`
6. `activateServiceZone`
7. `requestServiceZoneDeactivation`
8. `suspendServiceZoneForEmergency`
9. `requestServiceZoneReactivation`
10. `reactivateServiceZone`

Scoped read/assignment endpoints also exist in `functions/src/index.ts`, including `listVisibleServiceZones`, `getVisibleServiceZoneBoundary`, `assignWalkerToZone`, `assignZoneSupervisor`, `revokeZoneAssignment`, and `assignBoundaryReviewer`.

**Integration rule:** Admin may call lifecycle endpoints according to server permissions. Partner and Customer must not call administrative lifecycle endpoints. Partner/Customer receive only the minimal scoped read/booking endpoints needed for their roles.

## 6. Required integration sequence

1. **Freeze contracts:** finalize typed request/response/error contracts for Admin Zone read/write, Partner work preferences/assignment, Customer availability/booking, and booking-to-walk lifecycle.
2. **Firebase adapter tests:** add callable emulator contract tests and Rules tests for each app-facing API; assert resulting Firestore documents, audit logs, and denied-state immutability.
3. **Admin adapter:** implement canonical Zone read/lifecycle screens behind a feature flag; preserve legacy location data read-only during transition.
4. **Partner adapter:** replace legacy Zone source with scoped canonical Zone read; separate preference from authoritative assignment; add assignment-only work eligibility.
5. **Customer adapter:** implement server-side Zone resolution + availability/quote + booking creation; preserve no-payment-on-unavailable behavior.
6. **Cross-app synthetic end-to-end tests:** create Zone → verify boundary → Founder exact approval → activate → assign Walker → Customer availability → booking → Walker accepts/starts/completes → audit and payout eligibility.
7. **Migration rehearsal:** dry-run mapping and duplicate/orphan detection on synthetic fixtures; no live migration until separately approved.
8. **Release gate:** all repo CI, Emulator acceptance, security review, app builds, and explicit Founder release approval. Production deployment is a separate approval.

## 7. Minimum Emulator acceptance matrix

### Admin
- Founder and Central see all canonical Zones.
- City Manager sees only assigned City Zones.
- Supervisor sees only exact assigned Zone.
- Unauthorized/legacy `super_admin` cannot perform canonical lifecycle actions.
- Admin client cannot directly write canonical Zone, boundary, approval, assignment, audit, or outbox records.
- Stale revision, wrong parent, stale boundary hash, wrong approval request, and idempotency conflict are rejected without partial writes.

### Partner
- Work Location lists only active/serviceable canonical Zones within permitted discovery scope.
- Profile preference cannot grant assignment or widen assignment scope.
- Inactive/revoked assignment blocks new work.
- Partner can read only assigned booking/work data.
- Partner cannot change `walkerId`, `zoneId`, price, payment, or another Walker's booking.
- Emergency Zone suspension blocks new assignment/booking but does not terminate an already-running walk.

### Customer
- Outside-boundary, ambiguous-boundary, inactive-Zone, and no-capacity requests cannot proceed to payment.
- Valid pickup resolves to one canonical Zone and server-issued quote.
- Expired, replayed, customer-mismatched, Zone-mismatched, schedule-mismatched, or price-mismatched quote token is rejected.
- Customer cannot choose or overwrite `walkerId`, canonical `zoneId`, payment status, or server state.
- Booking and walk IDs remain separate; retries are idempotent.
- Cancellation and running-walk emergency/handover rules remain intact.

### End-to-end
- Active Zone + eligible Walker + valid slot → booking created with trusted Zone snapshot.
- No eligible Walker/slot → no payment authorization and no falsely confirmed booking.
- Walker assignment is same-zone and server-authoritative.
- Assignment retry is idempotent; concurrent assignment has one valid winner.
- Every transition writes an audit record; failures leave protected state unchanged.

## 8. Blocking gaps / decisions

1. Customer pickup-to-Zone resolver contract and boundary edge-case policy.
2. Availability/quote token schema, TTL, replay protection, and price source.
3. Booking creation ownership: direct Rules create versus callable-only create. Current Rules permit legacy direct customer create; do not switch until app contract and test suite move together.
4. Partner scoped booking feed: Firestore query/rules design versus callable feed.
5. Exact source of Walker preferred Zones versus active assignments and who approves assignment.
6. Legacy `zones` collection read-only/deprecation period and historical booking display strategy.
7. Notification delivery provider/dispatcher for emergency Founder notification remains a separate known implementation gap; outbox persistence alone does not prove delivery.

No unresolved decision above is silently assumed by this audit.

## 9. Current status

- Canonical Zone Lifecycle: implemented on a feature branch and Emulator CI was reported green for the latest checked commit; this is not production certification.
- Cross-app compatibility: **NOT INTEGRATED**.
- Admin/Partner/Customer changes: **NOT STARTED**.
- Cross-app Emulator E2E: **NOT RUN**.
- Production migration/deployment: **NOT AUTHORIZED / NOT PERFORMED**.
- This document is an audit artifact only and does not approve implementation or merge.

## 10. Source links

- Firebase lifecycle PR #71: https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/71
- Admin repository: https://github.com/DOJOWALK/DOJO-WALK-Admin
- Partner repository: https://github.com/DOJOWALK/DOJO-WALK-Partner
- Customer repository: https://github.com/DOJOWALK/DOJO-WALK-Customer
