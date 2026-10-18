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
    await setDoc(doc(db, 'service_countries/india'), {
      name: 'India', code: 'IN', isActive: false,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'service_states/up'), {
      countryId: 'india', name: 'Uttar Pradesh', isActive: false,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
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

test('new hierarchy records require existing, correctly linked ancestors', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  const stamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const stateBase = { name: 'Draft State', isActive: false, ...stamps };
  const childBase = { name: 'Draft Child', isServiceActive: false, ...stamps };
  await assertFails(setDoc(doc(db, 'service_states/missing-country-state'), {
    ...stateBase, countryId: 'missing-country',
  }));
  await assertFails(setDoc(doc(db, 'service_cities/missing-state-city'), {
    ...childBase, countryId: 'india', stateId: 'missing-state',
  }));
  await assertFails(setDoc(doc(db, 'service_cities/mismatched-city'), {
    ...childBase, countryId: 'other-country', stateId: 'up',
  }));
  await assertFails(setDoc(doc(db, 'service_areas/missing-city-area'), {
    ...childBase, countryId: 'india', stateId: 'up', cityId: 'missing-city',
  }));
  await assertFails(setDoc(doc(db, 'service_localities/missing-area-locality'), {
    ...childBase, countryId: 'india', stateId: 'up', cityId: 'city-parent', areaId: 'missing-area',
  }));
  await assertSucceeds(setDoc(doc(db, 'service_states/valid-new-state'), {
    ...stateBase, countryId: 'india',
  }));
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
  await assertSucceeds(setDoc(doc(db, 'service_countries/india-new'), {
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

test('admin can bind a verified boundary to an inactive City', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertSucceeds(setDoc(doc(db, 'service_cities/city-1'), {
    countryId: 'india', stateId: 'up', name: 'Example City',
    isServiceActive: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(db, 'service_cities/city-1'), {
    verifiedBoundaryId: 'city-boundary',
    updatedAt: serverTimestamp(),
  }));
});

test('admin can bind a verified boundary to an inactive Area under an active City', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertSucceeds(setDoc(doc(db, 'service_areas/area-1'), {
    countryId: 'india', stateId: 'up', cityId: 'city-parent',
    name: 'Example Area', isServiceActive: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_location_boundaries/area-boundary'), {
      locationId: 'area-1', locationType: 'area',
      points: [{ lat: 28.51, lng: 77.31 }, { lat: 28.52, lng: 77.31 }, { lat: 28.52, lng: 77.32 }],
      sourceType: 'governmentGis', sourceName: 'Test official area source',
      sourceReference: 'AREA-BIND-REF', verificationStatus: 'verified',
      verifiedBy: 'super-active', verifiedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  await assertSucceeds(updateDoc(doc(db, 'service_areas/area-1'), {
    verifiedBoundaryId: 'area-boundary',
    updatedAt: serverTimestamp(),
  }));
});

test('active City boundary reference cannot be rebound by a client transaction', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_cities/city-active-ref'), {
      countryId: 'india', stateId: 'up', name: 'Active City',
      verifiedBoundaryId: 'city-boundary', isServiceActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(updateDoc(doc(db, 'service_cities/city-active-ref'), {
    verifiedBoundaryId: 'replacement-boundary',
    updatedAt: serverTimestamp(),
  }));
});


test('clients cannot directly verify or reject a pending boundary', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_location_boundaries/pending-review-boundary'), {
      locationId: 'city-pending',
      locationType: 'city',
      points: [{ lat: 28.5, lng: 77.3 }, { lat: 28.6, lng: 77.3 }, { lat: 28.6, lng: 77.4 }],
      sourceType: 'governmentGis',
      sourceName: 'Test official source',
      sourceReference: 'TEST-PENDING-REF',
      verificationStatus: 'pending',
      verifiedBy: null,
      verifiedAt: null,
      verificationNotes: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  const db = env.authenticatedContext('super-active').firestore();
  const boundary = doc(db, 'service_location_boundaries/pending-review-boundary');
  await assertFails(updateDoc(boundary, {
    verificationStatus: 'verified',
    verifiedBy: 'super-active',
    verifiedAt: serverTimestamp(),
    verificationNotes: 'Direct client verification attempt',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(boundary, {
    verificationStatus: 'rejected',
    verifiedBy: 'super-active',
    verifiedAt: null,
    verificationNotes: 'Direct client rejection attempt',
    updatedAt: serverTimestamp(),
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

test('name indexes enforce the Admin payload schema and active super_admin authorization', async () => {
  const superDb = env.authenticatedContext('super-active').firestore();
  const supportDb = env.authenticatedContext('support-active').firestore();
  const locationDb = env.authenticatedContext('location-active').firestore();
  const inactiveDb = env.authenticatedContext('super-inactive').firestore();
  const index = {
    collectionPath: 'service_areas',
    documentId: 'area-1',
    name: 'example-area',
    parentIds: ['india', 'up', 'city-1'],
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(superDb, 'service_location_name_indexes/area-example'), index));
  await assertFails(setDoc(doc(supportDb, 'service_location_name_indexes/support-attempt'), index));
  await assertFails(setDoc(doc(locationDb, 'service_location_name_indexes/location-attempt'), index));
  await assertFails(setDoc(doc(inactiveDb, 'service_location_name_indexes/inactive-attempt'), index));

  await assertFails(setDoc(doc(superDb, 'service_location_name_indexes/extra-field'), {
    ...index, arbitraryAdminField: true,
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_name_indexes/unknown-collection'), {
    ...index, collectionPath: 'users',
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_name_indexes/empty-name'), {
    ...index, name: '',
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_name_indexes/too-many-parents'), {
    ...index, parentIds: ['a', 'b', 'c', 'd', 'e'],
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_name_indexes/wrong-parent-count'), {
    ...index, parentIds: ['india'],
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_name_indexes/country-with-parent'), {
    ...index, collectionPath: 'service_countries', parentIds: ['india', 'up', 'city-1'],
  }));
  await assertFails(deleteDoc(doc(supportDb, 'service_location_name_indexes/area-example')));
});

test('import audit validates bounded strings, actor, and immutable create-only records', async () => {
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
  await assertFails(setDoc(doc(superDb, 'service_location_imports/empty-source'), {
    ...record, source: '',
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_imports/long-source'), {
    ...record, source: 'x'.repeat(81),
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_imports/long-filename'), {
    ...record, fileName: 'x'.repeat(181),
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_imports/empty-status'), {
    ...record, status: '',
  }));
  await assertFails(setDoc(doc(superDb, 'service_location_imports/long-verification'), {
    ...record, verificationStatus: 'x'.repeat(33),
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


// Direct client transactions must not be able to verify a boundary or bind it
// to a City. The trusted callable integration suite covers the allowed server path.
test('client transaction cannot verify boundary and bind inactive City', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  const cityRef = doc(db, 'service_cities/city-transaction');
  const boundaryRef = doc(db, 'service_location_boundaries/city-transaction-boundary');

  await assertSucceeds(setDoc(cityRef, {
    countryId: 'india', stateId: 'up', name: 'Transaction City',
    isServiceActive: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(boundaryRef, {
    locationId: 'city-transaction',
    locationType: 'city',
    points: [
      { lat: 28.5, lng: 77.3 },
      { lat: 28.6, lng: 77.3 },
      { lat: 28.6, lng: 77.4 },
    ],
    sourceType: 'governmentGis',
    sourceName: 'Test official source',
    sourceReference: 'CITY-TRANSACTION-REF',
    verificationStatus: 'pending',
    verifiedBy: null,
    verifiedAt: null,
    verificationNotes: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const { runTransaction } = await import('firebase/firestore');
  await assertFails(runTransaction(db, async (transaction) => {
    const boundarySnapshot = await transaction.get(boundaryRef);
    const citySnapshot = await transaction.get(cityRef);
    assert.equal(boundarySnapshot.data().verificationStatus, 'pending');
    assert.equal(citySnapshot.data().isServiceActive, false);
    transaction.update(boundaryRef, {
      verificationStatus: 'verified',
      verifiedBy: 'super-active',
      verifiedAt: serverTimestamp(),
      verificationNotes: 'Direct client transaction attempt',
      updatedAt: serverTimestamp(),
    });
    transaction.update(cityRef, {
      verifiedBoundaryId: 'city-transaction-boundary',
      updatedAt: serverTimestamp(),
    });
  }));

  const [savedBoundary, savedCity] = await Promise.all([
    getDoc(boundaryRef),
    getDoc(cityRef),
  ]);
  assert.equal(savedBoundary.data().verificationStatus, 'pending');
  assert.equal(savedCity.data().verifiedBoundaryId, undefined);
  assert.equal(savedCity.data().isServiceActive, false);
});


test('clients cannot directly deactivate Country, State, City, or Area', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'service_countries/country-status'), {
      name: 'India', code: 'IN', isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'service_states/state-status'), {
      countryId: 'country-status', name: 'State', isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'service_cities/city-status'), {
      countryId: 'country-status', stateId: 'state-status', name: 'City',
      verifiedBoundaryId: 'city-boundary', isServiceActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'service_areas/area-status'), {
      countryId: 'country-status', stateId: 'state-status', cityId: 'city-status', name: 'Area',
      isServiceActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(updateDoc(doc(db, 'service_countries/country-status'), {
    isActive: false, updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_states/state-status'), {
    isActive: false, updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_cities/city-status'), {
    isServiceActive: false, updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_areas/area-status'), {
    isServiceActive: false, updatedAt: serverTimestamp(),
  }));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'service_localities/locality-status'), {
      countryId: 'country-status', stateId: 'state-status', cityId: 'city-status',
      areaId: 'area-status', name: 'Locality', isServiceActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
  await assertFails(updateDoc(doc(db, 'service_localities/locality-status'), {
    isServiceActive: false, updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db, 'service_localities/locality-created-active'), {
    countryId: 'country-status', stateId: 'state-status', cityId: 'city-status',
    areaId: 'area-status', name: 'Active Locality', isServiceActive: true,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('service location parent links cannot be changed after creation', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const stamp = new Date('2026-01-01T00:00:00Z');
    await setDoc(doc(db, 'service_states/state-parent-locked'), {
      countryId: 'country-a', name: 'State', isActive: false,
      createdAt: stamp, updatedAt: stamp,
    });
    await setDoc(doc(db, 'service_cities/city-parent-locked'), {
      countryId: 'country-a', stateId: 'state-parent-locked',
      name: 'City', isServiceActive: false,
      createdAt: stamp, updatedAt: stamp,
    });
    await setDoc(doc(db, 'service_areas/area-parent-locked'), {
      countryId: 'country-a', stateId: 'state-parent-locked',
      cityId: 'city-parent-locked', name: 'Area', isServiceActive: false,
      createdAt: stamp, updatedAt: stamp,
    });
    await setDoc(doc(db, 'service_localities/locality-parent-locked'), {
      countryId: 'country-a', stateId: 'state-parent-locked',
      cityId: 'city-parent-locked', areaId: 'area-parent-locked',
      name: 'Locality', isServiceActive: false,
      createdAt: stamp, updatedAt: stamp,
    });
  });
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(updateDoc(doc(db, 'service_states/state-parent-locked'), {
    countryId: 'country-b', updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_cities/city-parent-locked'), {
    stateId: 'state-b', updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_areas/area-parent-locked'), {
    cityId: 'city-b', updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, 'service_localities/locality-parent-locked'), {
    areaId: 'area-b', updatedAt: serverTimestamp(),
  }));
});

test('clients cannot create an already-active Country or State', async () => {
  const db = env.authenticatedContext('super-active').firestore();
  await assertFails(setDoc(doc(db, 'service_countries/country-created-active'), {
    name: 'Active Country', code: 'AC', isActive: true,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db, 'service_states/state-created-active'), {
    countryId: 'india', name: 'Active State', isActive: true,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});
