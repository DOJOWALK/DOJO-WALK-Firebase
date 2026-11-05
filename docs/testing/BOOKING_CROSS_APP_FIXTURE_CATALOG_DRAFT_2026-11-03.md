# Booking Cross-App Fixture Catalogue — Draft (03 Nov 2026)

**Status:** Documentation/test-design only. Not an approved DTO, production schema, executable integration suite, or permission to change app/backend behavior.

**Parent review:** [PR #59 — Cross-app booking lifecycle audit](https://github.com/DOJOWALK/DOJO-WALK-Firebase/pull/59)

## 1. Purpose and safety boundary

This catalogue turns the source-audit findings and INT-01…INT-20 matrix into reproducible synthetic fixture scenarios. It is intended for implementation only after the Booking API Contract, lifecycle decisions, task DTO, timezone resolver, idempotency rules, and actor permissions are approved.

- Fixtures below describe **observed legacy Customer input shapes** or **test-only synthetic identities**. They do not establish a canonical Firestore schema.
- Do not add fields such as `date`, `startTime`, `serviceDateKey`, or `timezone` to production booking writes merely to satisfy a fixture. Those belong to a separately approved adapter/task contract.
- Do not create child tasks, offers, payment records, or assignments from these examples until their ownership and persistence contracts are approved.
- Keep production direct-write behavior unchanged while contract approval is pending.
- No app source, Firestore Rules, Functions, Firestore data, production configuration, merge, deployment, or device testing is authorized by this document.

## 2. Source baseline

Reviewed source revisions recorded by the parent audit:

| Component | Source | Revision |
| --- | --- | --- |
| Customer writer | `lib/features/booking/screens/booking_confirmation_screen.dart` | `94d45b12c7873fc2d289e164df965c735c0c63cb` |
| Partner Today reader | `lib/screens/home/partner_home_screen.dart` | `9a1c14fe13e05eaa7fd2df55942a20b02ce82074` |
| Firebase normalizer/adapter | PR #47 branch | `da16f650c9738473482d896387cf09b1efec0eab` |

Observed Customer fields include `bookingPlan`, `serviceType`, `scheduledAt`, `preferredTime`, `duration`, `walkCount`, `walkSchedules`, `status: pending`, and `walkerId: null`. Choose-Dates additionally writes `selectedDates` and `dateSchedules`. Regular writes `frequency`, `walksPerWeek`, `walksPerDay`, `planStatus`, and `dailyWalkTemplate`. These are source observations, not approval of a future contract.

Partner Home currently queries assigned bookings by `walkerId == authenticated UID`, filters by `date` using device-local date, sorts by `startTime`, and displays a limited set of statuses. The pure adapter emits normalized occurrences but is not wired to a callable, persistence path, or Partner reader.

## 3. Fixture conventions

- All names, IDs, addresses, and coordinates must be synthetic and non-routable/test-only.
- Represent Firestore Timestamp values using the test harness's Timestamp constructor; do not substitute ISO strings unless the test explicitly exercises a legacy string parser.
- The snippets below are **shape sketches**, not copy/paste-ready Firestore documents. The harness must use the exact current Customer writer types when constructing source fixtures.
- Omit private pet/address values from logs. Assert ownership using synthetic Auth and document fixtures.
- Keep each test's expected result separate from the fixture input; never seed a trusted assigned state from a Customer-supplied value.

## 4. Source-shaped input fixtures

### FIX-01 — One-Time, one walk

Synthetic setup:
- Auth: Customer A.
- Pet: synthetic pet document owned by Customer A.
- Saved pickup address: synthetic address owned by Customer A.
- Request shape: `bookingPlan: one_time`, `serviceType: temporary_walk`, one `walkSchedules` entry, `status: pending`, `walkerId: null`.

Expected assertions after an approved callable exists:
- Auth UID, not a client-supplied customer identifier, determines the owner.
- Pet and pickup-address ownership are checked server-side.
- Exactly one request is created for the approved idempotency key.
- The request remains a request; it is not represented as confirmed, paid, assigned, or started.
- Any normalized occurrence preserves the submitted local service date, time, and duration under the approved timezone contract.

### FIX-02 — One-Time, multiple walks on one date

Synthetic setup:
- Same owner/pet/address pattern as FIX-01.
- Two or more valid `walkSchedules` entries on the same service date.

Expected assertions:
- Every submitted walk is represented once; no first-item-only truncation.
- Ordering is deterministic under the approved ordering/tie-break rule.
- Duplicate times/occurrences are rejected or handled only as the approved contract specifies.
- Customer's current UI limit is three walks per day. Do not silently change it to match the normalizer's four-walk acceptance in existing tests.

### FIX-03 — Choose-Dates, two dates, later date has multiple walks

Synthetic setup:
- `bookingPlan: customize`, `serviceType: custom_walk`.
- `selectedDates` contains two service dates.
- `dateSchedules` contains matching Timestamp dates; the second date contains at least two nested `walks`.

Expected assertions:
- Both dates are represented and each nested walk on the later date is preserved.
- Timestamp-to-date-key correspondence is checked using the approved service timezone.
- Mismatched list lengths, missing nested walks, duplicate dates, and timestamp/date-key disagreement fail without partial writes.
- Do not infer that a test-only injected date resolver is a production timezone implementation.

### FIX-04 — Regular request without a bounded end date

Synthetic setup:
- `bookingPlan: regular`, `serviceType: regular_walk`.
- Existing observed fields include `frequency: daily`, `walksPerWeek: 7`, `walksPerDay`, `planStatus: pending_confirmation`, and `dailyWalkTemplate`.
- No approved bounded service end date is supplied.

Expected assertions:
- No unbounded child-task series is generated.
- Request remains pending operations/product clarification.
- Do not auto-map Regular to a monthly package, calendar-month plan, or unlimited daily series without Founder/Product approval.

### FIX-05 — ASAP with client-generated `scheduledAt`

Synthetic setup:
- Current Customer source uses `preferredTime: ASAP` and a client-generated `scheduledAt` based on the device clock.

Expected assertions:
- Client clock value is not treated as authoritative confirmed start time.
- No scheduled/assignable task is generated before the approved immediate-availability workflow.
- Result remains a truthful request/operations state.

### FIX-06 — Legacy parent booking for reader compatibility

Synthetic setup:
- A synthetic legacy parent document containing only fields observed in the current Customer writer and fields needed by the current Partner/Admin readers.
- Seed a separate assigned fixture only inside a test harness, with assignment fields set by test setup—not by Customer input.

Expected assertions:
- Existing legacy readers are characterized before migration.
- Unassigned `pending` request does not appear as assigned Partner work.
- The test documents the current reader's legacy field expectations; it does not authorize adding duplicate fields to Customer writes.

## 5. Identity, ownership, and authorization fixture set

Use isolated Auth contexts and synthetic documents:

| Fixture | Actor | Data setup | Required negative assertion |
| --- | --- | --- | --- |
| AUTH-01 | Customer A | Own pet and own saved address | Customer A cannot submit Customer B's pet/address IDs |
| AUTH-02 | Customer A | Request payload includes forged customer ID | Backend derives owner from Auth; forged ID is ignored/rejected |
| AUTH-03 | Customer A | Payload includes `walkerId`, assigned status, price, payment status | Client cannot set trusted assignment, lifecycle, price, or payment fields |
| AUTH-04 | Walker A | Task assigned to Walker A in approved test schema | Walker A cannot read/update Walker B's task |
| AUTH-05 | Walker B | Same task assigned to Walker A | Walker B receives no task or protected fields |
| AUTH-06 | City Manager A | Scope contains City A only | City Manager A cannot access City B records/actions |
| AUTH-07 | Central Admin | Approved Central scope in test fixture | Central actions still require explicit action permission and audit trail |
| AUTH-08 | Super Admin | Technical/security role only | Super Admin role alone does not imply dispatch or Finance approval |

These are required authorization scenarios, not claims that the current Rules or apps already enforce them.

## 6. Cross-app integration test execution checklist

Do not mark a case PASS until the approved DTO and implementation exist and the exact test has run.

| Test ID | Fixture(s) | Test target | Status before contract approval |
| --- | --- | --- | --- |
| INT-01 | FIX-01 | Authenticated request creation and occurrence mapping | BLOCKED |
| INT-02 | FIX-02 | Multiple same-date walks and stable ordering | BLOCKED |
| INT-03 | FIX-03 | All Choose-Dates entries, including later-date walks | BLOCKED |
| INT-04 | FIX-03 | UTC instant crossing India midnight | BLOCKED |
| INT-05 | FIX-06 | Service-local Today grouping across device timezones | BLOCKED |
| INT-06 | FIX-04 | Regular bounded-horizon behavior | BLOCKED |
| INT-07 | FIX-05 | ASAP clock/availability boundary | BLOCKED |
| INT-08 | AUTH-01…03 | Identity, pet/address ownership, trusted-field rejection | BLOCKED |
| INT-09 | FIX-01 | Idempotent retry | BLOCKED |
| INT-10 | FIX-01 | Concurrent same-key submission | BLOCKED |
| INT-11 | AUTH-04 | Assigned Walker read scope | BLOCKED |
| INT-12 | AUTH-05 | Cross-Walker denial | BLOCKED |
| INT-13 | FIX-06 | Partner Today status/assignment projection | BLOCKED |
| INT-14 | Approved lifecycle fixture TBD | Stale/duplicate/out-of-order lifecycle command | BLOCKED |
| INT-15 | AUTH-06…08 | Admin parent/task view and role/geographic scope | BLOCKED |
| INT-16 | Approved cancellation fixture TBD | Request vs decision vs refund separation | BLOCKED |
| INT-17 | FIX-01…05 | Invalid date/time, empty/duplicate schedule, duration outside 20–60 | BLOCKED |
| INT-18 | Approved bounded schedule fixture TBD | Transaction/write-limit and no-partial-write behavior | BLOCKED |
| INT-19 | FIX-06 | Legacy parent without child tasks | BLOCKED |
| INT-20 | FIX-01…06 | Same seeded request projected consistently across Customer, Partner, Admin | BLOCKED |

## 7. Approval dependencies before executable integration work

1. Final parent Booking DTO and exact legacy field mapping.
2. Final Walk Task DTO, ID strategy, and persistence ownership.
3. Canonical parent/task/offer/payment status enums and transition matrix.
4. Service-zone-to-IANA-timezone resolver and service-local date semantics.
5. Regular booking period/end-date and generation horizon.
6. ASAP availability/confirmation behavior.
7. Idempotency key format, retention, replay response, and concurrent-write behavior.
8. Customer three-walk/day cap versus normalizer four-walk acceptance.
9. Admin/Partner field-level access, role/scope matrix, and authoritative Rules source.
10. Cancellation, refund, replacement, and active-walk safe-handover transitions.

## 8. Verification boundary

The parent audit records PR #47's exact-head Functions build/emulator suite as **303 passed, 0 failed**. That evidence applies to the pure normalizer/adapter tests only. It does not mean FIX-01…FIX-06 or INT-01…INT-20 have been implemented or executed, and it does not establish Customer → Partner integration.

**Current result:** Fixture catalogue prepared as a draft test-design artifact. All cross-app integration cases remain BLOCKED pending contract/product/security approvals. No app source, Rules, Functions, Firestore data, deployment, merge, or device QA was changed or performed.
