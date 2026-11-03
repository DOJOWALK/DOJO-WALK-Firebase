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

const projectId = 'demo-dojo-zone-rules-tests';
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

// These remain explicit acceptance gates. They are enabled as callable tests
// only after the trusted Zone API and its Emulator Auth/Functions harness exist.
test.todo('Central Admin with zone-operation permission can create a Zone draft');
test.todo('Central Admin without boundary-review permission cannot review a boundary');
test.todo('boundary submitter cannot review their own submitted boundary');
test.todo('Founder allowlist UID can decide only the exact current approval request');
test.todo('legacy super_admin without Founder/Central authority cannot approve or activate');
test.todo('Area Manager access is limited to assigned City/Zone scope');
test.todo('same normalized Zone name is rejected within one City but allowed in another');
test.todo('stale boundary revision or hash cannot be approved or activated');
test.todo('idempotent retries return the original result and conflicting payload reuse fails');
test.todo('concurrent activation attempts produce one valid state transition');
