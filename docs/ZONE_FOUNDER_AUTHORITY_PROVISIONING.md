# Founder Zone Authority Provisioning Runbook

## Purpose

Provision the Founder/CEO's Zone-wide read authority without allowing a client,
legacy role, email address, or user-editable claim to grant that authority.

## Security rule

The Zone visibility resolver trusts only the server-managed document:

`founder_users/{firebaseAuthUid}`

It does **not** infer Founder authority from `admin_users/{uid}.role = super_admin`,
custom Auth claims, a client-supplied UID, or an email address.

There is no public callable endpoint for creating or editing Founder authority.

## Required document

Create the document using a trusted administrative identity with Firestore write
permission. The document ID must be the exact UID copied from the intended
Founder account in Firebase Authentication; do not use an email address.

```json
{
  "authorityType": "founder_ceo",
  "isActive": true,
  "permissions": {
    "zoneGeometryReadAll": true
  },
  "provisionedBy": "<trusted-operator-uid>",
  "provisioningReason": "Initial Founder/CEO Zone visibility authority",
  "createdAt": "<server timestamp>",
  "updatedAt": "<server timestamp>"
}
```

## Controlled procedure

1. Confirm the Firebase project ID and environment before opening any console or
   running any administrative command. Emulator work must use a `demo-*` project.
2. Locate the intended Founder account in Firebase Authentication and copy its
   immutable UID. Independently verify the account with the Founder.
3. Have an authorized operator with narrowly scoped administrative access create
   `founder_users/{uid}` with the fields above. Use server timestamps, not a
   client-provided timestamp.
4. Record the operator, UID, reason, timestamp, and approval in the organization's
   privileged-access change log. Do not put credentials or tokens in the log.
5. Verify in the Firebase Emulator using a synthetic Founder fixture that:
   - the active Founder document grants Zone-wide listing and geometry access;
   - an inactive Founder document is denied;
   - a legacy `super_admin` without a Founder document is denied;
   - Auth custom claims alone are denied.
6. After production provisioning is separately authorized, verify the intended
   account through the application's callable endpoint and review the access
   audit event. Do not test by exposing polygon data in client logs.

## Revocation

Set `isActive: false` (or remove the document under the organization's
privileged-access procedure) using a trusted administrative identity. Verify
that the next callable request is denied. Preserve the change record.

## Not included

This runbook does not provision or modify any production account. No production
UID is assumed or embedded in source control. Production provisioning requires
the exact verified Firebase Auth UID and explicit authorization from the owner.
