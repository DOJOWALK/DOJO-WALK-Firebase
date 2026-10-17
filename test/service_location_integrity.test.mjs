import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSnapshot } from '../scripts/service_location_integrity_core.mjs';

test('reports missing and mismatched parents without mutating snapshot', () => {
  const snapshot = {
    service_countries: { india: { isActive: true } },
    service_states: { up: { countryId: 'india', isActive: true } },
    service_cities: { city: { countryId: 'india', stateId: 'up', isServiceActive: true } },
    service_areas: { area: { countryId: 'india', stateId: 'wrong-state', cityId: 'city', isServiceActive: true } },
    service_localities: { locality: { countryId: 'india', stateId: 'up', cityId: 'city', areaId: 'missing-area', isServiceActive: true } },
    service_location_boundaries: {},
  };
  const before = JSON.stringify(snapshot);
  const report = auditSnapshot(snapshot);
  assert.ok(report.issues.some(x => x.code === 'STATE_COUNTRY_MISMATCH') === false);
  assert.ok(report.issues.some(x => x.code === 'CITY_ANCESTRY_MISMATCH' && x.type === 'area'));
  assert.ok(report.issues.some(x => x.code === 'MISSING_AREA' && x.type === 'locality'));
  assert.equal(JSON.stringify(snapshot), before);
});

test('clean complete inactive hierarchy has no issues', () => {
  const snapshot = {
    service_countries: { india: { isActive: false } },
    service_states: { up: { countryId: 'india', isActive: false } },
    service_cities: { city: { countryId: 'india', stateId: 'up', isServiceActive: false } },
    service_areas: { area: { countryId: 'india', stateId: 'up', cityId: 'city', isServiceActive: false } },
    service_localities: { locality: { countryId: 'india', stateId: 'up', cityId: 'city', areaId: 'area', isServiceActive: false } },
    service_location_boundaries: {},
  };
  assert.equal(auditSnapshot(snapshot).issueCount, 0);
});

test('rejects snapshots missing any required collection', () => {
  assert.throws(
    () => auditSnapshot({ service_countries: {}, service_states: {}, service_cities: {}, service_areas: {} }),
    /service_localities/,
  );
});

test('rejects array in place of a document-ID keyed collection', () => {
  assert.throws(
    () => auditSnapshot({
      service_countries: [], service_states: {}, service_cities: {}, service_areas: {}, service_localities: {}, service_location_boundaries: {},
    }),
    /service_countries/,
  );
});

test('rejects non-object snapshot root', () => {
  assert.throws(() => auditSnapshot(null), /Snapshot root must be a JSON object/);
});

test('rejects null or array document values with collection and document ID', () => {
  const snapshot = {
    service_countries: { india: { isActive: false } },
    service_states: { broken: null },
    service_cities: {},
    service_areas: {},
    service_localities: {}, service_location_boundaries: {},
  };
  assert.throws(() => auditSnapshot(snapshot), /service_states\/broken/);
});

test('flags active City with missing boundary reference', () => {
  const snapshot = {
    service_countries: { c: { isActive: true } },
    service_states: { s: { countryId: 'c', isActive: true } },
    service_cities: { city: { countryId: 'c', stateId: 's', isServiceActive: true, verifiedBoundaryId: 'missing' } },
    service_areas: {}, service_localities: {}, service_location_boundaries: {},
  };
  assert.ok(auditSnapshot(snapshot).issues.some(x => x.code === 'MISSING_VERIFIED_BOUNDARY' && x.type === 'city'));
});

test('flags invalid verification metadata and coordinates for active Area', () => {
  const snapshot = {
    service_countries: { c: { isActive: true } },
    service_states: { s: { countryId: 'c', isActive: true } },
    service_cities: { city: { countryId: 'c', stateId: 's', isServiceActive: true } },
    service_areas: { area: { countryId: 'c', stateId: 's', cityId: 'city', isServiceActive: true, verifiedBoundaryId: 'b' } },
    service_localities: {},
    service_location_boundaries: { b: { locationId: 'wrong', locationType: 'area', verificationStatus: 'draft', sourceName: '', sourceReference: '', points: [{lat: 0,lng: 0},{lat: 0,lng: 0},{lat: 1,lng: 1}] } },
  };
  const codes = auditSnapshot(snapshot).issues.map(x => x.code);
  assert.ok(codes.includes('BOUNDARY_VERIFICATION_METADATA_INVALID'));
  assert.ok(codes.includes('BOUNDARY_COORDINATES_INVALID'));
});

test('summarizes issue counts by code and record type', () => {
  const snapshot = {
    service_countries: { c: { isActive: true } },
    service_states: { s: { countryId: 'c', isActive: true } },
    service_cities: { city: { countryId: 'c', stateId: 's', isServiceActive: true, verifiedBoundaryId: 'missing' } },
    service_areas: {}, service_localities: {}, service_location_boundaries: {},
  };
  const report = auditSnapshot(snapshot);
  assert.equal(report.issueCountsByCode.MISSING_VERIFIED_BOUNDARY, 1);
  assert.equal(report.issueCountsByType.city, 1);
  assert.equal(report.issueCount, report.issues.length);
});


test('marks snapshot scope unverified when export metadata is absent', () => {
  const snapshot = {
    service_countries: {}, service_states: {}, service_cities: {},
    service_areas: {}, service_localities: {}, service_location_boundaries: {},
  };
  const report = auditSnapshot(snapshot);
  assert.equal(report.snapshotScope.status, 'UNVERIFIED');
  assert.equal(report.snapshotScope.missingCollections.length, 6);
});

test('reports declared complete snapshot scope only when all collections and counts match', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '2026-10-17T00:00:00Z',
    collectionsIncluded: names,
    completeCollections: names,
    recordCounts: Object.fromEntries(names.map(name => [name, 0])),
  };
  assert.equal(auditSnapshot(snapshot).snapshotScope.status, 'DECLARED_COMPLETE');
  snapshot.snapshotMetadata.recordCounts.service_areas = 1;
  const report = auditSnapshot(snapshot);
  assert.equal(report.snapshotScope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.deepEqual(report.snapshotScope.countMismatches, ['service_areas']);
});


test('rejects non-array collection-list declarations in snapshot metadata', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '2026-10-17T00:00:00Z',
    collectionsIncluded: names,
    completeCollections: names,
    recordCounts: counts,
  };
  snapshot.snapshotMetadata.collectionsIncluded = { service_countries: true };
  let scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.malformedCollectionLists, true);

  snapshot.snapshotMetadata.collectionsIncluded = names;
  snapshot.snapshotMetadata.completeCollections = 'all collections';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.malformedCollectionLists, true);
});

test('rejects malformed record-count metadata and unknown count keys', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '2026-10-17T00:00:00Z',
    collectionsIncluded: names,
    completeCollections: names,
    recordCounts: { ...counts, unexpected_collection: 0 },
  };
  let scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.malformedRecordCounts, true);
  assert.deepEqual(scope.unknownRecordCountKeys, ['unexpected_collection']);

  snapshot.snapshotMetadata.recordCounts = 'not-a-count-map';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.malformedRecordCounts, true);
  assert.deepEqual(scope.unknownRecordCountKeys, []);
});

test('rejects invalid export timestamps and unknown collection names in scope metadata', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: 'yesterday',
    collectionsIncluded: [...names, 'unexpected_collection'],
    completeCollections: names,
    recordCounts: Object.fromEntries(names.map(name => [name, 0])),
  };
  const scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.invalidExportTimestamp, true);
  assert.deepEqual(scope.unknownCollections, ['unexpected_collection']);
  assert.equal(scope.exportedAt, null);
});

test('rejects duplicate collection entries in snapshot scope metadata', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '2026-10-17T00:00:00Z',
    collectionsIncluded: [...names, 'service_countries'],
    completeCollections: [...names, 'service_areas'],
    recordCounts: Object.fromEntries(names.map(name => [name, 0])),
  };
  const scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.malformedCollectionLists, true);
  assert.deepEqual(scope.duplicateCollectionEntries, ['collectionsIncluded:service_countries', 'completeCollections:service_areas']);
});

test('requires an explicit timezone in snapshot export timestamps', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '2026-10-17T12:00:00',
    collectionsIncluded: names,
    completeCollections: names,
    recordCounts: Object.fromEntries(names.map(name => [name, 0])),
  };
  let scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.invalidExportTimestamp, true);
  assert.equal(scope.exportedAt, null);

  snapshot.snapshotMetadata.exportedAt = '2026-10-17T12:00:00+05:30';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, false);
  assert.equal(scope.exportedAt, '2026-10-17T12:00:00+05:30');
});


test('rejects impossible calendar dates and out-of-range time components in snapshot timestamps', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '2026-02-30T12:00:00Z',
    collectionsIncluded: names,
    completeCollections: names,
    recordCounts: Object.fromEntries(names.map(name => [name, 0])),
  };
  let scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.status, 'INCOMPLETE_OR_UNVERIFIED');
  assert.equal(scope.invalidExportTimestamp, true);
  assert.equal(scope.exportedAt, null);
  snapshot.snapshotMetadata.exportedAt = '2026-10-17T25:00:00Z';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, true);
  snapshot.snapshotMetadata.exportedAt = '2024-02-29T23:59:59Z';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, false);
  assert.equal(scope.exportedAt, '2024-02-29T23:59:59Z');
});



test('validates leap years using Gregorian rules for years below 100 and century years', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '0000-02-29T12:00:00Z',
    collectionsIncluded: names,
    completeCollections: names,
    recordCounts: Object.fromEntries(names.map(name => [name, 0])),
  };
  let scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, false, 'year 0000 is a leap year under Gregorian leap-year rules');

  snapshot.snapshotMetadata.exportedAt = '1900-02-29T12:00:00Z';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, true, '1900 is not a leap year');

  snapshot.snapshotMetadata.exportedAt = '2000-02-29T12:00:00Z';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, false, '2000 is a leap year');
});

test('enforces ISO timezone offset bounds in snapshot timestamps', () => {
  const names = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  const snapshot = Object.fromEntries(names.map(name => [name, {}]));
  snapshot.snapshotMetadata = {
    sourceProjectId: 'synthetic-project',
    exportedAt: '2026-10-17T12:00:00+15:00',
    collectionsIncluded: names,
    completeCollections: names,
    recordCounts: Object.fromEntries(names.map(name => [name, 0])),
  };
  let scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, true);
  snapshot.snapshotMetadata.exportedAt = '2026-10-17T12:00:00+14:01';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, true);
  snapshot.snapshotMetadata.exportedAt = '2026-10-17T12:00:00+14:00';
  scope = auditSnapshot(snapshot).snapshotScope;
  assert.equal(scope.invalidExportTimestamp, false);
});
