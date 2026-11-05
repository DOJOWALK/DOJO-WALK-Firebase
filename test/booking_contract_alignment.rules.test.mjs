import fs from 'node:fs';
import path from 'node:path';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

// Characterization tests: these intentionally record the current Rules contract.
// They do NOT claim the proposed canonical Booking contract is implemented.
const projectId = 'demo-dojo-booking-contract';
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
});

function canonicalBooking(bookingId) {
  return {
    bookingId,
    customerId: 'synthetic-customer',
    bookingPlan: 'one_time',
    serviceType: 'temporary_walk',
    dogId: 'synthetic-dog',
    dogName: 'Milo',
    dogDetails: {
      breed: 'Indie',
      age: '3 years',
      size: 'medium',
    },
    pickupAddressId: 'synthetic-address',
    pickupAddress: {
      line1: 'Synthetic address only',
      latitude: 28.5,
      longitude: 77.3,
    },
    scheduledAt: Timestamp.fromDate(new Date('2026-11-10T01:00:00.000Z')),
    timeZone: 'Asia/Kolkata',
    serviceDateKey: '2026-11-10',
    durationMinutes: 30,
    status: 'pending',
    walkerId: null,
    cancelRequest: null,
    walkCount: 1,
    walkSchedules: [{ duration: 30, time: '06:30' }],
    createdAt: serverTimestamp(),
  };
}

function currentLegacyBooking(bookingId) {
  return {
    bookingId,
    customerId: 'synthetic-customer',
    walkType: 'scheduled',
    bookingPlan: 'one_time',
    serviceType: 'temporary_walk',
    serviceName: 'One-time Walk',
    petName: 'Milo',
    dogId: 'synthetic-dog',
    petDetails: { breed: 'Indie', age: '3 years', size: 'medium' },
    pickupAddressId: 'synthetic-address',
    pickupAddress: {
      line1: 'Synthetic address only',
      latitude: 28.5,
      longitude: 77.3,
    },
    scheduledAt: Timestamp.fromDate(new Date('2026-11-10T01:00:00.000Z')),
    duration: '30 minutes',
    preferredTime: '06:30',
    status: 'pending',
    walkerId: null,
    cancelRequest: null,
    walkCount: 1,
    walkSchedules: [{ duration: 30, time: '06:30' }],
    createdAt: serverTimestamp(),
  };
}

test('baseline: canonical dogName/dogDetails and durationMinutes Booking is rejected by current Rules', async () => {
  const db = env.authenticatedContext('synthetic-customer').firestore();
  await assertFails(
    setDoc(doc(db, 'bookings/canonical-contract-probe'), canonicalBooking('canonical-contract-probe')),
  );
});

test('baseline: current legacy petName/petDetails and duration Booking shape is accepted', async () => {
  const db = env.authenticatedContext('synthetic-customer').firestore();
  await assertSucceeds(
    setDoc(doc(db, 'bookings/legacy-contract-probe'), currentLegacyBooking('legacy-contract-probe')),
  );
});

test('baseline: client cannot create a Walk Task directly', async () => {
  const db = env.authenticatedContext('synthetic-customer').firestore();
  await assertFails(
    setDoc(doc(db, 'walk_tasks/synthetic-task'), {
      walkTaskId: 'synthetic-task',
      bookingId: 'synthetic-booking',
      dogId: 'synthetic-dog',
      dogName: 'Milo',
      dogDetails: { breed: 'Indie' },
      scheduledAt: Timestamp.fromDate(new Date('2026-11-10T01:00:00.000Z')),
      durationMinutes: 30,
      status: 'pending',
    }),
  );
});
