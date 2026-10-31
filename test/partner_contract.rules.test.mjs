import fs from 'node:fs';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
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

const projectId = 'demo-dojo-partner-contract-rules';
let env;

const approvedWalker = {
  userId: 'walker-1',
  fullName: 'Test Walker',
  phone: '9999999999',
  dateOfBirth: new Date('1995-01-01T00:00:00Z'),
  status: 'approved',
  isActive: true,
  isApproved: true,
  verificationStatus: 'verified',
  applicationSubmitted: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const assignedBooking = {
  bookingId: 'booking-1',
  customerId: 'customer-1',
  walkerId: 'walker-1',
  status: 'assigned',
  createdAt: new Date('2026-01-01T00:00:00Z'),
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
    await setDoc(doc(db, 'walkers/walker-1'), approvedWalker);
    await setDoc(doc(db, 'bookings/booking-1'), assignedBooking);
  });
});

function walkerDb(uid = 'walker-1') {
  return env.authenticatedContext(uid).firestore();
}

test('approved walker cannot save the Partner workingSchedule field under current Rules', async () => {
  await assertFails(
    updateDoc(doc(walkerDb(), 'walkers/walker-1'), {
      workingSchedule: {
        status: 'active',
        days: {
          monday: { enabled: true, start: '07:00', end: '19:00' },
        },
      },
      updatedAt: serverTimestamp(),
    }),
  );
});

test('approved walker can update the currently allow-listed availability field', async () => {
  await assertSucceeds(
    updateDoc(doc(walkerDb(), 'walkers/walker-1'), {
      availability: {
        monday: { enabled: true, start: '07:00', end: '19:00' },
      },
      updatedAt: serverTimestamp(),
    }),
  );
});

test('approved assigned walker cannot write dogReturned to booking', async () => {
  await assertFails(
    updateDoc(doc(walkerDb(), 'bookings/booking-1'), {
      dogReturned: true,
      updatedAt: serverTimestamp(),
    }),
  );
});

test('approved assigned walker cannot write returnLocationVerified to booking', async () => {
  await assertFails(
    updateDoc(doc(walkerDb(), 'bookings/booking-1'), {
      returnLocationVerified: true,
      updatedAt: serverTimestamp(),
    }),
  );
});

test('approved assigned walker cannot write route to booking', async () => {
  await assertFails(
    updateDoc(doc(walkerDb(), 'bookings/booking-1'), {
      route: [{ latitude: 28.6, longitude: 77.4 }],
      updatedAt: serverTimestamp(),
    }),
  );
});

test('approved assigned walker cannot create a walk record without an explicit Rules match', async () => {
  await assertFails(
    setDoc(doc(walkerDb(), 'walks/walk-1'), {
      walkId: 'walk-1',
      bookingId: 'booking-1',
      walkerId: 'walker-1',
      status: 'completed',
      createdAt: serverTimestamp(),
    }),
  );
});

test('unassigned approved walker cannot update another walker booking', async () => {
  await assertFails(
    updateDoc(doc(walkerDb('walker-2'), 'bookings/booking-1'), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    }),
  );
});

test('assigned approved walker can update only fields currently in the booking progress allow-list', async () => {
  await assertSucceeds(
    updateDoc(doc(walkerDb(), 'bookings/booking-1'), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    }),
  );
});
