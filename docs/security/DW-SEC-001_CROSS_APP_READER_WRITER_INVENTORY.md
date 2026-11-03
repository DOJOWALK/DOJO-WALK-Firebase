# DW-SEC-001 — Cross-App Walker Reader/Writer Inventory
**Status:** Read-only source inventory; not a runtime or production-data audit.  
**Date:** 2026-11-03  
**Branch receiving this document:** `feat/dw-sec-001-walker-data-separation`

## 1. Evidence snapshot inspected

| App / source | Revision or blob SHA | Purpose inspected |
|---|---|---|
| Partner `lib/screens/home/profile_screen.dart` | blob `7a8be25665a9e527e2991e2da41d093cd4fbdd04`; source snapshot `1e8a6f98daccae2881111daa608cf44ca66c74a1` | Walker self-profile reader |
| Partner `lib/features/onboarding/screens/kyc_documents_screen.dart` | blob `d10ff6cf2d66e4a78f860776fa70ec23cea92aab`; same source snapshot | KYC upload and parent Walker write |
| Partner `lib/features/onboarding/screens/review_submit_screen.dart` | blob `17aaedef0c04ee7956bb6260a05cc7f1d7f3380d`; same source snapshot | Onboarding review reader and KYC/address display |
| Customer `lib/features/booking/screens/booking_confirmation_screen.dart` | blob `94d45b12c7873fc2d289e164df965c735c0c63cb`; source snapshot `4a50ccd29aa1354c6478ac6e2c32c7213acec18d` | Booking create writer |
| Customer `lib/features/booking/screens/my_bookings_screen.dart` | blob `76483699c4ad5c664290f8d135e8ee0e13a90bc0`; same source snapshot | Customer booking list/details reader |
| Admin `lib/features/walkers/services/walker_admin_service.dart` | blob `d87d248ff8cc7f1b265c0db0c8f5abd52b6a3eb5` | Walker admin stream/read and approval lifecycle |
| Firebase `firestore.rules` | blob `9bac26b9e13a97d412a0154ec9af70629e82eb47` | Canonical Rules baseline from Firebase branch |

The exact source revisions are recorded so later changes can be compared. This inventory is limited to these inspected files and the previously documented Rules audit; it is not a claim that every repository file, deployed function, or live document was inspected.

## 2. Observed read/write contracts

### Partner self-profile
- Reads `walkers/{auth.uid}` directly.
- Reads `fullName`, `walkerId`, `zoneName`, `services`, `rating`, and `phone`.
- Displays name, Partner ID, primary zone, service, rating and mobile number to the owning Walker.
- Migration requirement: preserve owner self-profile functionality, but move fields to their canonical destination and ensure owner reads do not imply access to other Walkers' private data.

### Partner KYC submission
- Reads own `walkers/{auth.uid}` to confirm the profile exists.
- Uploads Aadhaar front/back and PAN images to `walker_documents/{uid}/{key}_{timestamp}.jpg`.
- Writes `walkers/{uid}` with nested `kyc.documents.{aadhaar_front|aadhaar_back|pan_card}`, each containing `status`, `storagePath`, and `submittedAt`; updates `updatedAt`.
- Migration requirement: retain current private Storage path and upload flow during transition; move KYC metadata to a restricted KYC record only after a compatible API/data migration is designed and tested.

### Partner onboarding review
- Reads the full own `walkers/{auth.uid}` document.
- Reads top-level profile/onboarding attributes and nested `currentAddress`, `kyc.documents.*.storagePath/status`, `kyc.selfie.storagePath/status`, and `zoneNames` with legacy fallback to `zoneName`.
- Uses private Storage paths to display submitted photos in the review screen.
- Migration requirement: provide a controlled owner/reviewer view or backend response so the Partner app can complete its own onboarding and correction flow without broad access to unrelated private categories. Do not break selfie/document preview.

### Customer booking create
- Reads the selected customer's own `users/{uid}/pets/{dogId}`.
- Creates `bookings/{bookingId}` directly from the client.
- Observed fields include `bookingId`, `customerId`, `walkType`, `bookingPlan`, `serviceType`, `serviceName`, `petName`, `dogId`, `petDetails`, `pickupAddressId`, `pickupAddress`, `scheduledAt`, `duration`, `preferredTime`, `walkCount`, `walkSchedules`, `status: pending`, `walkerId: null`, `cancelRequest: null`, `createdAt`; conditional regular/selected-date schedule fields are also written.
- This inspected booking writer does not assign a Walker or write a Walker public-profile projection.

### Customer booking list/details
- Reads Customer booking documents and displays booking status/schedule details; the inspected file reads the `walkerId` field for booking presentation.
- No direct read of `walker_public_profiles` was identified in this inspected file. Do not assume there is already a customer-facing Walker profile endpoint; search the remaining Customer screens before adding one.

### Admin Walker service
- Streams the full `walkers` collection and individual Walker documents.
- Reads bookings, bookings filtered by `walkerId`, and Walker-related `audit_logs`.
- Executes approve/reject/suspend/reactivate/correction actions using a transaction that updates Walker lifecycle state and writes an audit record.
- Migration requirement: Admin list/review screens must be split by operational need. KYC evidence should be available only to Verifier scope; Finance and Emergency fields must not arrive as part of a generic Walker model/list stream. Approval and audit atomicity must be preserved.

## 3. Security and compatibility risks confirmed by source review

1. Partner's existing self-profile and review screens expect one parent Walker document; splitting data requires an explicit Partner API/read-model transition.
2. KYC upload writes nested metadata into the parent Walker document even though the actual image objects are stored in private Storage. This must be moved with an idempotent mapping and preview regression tests.
3. Admin's generic `watchWalkers()` maps entire Walker documents into `WalkerAdminModel`; the model and screens must be audited to remove private categories from generic list/read payloads.
4. Customer booking writer sets `walkerId: null` at request creation; assignment is a later workflow. Public Walker data must be withheld until a trusted source confirms assignment.
5. The inspected Customer booking UI evidence does not establish a customer-facing assigned Walker detail reader. Search all Customer code and backend response paths before designing that UI/API integration.
6. Firebase canonical Rules baseline allows a signed-in user to get an active+approved `walkers/{uid}` document. Since Firestore does not redact fields per read, the parent document must not remain generally readable.
7. Current Rules baseline has a parent Walker allowlist that includes sensitive-capable keys such as `kyc`, `documents`, `bankDetails`, `emergencyContact`, `fcmToken` and `deviceTokens`. An allowlist is not evidence that every key exists in production.
8. Partner's separate Rules copy has nested Walker subcollection behavior that differs from the canonical Firebase Rules source. Firebase `firebase.json` identifies the Firebase repository Rules file as the deploy source; do not treat the Partner copy as deployed policy.

## 4. Reader/writer mapping still required

Before schema or Rules edits, inspect and record:
- Partner personal-details, address, zone selection, availability, earnings, notification/device registration, selfie upload and correction/replacement screens.
- Admin Walker list/detail/KYC review, finance/payout, emergency/support and export paths; inspect `WalkerAdminModel` field parsing and all screens consuming it.
- Customer search for every `walkers`, `walkerId`, Walker name/photo/contact and assigned booking detail access.
- Firebase Functions, scheduled jobs, triggers, scripts and callable endpoints that read/write Walker records or approval/assignment state.
- Any external finance/support workflow or vendor integration using Walker fields.
- Storage read/download call sites and any legacy URL persistence.

For each use, record: app/function, file+commit, collection/path, fields read, fields written, actor, purpose, role/scope, migration owner, compatibility requirement and regression test.

## 5. Safe migration sequence

1. Finish read-only reader/writer inventory; do not read/export production personal values.
2. Define canonical field names and types, mapping all legacy aliases and nested structures.
3. Freeze role IDs, geographic scope representation and action matrix against POL-021.
4. Freeze KYC correction/replacement and owner-self-view API contracts.
5. Approve retention/deletion schedule under POL-014/POL-020 before retention jobs are implemented.
6. Prepare synthetic fixtures, dry-run, backup proof, idempotency, conflict handling, rollback and post-migration reconciliation.
7. Implement in this feature branch and run Emulator plus Partner/Admin/Customer regression tests.
8. Request separate production migration/deployment approval only after evidence review.

## 6. Current status

Read-only source inspection only. No app source, Firestore Rules, Storage Rules, Functions or production data was modified. No tests were run. This document does not assert production field prevalence or deployed Rules parity. Exact private schemas, role identifiers/scopes, emergency access mechanics, retention periods, final API contract and migration/rollback remain open.
