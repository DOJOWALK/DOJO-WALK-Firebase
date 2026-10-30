import fs from 'node:fs';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

const projectId = 'demo-dojo-walker-lifecycle-rules';
let env;

const initialWalker = {
  userId: 'walker-1',
  fullName: 'Test Walker',
  phone: '9999999999',
  dateOfBirth: new Date('1995-01-01T00:00:00Z'),
  status: 'under_review',
  isActive: false,
  isApproved: false,
  verificationStatus: 'pending',
  applicationSubmitted: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

before(async () => {
  const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'admin_users/super-active'), {
      role: 'super_admin',
      isActive: true,
    });
    await setDoc(doc(db, 'admin_users/super-inactive'), {
      role: 'super_admin',
      isActive: false,
    });
    await setDoc(doc(db, 'admin_users/support-active'), {
      role: 'support',
      isActive: true,
    });
    await setDoc(doc(db, 'walkers/walker-1'), initialWalker);
  });
});

function adminDb(uid = 'super-active') {
  return env.authenticatedContext(uid).firestore();
}

function walkerDecision(overrides = {}) {
  return {
    status: 'approved',
    verificationStatus: 'verified',
    isApproved: true,
    isActive: true,
    updatedAt: serverTimestamp(),
    decisionBy: 'super-active',
    decisionAt: serverTimestamp(),
    ...overrides,
  };
}

test('active super admin can approve a submitted walker', async () => {
  await assertSucceeds(
    updateDoc(doc(adminDb(), 'walkers/walker-1'), walkerDecision()),
  );
});

test('active super admin can reject a submitted walker with a reason', async () => {
  await assertSucceeds(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({
        status: 'rejected',
        verificationStatus: 'rejected',
        isApproved: false,
        isActive: false,
        decisionReason: 'KYC details could not be verified.',
      }),
    ),
  );
});

test('active super admin can request correction with a reason', async () => {
  await assertSucceeds(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({
        status: 'correction_required',
        verificationStatus: 'correction_required',
        isApproved: false,
        isActive: false,
        decisionReason: 'Please upload a clearer identity document.',
      }),
    ),
  );
});

test('active super admin can suspend an approved verified walker', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'walkers/walker-1'), {
      ...initialWalker,
      status: 'approved',
      verificationStatus: 'verified',
      isApproved: true,
      isActive: true,
    });
  });

  await assertSucceeds(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({
        status: 'suspended',
        verificationStatus: 'verified',
        isApproved: true,
        isActive: false,
        decisionReason: 'Safety review pending.',
      }),
    ),
  );
});

test('active super admin can reactivate a suspended verified walker', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'walkers/walker-1'), {
      ...initialWalker,
      status: 'suspended',
      verificationStatus: 'verified',
      isApproved: true,
      isActive: false,
    });
  });

  await assertSucceeds(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision(),
    ),
  );
});

test('inactive super admin and active non-super-admin cannot decide walkers', async () => {
  await assertFails(
    updateDoc(
      doc(adminDb('super-inactive'), 'walkers/walker-1'),
      walkerDecision(),
    ),
  );
  await assertFails(
    updateDoc(
      doc(adminDb('support-active'), 'walkers/walker-1'),
      walkerDecision(),
    ),
  );
});

test('walker decision cannot claim another actor UID', async () => {
  await assertFails(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({ decisionBy: 'someone-else' }),
    ),
  );
});

test('walker decision rejects invalid status combinations and unknown fields', async () => {
  await assertFails(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({
        status: 'approved',
        verificationStatus: 'pending',
      }),
    ),
  );
  await assertFails(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({ unexpectedAdminField: true }),
    ),
  );
  await assertFails(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({ status: 'not_a_real_status' }),
    ),
  );
});

test('walker decision reason is limited to 1000 characters', async () => {
  await assertFails(
    updateDoc(
      doc(adminDb(), 'walkers/walker-1'),
      walkerDecision({ decisionReason: 'x'.repeat(1001) }),
    ),
  );
});

test('walker audit event allow-list accepts all five lifecycle events', async () => {
  const db = adminDb();
  const actions = [
    'walker_approved',
    'walker_rejected',
    'walker_suspended',
    'walker_reactivated',
    'walker_correction_requested',
  ];

  for (const action of actions) {
    await assertSucceeds(
      setDoc(doc(db, `audit_logs/${action}`), {
        actorUid: 'super-active',
        actorRole: 'super_admin',
        action,
        targetType: 'walker',
        targetId: 'walker-1',
        beforeStatus: 'under_review',
        afterStatus: 'approved',
        beforeVerificationStatus: 'pending',
        afterVerificationStatus: 'verified',
        beforeIsApproved: false,
        afterIsApproved: true,
        beforeIsActive: false,
        afterIsActive: true,
        createdAt: serverTimestamp(),
      }),
    );
  }
});

test('walker audit log rejects unknown event names and mismatched actor UID', async () => {
  const db = adminDb();
  await assertFails(
    setDoc(doc(db, 'audit_logs/unknown-event'), {
      actorUid: 'super-active',
      actorRole: 'super_admin',
      action: 'walker_deleted',
      targetType: 'walker',
      targetId: 'walker-1',
      createdAt: serverTimestamp(),
    }),
  );

  await assertFails(
    setDoc(doc(db, 'audit_logs/wrong-actor'), {
      actorUid: 'someone-else',
      actorRole: 'super_admin',
      action: 'walker_approved',
      targetType: 'walker',
      targetId: 'walker-1',
      createdAt: serverTimestamp(),
    }),
  );
});

test('walker audit records cannot be edited or deleted', async () => {
  const db = adminDb();
  await assertSucceeds(
    setDoc(doc(db, 'audit_logs/immutable-event'), {
      actorUid: 'super-active',
      actorRole: 'super_admin',
      action: 'walker_approved',
      targetType: 'walker',
      targetId: 'walker-1',
      createdAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(db, 'audit_logs/immutable-event'), {
      reason: 'changed later',
    }),
  );
  await assertFails(
    env.authenticatedContext('super-active').firestore()
      .doc('audit_logs/immutable-event').delete(),
  );
});
