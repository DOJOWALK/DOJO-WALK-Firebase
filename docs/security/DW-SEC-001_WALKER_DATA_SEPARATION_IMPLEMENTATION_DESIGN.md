# DW-SEC-001 — Walker Data Separation Implementation Design
**Status:** Founder-approved design direction; detailed technical freeze proposal.  
**Repository:** `DOJOWALK/DOJO-WALK-Firebase`  
**Branch:** `feat/dw-sec-001-walker-data-separation`  
**Date:** 2026-11-03

## 1. Authority and release boundary

This document implements only the design direction recorded in the DW-3 Notion task and the Founder decision dated 3 Nov 2026. Notion remains the source of truth. This file is a technical proposal for field-level schema and authorization review; it is not permission to migrate production data, deploy Rules, merge to main, or release apps. POL-014, POL-020 and POL-021 remain Draft.

## 2. Architecture decision

Do not expose the existing `walkers/{uid}` document to arbitrary authenticated users. It combines customer-safe profile attributes with sensitive-capable onboarding, identity, address, device, finance and emergency attributes. Firestore Rules cannot redact individual fields from a document read.

Use separate logical records:

| Collection | Purpose | Client access target |
|---|---|---|
| `walker_public_profiles/{walkerUid}` | Minimal customer-facing projection | No direct client read/list; backend-mediated response only after booking authorization |
| `walkers/{walkerUid}` | Restricted operational and Partner self-service profile | Owner and specifically authorized operational roles, with field-level write allowlists |
| `walker_kyc/{walkerUid}` | Identity evidence references and verification workflow | Walker's permitted submission flow; named Verifier roles for review |
| `walker_finance/{walkerUid}` | Bank/payout/earnings records | Walker's permitted own earnings view; Finance for authorized finance tasks |
| `walker_emergency/{walkerUid}` | Emergency contacts and restricted incident access | Walker's permitted own maintenance flow; authorized emergency/support access |
| `walker_devices/{walkerUid}` | Device registrations and security tokens | Trusted backend and narrowly authorized security operations; never customer-visible |
| `audit_logs/{logId}` | Security-relevant access and privileged action trail | Append-only through trusted workflows; restricted review |

Collection names above are approved design targets, but existing app paths and references must be mapped before any live migration. Do not create or populate these collections in production in this phase.

## 3. Customer projection — proposed exact contract

The only candidate fields for `walker_public_profiles/{walkerUid}` are:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `displayName` | string | yes | Approved customer-facing display name; never assume it equals legal name |
| `profilePhotoRef` | string or null | no | Reference to a separately controlled, customer-safe photo asset; not a KYC/selfie path or unrestricted download URL |
| `publicWalkerCode` | string or null | no | Customer-safe identifier only if the product needs it |
| `serviceSummary` | map | yes | Minimal approved service description; no internal eligibility evidence |
| `zoneSummary` | map or null | no | Customer-safe service-area label only; no exact home/current location |
| `profileState` | string | yes | Allowlisted publication state such as `published` / `unpublished`; not KYC detail |
| `updatedAt` | timestamp | yes | Server-controlled timestamp |

No phone, email, DOB, gender, residential address, raw KYC status/evidence, bank/payout data, emergency contacts, device tokens, internal notes, exact live location or raw eligibility evidence may be included. Contact sharing remains off by default and requires a separate recorded decision and controlled contact workflow.

**Important access design:** Customer apps must not query/list the public-profile collection. Prefer a callable/backend operation such as `getAssignedWalkerPublicProfile(bookingId)`: authenticate the caller, load the booking from the trusted backend, verify the caller owns that booking, verify the booking is in a state where the Walker is assigned, load only the assigned Walker's projection, and return the allowlisted response. Deny when any check fails. Apply rate limiting/abuse controls and audit sensitive exceptions. Exact callable name/response envelope is a proposal until cross-app API mapping is complete. This avoids relying on a collection query to prove an assignment relationship and prevents general directory enumeration.

## 4. Restricted operational Walker record — proposed boundaries

Keep only operational and Partner-owned profile data needed for onboarding progress, service capability, availability and assignment. Candidate attributes observed in the current legacy contract include identity/contact aliases, date of birth, gender, city/state/area/zone references, travel mode, service selections, availability, onboarding step/submission timestamps and lifecycle state. This is not a final field allowlist. Map every current reader/writer before choosing canonical names.

Do not keep the following in the operational parent record after migration: raw identity document payloads/references, bank details, emergency contact details, FCM/device tokens. Replace these with narrowly scoped references or separate records where required. Lifecycle fields (approval, verification outcome, active/suspended state, trusted eligibility) must not be writable by the Walker client; use trusted review workflows.

## 5. Private record boundaries

- **KYC:** document metadata/reference, type, submission state, reviewer outcome, timestamps and correction/replacement history. Actual files remain in private Storage paths. Do not put document images or extracted identity values in Notion, logs or public projection.
- **Finance:** payout destination and finance ledger fields are Finance-restricted. Never return bank details to Customer or unrelated operational roles. Walker self-view should expose only the minimum permitted payout/earnings information, not unrestricted finance administration fields.
- **Emergency:** emergency contact and incident access are purpose-limited. Exact break-glass activation authority, expiry, notification and independent review must be decided before implementation.
- **Devices:** tokens and device/session metadata are trusted-backend/security-only. Do not let a client choose another UID's path or read other devices' tokens.
- **Storage:** preserve existing `walker_selfies/{uid}/...` and `walker_documents/{uid}/...` private paths until a separately reviewed migration plan exists. No public ACL or direct customer access.

## 6. Role model — policy-aligned proposal, not final Firebase role IDs

Authorization must evaluate active identity + named role + action + assigned geographic/operational scope + record state. The role concepts to map are:

| Role concept | Permitted purpose | Explicitly not implied |
|---|---|---|
| Walker/Partner | Own profile, permitted onboarding submission, availability, assigned walks, own permitted earnings view | Other Walker/customer data; own approval or payout authorization |
| Verifier | Assigned KYC review and correction decisions | Finance, unrelated operations, bulk export |
| Finance | Payout, bank/reconciliation/refund tasks within approved limits | KYC evidence, live location, unrelated dog/customer data |
| Support | Assigned case data and approved support actions | Blanket KYC/bank/emergency access |
| Emergency responder | Incident-specific minimum records for a real incident | Standing unrestricted access |
| Zone Supervisor | Assigned Zone operational records | Other Zones or private KYC/finance by geography alone |
| City Manager | Assigned City operational records | Other Cities or blanket sensitive-data access |
| Central Operations | Cross-area operational coordination and approved escalations | Automatic Super Admin or unrestricted private-data access |
| Super Admin | Technical security and privileged account controls | Automatic operational, finance or Founder approval authority |
| Founder/CEO | Major business/policy/release decisions and oversight | Routine booking dispatch or unlogged data access |

The actual `admin_users.role` values in the current Rules are not enough to safely infer these permissions. Freeze real role IDs, scope document references and action matrix only after mapping all Admin/Partner/backend consumers. No role should be granted access merely because it is authenticated or has a generic admin label.

## 7. Migration and compatibility gates

1. Read-only inventory: count legacy keys and nested paths; do not copy personal values to Notion.
2. Reader/writer matrix: identify all Partner, Admin, Customer, Functions and support/finance consumers and writers.
3. Canonical field map: resolve aliases such as `name/fullName`, `phone/phoneNumber`, `address/currentAddress`, `photoUrl/profileImage` without silently dropping data.
4. Backup and dry-run: use synthetic/emulator fixtures; document backup verification, idempotency, conflicts, retry and rollback.
5. Dual-read/write strategy: only if required, time-boxed and with an explicit removal date; never leave the broad legacy read open as a permanent compatibility path.
6. Cutover verification: compare document/key counts and reference integrity without exporting private values; verify Partner onboarding/profile and Customer assigned-profile behavior.
7. Production migration and cutover require separate Founder approval after the plan and test evidence are reviewed.

## 8. Required Emulator acceptance tests

- Unauthenticated user cannot read any Walker private record or public projection directly.
- Unrelated authenticated Customer cannot read/list/enumerate Walker projections or private Walker records.
- Customer can receive only the minimal projection for a booking they own and whose assigned Walker matches the projection.
- Customer cannot request another customer's booking ID, a different Walker UID, an unassigned/pending/cancelled booking, or use a collection query to enumerate profiles.
- Walker A cannot read Walker B's operational, KYC, finance, emergency or device records.
- Walker cannot write approval, verification outcome, active/suspended state, payout authorization, audit logs or another user's record.
- Verifier can access only assigned KYC review fields and evidence; cannot access finance/device records without a separate approved role.
- Finance can access only approved finance records; cannot access KYC documents, device tokens or unrelated live-location records.
- Support and emergency roles are denied by default outside assigned cases/incidents; emergency access records reason and audit event.
- City Manager and Zone Supervisor cannot cross their assigned geographic scope.
- Inactive admin, unknown role, missing scope and malformed role data are denied.
- Storage objects remain private; guessed paths, cross-walker access and customer access are denied.
- Nested legacy paths and stale documents do not create a bypass.
- Existing Partner onboarding, document upload/review, profile, availability and assigned-walk flows pass regression tests.
- Missing projection, unpublished projection, assignment change and booking completion revoke or deny customer profile access as designed.
- Audit events capture actor, role, action, target reference, reason/correlation and server timestamp without copying secrets or full private documents.

Record test environment, exact commit, command, expected/actual result and test-run URL. No tests are claimed as run by this document.

## 9. Unresolved decisions that block Rules/schema implementation

- Exact field-level contract for each private collection and every existing reader/writer.
- Actual role identifiers, geographic scope representation and action-by-action permission matrix.
- Emergency/break-glass authority, expiry, notification and independent review.
- Category-wise retention/deletion periods, legal holds and backup lifecycle under POL-014/POL-020. These policies remain Draft; do not invent durations.
- Migration conflict rules, legacy compatibility window, rollback trigger and cutover checks.
- Final callable/API contract and app rollout sequence.
- Measurable Emulator acceptance thresholds and regression coverage.

## 10. Current work status

This file is a design artifact only. It does not change Firestore Rules, Storage Rules, Functions, production data or app code. No Emulator tests have been run. No merge, production migration or deployment is authorized. Next: complete cross-app reader/writer inventory and convert the open items above into a field/role/API decision table for Founder review before Rules edits.
