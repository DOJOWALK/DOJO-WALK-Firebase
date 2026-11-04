# Automatic Booking — Synthetic Firestore Emulator Acceptance Plan V1

**Status:** Test-first acceptance suite / pre-implementation reference model\
**Approved scope:** Automatic Booking across all eligible Active Zones without routine Central Admin approval.\
**Date:** 2026-11-04\
**Base context:** Booking PRs #76–#79, Zone lifecycle PR #71, Zone→Booking contract PR #80.\
**Safety:** Synthetic demo project only. No production data, live payment, app UI, Rules, callable, migration, merge or deployment.

## 1. Approved behavior

A customer Booking request must be processed automatically for every eligible Active Zone. Central Admin is not a routine approval gate. Central Admin receives only exceptional cases, alerts and operational failures.

A Booking may be confirmed only after:
1. The authenticated customer's own pet and saved address are loaded server-side.
2. The saved address resolves safely to exactly one eligible Active Zone.
3. Zone/Boundary/Founder-approval evidence is current and revalidated before commit.
4. Requested date/time and Zone capacity are available.
5. A qualified, active Walker can be assigned or a valid assignment workflow is available.
6. Capacity and idempotency are reserved atomically.
7. Payment succeeds under the separately approved payment contract.

**Important state distinction:** request received ≠ booking confirmed ≠ payment successful ≠ Walk Task assigned. Do not create duplicate bookings/tasks on retries. Immediate bookings remain awaiting operations confirmation unless a separate SLA/availability contract explicitly enables instant confirmation.

## 2. Zone resolution contract

- Use the trusted saved pickup address; never trust client zoneId, serviceZoneId, Boundary ID/hash, coordinates that differ from the saved record, or timezone.
- A Zone is eligible only if its current lifecycle status is Active, service is enabled, its verified Boundary is current, and its Founder activation approval tuple matches the verified Boundary.
- Use the strict-majority verified building-footprint rule when a verified footprint exists: one Zone must contain strictly more than 50% of the entire footprint. Do not renormalize covered fragments.
- Until a trusted footprint is available, point fallback is allowed only when the saved pickup point is strictly inside exactly one eligible Zone and away from boundaries. This is point-based coverage, not a majority claim.
- No eligible Zone, exact boundary/overlap ambiguity, invalid geometry, stale evidence or uncertain result must not be silently routed to a nearby/non-covering Zone. Return a clear non-confirmed outcome and create an exception record.
- If a different saved service address is validly within another Active Zone, the customer may choose that address; never change their address/Zone silently.

## 3. Automatic operations contract

- Normal eligible requests proceed without Central Admin review, including when no Admin is online.
- Availability is Zone-scoped and time-slot scoped.
- Reserve capacity atomically before confirmation; concurrent requests must not oversell the same last slot.
- Walker selection must require active/approved Walker status and a valid Zone assignment (or an explicitly approved cross-zone assignment policy).
- Primary Walker non-response or failed check-in triggers deterministic retry/backup policy; never silently mark assigned if no Walker accepted.
- If no Walker/slot is available, offer only actually available alternative times. Do not confirm the original slot.
- Every request receives a durable state and reason code. Failures enter a retry/exception queue with an alert record; no silent drop.
- Idempotent replay with the same request key and same canonical payload returns the same Booking outcome. Same key with a different payload conflicts.
- Zone/Boundary/approval and capacity must be revalidated at final transaction commit.
- Payment must not be captured before the required availability/capacity reservation succeeds. Payment provider integration is out of scope for this test-only PR.

## 4. Executable pre-implementation reference-model scenarios

The emulator test file uses isolated test_automatic_booking_* collections and a test-only reference oracle. It deliberately does not import or pretend to test a production Booking callable. These tests validate the approved state/transaction contract and emulator fixture mechanics before the real callable exists.

1. Active Zone + available Walker + free slot → automatically reserve and confirm without any Admin document.
2. Inactive, suspended, unapproved or stale Zone → reject; no Booking/Walk Task/payment/assignment side effects.
3. Address outside every eligible Zone → no booking confirmation; exception/status persisted.
4. Point on/near shared edge or multiple eligible Zones → review-required; no guessed Zone.
5. Verified footprint 70/30 and 51/49 → strict-majority Zone; exact 50/50 and no-majority → review-required.
6. Capacity exhausted → no confirmation; only genuine alternative slots may be offered.
7. Two concurrent customers competing for one remaining capacity unit → exactly one reservation succeeds.
8. Same idempotency key + same payload → one Booking only and stable response.
9. Same idempotency key + different payload → conflict; no second Booking.
10. Primary Walker fails acceptance/check-in → backup search/assignment state; no false successful assignment.
11. No available Walker → durable pending/exception state and alert; no silent drop.
12. Zone deactivated or Boundary/approval hash changed between discovery and commit → abort; no stale Booking.
13. Client-supplied Zone/Boundary/timezone override → reject.
14. Central Admin offline/absent → ordinary valid request still processes.
15. Immediate plan → awaiting operations confirmation, no premature Walk Task.

## 5. Required application integration acceptance tests (must be added before runtime implementation is considered complete)

These tests must call the eventual authenticated Booking callable through Functions + Auth + Firestore Emulators and assert actual application writes, not the reference oracle:

- Authentication and UID-scoped pet/address ownership.
- Canonical request allowlist and trusted snapshots.
- Exact Zone eligibility predicate against PR #71 schema.
- Point fallback and verified footprint strict-majority; overlap, tie, no-majority, invalid geometry.
- India timezone source pinned to trusted country configuration; device/client timezone ignored.
- Availability, per-Zone capacity, transaction contention and no oversell.
- Idempotency, replay, changed-payload conflict and concurrent duplicate requests.
- Walker eligibility, Zone assignment, primary response timeout, backup and no-walker exception.
- No routine Central Admin approval dependency.
- Payment sequencing and payment failure recovery (after payment contract approval).
- No forbidden writes on every denial: no confirmed Booking, Walk Task, payment capture, assignment or success notification.
- Zone/Boundary/approval/footprint/capacity race revalidation.
- All booking plans and bounded task generation; Immediate remains awaiting operations confirmation.
- Retry/recovery and exception queue observability.

## 6. Test evidence rules

- Use Firebase Emulator Suite and a project ID beginning demo-; explicitly reject dojo-platform-b68a3 and all non-demo IDs.
- Use synthetic customer, pet, address, Zone and Walker identifiers only.
- Run tests serially where fixtures are shared; use unique test prefixes and cleanup.
- CI must report the exact PR head SHA, emulator command, test count and each test result.
- A PASS from the reference-model suite is not a claim that the production Booking callable exists or passes. Production integration remains blocked until the tests in Section 5 are implemented against the real callable.

## 7. Explicit non-effects

This PR must not add or modify production Functions exports, Firestore Rules/indexes, Booking/Walk Task schemas, payment integrations, Admin/Customer/Partner apps, live data, migrations, production configuration or deployments. No PR is merged.
