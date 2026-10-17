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
  };
  assert.equal(auditSnapshot(snapshot).issueCount, 0);
});
