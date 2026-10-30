# DOJO WALK Role × Action Permission Matrix — Draft

**Date:** 2026-10-30  
**Status:** Draft for Founder / Security / Operations approval — NOT approved, implemented or tested  
**Policy sources reviewed:** POL-021 Access Control, Admin Roles & Privileged Account Security; POL-037 India City–Zone Operating Structure; POL-004 Walker / Partner Management; POL-007 Walk Lifecycle & Live Tracking. Source policies are drafts; this matrix is a proposal, not a grant of access.

## 1. Mandatory authorization formula

Allow an action only when all checks pass:

`active account AND authenticated identity AND approved role AND assigned scope AND permitted action AND valid record state AND required approval`

- Deny by default if any check or required scope is missing.
- Enforce in backend/Firestore Rules/Functions/API for every read and write. Hiding a button is not authorization.
- Derive actor UID and role from trusted authentication/role records, never from client payload.
- Scope City Manager to one assigned City and its approved Zones; Zone Supervisor to one assigned Zone; Walker to own profile and current assigned work.
- A person temporarily covering multiple duties must have explicit recorded role/scope grants and must not self-approve a critical action.
- Super Admin is a technical privileged-access role, not a routine operations role and not automatically a Finance Approver or Founder.

## 2. Role definitions

| Role | Default scope | Core purpose | Explicit non-assumption |
|---|---|---|---|
| Founder / CEO | Company-wide oversight | Major policy, budget limits, senior appointments, material risk and city/zone expansion GO/NO-GO | Does not routinely dispatch bookings or need unrestricted access to every customer detail |
| Super Admin | Technical/security administration | Admin account and role administration, technical configuration, security/audit access under controlled process | Not automatically Central Operations, Founder, Finance Approver or zone operator |
| Central Head / Central Operations | Cross-city operations | City Manager oversight, cross-city staffing/support, quality, escalation and consolidated reporting | Cannot grant self Super Admin or bypass backend controls |
| City Manager | One assigned City and approved child Zones | Daily city operations, Zone Supervisor oversight, city capacity, bookings and complaints | No access to another City without explicit scope grant |
| Zone Supervisor | One assigned active Service Zone | Local Walker readiness/availability, booking readiness, lateness/no-show and local incident escalation | No cross-zone access by default |
| Walker / Partner | Own profile and assigned/accepted walks only | Perform work, submit permitted operational evidence and report incidents | Cannot change price, booking assignment, service coverage, payout or authoritative status |
| Support | Assigned support cases / minimum necessary customer data | Customer communication, case logging and escalation | No unrestricted GPS history, role grants, payment approvals or bulk export |
| Finance | Approved payment/refund/reconciliation resources | Payment, refund, payout and reconciliation | No self-approval; operational roles do not inherit finance authority |
| Location Preparer | Explicit location records assigned | Prepare geographic/service-zone records | Cannot approve own revision |
| Location Reviewer / Verifier | Explicit assigned review scope | Independently verify boundaries/data | Cannot activate unless separately granted |
| Service Identity | Specific runtime/function resource | Machine-to-machine work with minimum IAM permissions | Never a human login; no broad owner credentials |

## 3. Legend

- **A** — May perform, subject to record-state validation and audit.
- **R** — Read only, limited to the stated scope and minimum necessary fields.
- **Req** — May request/submit; a separate authorized role/backend must approve or execute.
- **Appr** — Approval authority only where the relevant policy explicitly delegates it.
- **—** — No default permission.
- **Conditional** — Not granted until Founder-approved delegation, scope and backend enforcement exist.

A role label alone never grants access. All A/R/Req/Appr entries are proposals pending approval and implementation.

## 4. Company governance and access actions

| Action | Founder / CEO | Super Admin | Central Ops | City Manager | Zone Supervisor | Walker | Support | Finance |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| View company-wide summary reports | R | R security only | R | — | — | — | — | R finance summary |
| Approve major policy / budget / risk / expansion | Appr | — | Req | — | — | — | — | Req finance impact |
| Manage Admin user roles / privileged accounts | Oversight R | A (controlled) | Req | — | — | — | — | — |
| Grant/revoke Super Admin | Appr (two-person controlled process) | Req / technical execution only | — | — | — | — | — | — |
| Cross-city operational monitoring | R | — | A/R | — | — | — | Conditional case view | — |
| Assign/review City Manager | Appr | — | Req / operational recommendation | — | — | — | — | — |
| City-level staffing and performance | R summary | — | A/R | A/R own City | R own Zone | R own record | — | — |
| Zone-level daily operations | R summary | — | A/R | A own City | A own Zone | R own assigned job | Req case | — |
| Cross-city escalation | Appr major risk | — | A | Req | Req | Req | Req | Req finance issue |
| Production deployment approval | Appr per release gate | Technical controls only | Req operational readiness | — | — | — | — | — |
| Emergency break-glass access | Appr/review | A only if separately authorized, time-limited and logged | Req | Req | Req | — | — | — |

**Separation of duties:** Super Admin role changes, production access, refunds, payouts, zone approval/activation and serious incident closure should use independent approval where practical. Founder oversight does not mean the Founder must perform routine system administration.

## 5. Booking, assignment and walk actions

| Action | Founder / CEO | Super Admin | Central Ops | City Manager | Zone Supervisor | Walker | Support |
|---|---:|---:|---:|---:|---:|---:|---:|
| View all-city booking exception summary | R | — | R | — | — | — | — |
| View booking details | — | — | R minimum necessary | R own City | R own Zone | R assigned booking | R assigned case, minimized |
| Create customer booking | — | — | — | — | — | — | — |
| Run automated eligibility / assignment | — | — | Backend only / monitor | — | — | — | — |
| Manually request reassignment | — | — | A/Req per approved policy | Req own City | Req own Zone | Req support only | Req |
| Approve/execute manual reassignment | — | — | A within approved rules | Conditional own City | Conditional own Zone | — | — |
| Accept/decline own offer | — | — | — | — | — | A own offer | — |
| Start own assigned walk | — | — | — | — | — | A via backend guard | — |
| Pause/resume own walk | — | — | — | — | — | Conditional: only if POL-007 enables it | — |
| Submit GPS for own active walk | — | — | Backend ingestion/monitor | — | — | A via validated endpoint | — |
| Complete own walk with safe handover | — | — | Monitor/escalate | — | — | A via backend guard | — |
| Override lifecycle state | — | — | Conditional, explicit audited exception only | — | — | — | — |
| Cancel customer booking | — | — | Per cancellation policy | Req/escalate | Req/escalate | Req/escalate | Req/case |
| View precise live GPS | — | — | R for active exception handling, need-to-know | R own City active operations | R own Zone active operations | R own current device/session | — |
| View historical route | — | — | Conditional, approved incident/audit need | Conditional, own City and case | Conditional, own Zone and case | Own permitted records only | — |
| Mark incident active / report | — | — | A | A own City | A own Zone | A own walk | Req/A case intake |
| Close serious incident | Appr only if policy delegates | — | A/Appr with independent review | Req | Req | — | Req |

The backend must remain authoritative for start, completion, handover, assignment and GPS ingestion. Operational staff may monitor and escalate; they must not silently edit route points or force-complete a walk.

## 6. Walker management actions

| Action | Founder / CEO | Super Admin | Central Ops | City Manager | Zone Supervisor | Support |
|---|---:|---:|---:|---:|---:|---:|
| View national Walker metrics | R | — | R | — | — | — |
| View Walker profile | — | — | R minimum necessary | R own City | R own Zone | R limited case |
| Review application/documents | — | — | A/assign reviewer | A own City if delegated | Req | — |
| Approve/reject onboarding | — | — | A per POL-004 delegation | Conditional own City | Req | — |
| Change Walker verification/security status | — | Technical account security only | A per policy | Conditional | Req | — |
| Suspend for immediate safety risk | — | — | A per approved incident authority | Conditional own City | Req emergency escalation | Req |
| Reinstate after investigation | Appr only if designated | — | A with independent review | Req | — | — |
| Change Walker city/zone scope | — | — | A with approved workflow | Req own City | Req own Zone | — |
| Edit own availability | — | — | — | — | — | — |
| View own earnings statement | — | — | — | — | — | — |

Exact onboarding, rejection, suspension, reinstatement, scope-change and appeal authority must be reconciled with POL-004 and POL-021 before implementation.

## 7. Finance and sensitive-data separation

| Action | Founder / CEO | Super Admin | Central Ops | City Manager | Zone Supervisor | Walker | Finance |
|---|---:|---:|---:|---:|---:|---:|---:|
| View consolidated financial report | R | — | R summary | — | — | — | R |
| View individual payout statement | — | — | — | — | — | R own | R |
| Prepare refund / payout adjustment | — | — | Req | Req | Req | Req own dispute | A |
| Approve refund / payout adjustment | Appr above policy threshold / major risk | — | Appr within separately approved limit | — | — | — | Appr within delegated limit |
| Execute payment/refund | — | — | — | — | — | — | A through approved provider |
| Reconcile settlement | R summary | — | — | — | — | R own statement | A |
| Change payment gateway secrets | Oversight | A technical secret control with separate approval | — | — | — | — | Req |
| Export financial/customer PII | Appr only with documented need | — | Conditional | — | — | Own statement only | Conditional restricted |

No threshold or financial approval delegation is set by this document. Existing refund threshold discussions must be confirmed against the current approved finance policy before coding.

## 8. Service Zone governance actions

| Action | Founder / CEO | Super Admin | Central Ops | City Manager | Zone Supervisor | Location Preparer | Reviewer |
|---|---:|---:|---:|---:|---:|---:|---:|
| Create City/Zone draft | — | — | A | Req | Req | A if assigned | — |
| Edit unsubmitted Zone draft | — | — | A | A own City if delegated | Req own Zone | A assigned | — |
| Submit Zone revision for review | — | — | A | Req | Req | A | — |
| Verify polygon / locality / address tests | — | — | R | R | R | — | A |
| Approve launch readiness / GO-NO-GO | Appr | — | Req / evidence pack | Req | Req | — | Req |
| Activate approved Zone | — | — | A only after Founder GO and backend recheck | — | — | — | — |
| Suspend Zone for operational emergency | Oversight | Technical safeguard only | A | A own City if delegated | Req urgent | — | — |
| Reactivate Zone | Appr GO if required by policy | — | A after corrective evidence and recheck | Req | Req | — | A verify |
| Change boundary after approval | Appr material revision | — | Req / submit new revision | Req | Req | A draft only | A independent verification |

This table follows POL-037's separation: Founder records GO/NO-GO for exact Zone revision; Central Operations performs activation as a separate action after backend checks. Super Admin is not the Founder approver. Existing technical zone schema and actual role IDs still require verification.

## 9. Backend authorization claims to implement

For every protected request, backend must validate:
1. Firebase Auth UID exists and account is active.
2. Role is read from a trusted, protected role record; no client-supplied role.
3. Role is active and has the requested action.
4. Geographic scope is assigned and active.
5. Target booking/walk/Walker/Zone belongs to that scope.
6. Target record is in a state where the action is legal.
7. Required reason, evidence, second approval or re-authentication exists.
8. Request is idempotent where retry/race is possible.
9. Write and immutable audit event are atomic where one transition requires both.
10. Failure is denied without partial mutation; response does not leak unrelated records.

Use explicit permission identifiers such as `booking.read.city`, `walk.start.assigned`, `walk.complete.assigned`, `walker.approve.city`, `zone.activate.central`, `admin.role.manage`, `finance.refund.approve`. Final identifiers and role bindings are not yet approved.

## 10. Required negative and positive tests

- Unauthenticated caller denied for every protected action.
- Inactive admin denied even if UI route is known.
- Super Admin cannot perform Central Operations/Finance action merely by having technical role.
- Central Operations can view permitted cross-city operational summary but cannot grant itself Super Admin.
- City Manager for City A cannot read or mutate City B booking, Walker, incident, route or Zone.
- Zone Supervisor for Zone A cannot access Zone B, even within same City.
- Walker cannot read another Walker's profile, booking or GPS history.
- Support cannot read precise route or payout secrets outside an assigned case.
- Finance cannot alter walk state or assign a Walker.
- Location preparer cannot approve their own Zone revision.
- Founder GO on revision N does not authorize activation of changed revision N+1.
- Zone activation fails unless exact revision has approval and verified boundary.
- Client cannot forge actor UID, role, timestamp, scope or audit event.
- Direct REST/SDK calls are denied consistently with UI permissions.
- Emergency exception is time-limited, reasoned, audited and reviewed.
- All denied transactions leave protected records unchanged.

Record environment, commit, test command/run ID, expected/actual result, evidence and retest. No PASS claim without execution.

## 11. Decisions needed before implementation

1. Founder approval of the role model and exact delegated actions.
2. Confirm whether Central Head and Central Operations are one role or separate roles.
3. Confirm City Manager / Zone Supervisor appointment and temporary multi-role coverage process.
4. Approve action-level authority for Walker approval, rejection, suspension, reinstatement and reassignment.
5. Approve exact Finance roles, refund/payout thresholds, dual-control and payment execution separation.
6. Approve location creator/reviewer/Founder GO/Central activation workflow and emergency suspension.
7. Approve precise GPS and incident access rules by role and purpose.
8. Map role names to Firebase custom claims / protected documents / Rules / Functions and Admin UI.
9. Approve review cadence, revocation SLA, break-glass owner and privileged-account MFA.
10. Confirm all city/zone scope grants and test data.

## 12. Release gate

**NO-GO for production authorization changes** until the role matrix is approved, mapped to real identities/scopes, implemented server-side, and passes positive and negative emulator/integration tests. No role should receive a permission simply because a UI menu exists.

No source code, Firestore Rules, Functions, Firebase data, GitHub access, or production settings were changed by this document.
