# Booking + Walk Task V1 DTO — Synthetic Emulator Test Contract

**Date:** 2026-11-04  
**Status:** Test-only reference contract; not production integration evidence.  
**Parent decision:** PR #83, Booking + Walk Task API V1 Schema Decision Record.

## Purpose

Exercise the proposed canonical parent Booking / child Walk Task shape in a demo Firestore Emulator before runtime implementation. The suite is intentionally isolated under `test_booking_walk_task_dto_*` collections and is not imported by deployed Functions.

## Scenarios covered

1. One-Time creates one parent and one executable task.
2. Choose-Dates preserves multiple dates and multiple walks on one date as separate tasks.
3. Finite Regular produces only its finite occurrence set; no unbounded subscription/task series.
4. Immediate with `ASAP` and client clock metadata cannot create a confirmed aggregate without a server-verified slot.
5. Client-forged identity, pet/address snapshots, Zone/City, timezone, appointment time, price, payment, status and Walker fields are rejected by the test-only allowlist.
6. Parent confirmation and task materialization reject a partial parent-child set.
7. Aggregate retry does not duplicate child tasks.
8. Walker eligibility fixture requires active + approved + verified + exact Zone membership.

## Explicit limitations

- This is a synthetic reference oracle, not the exported production callable.
- It does not authenticate a Firebase user or invoke Auth Emulator.
- It does not read real Customer App DTOs or prove the Customer App adapter maps its current `walkSchedules` / `dateSchedules` payload correctly.
- The Walker `zones` list is only a test fixture reflecting the audited Partner profile shape; its mapping to canonical `service_zones` remains a migration gate.
- It does not implement or verify Zone geometry, approval request tuple, capacity reservation, payment provider, real task materializer, assignment locking, Firestore Rules, or notifications.
- The task timestamps in the fixtures are synthetic. Production must convert customer-selected local wall-clock values using trusted `Asia/Kolkata` and pin the country config revision.
- Emulator data is demo-only. The workflow refuses any non-`demo-*` project and explicitly rejects the production Firebase project ID.

## Actual callable integration gate

The actual callable integration suite remains blocked until the production Booking callable, trusted Zone resolver, country configuration reader, availability/capacity service, verified payment transition, task materializer and Walker assignment service exist. A PASS here means only these isolated DTO reference assertions passed; it must not be represented as production booking readiness.
