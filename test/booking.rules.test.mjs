import fs from 'node:fs';
import path from 'node:path';
import test, { before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

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
    walkSchedules: [{ time: '06:30', duration: 30 }],
    ...overrides,
  };
}

test('authenticated customer can create a valid one-time booking request', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  await assertSucceeds(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking(),
    ),
  );
});

test('unauthenticated client cannot create a booking', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(
    setDoc(doc(db, 'bookings/booking-test-001'), validOneTimeBooking()),
  );
});

test('customer cannot create a booking under another customer UID', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking({ customerId: 'customer-2' }),
    ),
  );
});

test('booking rejects an unsupported plan or mismatched service type', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
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
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking({
        walkCount: 2,
        walkSchedules: [{ time: '06:30', duration: 30 }],
      }),
    ),
  );
});

test('booking rejects unexpected fields outside the Firestore allow-list', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-test-001'),
      validOneTimeBooking({ clientCalculatedPrice: 1 }),
    ),
  );
});

test('booking accepts the inclusive 20 to 60 minute duration range', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  await assertSucceeds(
    setDoc(
      doc(db, 'bookings/booking-duration-min'),
      validOneTimeBooking({
        bookingId: 'booking-duration-min',
        duration: '20 minutes',
      }),
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(db, 'bookings/booking-duration-max'),
      validOneTimeBooking({
        bookingId: 'booking-duration-max',
        duration: '60 minutes',
      }),
    ),
  );
});

test('booking rejects durations below 20 or above 60 minutes', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-duration-short'),
      validOneTimeBooking({
        bookingId: 'booking-duration-short',
        duration: '19 minutes',
      }),
    ),
  );
  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-duration-long'),
      validOneTimeBooking({
        bookingId: 'booking-duration-long',
        duration: '61 minutes',
      }),
    ),
  );
});

test('booking accepts valid pickup coordinates and legacy addresses without coordinates', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  await assertSucceeds(
    setDoc(
      doc(db, 'bookings/booking-coordinate-valid'),
      validOneTimeBooking({
        bookingId: 'booking-coordinate-valid',
        pickupAddress: { latitude: 28.6, longitude: 77.4 },
      }),
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(db, 'bookings/booking-coordinate-legacy'),
      validOneTimeBooking({
        bookingId: 'booking-coordinate-legacy',
        pickupAddress: { address: 'Legacy saved address' },
      }),
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(db, 'bookings/booking-coordinate-null-legacy'),
      validOneTimeBooking({
        bookingId: 'booking-coordinate-null-legacy',
        pickupAddress: {
          address: 'Legacy address with null coordinates',
          latitude: null,
          longitude: null,
        },
      }),
    ),
  );
});

test('booking rejects incomplete, non-numeric, or out-of-range pickup coordinates', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const invalidAddresses = [
    { latitude: 28.6 },
    { longitude: 77.4 },
    { latitude: '28.6', longitude: 77.4 },
    { latitude: 91, longitude: 77.4 },
    { latitude: 28.6, longitude: 181 },
    { latitude: -91, longitude: 77.4 },
    { latitude: 28.6, longitude: -181 },
    { latitude: null, longitude: 77.4 },
  ];

  for (let index = 0; index < invalidAddresses.length; index += 1) {
    const bookingId = `booking-coordinate-invalid-${index}`;
    await assertFails(
      setDoc(
        doc(db, `bookings/${bookingId}`),
        validOneTimeBooking({
          bookingId,
          pickupAddress: invalidAddresses[index],
        }),
      ),
    );
  }
});

test('booking rejects invalid duration or missing time in each primary walk schedule', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const invalidSchedules = [
    [{ time: '06:30', duration: 19 }],
    [{ time: '06:30', duration: 61 }],
    [{ time: '', duration: 30 }],
    [{ duration: 30 }],
    [{ time: '06:30', duration: '30' }],
  ];

  for (let index = 0; index < invalidSchedules.length; index += 1) {
    const bookingId = `booking-primary-walk-invalid-${index}`;
    await assertFails(
      setDoc(
        doc(db, `bookings/${bookingId}`),
        validOneTimeBooking({
          bookingId,
          walkSchedules: invalidSchedules[index],
        }),
      ),
    );
  }
});

test('regular booking rejects an invalid duration in its daily walk template', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const regularBooking = {
    ...validOneTimeBooking({
      bookingId: 'booking-regular-invalid-template',
      bookingPlan: 'regular',
      serviceType: 'regular_walk',
      serviceName: 'Regular Daily Walk',
      frequency: 'daily',
      walksPerWeek: 7,
      walksPerDay: 1,
      planStatus: 'pending_confirmation',
      dailyWalkTemplate: [{ time: '06:30', duration: 19 }],
    }),
  };

  await assertFails(
    setDoc(
      doc(db, 'bookings/booking-regular-invalid-template'),
      regularBooking,
    ),
  );
});

test('regular booking accepts a valid daily walk template', async () => {
  const db = env.authenticatedContext('customer-1').firestore();
  const regularBooking = validOneTimeBooking({
    bookingId: 'booking-regular-valid-template',
    bookingPlan: 'regular',
    serviceType: 'regular_walk',
    serviceName: 'Regular Daily Walk',
    frequency: 'daily',
    walksPerWeek: 7,
    walksPerDay: 1,
    planStatus: 'pending_confirmation',
    dailyWalkTemplate: [{ time: '06:30', duration: 30 }],
  });

  await assertSucceeds(
    setDoc(
      doc(db, 'bookings/booking-regular-valid-template'),
      regularBooking,
    ),
  );
});
