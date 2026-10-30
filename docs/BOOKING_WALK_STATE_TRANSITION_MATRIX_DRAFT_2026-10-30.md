# Booking & Walk State Transition Matrix — Draft

**Date:** 2026-10-30  
**Status:** Draft for Founder / Operations / Engineering review — NOT approved for production  
**Policy inputs reviewed:** POL-005, POL-006, POL-007 and Cross-App Live Tracking & Booking Data Contract — Readiness. All three policies are currently Draft / Founder approval required.  
**Repository:** `DOJOWALK/DOJO-WALK-Firebase`  
**Branch:** `docs/booking-walk-backend-plan-2026-10-30`

> This matrix consolidates policy-proposed states. It does not create a new production enum or authorize implementation. Existing app enums must be mapped only after policy approval and a shared data dictionary freeze.

## 1. State ownership

| Domain | Authoritative owner | Client responsibility |
|---|---|---|
| Booking eligibility, quote, service-area validation and booking state | Trusted backend | Submit request; display server result |
| Walker offers and assignment | Assignment backend | Walker responds to their own active offer |
| Walk lifecycle and handover | Trusted backend | Submit permitted commands/evidence |
| GPS acceptance and freshness | Trusted ingestion/backend | Provide device sample; show accepted freshness |
| Incident lifecycle | Approved incident workflow | Report facts and follow safe instructions |
| Audit events | Backend | No client edits/deletes |

Never accept a client-provided status, actor role, assignment winner or authoritative timestamp as proof.

## 2. Booking lifecycle transition matrix

The following baseline state names come from the Draft POL-005 / POL-006 language. They are proposed canonical values, not approved enum strings.

| Current state | Requested next state | Actor / command | Required server guards | If guard fails |
|---|---|---|---|---|
| draft (if persisted) | submitted | Customer: submitBooking | Authenticated eligible customer; dog belongs to customer; required service/schedule/pickup data; consent/version; idempotency key | Keep draft; return field/actionable validation error |
| submitted | validated | Backend: validateBooking | Account eligibility; dog/service eligibility; active verified zone polygon; service hours/capacity; valid schedule; server quote/terms; no duplicate | Reject or route to review; no payable/assignable confirmation |
| submitted | failed | Backend: rejectBooking | Terminal failure reason and audit record | No silent state change |
| validated | searching_walker | Backend: beginAssignment | Validated booking remains eligible; payment/authorization sequence follows approved pricing policy | Keep validated or needs_operations; no false assignment |
| searching_walker | offer_pending | Assignment service: createOffer | One eligible active approved walker; no overlap; unique offer ID; one open offer per booking; configurable expiry; atomic attempt | Retry safely or needs_operations |
| offer_pending | offer_pending | Walker: decline / expiry worker | Actor is offered walker for decline; offer still open; expiry job verifies deadline; idempotent response | Reject stale/duplicate response; preserve winning state |
| offer_pending | searching_walker | Assignment service: next candidate | Prior offer is declined/expired; next candidate revalidated; no competing open offer | Retry or needs_operations |
| offer_pending | assigned | Walker: acceptOffer | Same offer still open/unexpired; authenticated Walker is recipient; Walker still approved/active/eligible/free; booking still assignable; atomic winner | Reject acceptance; refresh true state |
| searching_walker / offer_pending | needs_operations | Assignment service | Candidate attempts exhausted, no eligible Walker, or blocking exception; reason and alert recorded | Keep current state and retry/escalate safely |
| needs_operations | searching_walker | Authorized Operations command | Authorized role and area scope; mandatory reason; eligibility re-run; audit | Deny and retain needs_operations |
| assigned | in_progress | Walker: startWalk (POL-007 gate) | Authenticated currently assigned Walker; booking active/not cancelled/reassigned; valid bookingId/walkId; required pickup/dog/recipient/equipment/safety checks acknowledged; idempotency; transaction | Reject; no GPS/live state represented as started |
| draft / submitted / validated / searching_walker / offer_pending / assigned | cancelled | Approved cancellation command | POL-010/POL-029 authority and terms; stop matching; invalidate open offers; handle acceptance race transactionally | Return policy-specific denial or current winning state |
| in_progress | completed | Backend: completeWalk | Assigned Walker; allowed walk state; authorized recipient; dog safely returned; required handover evidence; no active blocking incident; idempotency; atomic booking+walk+event update | Keep active/needs_operations/incident path; never force-complete |
| any non-terminal state | failed | Backend / authorized workflow | Only defined unrecoverable failure; reason, actor and audit; payment/refund follow separate policy | Keep current state; escalate |
| completed / cancelled / failed | any transition | Any client | Terminal-state protection; only separately approved correction workflow | Deny; append correction/audit event if authorized |

**Important:** POL-006's customer-facing status wording distinguishes “request received”, “finding a walker”, “walker assigned”, “needs assistance”, “cancelled” and “completed”. These are display labels, not necessarily separate database states.

## 3. Walk operational lifecycle

POL-007 describes an operational sequence. These phases should not be assumed to be booking states. The implementation may store them as one walk status plus immutable events, subject to approval.

| Operational phase (policy wording) | Permitted command/event | Required guard/evidence | Prohibited shortcut |
|---|---|---|---|
| Assigned | Create/link operational walk | Exactly one booking reference; current assignment confirmed; stable walk identity | Creating an orphan walk with no booking |
| Walker en route (if enabled) | Record en-route event | Assigned Walker; permitted pre-walk sharing phase approved | Claiming service has started |
| Arrived at pickup | Record arrival | Assigned Walker; booking still active; server event timestamp | Treating GPS marker alone as proof of arrival |
| Pickup checks pending | Submit pickup checklist | Dog identity, authorized handover person, handling notes, equipment and material exceptions reviewed | Starting while required checks are missing |
| In progress | startWalk accepted by backend | All start guards passed; backend records start and audit event | Client-only status update or GPS start as proof |
| Paused (only if supported/approved) | pauseWalk / resumeWalk | Approved reason, active walk, assigned Walker; incident route remains available | Using pause to hide an incident or abandon dog |
| Returning / handover phase (if separately represented) | returnStarted / handoverPending | Approved workflow and safe return; do not infer completion from duration | Leaving dog unattended or changing recipient silently |
| Completion pending | submitCompletion | Agreed handover point; authorized recipient; dog present and safely transferable; required evidence | Marking complete before handover |
| Completed | completeWalk accepted by backend | All completion guards; one successful completion; immutable audit event | Duplicate completion, duplicate payout/notification |
| Needs Operations | raiseOperationsException | Reason, current dog status and safe next step; scope-authorized escalation | Silently reassigning an in-progress walk |
| Cancelled | cancelWalk / approved abort path | Policy-approved pre-start cancellation or controlled exception; record reason | Cancelling a live walk without safe handover |
| Incident active (linked overlay/record) | reportIncident / escalateIncident | Immediate safety actions; incident record linked to booking/walk; ordinary completion blocked as appropriate | Treating incident as ordinary completion or overwriting it |

### Incident handling is not an ordinary linear status

POL-007 requires safety to take priority. An incident may arise during an active walk and must be represented through a separate incident workflow/record or approved overlay. It must not be erased by changing the booking to completed. Emergency stop, substitute Walker and alternate handover authority require POL-016 and founder-approved exception rules.

## 4. Minimum transition command contract

Proposed command names for review only:

| Command | Caller | Minimum input | Server derives / verifies |
|---|---|---|---|
| `submitBooking` | Customer | booking request, idempotency key | customer UID, quote/eligibility, canonical booking state |
| `createOffer` | Assignment service | booking ID, candidate/attempt reference | eligibility, offer ID, expiry, current state |
| `respondToOffer` | Offered Walker | offer ID, accept/decline, idempotency key | caller UID, offer ownership/open/expiry, current eligibility |
| `startWalk` | Assigned Walker | booking ID, walk ID or stable request key, pickup-check evidence | assignment, booking state, Walker eligibility, server start time, event |
| `submitLocation` | Assigned Walker/device session | walk ID, coordinates, accuracy, device capture time, sequence/idempotency | authenticated actor, active walk, assignment, rate/quality/freshness policy, receivedAt |
| `pauseWalk` / `resumeWalk` | Assigned Walker | walk ID, approved reason | assignment, current phase, policy support, server event |
| `completeWalk` | Assigned Walker | walk ID, recipient/handover evidence, idempotency key | assignment, active phase, recipient authorization, safe handover, atomic completion |
| `raiseOperationsException` | Walker / authorized staff | booking/walk ID, reason, safety status | actor scope, escalation route, immutable event |
| `reportIncident` | Walker / authorized staff | booking/walk ID, incident facts and safe contact status | actor, scope, incident ID, severity workflow |

No command should accept an arbitrary actor UID or actor role from client payload. All command handlers must validate the authenticated identity and authoritative role/assignment records.

## 5. Idempotency and transaction invariants

1. Booking submission retry returns the original booking result.
2. Offer response retry returns the original accepted/declined result.
3. Only one offer can be the active offer for a booking at a time.
4. Concurrent accept requests result in exactly one assigned Walker.
5. Start retry creates no second walk/start event.
6. A previous Walker cannot start or submit location after reassignment.
7. Location retry cannot duplicate a sample or move server freshness backwards.
8. Completion retry returns the existing completion; no duplicate event, payout trigger or customer notification.
9. Booking state, walk state and lifecycle event changes commit atomically where they form one business transition.
10. A denied write leaves all authoritative records unchanged.

## 6. Explicitly unresolved policy decisions

| Decision | Why it blocks final state machine | Source |
|---|---|---|
| Whether draft is persisted or client-only | Determines first persisted state | POL-005 / POL-006 |
| Exact offer expiry, attempt count and candidate ranking | Changes offer_pending → searching_walker loop | POL-005 |
| Payment authorization/capture point for each booking type | Determines when validated/searching may proceed | POL-006 + pricing policy |
| Exact status enum mapping to current app values | Prevents duplicate/conflicting state fields | All apps + Firebase |
| Whether en-route, arrived, returning and completion_pending are stored states or events | Determines data model granularity | POL-007 |
| Whether pause/resume is enabled and allowed reasons | Changes active-walk transition graph | POL-007 |
| Exact pickup checklist fields and acknowledgement | Start guard cannot be finalized without it | POL-007 |
| Exact recipient authorization and handover evidence | Completion guard cannot be finalized without it | POL-007 |
| Customer unavailable waiting/alternate recipient rules | Cannot define safe exception transition yet | POL-007 + relevant operations policy |
| Emergency stop, reassignment and alternate handover authority | Incident path must not bypass safety | POL-016 / POL-007 |
| GPS cadence, stale threshold, accuracy, sharing window and retention | Location state/freshness transitions are not defined | POL-007 + privacy policy |
| Role/action matrix for Founder, Central, City Manager, Zone Supervisor | Admin override scope cannot be implemented yet | POL-004 / governance |
| Legacy/manual walk exception | Missing bookingId path must be either denied or explicitly governed | POL-007 |

## 7. Required implementation tests (not run by this document)

- Booking: invalid account/dog/zone/service/quote; duplicate submission; network retry.
- Assignment: inactive Walker, overlap, decline, expiry, delayed notification, concurrent acceptance, exhausted candidates, reassignment.
- Start: wrong Walker, cancelled booking, reassigned booking, missing bookingId, missing pickup checks, duplicate request.
- Location: wrong Walker/walk, inactive walk, malformed/out-of-range coordinates, stale/out-of-order sample, duplicate sample, cross-area/customer read denial, stop after sharing window.
- Completion: unauthorized recipient, missing handover evidence, customer unavailable, active incident, duplicate completion, network retry and no duplicate payout/notification.
- Admin: area-scoped reads/actions, mandatory reason, audit actor/time, no false success UI.
- End-to-end: Customer booking → assignment → Partner start/GPS → Admin freshness/route → safe handover → Customer completion status.

## 8. Approval and release gates

1. Founder approves POL-005, POL-006, POL-007 and relevant exception clauses.
2. Operations approves offer thresholds, handover and escalation procedures.
3. Engineering freezes one shared, versioned status/field dictionary.
4. Firebase Rules and Functions Emulator tests prove all guards and denied-write rollback.
5. Partner, Admin and Customer consume the same contract.
6. Device QA verifies background GPS, permission revocation, offline retry and stale labels.
7. A controlled pilot and rollback plan are approved separately.

**Release decision: NO-GO.** This is a documentation-only draft. No app source, Firebase Rules, Functions, database data or production configuration was changed.
