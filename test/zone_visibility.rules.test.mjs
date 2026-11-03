import fs from 'node:fs';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-dojo-zone-visibility-rules';
const rawGeometryCollections = [
  'service_location_boundaries',
  'service_zones',
];
const internalAuthorityCollections = [
  'founder_users',
  'admin_scope_assignments',
  'walker_zone_assignments',
  'zone_boundary_review_assignments',
];
const actors = [
  { uid: 'visibility-founder', label: 'Founder' },
  { uid: 'visibility-central-admin', label: 'Central Admin' },
  { uid: 'visibility-city-manager', label: 'City Manager' },
  { uid: 'visibility-supervisor', label: 'Supervisor' },
  { uid: 'visibility-walker', label: 'Walker' },
  { uid: 'visibility-reviewer', label: 'Boundary Reviewer' },
  { uid: 'visibility-submitter', label: 'Draft submitter' },
  { uid: 'visibility-customer', label: 'Customer' },
  { uid: 'visibility-inactive-admin', label: 'Inactive Admin' },
  { uid: 'visibility-legacy-super-admin', label: 'Legacy super_admin only' },
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
    await setDoc(doc(db, 'service_location_boundaries/zone-boundary-secret'), {
      locationId: 'zone-private-1',
      locationType: 'zone',
      points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }],
      verificationStatus: 'verified',
      fixtureOnly: true,
    });
    await setDoc(doc(db, 'service_zones/zone-private-1'), {
      cityId: 'city-a', name: 'Synthetic Zone A', status: 'active', fixtureOnly: true,
    });
    for (const actor of actors) {
      if (actor.uid === 'visibility-legacy-super-admin') {
        await setDoc(doc(db, `admin_users/${actor.uid}`), { role: 'super_admin', isActive: true });
      } else if (actor.uid === 'visibility-inactive-admin') {
        await setDoc(doc(db, `admin_users/${actor.uid}`), { role: 'central_admin', isActive: false });
      } else if (actor.uid === 'visibility-central-admin') {
        await setDoc(doc(db, `admin_users/${actor.uid}`), {
          role: 'central_admin', isActive: true, permissions: { zoneGeometryReadAll: true },
        });
      } else if (actor.uid === 'visibility-city-manager') {
        await setDoc(doc(db, `admin_users/${actor.uid}`), { role: 'city_manager', isActive: true });
      } else if (actor.uid === 'visibility-supervisor') {
        await setDoc(doc(db, `admin_users/${actor.uid}`), { role: 'zone_supervisor', isActive: true });
      } else if (actor.uid === 'visibility-reviewer') {
        await setDoc(doc(db, `admin_users/${actor.uid}`), {
          role: 'admin', isActive: true, permissions: { zoneBoundaryReview: true },
        });
      }
    }
    await setDoc(doc(db, 'founder_users/visibility-founder'), {
      authorityType: 'founder_ceo', isActive: true, fixtureOnly: true,
    });
    await setDoc(doc(db, 'founder_users/visibility-inactive-founder'), {
      authorityType: 'founder_ceo', isActive: false, fixtureOnly: true,
    });
    await setDoc(doc(db, 'admin_scope_assignments/city-manager-city-a'), {
      adminUid: 'visibility-city-manager', role: 'city_manager',
      scopeType: 'city', scopeId: 'city-a', isActive: true,
    });
    await setDoc(doc(db, 'admin_scope_assignments/supervisor-zone-a'), {
      adminUid: 'visibility-supervisor', role: 'zone_supervisor',
      scopeType: 'zone', scopeId: 'zone-private-1', isActive: true,
    });
    await setDoc(doc(db, 'walker_zone_assignments/walker-zone-a'), {
      walkerUid: 'visibility-walker', zoneId: 'zone-private-1', status: 'active',
    });
    await setDoc(doc(db, 'zone_boundary_review_assignments/reviewer-boundary-a'), {
      reviewerUid: 'visibility-reviewer', boundaryId: 'zone-boundary-secret',
      zoneId: 'zone-private-1', status: 'assigned',
    });
  });
});

for (const actor of actors) {
  test(`raw Zone geometry cannot be fetched or listed directly by ${actor.label}`, async () => {
    const db = env.authenticatedContext(actor.uid).firestore();
    await assertFails(getDoc(doc(db, 'service_location_boundaries/zone-boundary-secret')));
    await assertFails(getDocs(collection(db, 'service_location_boundaries')));
    await assertFails(getDoc(doc(db, 'service_zones/zone-private-1')));
    await assertFails(getDocs(collection(db, 'service_zones')));
  });
}

test('unauthenticated clients cannot fetch or list raw Zone geometry', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'service_location_boundaries/zone-boundary-secret')));
  await assertFails(getDocs(collection(db, 'service_location_boundaries')));
  await assertFails(getDoc(doc(db, 'service_zones/zone-private-1')));
  await assertFails(getDocs(collection(db, 'service_zones')));
});

for (const actor of actors) {
  test(`internal authority and assignment records are not directly readable by ${actor.label}`, async () => {
    const db = env.authenticatedContext(actor.uid).firestore();
    for (const name of internalAuthorityCollections) {
      await assertFails(getDocs(collection(db, name)));
    }
  });
}

test('clients cannot forge or mutate Founder and assignment authority records', async () => {
  const db = env.authenticatedContext('visibility-customer').firestore();
  for (const name of internalAuthorityCollections) {
    await assertFails(setDoc(doc(db, name, 'client-forged'), {
      isActive: true, role: 'founder_ceo', scopeId: 'all-zones', fixtureOnly: false,
    }));
  }
  await assertFails(updateDoc(doc(db, 'walker_zone_assignments/walker-zone-a'), {
    status: 'active', zoneId: 'zone-another-city',
  }));
});

// These callable acceptance gates remain TODO until the trusted read APIs exist.
// TODO is deliberately not counted as a passing authorization test.
test.todo('Founder callable sees all canonical Zones and loses access immediately when founder_users/{uid} is revoked');
test.todo('Central Admin callable sees all Zones only with active membership and explicit zoneGeometryReadAll permission');
test.todo('City Manager callable sees all Zones in assigned City and no Zone in another City');
test.todo('Supervisor callable sees exact assigned Zone IDs only; revocation removes former Zone access');
test.todo('Walker callable ignores editable onboarding preferences and checks active walker_zone_assignments');
test.todo('Boundary Reviewer callable reads only assigned boundary and denies submitter self-review');
test.todo('Draft submitter callable reads own draft only and cannot widen scope by guessed ID');
test.todo('role disablement, assignment expiry, revocation, and reassignment invalidate subsequent reads');
test.todo('callable rejects client payload scope, custom claims, email, display name, and legacy super_admin spoofing');
test.todo('customer callable surface never returns raw Zone geometry');
test.todo('callable pagination, guessed IDs, and broad query attempts cannot bypass scope');
