import fs from 'node:fs';
import path from 'node:path';
import test, { before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp } from 'firebase/firestore';

const projectId = 'demo-dojo-booking-rules';
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

function validOneTimeBooking(overrides = {}) {
  return {
    bookingId: 'booking-test-001',
    customerId: 'customer-1',
    walkType: 'scheduled',
    bookingPlan: 'one_time',
    serviceType: 'temporary_walk',
    serviceName: 'Temporary Walk',
    petName: 'Buddy',
    dogId: 'dog-1',
    petDetails: { breed: 'Indie' },
    pickupAddressId: 'address-1',
    pickupAddress: {
      label: 'Home',
      address: 'Test address',
      latitude: 28.6,
      longitude: 77.4,
    },
    scheduledAt: new Date('2026-11-01T06:30:00.000Z'),
    duration: '30 minutes',
    preferredTime: '06:30',
    status: 'pending',
    walkerId: null,
    cancelRequest: null,
    createdAt: serverTimestamp(),
    walkCount: 1,
    walkSchedules: [{ scheduledAt: new Date('2026-11-01T06:30:00.000Z') }],
    ...overrides,
  };
}

test('authenticated customer can create a valid one-time booking request', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  await assertSucceeds(
    db && (await import('firebase/firestore')).setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking(),
    ),
  );
});

test('unauthenticated client cannot create a booking', async () => {
  const db = env.unauthenticatedContext().firestore();
  const { setDoc } = await import('firebase/firestore');
  await assertFails(
    setDoc(doc(db, 'bookings/booking-test-001'), validOneTimeBooking()),
  );
});

test('customer cannot create a booking under another customer UID', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const { setDoc } = await import('firebase/firestore');
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking({ customerId: 'customer-2' }),
    ),
  );
});

test('booking rejects an unsupported plan or mismatched service type', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const { setDoc } = await import('firebase/firestore');
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking({ bookingPlan: 'weekly' }),
    ),
  );
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-002'),
      validOneTimeBooking({
        bookingId: 'booking-test-002',
        serviceType: 'regular_walk',
      }),
    ),
  );
});

test('booking rejects a walk count that does not match its schedule list', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const { setDoc } = await import('firebase/firestore');
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking({
        walkCount: 2,
        walkSchedules: [{ scheduledAt: new Date('2026-11-01T06:30:00.000Z') }],
      }),
    ),
  );
});

test('booking rejects unexpected fields outside the Firestore allow-list', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const { setDoc } = await import('firebase/firestore');
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking({ clientCalculatedPrice: 1 }),
    ),
  );
});
