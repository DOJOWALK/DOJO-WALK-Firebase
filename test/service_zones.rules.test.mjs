import fs from 'node:fs';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = 'demo-dojo-rules-tests';
const canonicalCollections = [
  'service_zones',
  'service_location_boundaries',
  'service_zone_approval_requests',
  'service_zone_name_indexes',
  'service_zone_audit',
];
const actorFixtures = [
  { uid: 'synthetic-founder', label: 'Founder allowlist actor' },
  { uid: 'synthetic-central-admin', label: 'Central Admin actor' },
  { uid: 'synthetic-boundary-reviewer', label: 'Boundary reviewer actor' },
  { uid: 'synthetic-area-manager', label: 'Area Manager actor' },
  { uid: 'synthetic-supervisor', label: 'Supervisor actor' },
  { uid: 'synthetic-legacy-super-admin', label: 'Legacy super_admin actor' },
  { uid: 'synthetic-walker', label: 'Walker actor' },
  { uid: 'synthetic-customer', label: 'Customer actor' },
];
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
    for (const collectionName of canonicalCollections) {
      await setDoc(doc(db, collectionName, 'fixture-record'), {
        fixtureOnly: true,
        status: 'draft',
        revision: 1,
      });
    }
  });
});

for (const actor of actorFixtures) {
  test(`canonical Zone records are server-write-only for ${actor.label}`, async () => {
    const db = env.authenticatedContext(actor.uid).firestore();

    for (const collectionName of canonicalCollections) {
      const ref = doc(db, collectionName, 'fixture-record');
      await assertFails(setDoc(doc(db, collectionName, 'forged-create'), {
        zoneId: 'forged-zone',
        status: 'active',
        isServiceActive: true,
        revision: 999,
        boundaryHash: 'client-forged-hash',
        founderDecision: 'approved',
        actorUid: actor.uid,
        auditActorUid: actor.uid,
      }));
      await assertFails(updateDoc(ref, {
        status: 'active',
        isServiceActive: true,
        revision: 999,
        boundaryHash: 'client-forged-hash',
        founderDecision: 'approved',
        actorUid: actor.uid,
        auditActorUid: actor.uid,
      }));
      await assertFails(deleteDoc(ref));
    }
  });
}

test('unauthenticated clients cannot create canonical Zone lifecycle records', async () => {
  const db = env.unauthenticatedContext().firestore();
  for (const collectionName of canonicalCollections) {
    await assertFails(setDoc(doc(db, collectionName, 'unauthenticated-forgery'), {
      status: 'active',
      isServiceActive: true,
    }));
  }
});

// Canonical Zone lifecycle acceptance gates live in
// functions/test/zone_lifecycle_acceptance.test.cjs and run under the
// Auth + Functions + Firestore Emulator harness (npm run test:zone-emulator).
// Keep this Rules suite focused on direct client access: canonical Zone
// collections are server-write-only; callable authorization/state transitions
// are asserted by the dedicated Functions acceptance suite.
