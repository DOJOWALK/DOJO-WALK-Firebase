# DOJO WALK — Zone Service Location Backend Implementation Plan

Status: DESIGN PLAN ONLY — NOT IMPLEMENTED, NOT TESTED, NOT DEPLOYED
Owner decision source: DOJO WALK operating requirements (latest confirmed hierarchy).

## 1. Required operating model

The service-location hierarchy used by the Admin workflow must be:

State/UT → District → City → Zone

- Do not show or require a Locality dropdown.
- Zone is the only level with service activation/deactivation controls.
- State/UT, District, and City are hierarchy selectors, not independently service-activated locations.
- A Zone cannot become active until its boundary is verified and all parent links are validated server-side.
- Do not delete legacy service_areas/service_localities records as part of this change.

## 2. Source audit findings (repository source inspection)

The current source has a legacy location model:
- `functions/src/location_name_index.ts` declares country/state/district/city/area/locality collections and allows City name-index tuples with 2 or 3 parents.
- `functions/src/index.ts` has boundary review and activation paths for City/Area; the boundary validator only accepts `city` and `area`.
- `setServiceLocationStatus` accepts country/state/district/city/area/locality status changes.
- Firestore rules define `isAdmin()` as an active `super_admin`, but the current service-location callable save path also accepts active `admin` accounts. This role mismatch must be explicitly reviewed and aligned with the approved authorization policy before release.
- This audit does not establish what is currently deployed in Firebase production.

## 3. Proposed Zone document contract

Proposed collection: `service_zones/{zoneId}`.

Required fields:
- `name`: trimmed, non-empty, max 120 characters
- `stateId`, `districtId`, `cityId`: validated document IDs
- `isServiceActive`: server-controlled boolean; new zones default to false
- `boundaryId`: reference to a boundary record owned by this Zone
- `createdAt`, `updatedAt`: server timestamps

Suggested operational metadata:
- `boundaryVerificationStatus`: pending | verified | rejected (authoritative status remains on the boundary review record)
- `createdBy`, `updatedBy`: authenticated actor IDs
- `activationStatusReason`: optional bounded audit reason

The canonical name index must include the full parent chain [stateId, districtId, cityId] so same-named Zones under different Cities do not collide. Keep any existing index format backward-compatible until the migration is explicitly designed and tested.

## 4. Callable/API requirements

Implement or adapt server-authoritative callables for:
1. Save/create Zone (create inactive; reject unknown fields; validate State → District → City ancestry; reject parent reassignment on update; enforce duplicate-name protection transactionally).
2. Submit/attach Zone boundary (validate polygon shape and size; record source/reference; keep pending until reviewed).
3. Review Zone boundary (only an authorized reviewer; require decision notes; verify polygon; write immutable audit record; bind verified boundary to the owning Zone).
4. Activate Zone (only after fresh transactional checks of actor, all parents, boundary ownership, verified status, valid geometry and unchanged ancestry; write audit record).
5. Deactivate Zone (server-side only; record actor, reason, timestamp and previous/new state).
6. Read/list API compatible with Admin dropdowns, returning only the fields required for the workflow.

Do not silently repurpose existing City/Area callables without compatibility tests. Prefer explicit Zone support, then remove legacy paths only after clients and stored data have been migrated.

## 5. Authorization requirements

Every privileged callable must verify on the server:
- authenticated request;
- admin record exists and is active;
- approved role for the specific action;
- scope/action authorization as defined by the current access-control policy;
- target and parent records still match inside the transaction.

Never rely on hidden/disabled UI controls as authorization. Firestore client writes to Zone activation fields and boundary verification fields must be denied. Keep server-owned audit records immutable from clients.

Role decision to resolve before release: current code inconsistently permits `admin` for generic save while other location operations require `super_admin`. Do not assume these are interchangeable; align with the approved role matrix.

## 6. Firestore Rules

- Add explicit `service_zones` read/write policy.
- Deny client create/update/delete of server-controlled activation, boundary verification, and audit fields.
- Deny client writes to Zone boundary review audit records and activation audit records.
- Check whether `service_location_boundaries`, name indexes, import runs, and audit collections already have rules; test both permitted and denied operations.
- Do not introduce a broad catch-all allow rule.

## 7. Legacy data and migration safety

Migration must be additive and reversible:
1. Inventory current collection counts, fields, references, boundary records and name-index documents.
2. Export/backup before writes; preserve source IDs and original records.
3. Produce a dry-run mapping from legacy Area records to candidate Zones only where City/parent and geometry can be verified.
4. Never automatically equate every Area with a Zone without business review.
5. Flag missing parents, duplicate normalized names, invalid polygons, missing boundary provenance and ambiguous mappings.
6. Write migration markers and a reconciliation report; make the migration idempotent.
7. Keep legacy collections readable during the compatibility window.
8. Do not run production migration or deploy rules/functions as part of this planning change.

## 8. Required tests before merge

Callable tests (emulator):
- valid State → District → City → Zone save succeeds and new Zone remains inactive;
- missing/inactive/mismatched State, District or City is rejected;
- invalid ID, unknown payload field, blank/oversized name is rejected;
- duplicate normalized Zone name under the same City is rejected; same name under another City is allowed;
- parent reassignment is rejected;
- unverified, rejected, malformed, mismatched-owner or stale boundary blocks activation;
- verified valid boundary + active and correctly linked parents permits activation;
- deactivation records audit details;
- inactive admin, non-admin, missing admin record and unauthenticated caller are denied;
- client writes to activation/verification/audit fields are denied;
- concurrent parent or boundary changes cannot bypass activation checks;
- legacy City/Area behavior remains covered until retirement is approved.

Rules tests:
- permitted reads for intended client roles;
- no client can activate/deactivate a Zone directly;
- no client can mark a boundary verified;
- no client can mutate audit/import-run records;
- cross-scope and unauthenticated access is denied.

## 9. Release gates

Do not merge or deploy until:
- the role matrix is confirmed against POL-021;
- the Admin client and Firebase callable contracts agree;
- migration dry-run has been reviewed;
- emulator rules and callable tests pass;
- CI passes on the final commit;
- rollback plan and production backup are documented;
- a human reviewer approves the draft PR.

## 10. Current state

This file is a planning artifact only. No application code, Firestore rules, deployed functions, or production data were changed by this document. Implementation and test status remain pending.
