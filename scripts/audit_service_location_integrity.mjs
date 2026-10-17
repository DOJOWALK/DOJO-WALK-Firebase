#!/usr/bin/env node
/**
 * Read-only offline audit of a JSON snapshot of DOJO WALK service-location docs.
 *
 * Input shape:
 * {
 *   "service_countries": {"india": {"isActive": false}},
 *   "service_states": {"up": {"countryId": "india", "isActive": false}},
 *   "service_cities": {"city-id": {"countryId":"india","stateId":"up","isServiceActive":false}},
 *   "service_areas": {"area-id": {"countryId":"india","stateId":"up","cityId":"city-id","isServiceActive":false}},
 *   "service_localities": {"locality-id": {"countryId":"india","stateId":"up","cityId":"city-id","areaId":"area-id","isServiceActive":false}}
 * }
 *
 * This tool never connects to Firebase and never changes source data.
 * Usage: node scripts/audit_service_location_integrity.mjs snapshot.json [report.json]
 */
import fs from 'node:fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || inputPath === '--help') {
  console.error('Usage: node scripts/audit_service_location_integrity.mjs <snapshot.json> [report.json]');
  process.exit(inputPath === '--help' ? 0 : 2);
}
const snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const collections = [
  'service_countries', 'service_states', 'service_cities',
  'service_areas', 'service_localities',
];
for (const name of collections) {
  if (!snapshot[name] || typeof snapshot[name] !== 'object' || Array.isArray(snapshot[name])) {
    throw new Error(`Snapshot must include object collection "${name}" keyed by document ID.`);
  }
}
const issues = [];
const records = Object.fromEntries(collections.map(name => [name, Object.keys(snapshot[name]).length]));
const add = (type, id, code, detail) => issues.push({ type, id, code, detail });
const countries = snapshot.service_countries;
const states = snapshot.service_states;
const cities = snapshot.service_cities;
const areas = snapshot.service_areas;
const localities = snapshot.service_localities;

for (const [id, d] of Object.entries(states)) {
  if (!countries[d.countryId]) add('state', id, 'MISSING_COUNTRY', `countryId "${d.countryId ?? ''}" does not resolve`);
  if (d.isActive === true && countries[d.countryId]?.isActive !== true) add('state', id, 'ACTIVE_UNDER_INACTIVE_COUNTRY', 'Active State has no active Country ancestor');
}
for (const [id, d] of Object.entries(cities)) {
  const state = states[d.stateId];
  if (!countries[d.countryId]) add('city', id, 'MISSING_COUNTRY', `countryId "${d.countryId ?? ''}" does not resolve`);
  if (!state) add('city', id, 'MISSING_STATE', `stateId "${d.stateId ?? ''}" does not resolve`);
  else if (state.countryId !== d.countryId) add('city', id, 'STATE_COUNTRY_MISMATCH', 'City countryId does not match its State countryId');
  if (d.isServiceActive === true && (countries[d.countryId]?.isActive !== true || state?.isActive !== true)) add('city', id, 'ACTIVE_UNDER_INACTIVE_ANCESTOR', 'Active City has an inactive or missing Country/State ancestor');
}
for (const [id, d] of Object.entries(areas)) {
  const state = states[d.stateId], city = cities[d.cityId];
  if (!countries[d.countryId]) add('area', id, 'MISSING_COUNTRY', `countryId "${d.countryId ?? ''}" does not resolve`);
  if (!state) add('area', id, 'MISSING_STATE', `stateId "${d.stateId ?? ''}" does not resolve`);
  else if (state.countryId !== d.countryId) add('area', id, 'STATE_COUNTRY_MISMATCH', 'Area countryId does not match its State countryId');
  if (!city) add('area', id, 'MISSING_CITY', `cityId "${d.cityId ?? ''}" does not resolve`);
  else if (city.countryId !== d.countryId || city.stateId !== d.stateId) add('area', id, 'CITY_ANCESTRY_MISMATCH', 'Area Country/State IDs do not match its City');
  if (d.isServiceActive === true && (countries[d.countryId]?.isActive !== true || state?.isActive !== true || city?.isServiceActive !== true)) add('area', id, 'ACTIVE_UNDER_INACTIVE_ANCESTOR', 'Active Area has an inactive or missing ancestor');
}
for (const [id, d] of Object.entries(localities)) {
  const state = states[d.stateId], city = cities[d.cityId], area = areas[d.areaId];
  if (!countries[d.countryId]) add('locality', id, 'MISSING_COUNTRY', `countryId "${d.countryId ?? ''}" does not resolve`);
  if (!state) add('locality', id, 'MISSING_STATE', `stateId "${d.stateId ?? ''}" does not resolve`);
  else if (state.countryId !== d.countryId) add('locality', id, 'STATE_COUNTRY_MISMATCH', 'Locality countryId does not match its State countryId');
  if (!city) add('locality', id, 'MISSING_CITY', `cityId "${d.cityId ?? ''}" does not resolve`);
  else if (city.countryId !== d.countryId || city.stateId !== d.stateId) add('locality', id, 'CITY_ANCESTRY_MISMATCH', 'Locality Country/State IDs do not match its City');
  if (!area) add('locality', id, 'MISSING_AREA', `areaId "${d.areaId ?? ''}" does not resolve`);
  else if (area.countryId !== d.countryId || area.stateId !== d.stateId || area.cityId !== d.cityId) add('locality', id, 'AREA_ANCESTRY_MISMATCH', 'Locality Country/State/City IDs do not match its Area');
  if (d.isServiceActive === true && (countries[d.countryId]?.isActive !== true || state?.isActive !== true || city?.isServiceActive !== true || area?.isServiceActive !== true)) add('locality', id, 'ACTIVE_UNDER_INACTIVE_ANCESTOR', 'Active Locality has an inactive or missing ancestor');
}
const report = {
  audit: 'DOJO WALK service-location hierarchy integrity',
  mode: 'read-only offline snapshot; no Firebase connection; no source writes',
  counts: records,
  totalRecords: Object.values(records).reduce((sum, n) => sum + n, 0),
  issueCount: issues.length,
  issues,
};
const output = JSON.stringify(report, null, 2) + '\n';
if (outputPath) fs.writeFileSync(outputPath, output, { flag: 'wx' });
else process.stdout.write(output);
if (issues.length) process.exitCode = 1;
