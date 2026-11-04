# DOJO WALK — Zone Lifecycle + Cross-App Booking Integration Audit

**Audit date:** 2026-11-04  
**Type:** Read-only source audit; documentation-only record  
**Firebase evidence ref:** `implementation/zone-emulator-first-plan-2026-11-03` at `c4d7a6facb08cdd738534371c5af01ad2735fcf4`  
**App evidence:** default `main` branches read during this audit  
**Production access:** None  
**Changes in this audit:** No runtime code, Rules, data, app behavior, deployment, migration, or Zone activation changed.

## 1. Executive result

The canonical Zone **visibility** and **assignment-writer** slices are implemented on the Firebase implementation branch and have recorded synthetic Emulator evidence. The complete Zone lifecycle and the Customer → Firebase → Partner booking/walk workflow are **not yet integrated**.

Do not merge the Firebase implementation branch to Firebase `main`, deploy Rules/Functions, enable Admin UI actions, or switch Customer/Partner writes based on this audit alone.

## 2. Zone lifecycle acceptance gates

The checked-in `test/service_zones.rules.test.mjs` contains these ten explicit `test.todo` entries. They are not passing tests and must remain release blockers until converted to executable Emulator acceptance tests and passed:

1. Central Admin with `zoneOperations` permission can create a Zone draft.
2. Central Admin without boundary-review permission cannot review a boundary.
3. Boundary submitter cannot review their own submitted boundary.
4. Founder allowlist UID can decide only the exact current approval request.
5. Legacy `super_admin` without Founder/Central authority cannot approve or activate.
6. Area Manager access is limited to assigned City/Zone scope.
7. Same normalized Zone name is rejected within one City but allowed in another.
8. Stale boundary revision/hash cannot be approved or activated.
9. Idempotent retries return the original result; conflicting payload reuse fails.
10. Concurrent activation attempts produce one valid state transition.

### Current Functions inventory

The implementation branch exports these relevant callables:

- Visibility: `listVisibleServiceZones`, `getVisibleServiceZoneBoundary`.
- Assignment: `approveCityManagerAppointment`, `assignCityManager`, `assignZoneSupervisor`, `assignWalkerToZone`, `assignBoundaryReviewer`, `revokeZoneAssignment`.
- Legacy location: `reviewServiceLocationBoundary`, `activateServiceLocation`, `setServiceLocationStatus`, `saveServiceLocationWithNameIndex`, `manageServiceLocationImportRun`.

No dedicated canonical Zone lifecycle callable is currently exported for Zone draft creation, Zone boundary submission/review, exact Founder Zone approval, Zone activation/deactivation, or emergency suspension/reactivation. The ten TODOs are therefore genuine missing lifecycle coverage, not a reason to count the existing visibility or assignment tests as lifecycle PASS.

### Legacy endpoint separation risk

The legacy `reviewServiceLocationBoundary` and `activateServiceLocation` paths in `functions/src/index.ts` are City/Area workflows and still use the active legacy `admin_users/{uid}.role == super_admin` authorization path. They must not be reused as canonical Zone review/approval/activation endpoints. Any migration must preserve a deliberate compatibility boundary and ensure legacy role alone cannot grant canonical Zone authority.

### Assignment slice already present

Assignment writer callables and `functions/test/zone_assignment_writers_callable.test.cjs` are present on the implementation branch. The existing test suite covers synthetic Founder approval of City Manager appointment, Central execution, verified/active Zone checks, Walker eligibility, Supervisor cardinality, reviewer assignment/self-review restrictions, denied roles, revocation/audit, malformed input, and direct client write denial. This is separate from the ten lifecycle TODOs.

## 3. Cross-app source compatibility findings

### Admin — `DOJOWALK/DOJO-WALK-Admin`

Evidence read from `main`:

- `lib/features/service_location/models/service_location_models.dart`
- `lib/features/service_location/services/service_location_service.dart`

The checked-in hierarchy remains Country → State → District → Service City → Service Area → optional Locality. The service calls legacy `setServiceLocationStatus` and `activateServiceLocation`; it does not call the new Zone visibility or Zone assignment callables. The model and service continue to represent City/Area activation, not Zone-only activation.

Admin PR #37 (fresh architecture / trusted Service Location flow) is **closed, unmerged**. Therefore it is not evidence of a current merged Admin integration with the Firebase implementation branch.

### Partner — `DOJOWALK/DOJO-WALK-Partner`

Evidence read from `main`:

- `lib/screens/home/partner_home_screen.dart`
- `lib/features/live_walk/screens/live_walk_screen.dart`

Current Partner Home queries parent `bookings` by `walkerId`, filters using parent `date`, reads `startTime`, and recognizes active statuses `assigned`, `accepted`, `picked_up`, `walking`. It also queries `walks` for history. The current reader is not yet a child `walk_tasks/{walkTaskId}` consumer.

Current Live Walk completion creates a `walks` document from the client and directly updates the parent booking status to `completed`. A proposed trusted `completeWalk` contract exists in Firebase documentation, but it is not an implemented callable. Do not weaken Rules to make the direct write succeed.

Partner PR #5 is Draft/Open/Unmerged and explicitly records that Firebase Emulator booking → Partner pickup GPS end-to-end testing, the shared schema/state transition contract, duplicate-completion protection, and Admin live-tracking contract remain outstanding.

### Customer — `DOJOWALK/DOJO-WALK-Customer`

Evidence read from `main`:

- `lib/features/booking/screens/choose_walk_screen.dart`
- `lib/features/booking/screens/booking_confirmation_screen.dart`

Customer confirmation currently creates `bookings/{bookingId}` directly from the client, writes initial `status: pending` and `walkerId: null`, and stores nested `walkSchedules` / `dateSchedules` on the parent. It does not call a trusted booking-validation callable and does not create canonical child walk-task occurrences.

The saved pickup address is copied into the client payload. The proposed backend must derive the authoritative address from `users/{auth.uid}/addresses/{addressId}`, verify ownership, and resolve Zone coverage server-side; client Zone/address fields cannot be treated as authority.

Customer PR #29 and PR #30 are Draft/Open/Unmerged. PR #30 preserves optional pickup GPS coordinates in the booking snapshot, but this is not proof of server-side address validation, Zone resolution, task creation, or Partner handover.

## 4. Existing shared booking architecture — Draft, not final API

Firebase `docs/contracts/BOOKING_WALK_TASK_CONTRACT_V1_DRAFT.md` records the approved architecture direction:

- One parent `bookings/{bookingId}`.
- One child `walk_tasks/{walkTaskId}` per scheduled walk occurrence.
- Keep `walks/{walkId}` for completed-walk history; do not repurpose it as the schedule/task collection.
- Partner Today/Schedule should consume assigned child tasks.
- Admin retains the parent booking view and exposes child occurrences.

The DTO, status enum, timezone model, Regular-plan end date/generation horizon, idempotency key shape/retention, and task-creation timing are still Draft/open decisions. The document's safe direction is to validate and normalize request data before any Firestore writes; Regular and Immediate requests must not become assignable tasks until their missing bounded scheduling/availability decisions are resolved.

The Customer-to-Partner field drift is confirmed:

| Concern | Customer parent request | Current Partner reader |
|---|---|---|
| Date | `scheduledAt`, nested `dateSchedules` | `date` |
| Time | `preferredTime`, nested walk `time` | `startTime` |
| Pet display | `petName`, `petDetails` | `dogName`, `dog` |
| Service type | `serviceType`, `bookingPlan` | `type` |
| Pickup | map-valued `pickupAddress` | expects string / legacy `location` or `zoneName` fallback |
| Initial/active status | `pending` | active list expects `assigned`, `accepted`, `picked_up`, `walking` |

Do not patch these fields independently or write both formats speculatively. Final task DTO and a versioned compatibility adapter must be approved and tested across all three apps.

The separate `docs/architecture/TRUSTED_WALK_COMPLETION_API_CONTRACT_2026-10-31.md` labels `completeWalk` as PROPOSED and not implemented/deployed. It depends on stable occurrence IDs, trusted start/GPS/handover contracts, a canonical state machine, idempotency, and parent aggregation.

## 5. Open PR state observed during audit

| Repository | PR | State | Relevance |
|---|---:|---|---|
| Firebase | #64 | Draft / Open / Unmerged | Zone implementation; head is the implementation branch, base is the architecture contract branch |
| Admin | #37 | Closed / Unmerged | Fresh architecture and legacy service-location flow |
| Partner | #5 | Draft / Open / Unmerged | Partner UI/structure; end-to-end booking integration remains outstanding |
| Customer | #29 | Draft / Open / Unmerged | Customer UI/booking validation; backend integration deferred |
| Customer | #30 | Draft / Open / Unmerged | Pickup-coordinate snapshot only; not end-to-end integration |

These are repository PR states, not production release states.

## 6. Recommended implementation sequence

1. **Lifecycle test-first:** replace the ten TODOs with executable synthetic Emulator cases. First record baseline behavior and missing callable outcomes; do not change Rules/Functions in the same step as the initial tests.
2. **Zone lifecycle Functions:** implement server-owned draft, boundary review, Founder exact-revision approval, activation, routine deactivation, emergency suspension, notification retry/escalation, and reactivation only against approved contracts. Keep legacy City/Area callables isolated.
3. **Lifecycle Rules and regressions:** prove client cannot forge lifecycle/approval fields; test stale hash/revision, idempotency, concurrent transitions, revocation, and emergency behavior.
4. **Booking request validator first:** pure validation/normalization with no Firestore writes. Test One-Time and Choose-Dates occurrence expansion. Keep Regular and Immediate non-assignable pending requests until bounded period/availability decisions are finalized.
5. **Cross-app DTO/state contract:** approve task fields, time zone, statuses/transitions, parent aggregation, cancellation/refund interaction, idempotency, address snapshot, and rollout compatibility.
6. **Trusted booking callable:** verify Auth, pet/address ownership, authoritative pickup coordinates, Zone polygon + active status + exact approval, availability/capacity, and idempotency before creating parent/child records.
7. **Partner/Admin consumers:** move Partner operational lists to assigned child tasks and Admin to parent + child view. Replace client completion writes with trusted lifecycle callables only after the shared contract is approved.
8. **Coordinated Emulator E2E:** Customer request → Zone eligibility → availability → parent + task → assignment → Partner pickup/start/GPS/handover/completion → Admin/customer status. Add failure, retry, duplicate, reassignment, cancellation, and privacy cases.
9. **Release gate:** review exact PR diffs, CI, branch protection and deploy workflows. Main merge, production migration/deployment, UI enablement and Zone activation each require their own explicit approval.

## 7. Safety boundary

- No production project or production Firestore records were accessed.
- No real Founder UID or role was provisioned.
- No live assignment, Zone activation, migration, Rules deployment or Functions deployment was performed.
- No app code or runtime Rules/Functions were changed by this audit.
- This report is documentation-only and is not a production approval.
