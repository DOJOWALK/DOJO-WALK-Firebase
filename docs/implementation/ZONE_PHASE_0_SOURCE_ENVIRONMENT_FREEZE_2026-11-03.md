# DOJO WALK — Canonical Zone Phase 0 Source & Environment Freeze

Date: 2026-11-03
Status: Source inspection complete for the pinned GitHub refs below. No Emulator execution, runtime implementation, deployment, merge, role provisioning, or production data access was performed.

## 1. Pinned repository refs

| Repository | Ref | Commit |
|---|---|---|
| Firebase | `main` | `bdfea488990864c4f5670a98fb147eefd1453334` |
| Firebase | `architecture/canonical-zone-booking-contract` | `130d484b10d0e7c08aaa358932702f2a0ddedbe3` |
| Firebase | `implementation/zone-emulator-first-plan-2026-11-03` | `4a244a94a254db72cd035e8e61f6e76033c8637c` |
| Admin | PR #51 head, `ui/notion-brand-foundation-2026-10-28` | `ef195aa16c9c1d2e207308bc63c9b480455ddde3` |

Firebase implementation branch is exactly one commit ahead of the architecture branch. Its only added file at this checkpoint is the implementation plan. Admin PR #51 is Open / Draft / Unmerged. Firebase PR #64 is Open / Draft / Unmerged.

## 2. Source SHA manifest

### Firebase source on `main`

| File | Blob SHA | Finding |
|---|---|---|
| `functions/src/index.ts` | `2b13994aff949f38e626e1929422e5de84755312` | Five callable exports listed below |
| `firestore.rules` | `9bac26b9e13a97d412a0154ec9af70629e82eb47` | Legacy role/boundary rules; no canonical Zone match |
| `firebase.json` | `bcbb18b9de69a917b8a28c17dbeccaa78c10384f` | Auth/Functions/Firestore/Storage emulator ports and rules paths |
| `package.json` | `bf603e9a9a6ab4cddd6f5be1a0c2862356043127` | Root Firestore Rules test script |
| `functions/package.json` | `e05c6f142638aa3c483548590385ef6ee0321bff` | Node 22, Functions build/test/emulate scripts |
| `functions/tsconfig.json` | `8abc3b595665f6c91abbb8dc61578d8130b944da` | TypeScript strict mode, ES2022 |
| `functions/src/location_name_index.ts` | `eb0418290fdf82b55336a1236d5555561c9acf95` | Legacy location types only |
| `test/firestore.rules.test.mjs` | `e7bfeb73b09438dd6252f8232d41ea78de57cf0f` | Existing Rules Emulator test harness |
| `functions/test/location_geometry.test.cjs` | `7b2f889ea3d8f4033303d32a4a34ffa165aab61f` | Existing City/Area geometry unit tests |
| `functions/test/location_name_index.test.cjs` | `393aa4d4e6b2d499111ed2701471a4a137e3ef06` | Existing legacy name-index unit tests |

### Admin source on `ui/notion-brand-foundation-2026-10-28`

| File | Blob SHA | Finding |
|---|---|---|
| `.github/workflows/walker-admin-emulator-integration.yml` | `6bca798b08ede80102ed25cc3f881d45b98522a7` | Manual-only, exact Firebase SHA input and checkout validation |
| `lib/features/service_location/services/service_zone_workflow_service.dart` | `77c0f290b764f781aa7fcc672c4ff5d1ec49f6cf` | Zone client callable wrapper methods |
| `lib/features/service_location/screens/add_zone_screen.dart` | `a4d8d27aef295e7e48620abb4d7abd8b024cc0a5` | UI-only; Save/Submit remain disabled |
| `integration_test/service_zone_workflow_emulator_test.dart` | `027177be89edb1c9506bbf100b99e85502bb8e98` | One unauthenticated/unauthorized integration test |
| `pubspec.yaml` | `962af39b8af8115dc6d2c21f1bf7f81d45485aa3` | FlutterFire dependencies and integration_test |

### Architecture / implementation documents

- Canonical contract blob SHA: `c7bf9186225e443bbb40b33618c41f4ff374ecfc`.
- Emulator-first plan blob SHA: `afb9b9919c27e130564c287c95bcac2d8de6ca5f`.

## 3. Verified backend compatibility blockers

### 3.1 Callable export mismatch

Firebase `functions/src/index.ts` currently exports only:
- `reviewServiceLocationBoundary`
- `activateServiceLocation`
- `setServiceLocationStatus`
- `saveServiceLocationWithNameIndex`
- `manageServiceLocationImportRun`

The Admin Zone workflow service calls:
- `saveServiceLocationWithNameIndex`
- `submitServiceZoneForFounderReview`
- `reviewServiceLocationBoundary`
- `decideServiceZoneFounderApproval`
- `activateServiceZone`
- `requestServiceZoneDeactivation`
- `setServiceLocationStatus`
- `suspendServiceZoneForEmergency`
- `requestServiceZoneReactivation`

The following six Zone-specific names called by Admin are not exported by the inspected Firebase `main` Functions entry point:
- `submitServiceZoneForFounderReview`
- `decideServiceZoneFounderApproval`
- `activateServiceZone`
- `requestServiceZoneDeactivation`
- `suspendServiceZoneForEmergency`
- `requestServiceZoneReactivation`

The two shared legacy callable names do not establish Zone compatibility:
- `saveServiceLocationWithNameIndex` accepts the legacy `ServiceLocationType` map, which contains country/state/district/city/area/locality and **does not contain zone**.
- `reviewServiceLocationBoundary` and `activateServiceLocation` validate legacy City/Area boundaries, not canonical Zone lifecycle records.

**Conclusion:** Admin wrapper methods are not proof that the Firebase Zone backend exists. Paired Admin↔Firebase Zone E2E is blocked until a versioned Zone callable contract is implemented and tested.

### 3.2 Firestore Rules / authority mismatch

- The inspected Rules file has a match for `service_location_boundaries/{boundaryId}`, but no `service_zones`, `service_zone_approval_requests`, `service_zone_name_indexes`, `service_zone_audit`, or `founder_users` match.
- Existing `isAdmin()` requires an active `admin_users/{uid}` record with role exactly `super_admin`.
- Existing boundary rules permit legacy draft creation/update under their validation helpers; this is not the target server-only immutable Zone boundary workflow.
- No canonical `central_admin`, `area_manager`, `supervisor`, or explicit Founder allowlist authorization was verified in these Rules.

**Conclusion:** Do not grant new roles, change existing Rules, or enable Zone controls until the new authority model and Rules Emulator matrix are approved and implemented.

## 4. Admin screen and integration workflow findings

- `AddZoneScreen` describes itself as UI-only and has disabled Save Draft / Submit actions. It holds the drawn polygon in screen state and does not invoke `ServiceZoneWorkflowService`.
- `ServiceZoneWorkflowService` exists, but the screen is not wired to it. The service has no dedicated boundary-draft upload/persistence callable.
- The current Admin Zone Emulator integration test contains one test focused on unauthenticated callable rejection and confirming that unauthorized requests did not create Zone/audit documents. It does not prove successful lifecycle, Founder decision, reviewer separation, stale revision/hash handling, or Rules forgery coverage.
- The manual workflow now accepts a required exact 40-character Firebase commit SHA, checks out that exact ref, verifies the checked-out SHA, and records both Admin and Firebase SHAs. This fixes the earlier hard-coded Firebase `main` problem.
- The workflow starts Auth, Firestore, and Functions emulators and runs two Flutter integration tests. It does not run the Firebase repository's standalone Firestore Rules unit-test command as part of that workflow.

## 5. Environment facts from repository configuration

- Functions runtime: Node.js 22.
- Firebase Functions package scripts:
  - `npm run build` → TypeScript compile.
  - `npm test` → build, then Node test runner over `test/*.test.cjs`.
  - `npm run emulate` → starts Functions + Firestore only (does not include Auth).
- Root Firebase package script:
  - `npm test` → `node --test test/firestore.rules.test.mjs`.
  - Firebase CLI dependency range: `^14.12.1`.
- `firebase.json` emulator ports: Auth 9099, Functions 5001, Firestore 8080, Storage 9199; Emulator UI disabled.
- The Admin manual integration workflow explicitly starts Auth + Firestore + Functions. The existing Functions `emulate` convenience script should not be used for the authenticated Admin integration test unless Auth is started separately.

These are source-configured versions and commands, not proof that local dependencies are installed or that any Emulator command has passed.

## 6. Unverified items and hard blockers

- No direct read of the live Firebase Auth users, `admin_users`, or any Founder authority records was performed. Therefore the actual Founder UID, bootstrap custodian(s), recovery custodian(s), and live role document shape remain unverified.
- The source snapshot does not contain a `founder_users` collection contract. Do not invent a Founder UID or provision a role from email/display name.
- Exact production deployed Functions/Rules versions were not queried.
- No local checkout, dependency installation, Emulator startup, test execution, or paired integration run was performed during this source freeze.

## 7. Phase 0 exit assessment

<badge>PARTIAL — source inspected; identity/deployment verification blocked</badge>

Repository source, branch refs, callable exports, Rules shape, Admin UI wiring, test harness commands, and manual paired-workflow SHA pinning have been inspected and pinned above. Phase 0 is complete for source inspection only; it is not complete for live identity/deployment verification.

## 8. Next safe execution step

Prepare Phase 1 synthetic-fixture test scaffolding only after recording the remaining governance defaults:
1. Confirm Zone-name uniqueness within City.
2. Confirm a separately permissioned Central Admin boundary reviewer, with no self-review.
3. Confirm explicit `founder_users/{uid}` allowlisting and a separately audited provisioning/recovery process.

The exact live Founder UID must remain outside source control and should never be written into this document. Do not implement production role provisioning. After these decisions are recorded, write failing tests against synthetic UIDs and emulator-only fixtures, then implement Functions/Rules to satisfy them.
