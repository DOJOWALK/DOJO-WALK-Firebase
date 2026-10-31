import fs from 'node:fs';
import path from 'node:path';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const projectId = 'demo-dojo-working-schedule-rules';
const walkerUid = 'walker-owner';
let env;

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
    await setDoc(doc(db, `walkers/${walkerUid}`), {
      userId: walkerUid,
      fullName: 'Test Walker',
      phone: '9999999999',
      dateOfBirth: new Date('1995-01-01T00:00:00.000Z'),
      status: 'approved',
      isActive: true,
      isApproved: true,
      verificationStatus: 'verified',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });
});

test('walker owner cannot save Partner workingSchedule using merge set', async () => {
  const db = env.authenticatedContext(walkerUid).firestore();
  const schedule = {
    status: 'active',
    days: {
      monday: { enabled: true, start: '7:00 AM', end: '7:00 PM' },
      tuesday: { enabled: false, start: '7:00 AM', end: '7:00 PM' },
    },
  };

  // Mirrors the Partner app's set(..., SetOptions(merge: true)) write shape.
  await assertFails(setDoc(
    doc(db, `walkers/${walkerUid}`),
    { workingSchedule: schedule, updatedAt: serverTimestamp() },
    { merge: true },
  ));
});

test('walker owner can still update the legacy allowlisted availability field', async () => {
  const db = env.authenticatedContext(walkerUid).firestore();
  await assertSucceeds(setDoc(
    doc(db, `walkers/${walkerUid}`),
    {
      availability: { monday: true },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ));
});
