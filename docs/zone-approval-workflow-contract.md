# DOJO WALK Zone Approval Workflow — implementation contract

Status: implementation is present on PR #39. The PR description records the latest exact head SHA and its CI results; verify that SHA before relying on a validation result. Earlier CI passes on a prior commit are not evidence for a newer head. Keep the PR Draft and unmerged while final review continues; a passing CI run is not production approval.

## Authority
- Central Admin (admin_users/{uid}.role == central_admin, active) owns Zone draft creation/editing, boundary preparation, submission, and operational follow-up.
- Founder/CEO (role == founder, active) is the sole business approver for approve, reject, or request-changes decisions.
- Technical super_admin does not implicitly receive Founder approval authority.
- Technical super_admin also cannot create/edit Zone boundary drafts or perform boundary review; those Zone operations belong to Central Admin. Super Admin may retain technical/read access.
- Recheck actor role and active status inside every Firestore transaction.

## Zone workflow fields
- workflowStatus: draft | submitted | changes_required | rejected | approved | active | deactivation_submitted | deactivation_approved | reactivation_submitted | suspended | deactivated
- revision: monotonically increasing integer, incremented whenever approval-relevant Zone details or verified boundary changes.
- boundaryHash: SHA-256 of canonical verified polygon coordinates, boundary identity, and verification provenance; computed server-side.
- submittedRevision, submittedBoundaryHash, submittedBy, submittedAt
- approvalStatus, approvedRevision, approvedBoundaryHash, approvedBy, approvedAt, decisionNote
- isServiceActive remains the runtime switch; approval does not itself activate service.

## Required transitions
1. Central Admin saves a draft. New Zone starts inactive and unapproved.
2. Central Admin submits only after State → District → City ancestry and verified Zone polygon checks pass.
3. Founder may approve, reject, or request changes. Decision binds to Zone ID + current revision + current boundary hash. Duplicate/replayed decisions must be idempotent or rejected.
4. Any material Zone field or verified boundary change increments revision and invalidates prior submission/approval.
5. Central Admin can request activation only after Founder approval matches current revision and hash; backend rechecks boundary and canonical ancestry transactionally.
6. Parent State/District/City must exist and have canonical matching ancestry. Their legacy service-active flags must not be required for Zone activation.
7. Central Admin requests Zone deactivation with a reason; Founder approval is required before Central Admin executes deactivation. The request and decision bind to the current revision and boundary hash.
8. Central Admin may emergency-suspend an active Zone with a mandatory reason/severity, audit record, and durable Founder inbox notification. Emergency suspension cannot activate/reactivate. Push/email delivery is not configured by the callable.
9. Reactivation after emergency suspension requires Central Admin to submit a fresh request; the backend increments revision and hashes the current verified boundary. Founder must explicitly decide `reactivate` for that exact revision/hash, after which Central Admin separately activates through the normal readiness checks.

## Mandatory negative tests
- Unauthenticated and inactive actors are rejected.
- Super Admin cannot submit as Central Admin or approve as Founder.
- Central Admin cannot self-approve.
- Founder role is required for approval decisions.
- Missing, rejected, changes-required, stale-revision, or stale-boundary-hash approval blocks activation.
- Boundary change after approval invalidates approval.
- Direct activation callable bypass is impossible.
- State/District/City inactive flags alone do not block Zone activation when parents exist and ancestry/boundaries are valid.
- Parent ancestry mismatch, missing parent, or invalid/unverified Zone polygon blocks submission and activation. City polygon presence or geometric containment is not a prerequisite under POL-038 Option B.
- Emergency suspension records actor, reason, timestamp, and Founder notification marker; it never grants activation.
- Repeated decisions and activation requests cannot create duplicate or inconsistent transitions.

## Delivery gates
- Add server callables and transactional checks.
- Add emulator integration tests for each transition and negative case.
- Run Functions build, Geometry/Callable tests, and Firestore Rules tests on the exact final head SHA.
- Keep PR #39 Draft and unmerged until all gates pass. No production deployment is authorized by this spec.

## Callable implementation map (PR #39)
- `saveServiceLocationWithNameIndex`: Central Admin Zone draft create/edit; saves bump the revision and invalidate prior approval. Active Zones must be deactivated through the Founder-approved path before editing.
- `reviewServiceLocationBoundary`: verifies the Zone polygon and checks parent City hierarchy existence; City polygon containment is not required under POL-038 Option B; a newly verified Zone boundary bumps revision and invalidates prior approval.
- `submitServiceZoneForFounderReview`: Central Admin submission with server-computed SHA-256 boundary hash.
- `decideServiceZoneFounderApproval`: Founder-only approve/reject/request-changes decisions; also approves a submitted deactivation request.
- `activateServiceZone`: Central Admin activation only when the current revision and boundary hash have Founder approval.
- `requestServiceZoneDeactivation` + `setServiceLocationStatus`: Central Admin requests deactivation; Founder approves; Central Admin executes only if approval and current boundary hash still match.
- `suspendServiceZoneForEmergency`: Central Admin emergency-stops a Zone with a reason/severity, writes an audit entry, clears reusable activation approval, and queues a Founder inbox notification. It cannot activate or reactivate a Zone.

Emergency suspension is implemented as a Central Admin-only callable with mandatory reason and severity, durable Founder inbox notification record, approval-field invalidation, and audit entry. Reactivation requires a new Central Admin submission and explicit Founder `reactivate` decision tied to a newly incremented revision and current verified boundary hash. Automated push/email delivery is not configured by this callable; the notification is queued in Firestore for the Founder-facing admin inbox. Emulator integration coverage includes replayed submissions/decisions, stale revision/hash rejection, suspension bypass attempts, and the reactivation workflow. The exact head cited above passed the configured CI workflows; final security review and any required fixes must be validated on the new exact head before merge. No production deployment is authorized.
