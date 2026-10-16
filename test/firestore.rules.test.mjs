import fs from 'node:fs';
import path from 'node:path';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const projectId = 'demo-dojo-rules-tests';
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
    await setDoc(doc(db, 'admin_users/super-active'), {
      role: 'super_admin', isActive: true,
    });
    await setDoc(doc(db, 'admin_users/super-inactive'), {
      role: 'super_admin', isActive: false,
    });
    await setDoc(doc(db, 'admin_users/support-active'), {
      role: 'support', isActive: true,
    });
    await setDoc(doc(db, 'service_location_boundaries/city-boundary'), {
      locationId: 'city-1',
      locationType: 'city',
      points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }],
      sourceType: 'governmentGis',
      sourceName: 'Test official source',
      sourceReference: 'TEST-REF-1',
      verificationStatus: 'verified',
      verifiedBy: 'super-active',
      verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
});

test('unauthenticated reads and writes to service locations are denied', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'service_countries/country-1')));
  await assertFails(setDoc(doc(db, 'service_countries/country-1'), {
    name: 'India', code: 'IN', isActive: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('active super_admin can create a valid country', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertSucceeds(setDoc(doc(db, 'service_countries/india'), {
    name: 'India', code: 'IN', isActive: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('inactive super_admin and active support role cannot write service locations', async () => {
  const inactiveDb = env.authenticatedContext('super-inactive').firestore();
  const supportDb = env.authenticatedContext('support-active').firestore();
  const country = {
    name: 'India', code: 'IN', isActive: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(inactiveDb, 'service_countries/inactive-attempt'), country));
  await assertFails(setDoc(doc(supportDb, 'service_countries/support-attempt'), country));
});

test('city cannot be activated without a verified matching boundary', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_cities/city-1'), {
    countryId: 'india', stateId: 'up', name: 'Example City',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('city can be activated when its referenced boundary is verified and matches', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertSucceeds(setDoc(doc(db, 'service_cities/city-1'), {
    countryId: 'india', stateId: 'up', name: 'Example City',
    verifiedBoundaryId: 'city-boundary',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('city cannot use a verified boundary belonging to a different location', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_cities/city-2'), {
    countryId: 'india', stateId: 'up', name: 'Other City',
    verifiedBoundaryId: 'city-boundary',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('verified boundary cannot be edited or deleted', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(updateDoc(doc(db, 'service_location_boundaries/city-boundary'), {
    sourceName: 'Changed source',
  }));
  await assertFails(deleteDoc(doc(db, 'service_location_boundaries/city-boundary')));
});
