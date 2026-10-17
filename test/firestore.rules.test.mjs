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
    await setDoc(doc(db, 'admin_users/location-active'), {
      role: 'admin', isActive: true,
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
    await setDoc(doc(db, 'service_location_boundaries/parent-city-boundary'), {
      locationId: 'city-parent',
      locationType: 'city',
      points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }],
      sourceType: 'governmentGis',
      sourceName: 'Test parent city official source',
      sourceReference: 'TEST-PARENT-REF',
      verificationStatus: 'verified',
      verifiedBy: 'super-active',
      verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'service_cities/city-parent'), {
      countryId: 'india', stateId: 'up', name: 'Parent City',
      verifiedBoundaryId: 'parent-city-boundary', isServiceActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
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
  const locationDb = env.authenticatedContext('location-active').firestore();
  const country = {
    name: 'India', code: 'IN', isActive: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(inactiveDb, 'service_countries/inactive-attempt'), country));
  await assertFails(setDoc(doc(supportDb, 'service_countries/support-attempt'), country));
  await assertFails(setDoc(doc(locationDb, 'service_countries/location-attempt'), country));
});

test('city cannot be activated without a verified matching boundary', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_cities/city-1'), {
    countryId: 'india', stateId: 'up', name: 'Example City',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('client cannot directly activate city even with a matching verified boundary', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_cities/city-1'), {
    countryId: 'india', stateId: 'up', name: 'Example City',
    verifiedBoundaryId: 'city-boundary',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('client cannot change an inactive city to active', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_cities/city-inactive-to-active'), {
      countryId: 'india', stateId: 'up', name: 'Inactive City',
      verifiedBoundaryId: 'city-boundary', isServiceActive: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    // Make the referenced verified boundary match this test location.
    await setDoc(doc(context.firestore(), 'service_location_boundaries/city-inactive-to-active-boundary'), {
      locationId: 'city-inactive-to-active', locationType: 'city',
      points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }],
      sourceType: 'governmentGis', sourceName: 'Test official source',
      sourceReference: 'TEST-REF-INACTIVE', verificationStatus: 'verified',
      verifiedBy: 'super-active', verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await updateDoc(doc(context.firestore(), 'service_cities/city-inactive-to-active'), {
      verifiedBoundaryId: 'city-inactive-to-active-boundary',
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(updateDoc(doc(db, 'service_cities/city-inactive-to-active'), {
    isServiceActive: true, updatedAt: serverTimestamp(),
  }));
});

test('direct city activation with a mismatched boundary is denied', async () => {
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


test('area cannot be activated without a verified matching boundary', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_areas/area-no-boundary'), {
    countryId: 'india', stateId: 'up', cityId: 'city-parent',
    name: 'Area Without Boundary', isServiceActive: true,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('client cannot directly activate area even with its own verified boundary', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_location_boundaries/area-boundary'), {
      locationId: 'area-1', locationType: 'area',
      points: [{ lat: 28.51, lng: 77.31 }, { lat: 28.52, lng: 77.31 }, { lat: 28.52, lng: 77.32 }],
      sourceType: 'governmentGis', sourceName: 'Test official area source',
      sourceReference: 'AREA-REF-1', verificationStatus: 'verified',
      verifiedBy: 'super-active', verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_areas/area-1'), {
    countryId: 'india', stateId: 'up', cityId: 'city-parent',
    name: 'Verified Area', verifiedBoundaryId: 'area-boundary',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('direct area activation with a mismatched boundary is denied', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_location_boundaries/other-area-boundary'), {
      locationId: 'some-other-area', locationType: 'area',
      points: [{ lat: 28.51, lng: 77.31 }, { lat: 28.52, lng: 77.31 }, { lat: 28.52, lng: 77.32 }],
      sourceType: 'governmentGis', sourceName: 'Test official area source',
      sourceReference: 'AREA-REF-2', verificationStatus: 'verified',
      verifiedBy: 'super-active', verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_areas/area-2'), {
    countryId: 'india', stateId: 'up', cityId: 'city-parent',
    name: 'Mismatched Area', verifiedBoundaryId: 'other-area-boundary',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('only active super_admin can write service location name indexes', async () => {
  const superDb = env.authenticatedContext('super-active').firestore();
  const supportDb = env.authenticatedContext('support-active').firestore();
  const locationDb = env.authenticatedContext('location-active').firestore();
  const inactiveDb = env.authenticatedContext('super-inactive').firestore();
  const index = { normalizedName: 'example-area', locationId: 'area-1', locationType: 'area' };
  await assertSucceeds(setDoc(doc(superDb, 'service_location_name_indexes/area-example'), index));
  await assertFails(setDoc(doc(supportDb, 'service_location_name_indexes/support-attempt'), index));
  await assertFails(setDoc(doc(locationDb, 'service_location_name_indexes/location-attempt'), index));
  await assertFails(setDoc(doc(inactiveDb, 'service_location_name_indexes/inactive-attempt'), index));
  await assertFails(deleteDoc(doc(supportDb, 'service_location_name_indexes/area-example')));
});

test('import audit creation requires active super_admin and matching actor', async () => {
  const superDb = env.authenticatedContext('super-active').firestore();
  const supportDb = env.authenticatedContext('support-active').firestore();
  const record = {
    source: 'LGD', fileName: 'areas.csv', status: 'pending',
    importedBy: 'super-active', importedAt: serverTimestamp(),
    verificationStatus: 'pending',
  };
  await assertSucceeds(setDoc(doc(superDb, 'service_location_imports/import-ok'), record));
  await assertFails(setDoc(doc(supportDb, 'service_location_imports/import-support'), {
    ...record, importedBy: 'support-active',
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_imports/import-spoofed'), {
    ...record, importedBy: 'support-active',
  }));
  await assertFails(updateDoc(doc(superDb, 'service_location_imports/import-ok'), {
    status: 'completed',
  }));
});

test('area cannot be activated when its parent city is inactive', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'service_cities/city-inactive'), {
      countryId: 'india', stateId: 'up', name: 'Inactive Parent City',
      verifiedBoundaryId: 'parent-city-boundary', isServiceActive: false,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'service_location_boundaries/area-inactive-parent-boundary'), {
      locationId: 'area-inactive-parent', locationType: 'area',
      points: [{ lat: 28.51, lng: 77.31 }, { lat: 28.52, lng: 77.31 }, { lat: 28.52, lng: 77.32 }],
      sourceType: 'governmentGis', sourceName: 'Test official area source',
      sourceReference: 'AREA-REF-INACTIVE-PARENT', verificationStatus: 'verified',
      verifiedBy: 'super-active', verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_areas/area-inactive-parent'), {
    countryId: 'india', stateId: 'up', cityId: 'city-inactive',
    name: 'Area With Inactive Parent', verifiedBoundaryId: 'area-inactive-parent-boundary',
    isServiceActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});


test('active city identity and verified boundary reference cannot be changed by clients', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_cities/city-1'), {
      countryId: 'india', stateId: 'up', name: 'Active City',
      verifiedBoundaryId: 'city-boundary', isServiceActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(updateDoc(doc(db, 'service_cities/city-1'), {
    stateId: 'delhi', updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_cities/city-1'), {
    verifiedBoundaryId: 'another-boundary', updatedAt: serverTimestamp(),
  }));
});

test('active area parent and verified boundary reference cannot be changed by clients', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'service_location_boundaries/active-area-boundary'), {
      locationId: 'active-area', locationType: 'area',
      points: [{ lat: 28.51, lng: 77.31 }, { lat: 28.52, lng: 77.31 }, { lat: 28.52, lng: 77.32 }],
      sourceType: 'governmentGis', sourceName: 'Test official area source',
      sourceReference: 'ACTIVE-AREA-REF', verificationStatus: 'verified',
      verifiedBy: 'super-active', verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'service_areas/active-area'), {
      countryId: 'india', stateId: 'up', cityId: 'city-parent', name: 'Active Area',
      verifiedBoundaryId: 'active-area-boundary', isServiceActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(updateDoc(doc(db, 'service_areas/active-area'), {
    cityId: 'other-city', updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_areas/active-area'), {
    verifiedBoundaryId: 'another-area-boundary', updatedAt: serverTimestamp(),
  }));
});

test('clients cannot create, update, or delete service location activation audit records', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_location_activation_audit/audit-existing'), {
      actorUid: 'super-active', locationId: 'city-1', locationType: 'city',
      boundaryId: 'city-boundary', result: 'activated',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  const record = {
    actorUid: 'super-active', locationId: 'city-1', locationType: 'city',
    boundaryId: 'city-boundary', result: 'activated', createdAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(db, 'service_location_activation_audit/audit-forged'), record));
  await assertFails(updateDoc(doc(db, 'service_location_activation_audit/audit-existing'), {
    result: 'forged', 
  }));
  await assertFails(deleteDoc(doc(db, 'service_location_activation_audit/audit-existing')));
});
