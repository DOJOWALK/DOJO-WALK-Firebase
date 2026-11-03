# DW-SEC-001 — Cross-app Walker Data Inventory (continued)

Date: 2026-11-03  
Scope: read-only source inspection of remaining Partner, Admin, Customer and Firebase paths. This is a source-code inventory, not a production-data audit or deployed-rules verification.

## Source snapshots inspected

All app files below were read from each repository's `main` branch. Blob SHAs are recorded to make the inspection reproducible.

| Repository | Path | Blob SHA |
|---|---|---|
| DOJO-WALK-Partner | `lib/screens/home/profile_screen.dart` | `7a8be25665a9e527e2991e2da41d093cd4fbdd04` |
| DOJO-WALK-Partner | `lib/features/onboarding/screens/current_address_screen.dart` | `96b6b632943063e51549bd7ee203e95a13e9b2f1` |
| DOJO-WALK-Partner | `lib/features/onboarding/screens/kyc_documents_screen.dart` | `d10ff6cf2d66e4a78f860776fa70ec23cea92aab` |
| DOJO-WALK-Partner | `lib/features/onboarding/screens/review_submit_screen.dart` | `17aaedef0c04ee7956bb6260a05cc7f1d7f3380d` |
| DOJO-WALK-Partner | `lib/screens/home/earnings_screen.dart` | `9fd6a6bbdc908ce0e92bc4b4466c5a8fb5f7ef6c` |
| DOJO-WALK-Partner | `lib/features/live_walk/screens/live_walk_screen.dart` | `1ca731246d58cc3742606dd3de8e04755d744cf0` |
| DOJO-WALK-Partner | `lib/features/live_walk/services/location_permission_service.dart` | `037a604499ddc2923bb433001f8a2f3ef2f25540` |
| DOJO-WALK-Admin | `lib/features/walkers/models/walker_admin_model.dart` | `d8a2cca8c7d6851c13ecd34bf2c063aab480b67e` |
| DOJO-WALK-Admin | `lib/features/walkers/services/walker_admin_service.dart` | `d87d248ff8cc7f1b265c0db0c8f5abd52b6a3eb5` |
| DOJO-WALK-Admin | `lib/features/walkers/screens/walker_management_dashboard_screen.dart` | `20da5d3ec38513bfa784d7a8c263c86156c28f2b` |
| DOJO-WALK-Admin | `lib/features/walkers/screens/walker_details_screen.dart` | `9f45b86c298211eba41dfc7bf45f8f98554311d4` |
| DOJO-WALK-Admin | `lib/features/walkers/widgets/walker_details_sections.dart` | `e51fb0c028622c0c6cba9c3cf897437872f728ca` |
| DOJO-WALK-Admin | `lib/features/walkers/widgets/kyc_document_viewer_dialog.dart` | `90ad743e9411255615943187dfe219a23e4aec9f` |
| DOJO-WALK-Admin | `lib/features/walkers/widgets/walker_security_dialog.dart` | `dd4ab43d71a986da94e162254f8cd4d4b31dcb59` |
| DOJO-WALK-Admin | `lib/features/walkers/widgets/walker_activity_history_dialog.dart` | `50303e4992466f846b60a0385e1b81ffe6188233` |
| DOJO-WALK-Admin | `lib/features/walkers/utils/walker_admin_helpers.dart` | `d45ce18b01c89657c55d339f5d8426d72290786e` |
| DOJO-WALK-Customer | `lib/features/booking/screens/choose_walk_screen.dart` | `0ab692f470a7cf675f1c30006c4e8157126b1736` |
| DOJO-WALK-Customer | `lib/features/booking/screens/my_bookings_screen.dart` | `76483699c4ad5c664290f8d135e8ee0e13a90bc0` |
| DOJO-WALK-Customer | `lib/features/profile/screens/profile_screen.dart` | `1d049dfeb3bee8c26855b74a1a30e42a32c4d3e9` |
| DOJO-WALK-Customer | `lib/features/support/screens/help_support_screen.dart` | `674e10cdc2bbb3f7a3fd7b969f83f0f19b2fa341` |
| DOJO-WALK-Firebase | `functions/src/index.ts` | `2b13994aff949f38e626e1929422e5de84755312` |
| DOJO-WALK-Firebase | `functions/package.json` | `e05c6f142638aa3ca483548590385ef6ee0321bff` |

## Findings

### Partner app

1. Profile screen reads `walkers/{auth.uid}` and displays `walkerId`, `zoneName`, `phone` and profile-related values. This remains a direct parent-document read.
2. Current-address screen reads and writes `walkers/{auth.uid}.currentAddress`. Fields observed include `houseNumber`, `street`, `landmark`, `city`, `state`, and `pinCode`. This is residential/address data and must remain restricted to the Walker and explicitly authorized verification/support roles.
3. KYC screen uploads documents to `walker_documents/{uid}/{key}_{timestamp}.jpg` and writes KYC metadata under `walkers/{uid}.kyc.documents`, including `status`, `storagePath`, and `submittedAt`. This is consistent with the previously recorded actual Partner Storage path; do not substitute a guessed `walker_kyc` Storage path.
4. Review/Submit screen reads the Walker parent, including phone, selected zones (`zoneNames` with legacy `zoneName` fallback), `currentAddress`, KYC document/selfie status and Storage paths; it resolves private KYC/selfie objects from Firebase Storage. It also updates onboarding/submission state on the parent document.
5. Earnings screen currently contains presentation cards and explanatory text; inspected source shows no Firestore earnings/payout query or write. Therefore this screen is not evidence of a real earnings ledger or payout integration.
6. Live Walk creates a `walks/{walkId}` document with `walkerId` and walk/location-related data, then separately updates `bookings/{bookingId}`. This is a multi-write client flow, not a server-atomic lifecycle operation. Exact location payload and event semantics need a separate focused contract review before migration.
7. Location permission helper checks/request foreground or always location permission through the device location plugin. The inspected helper itself does not persist device tokens or write a device registry.
8. Partner repository's `functions/index.js` is only a small stub in the inspected main snapshot; it is not evidence of a Partner-side backend Walker service.

### Admin app

1. `WalkerAdminService` streams the full `walkers` collection, reads individual parent documents, queries bookings by `walkerId`, and reads Walker-related `audit_logs`. Its approve/reject/suspend/reactivate/correction actions update the Walker parent and write an audit record in a Firestore transaction.
2. `WalkerAdminModel` maps phone, email, photo, status, verification timestamps, and the full nested `kyc` map from the parent document. It retains raw data for details screens.
3. Dashboard searches and renders Walker name, phone, email, UID, area/city/state, photo and status. It filters availability/review/rejected/running states using parent fields and bookings.
4. Details sections render current residential address, assigned zones, availability and KYC document metadata/references. KYC viewer resolves Storage paths/URLs and loads document content.
5. Security dialog receives the full Walker data map; details screen also passes the full map to it. This is a UI presentation path, not a separate permission boundary.
6. Activity-history dialog reads audit logs filtered by `targetType=walker` and `targetId=walkerId`.
7. These findings confirm Admin is a broad consumer of the existing parent Walker document. The target split requires a deliberately scoped Admin service/model contract; merely changing UI widgets would not enforce data separation.

### Customer app

1. Booking selection reads the signed-in customer's own user/profile data; inspected choose-walk source did not read Walker documents.
2. Booking creation continues to write a parent `bookings/{bookingId}` record with `walkerId: null` at initial creation; see the earlier inventory for the full booking field list.
3. My Bookings reads the customer's bookings and displays the `walkerId` value when assigned. In the inspected source it does not fetch a Walker profile document, phone number, or contact details; UI text says Walker name/contact will appear when available in the booking record.
4. Customer profile reads the customer's own `users/{uid}` document. Support FAQ contains general text and no Walker private-data read.
5. No customer-facing assigned-Walker profile callable or projection consumer was found in these inspected files. The proposed `getAssignedWalkerPublicProfile(bookingId)` remains a design proposal, not an implemented API. Full Customer repository search is still needed before finalizing the consumer list.

### Firebase Functions / scripts

1. Firebase Functions package is a TypeScript trusted-location Functions package. The inspected `functions/src/index.ts` exports five callable operations: service-location boundary review, service-location activation, service-location status, save service location with name index, and service-location import-run management.
2. No Walker profile, KYC, finance/payout, emergency, device-token, or assigned-Walker callable was found in this Functions entry point.
3. The Firebase Functions scripts discovered in the repository tree are service-location migration/preflight/integrity scripts. No Walker migration script was identified in the inspected tree.
4. This is a bounded repository/source finding; it does not prove that no external service, separate repository, scheduled job, or deployed function exists.

## Security and contract implications

- The legacy `walkers/{uid}` parent is currently a cross-app aggregation point containing public-ish display data, residential address, phone, zones, onboarding, KYC metadata and lifecycle state. Firestore document reads cannot redact individual fields; the existing direct-read pattern is incompatible with strict field-level data separation.
- Partner's own profile/onboarding flows need a controlled migration path that preserves self-read/self-write behavior without exposing restricted fields to other roles.
- Admin needs separate purpose-scoped access for operational profile, KYC review, finance, emergency/support and device/security. Current full-collection streaming plus raw-data model is too broad to serve as the final role boundary.
- Customer currently displays only the assigned `walkerId` from the booking; the customer-safe public profile projection and authorization callable are not yet implemented in the inspected sources.
- Earnings/payout UI is presently static in the inspected source; do not treat it as a verified ledger or payout source.
- Live Walk's client-side writes to `walks` and `bookings` require a separate authoritative lifecycle/API decision and must not be silently moved into this data-separation change.

## Remaining gates before Rules/schema edits

1. Complete repository-wide search for every read/write to `walkers`, `walks`, `walker_documents`, `walker_selfies`, `deviceTokens`, FCM and payout collections across all apps, Functions, workflows, scripts and any integration repository.
2. Freeze field-by-field schemas and ownership for the public projection and each restricted collection, including compatibility/legacy fields.
3. Freeze actual Firebase role IDs, active-state checks, geographic scopes and action matrix for Walker, Verifier, Finance, Support/Emergency, Central/Admin.
4. Approve exact emergency access authority, reason, expiry, review and audit mechanics.
5. Approve POL-014/POL-020 retention/deletion/backup/legal-hold schedule; no durations are inferred here.
6. Freeze callable/API request-response contracts, booking ownership/assigned-Walker checks, migration conflict handling, idempotency, reconciliation, rollback and cutover.
7. Define Emulator acceptance tests for own Walker, other Walker, assigned/unassigned Customer, unrelated Customer, scoped/inactive Admin, Verifier, Finance, Support/Emergency, query/list leakage, Storage and Partner regression.

## Change and verification status

- Read-only source inspection only.
- No Firestore Rules, Storage Rules, app source, Functions source, production data or deployed configuration changed.
- No tests were run as part of this inventory.
- No merge, workflow dispatch, production migration or deployment performed.
- This document does not mark DW-SEC-001 implementation or testing complete.


## Repository-wide GitHub code-search pass (3 Nov 2026)

A repository-scoped GitHub code-search pass was run for `walks`, `walker_documents`, `deviceTokens`, `currentAddress`, `bankDetails`, `payout`, `fcmToken`, and `walkerId` across the four app/backend repositories. This helps discover additional references, but GitHub code search is an index and is not a substitute for a checked-out full-text scan or deployed-resource inventory.

### Search results that extend the file-by-file inspection

- Partner `walks` references include `lib/screens/home/schedule_screen.dart`, `lib/screens/home/partner_home_screen.dart`, `lib/screens/home/working_schedule_screen.dart`, `lib/screens/home/walk_summary_screen.dart`, `lib/screens/home/navigation_screen.dart`, and `lib/screens/home/walk_completed_screen.dart`, in addition to the inspected Live Walk screen.
- Admin `walks` references include `lib/screens/dashboard/dashboard_screen.dart` and `lib/features/walkers/widgets/walker_details_sections.dart`; Admin `walkerId` references also include `lib/screens/live/live_operations_screen.dart`, `lib/screens/bookings/bookings_screen.dart`, and the Walker management/details/audit files.
- Customer `walks` references include `lib/features/home/screens/home_screen.dart`, booking selection/confirmation/list screens, support and profile text/screens. The `walkerId` search returned only Customer booking creation and My Bookings in the indexed results.
- Partner `walker_documents` search returned only the KYC upload screen. Admin/Customer/Firebase searches returned no indexed matches for that literal path.
- Partner `currentAddress` search returned Current Address, Review/Submit and KYC onboarding screens. Admin returned Walker helper/details sections and two historical audit documents. Customer/Firebase returned no indexed matches for that exact key.
- Literal `deviceTokens`, `fcmToken`, and `bankDetails` matches were found only in Partner's checked-in `firestore.rules` copy; no app implementation reader/writer was returned by these exact-term searches.
- Partner `payout` matches included `earnings_screen.dart` and `walk_completed_screen.dart`; Admin had one architecture document match. No Firebase payout implementation match was returned.
- Firebase code-search returned zero results for `walks`, `walker_documents`, `walkerId`, `deviceTokens`, `currentAddress`, `bankDetails`, `payout`, and `fcmToken` in this search pass. This does not establish absence from deployed functions, external systems, differently named fields, or unindexed sources.

### Follow-up inspection required

The newly surfaced Partner schedule/home/navigation/summary/completion files and Admin Live Operations/dashboard files must be read individually to determine exact collection paths, fields and writes. Continue to treat exact-term search misses as unverified, not proof of no usage.

### Search limitations

The search was performed against GitHub's indexed code results, which may be incomplete, branch/ref-dependent, or omit generated/ignored files. No repository checkout grep, production Firestore/Storage scan, deployed Functions listing, external integration inspection, or tests were performed. No code or production resources were changed.


## Individual inspection of newly surfaced Partner and Admin screens (3 Nov 2026)

### Additional exact source snapshots

| Repository | Path | Blob SHA |
|---|---|---|
| Partner | `lib/screens/home/schedule_screen.dart` | `02b07aa81bfbc32fa8e5cd0d5d083cd2d3c0aa25` |
| Partner | `lib/screens/home/partner_home_screen.dart` | `9a1c14fe13e05eaa7fd2df55942a20b02ce82074` |
| Partner | `lib/screens/home/working_schedule_screen.dart` | `e9f13b0627c5a07f2c5b3a0af09734cd007bb26c` |
| Partner | `lib/screens/home/walk_summary_screen.dart` | `0189ebde502f5b317c678a2ed5af8d7eeefa2e62` |
| Partner | `lib/screens/home/navigation_screen.dart` | `28571975921f8e5b075925742691697016b3b6f4` |
| Partner | `lib/screens/home/walk_completed_screen.dart` | `b61a68273dbf1e590c6c29c188ebf81753ef7668` |
| Partner | `lib/features/live_walk/screens/live_walk_screen.dart` | `1ca731246d58cc3742606dd3de8e04755d744cf0` |
| Admin | `lib/screens/live/live_operations_screen.dart` | `15bf852258b273f753a45d9b107528dc027829e5` |
| Admin | `lib/screens/dashboard/dashboard_screen.dart` | `ce4bd363279e15e707cf1ac8bfcb21ec451ac50d` |

### Partner — schedule, booking and walk writes

1. `partner_home_screen.dart` reads the full own `walkers/{uid}` document and extracts `workingSchedule`, `fullName`, and `walkerId`.
2. It queries `bookings` by `walkerId == auth.uid`, then filters today's date and active statuses client-side. It reads booking fields used for time, dog, duration and location display.
3. It queries `walks` by `walkerId == auth.uid` (limit 50) and checks `status`, `reviewStatus`, `dogName`, `createdAt`, `endedAt`, and `startedAt`.
4. Walker review submission writes `reviewStatus`, `reviewedAt`, `updatedAt`, and optionally `reviewRating` / `reviewNote` to `walks/{walkId}`. Skip-review writes status/timestamps to the same document. Errors are caught and the prompt is hidden locally even if the write fails; UI acknowledgement is therefore not proof of persisted review.
5. `working_schedule_screen.dart` reads own `walkers/{uid}.workingSchedule`; writes `workingSchedule.status`, `workingSchedule.days.{day}.enabled/start/end`, and `updatedAt` using merge. This is a direct Partner client write to the restricted Walker parent.
6. `schedule_screen.dart`, `walk_summary_screen.dart`, and `walk_completed_screen.dart` are presentation/route parameter screens in the inspected snapshots; no direct Firestore reader/writer found in those files.
7. `navigation_screen.dart` directly updates parent Booking `status` to `accepted`, `picked_up`, and `walking` with `updatedAt`. It has no trusted callable shown in this screen for these transitions.

### Partner — Live Walk event and GPS payload

1. Live Walk reads the booking document to obtain customer pickup coordinates (latitude/longitude or GeoPoint) for return-location verification.
2. It tracks device positions in memory, compacts the route, then writes one `walks/{generatedWalkId}` document at completion. Observed fields include `peeCount`, `poopCount`, `startedAt`, `endedAt`, `dogReturned`, compacted `route` GeoPoints, optional `bookingId`, and start/end coordinate values. It then separately updates the related Booking with completion/return fields.
3. Walk document creation and Booking update are separate client writes; there is no transaction/batch or server-authoritative operation shown in the inspected completion block.
4. The Admin Live Operations screen reads `walk_locations`, while this Partner Live Walk source writes the compact route to `walks/{walkId}.route`. The inspected source does not show a corresponding `walk_locations` writer. Treat this as a data-contract/source mismatch requiring wider search; do not assume Admin route points are being populated by this screen.

### Admin — Live Operations and Dashboard

1. Live Operations listens to `walkers` filtered by `isOnline == true` and spreads every returned parent document into an in-memory map. It uses `currentLocation` and `name` for map markers. This is a broad online-Walker parent read, not a location-only projection.
2. Selecting a Walker queries `walk_locations` by `walkerId`, orders by `timestamp`, limits to 300 and reads `latitude`/`longitude` to draw a route.
3. Live Operations loads a linked Booking by document ID and renders up to 12 non-null fields by key/value without an explicit field allowlist in the inspected code. This can expose more booking fields in the Admin UI than the route panel needs.
4. Dashboard uses generic collection-wide count streams for `bookings`, `users`, and `walkers`; counts `walkers` where `isOnline == true`; counts Booking statuses; streams recent bookings ordered by `createdAt`; streams `payments` where `status == paid` and sums `amount`; and streams recent `audit_logs`. This is a wide operational/financial dashboard read surface. The UI does not by itself prove the actor has the required least-privilege scope.
5. Dashboard Booking status cards use mixed casing (e.g. `Pending` alongside lowercase statuses elsewhere); status taxonomy consistency is a separate contract issue, not resolved by this Walker-data inventory.

### Updated risk and migration implications

- Partner self-service profile, schedule and onboarding currently depend on direct reads/writes to `walkers/{uid}`. Migration must preserve own-Walker access while separating private address/KYC and operational/availability fields.
- Admin Live Operations currently receives whole online Walker documents to display a name and current location. Target design should define a minimal, purpose-scoped live-operations projection/API with geographic scope and active-role checks; no new projection schema is approved in this inventory.
- `walk_locations` has a live Admin reader in source, but no writer was found in the inspected Partner Live Walk file; its writer and Rules coverage remain unresolved.
- Admin Dashboard reads collection-wide counts and payment totals. These aggregate permissions need explicit role/scope and data-minimization decisions; do not infer that all Admin users may read full underlying documents.
- Partner Walk review writes and Booking lifecycle status writes are client-authoritative in inspected source; those lifecycle operations need their own approved callable/API contract. Do not silently fold them into DW-SEC-001 implementation.

### Verification boundary

These findings are from the exact source snapshots listed above. They do not establish deployed Rules behavior, production data contents, whether a different app version writes `walk_locations`, or whether backend integrations exist elsewhere. No app/Rules/Functions source was changed and no tests, production reads, merge or deployment were performed.


## Follow-up: GPS/location writer search, Admin Walker detail and finance surfaces (3 Nov 2026)

### Additional exact source snapshots

| Repository | Path | Blob SHA |
|---|---|---|
| Partner | `lib/screens/home/walk_details_screen.dart` | `4443ca2b4520700246c417cb315a6645506a1be1` |
| Partner | `lib/features/onboarding/screens/work_location_screen.dart` | `9c5d5e12a3fd29785d2001fb20937a7bbb374df5` |
| Partner | `lib/screens/home/earnings_screen.dart` | `9fd6a6bbdc908ce0e92bc4b4466c5a8fb5f7ef6c` |
| Admin | `lib/screens/live/live_operations_screen.dart` | `15bf852258b273f753a45d9b107528dc027829e5` |
| Admin | `lib/features/walkers/screens/walker_details_screen.dart` | `9f45b86c298211eba41dfc7bf45f8f98554311d4` |
| Admin | `lib/features/walkers/widgets/walker_details_sections.dart` | `e51fb0c028622c0c6cba9c3cf897437872f728ca` |
| Admin | `lib/screens/dashboard/dashboard_screen.dart` | `ce4bd363279e15e707cf1ac8bfcb21ec451ac50d` |
| Firebase | `firestore.rules` | `9bac26b9e13a97d412a0154ec9af70629e82eb47` |
| Firebase | `storage.rules` | `3f68748b526e4c702c84d3712ea14b8644808479` |

### GPS and live-location writer search

1. Admin Live Operations has a live query on `walkers` where `isOnline == true`, consumes full document maps, and extracts `currentLocation`; its route panel reads `walk_locations` filtered by `walkerId`, ordered by `timestamp`, limit 300.
2. GitHub indexed code search across Partner, Admin and Firebase for exact `walk_locations` and `currentLocation` terms returned:
   - Partner: zero matches for both exact terms.
   - Admin: one `walk_locations` match, the Live Operations reader.
   - Firebase: zero matches for both exact terms.
3. Inspected Partner Live Walk completion writes a compact `route` array into `walks/{walkId}` and separately updates the Booking; it does not write `walk_locations` in that source.
4. Inspected Firebase `firestore.rules` has a `bookings/{bookingId}` match and Walker parent match, but no match for `walks/{walkId}` or `walk_locations/{locationId}` was found in the full 1,551-line Rules file. The existing Booking rule allows approved assigned Walker updates only to a fixed set of status/time/schedule/notes/count/distance fields; this does not include the entire Live Walk payload written by the inspected Partner client.
5. Consequence: current source evidence shows an unresolved Live GPS contract: Admin expects a `walk_locations` stream, Partner Live Walk writes a final route under `walks`, and canonical Firebase Rules contain no explicit match for either collection. This is a source mismatch/rules coverage risk, not a statement about the currently deployed Rules version. Do not add permissive rules or switch the writer without a separate approved contract and Emulator tests.

### Partner booking detail and work-location writes

1. Partner Walk Details reads `bookings/{bookingId}` and extracts customer name, dog breed/size, and pickup address from the booking document. On navigation it attempts to update Booking `status = accepted` and `updatedAt` directly; exceptions are swallowed and navigation proceeds.
2. Partner Work Location reads active `zones` to resolve selected zone names/IDs, then reads own `walkers/{uid}` and, for an existing in-progress application, writes `city`, `state`, `area`, `zoneName`, `zoneNames`, `zones`, `travelMode`, and `updatedAt` to the Walker parent.
3. Partner Earnings screen remains presentation-only in the inspected snapshot; its labels/cards do not establish a queryable earnings ledger or payout record.

### Admin Walker details and finance surface

1. Walker details screen subscribes to `WalkerAdminService.watchWalker(uid)`, invokes privileged approval/rejection/suspension/reactivation/correction actions through the service, opens private KYC documents through the Storage viewer, opens Walker audit history, and passes the complete Walker data map to the security dialog.
2. Walker details sections display phone, email, gender, DOB, current residential address, zone/service details, walk counters and KYC document metadata. These are consumers of the broad parent Walker model, not independently scoped data sources.
3. Admin Dashboard reads `payments` where status is paid and aggregates `amount`, in addition to collection-wide operational counts and recent audit/booking streams. No separate Walker finance/payout collection consumer was found in the inspected Admin Walker details and Dashboard files.
4. Exact `bankDetails` code search in Admin returned zero indexed matches. This is not proof that payout/bank information does not exist elsewhere or in external systems.

### Canonical Rules and Storage Rules observations

1. Canonical Firestore Rules permit `walkers/{uid}` get by owner, Admin, or any signed-in user when the Walker is active and approved; list is Admin-only. A Firestore document read returns the full document, so this is not field-level redaction.
2. Walker parent create allowlist includes sensitive-capable keys including `currentAddress`, `kyc`, `documents`, `fcmToken`, `deviceTokens`, `bankDetails`, and `emergencyContact`. Admin parent updates are limited to lifecycle/decision fields in the inspected rule.
3. Canonical Storage Rules allow Walker owner and active Super Admin to read their `walker_selfies/{uid}/{fileName}` and `walker_documents/{uid}/{fileName}` objects; owner can create matching objects; update/delete are denied. This is the checked-in source, not a live deployment read-back.
4. No `walk_locations` or `walks` match exists in the inspected canonical Firestore Rules source. Do not infer whether another overlapping wildcard rule, separate project, or deployed revision changes actual behavior without full emulator/live verification.

### Remaining gaps

- Determine how `isOnline` and `currentLocation` are written (exact indexed search did not find Partner writer; search remaining branches/commits and any other app/backend repository).
- Determine whether a legacy/external service writes `walk_locations`; indexed search found only Admin reader.
- Inspect all Dashboard and payment-related screens/services for who can view payment details versus aggregate totals; no Walker payout ledger was evidenced in the inspected sources.
- Define the approved trusted live-location write/read API, retention, geographic access scopes, stale-location expiry and emergency access before implementation.
- Keep DW-SEC-001 implementation gated until field schemas, role IDs/scopes, emergency mechanics, POL-014/POL-020 retention approval, API and migration/rollback contract are frozen.

### Verification boundary

Source-only review and indexed code search. No live Firebase Rules read-back, production data query, deployment, test execution, code change, merge or workflow dispatch was performed.


## Historical Partner audit-branch reconciliation — GPS and earnings (3 Nov 2026)

### Historical audit evidence discovered

Partner branch `chore/notion-aligned-structure` contains read-only audit/decision documents (commit `276e922f00ec7524e86d99afc59ae7a26b184ad8`):

| Document | Blob SHA | Recorded status |
|---|---|---|
| `docs/architecture/PARTNER_LIVE_WALK_GPS_HANDOVER_AUDIT_2026-10-31.md` | `6b6c25281650b974379ebb50675fdf2fdafe1d59` | Read-only audit; P0/P1 gaps |
| `docs/architecture/PARTNER_EARNINGS_PAYOUT_UI_AUDIT_2026-10-31.md` | `73c1a263174bbb867f190c0e54f8ede92ac04322` | Read-only audit; P0 Finance gates |
| `docs/decisions/ADR-002-live-walk-idempotency.md` | `a8ad70a9927fda9c84e665568a3a963770165832` | Proposed, not approved/validated |
| `docs/decisions/ADR-003-firestore-live-walk-rules-gate.md` | `7b6ebbc748d0f3ac740fc4fac0bef986fa4da730` | Confirmed source security/configuration gap; remediation required |
| `docs/decisions/ADR-005-live-walk-completion-backend-contract.md` | `e91dd7bb82effda90f521503272260e91afd5f5f` | Proposed, not implemented |

### GPS audit reconciliation

The historical audit explicitly records:
- `Geolocator.getPositionStream()` uses high accuracy and a 3m distance filter; client filters accuracy worse than 35m, jumps above 100m and movement below 3m.
- GPS points remain in the in-memory route; route is saved to `walks` only on completion. No app lifecycle/background location service, periodic heartbeat, or live `walk_locations` write was found in the audited Partner screen.
- Start does not visibly call a trusted backend to revalidate assigned Walker, booking/occurrence state and authorization before tracking.
- Return OTP is compared client-side with a value read from Booking; no trusted one-time verification, expiry, attempt counter or replay prevention was found.
- Completion used a random walk document ID per screen state; this is not cross-session idempotency.
- Historical Partner Rules lacked `/walks/{walkId}` and Booking completion fields written by client, making the inspected completion batch incompatible with those rules. This is source evidence, not deployed Rules confirmation.
- ADR-005 proposes a trusted completion callable and stable idempotency; explicitly not implemented. The current Firebase main `functions/src/index.ts` exports service-location callables only (boundary review, activation/status, save/index, import-run management); no Live Walk start/location/handover/completion callable appears in the 1,410-line entry point.

### Important current-main vs historical-branch earnings discrepancy

Current Partner `main` `lib/screens/home/earnings_screen.dart` blob `9fd6a6bbdc908ce0e92bc4b4466c5a8fb5f7ef6c` contains hard-coded figures and transaction examples:
- Available earnings ₹1,240 and “Ready for payout”
- Today ₹120, This Week ₹720, This Month ₹1,240, Walks 12
- Bruno/Max sample transaction cards ₹120/₹150

A separate Partner branch `fix/earnings-demo-data-disclosure` contains a safer revision at blob `9b9279f6171279132e6a2987b794a5245ab6e8f2`, showing dashes and explicitly saying the preview figures are not live or payable. That branch is not main and no merge status/approval is inferred here. The older `chore/notion-aligned-structure` earnings audit (above) also documents a placeholder, not a live ledger.

**Risk:** Current main's hard-coded amounts can be mistaken for payable balances. Do not treat these as actual earnings, and do not merge or deploy a UI change solely on the basis of a side branch. Record/approve the correct Finance policy and reconcile branch/PR ownership before a controlled fix.

### Finance policy gate

The historical audit found POL-013, POL-033 and POL-034 still Draft/unapproved at the time of review. It specifically warns not to hard-code proposed ₹40/bonus pools or weekly payout timing from a draft; payout frequency/cutoff/threshold/rail remain undecided in the referenced POL-033 draft. This conflicts with older remembered operational payout concepts, so the latest approved Notion policy/Founder decision must govern; no payout rate or schedule is authorized by this source audit.

### Follow-up actions

1. Reconcile Partner `main` with `fix/earnings-demo-data-disclosure` and its PR/status; remove misleading demo amounts only through approved, reviewed implementation and tests.
2. Keep Live Walk direct writes blocked pending approved POL-006/POL-007/POL-026 policy, trusted start/location/handover/completion contracts, stable idempotency and Emulator tests.
3. Confirm current deployed Firestore Rules version and target project before asserting production behavior.
4. Finance/Founder must resolve POL-013/POL-033/POL-034 and record effective-dated payout model before ledger/UI implementation.

### Verification boundary

Historical branch documents and current checked-in source were fetched and compared. No app/Rules source modified, no tests run, no PR merged, no deployment, no production data accessed. Notion verification remains Not checked.
