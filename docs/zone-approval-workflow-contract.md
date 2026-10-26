# DOJO WALK Zone Approval Workflow — implementation contract

Status: design contract for PR #39; this document is not evidence that the callable workflow is implemented.

## Authority
- Central Admin (admin_users/{uid}.role == central_admin, active) owns Zone draft creation/editing, boundary preparation, submission, and operational follow-up.
- Founder/CEO (role == founder, active) is the sole business approver for approve, reject, or request-changes decisions.
- Technical super_admin does not implicitly receive Founder approval authority.
- Recheck actor role and active status inside every Firestore transaction.

## Zone workflow fields
- workflowStatus: draft | submitted | changes_required | rejected | approved | active | suspended | deactivated
- revision: monotonically increasing integer, incremented whenever approval-relevant Zone details or verified boundary changes.
- boundaryHash: SHA-256 of canonical verified polygon coordinates and boundary identity; computed server-side.
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
7. Central Admin may emergency-suspend an active Zone with a reason and audit record; notify Founder. Emergency suspension cannot activate/reactivate.
8. Reactivation after suspension requires current valid Founder approval and all backend readiness checks.

## Mandatory negative tests
- Unauthenticated and inactive actors are rejected.
- Super Admin cannot submit as Central Admin or approve as Founder.
- Central Admin cannot self-approve.
- Founder role is required for approval decisions.
- Missing, rejected, changes-required, stale-revision, or stale-boundary-hash approval blocks activation.
- Boundary change after approval invalidates approval.
- Direct activation callable bypass is impossible.
- State/District/City inactive flags alone do not block Zone activation when parents exist and ancestry/boundaries are valid.
- Parent ancestry mismatch, missing parent, invalid/unverified polygon, or polygon outside City blocks submission and activation.
- Emergency suspension records actor, reason, timestamp, and Founder notification marker; it never grants activation.
- Repeated decisions and activation requests cannot create duplicate or inconsistent transitions.

## Delivery gates
- Add server callables and transactional checks.
- Add emulator integration tests for each transition and negative case.
- Run Functions build, Geometry/Callable tests, and Firestore Rules tests on the exact final head SHA.
- Keep PR #39 Draft and unmerged until all gates pass. No production deployment is authorized by this spec.