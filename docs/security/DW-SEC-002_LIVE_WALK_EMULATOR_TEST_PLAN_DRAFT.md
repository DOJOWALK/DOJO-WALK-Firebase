# DOJO WALK Live Walk — Emulator Test Plan (Draft)

**Status:** Draft test design only — not approved for implementation or release  
**Date:** 3 November 2026  
**Repository:** `DOJOWALK/DOJO-WALK-Firebase`  
**Branch:** `feat/dw-sec-001-walker-data-separation`  
**Controlling Notion records:** POL-007 (Draft), Cross-App Live Tracking & Booking Data Contract — Readiness (Draft), DW-3 cross-app audit.  
**Execution status:** NOT RUN. No test result or PASS is claimed.

## 1. Purpose and boundary

Translate the existing POL-007 acceptance-test requirements into a reviewable Emulator test matrix. This document does not define or approve Firestore collection names, document schemas, lifecycle state strings, GPS cadence, stale thresholds, retention durations, role IDs, emergency authority or callable names.

Do not write executable tests against guessed schema. First obtain Founder approval for POL-007 and the shared contract, then freeze the data dictionary, role/scope matrix and trusted command contract in Notion.

## 2. Preconditions before executable tests

- [ ] POL-007 approved by Founder.
- [ ] Related POL-006, POL-008 and incident/safety dependencies reviewed and approved as required.
- [ ] Privacy and precise-location retention/access rules approved (POL-014/POL-020 dependencies).
- [ ] Canonical live marker source and route/event source approved.
- [ ] Booking-to-walk linkage, stable IDs and idempotency contract approved.
- [ ] Trusted start, location ingestion, pause/resume, handover and completion commands approved.
- [ ] GPS freshness, accuracy, update-rate and tracking-window parameters approved.
- [ ] Role IDs, active status, geographic scope and emergency-access matrix approved.
- [ ] Canonical Firestore Rules source and Emulator configuration identified.

## 3. Test fixture roles (conceptual only)

Use isolated Emulator identities representing: unauthenticated caller; assigned Walker; unrelated Walker; booking-owning Customer; unrelated Customer; area-scoped Admin for the booking area; Admin for another area; inactive Admin; Support/Emergency role with only approved scope; and privileged backend service identity.

These are test personas, not proposed production role IDs or claims that the roles already exist.

## 4. Acceptance matrix

| ID | Scenario | Expected security/consistency outcome | Evidence |
|---|---|---|---|
| LW-001 | Unauthenticated start | Denied; no walk/event mutation | Emulator assertion + logs |
| LW-002 | Wrong/unassigned Walker starts | Denied; no mutation | Emulator assertion |
| LW-003 | Previously assigned Walker after reassignment | Denied against current server assignment | Emulator assertion |
| LW-004 | Cancelled/ineligible booking start | Denied | Emulator assertion |
| LW-005 | Required pickup checks missing | Start denied; no false started state | Callable + Rules test |
| LW-006 | Duplicate start/retry | One logical start only; stable response or safe conflict | Idempotency test |
| LW-007 | Missing booking reference | Normal start rejected; no orphan active walk | Callable test |
| LW-008 | Authorized Walker location update during active walk | Accepted only for the active assigned walk and approved fields | Positive Rules/Function test |
| LW-009 | Other Walker writes location for that walk | Denied | Negative Rules/Function test |
| LW-010 | Location update after walk end | Rejected or handled only by an explicitly approved late-event rule | Boundary test |
| LW-011 | Stale, delayed or unavailable GPS | UI/API labels state honestly; never represented as fresh live data | Contract/integration test |
| LW-012 | GPS gap / poor accuracy | No fabricated route points; quality metadata preserved where approved | Function/unit test |
| LW-013 | Customer reads own active booking location | Only authorized, server-accepted, customer-safe location returned | Callable/authorization test |
| LW-014 | Customer reads another customer's or unrelated walker's location | Denied; no cross-booking leakage | Negative authorization test |
| LW-015 | Area Admin reads in-scope active walk | Only approved operational fields returned | Positive scope test |
| LW-016 | Other-area or inactive Admin reads walk | Denied | Negative scope test |
| LW-017 | Unauthorized recipient handover | Completion denied; incident/exception route remains available | Callable test |
| LW-018 | Required handover evidence missing | Completion denied | Callable test |
| LW-019 | Duplicate completion / network retry | One completion event and one logical completed walk; no duplicate side effects | Idempotency/integration test |
| LW-020 | Customer unavailable / unsafe handover | Walk is not force-completed; approved exception/escalation path is recorded | Workflow test |
| LW-021 | Incident during active walk | Safety/incident path remains usable; ordinary completion cannot hide incident | Integration test |
| LW-022 | Tracking stop at approved sharing-window end | Further location sharing stops according to approved policy | Time-bound integration test |
| LW-023 | Network outage and retry | No contradictory state or duplicate event after reconciliation | Integration test |
| LW-024 | Area-scoped Admin intervention | Intervention requires authorized scope, reason and audit record; GPS trail is not rewritten | Rules/Function test |
| LW-025 | Restricted precise route history | Only approved roles and retention controls permit access | Rules + negative tests |

## 5. Cross-app contract assertions

After the canonical contract is approved, tests must assert all of the following without relying on UI-only behavior:

- Customer writer, Partner lifecycle commands, Admin readers and Firebase backend use the same booking/walk identity and approved field names.
- Admin live marker and route reader consume the same approved server-accepted location model that Partner/backend publishes.
- Customer response is a minimal allowlisted projection, not a raw Walker or operational document.
- Client cannot directly set authoritative lifecycle state, server timestamps, assignment, handover approval or completion fields.
- Every accepted command validates current assignment, booking state, actor status and geographic/role scope.
- Duplicate requests and retries cannot duplicate walk records, events, notifications or financial side effects.
- Precise GPS and incident records are excluded from broad collection reads and unauthorized logs.

## 6. Execution record template

For each test, record: test ID; exact source commit; Emulator version/config; command; fixture identity; expected result; actual result; assertion output; run URL/ID; timestamp; reviewer; and any failure/defect link.

**No test may be marked PASS until it has actually run against the approved schema and exact source commit.** Unit tests alone do not establish Rules authorization or end-to-end device background tracking.

## 7. Release gates

- [ ] Policy and contract approvals read back from Notion.
- [ ] Schema and role matrix frozen in Notion.
- [ ] Rules and trusted Functions implemented on an isolated branch.
- [ ] All applicable positive and negative Emulator tests executed.
- [ ] Partner, Admin and Customer integration tests executed.
- [ ] Physical-device tests cover permission denial, background suspension, battery/network interruption, GPS gaps and safe return.
- [ ] Independent security review and evidence reconciliation completed.
- [ ] Separate Founder approval obtained for production migration/deployment.

**Current release decision: NO-GO.** This document is a test-plan draft only. No production behavior is approved by its creation.
