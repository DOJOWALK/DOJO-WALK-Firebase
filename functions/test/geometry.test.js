'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBoundaryPolygon, validateAreaInsideCity } = require('../geometry');

const city = [
  { lat: 28.50, lng: 77.30 },
  { lat: 28.60, lng: 77.30 },
  { lat: 28.60, lng: 77.40 },
  { lat: 28.50, lng: 77.40 },
];

test('accepts a valid simple polygon', () => {
  assert.doesNotThrow(() => validateBoundaryPolygon(city));
});

test('rejects fewer than three distinct vertices', () => {
  assert.throws(() => validateBoundaryPolygon([
    { lat: 1, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 1 },
  ]), /distinct points/);
});

test('rejects out-of-range coordinates', () => {
  assert.throws(() => validateBoundaryPolygon([
    { lat: 91, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 },
  ]), /out-of-range/);
});

test('rejects self-intersecting polygon', () => {
  assert.throws(() => validateBoundaryPolygon([
    { lat: 0, lng: 0 }, { lat: 1, lng: 1 },
    { lat: 0, lng: 1 }, { lat: 1, lng: 0 },
  ]));
});

test('accepts an Area fully inside City', () => {
  assert.equal(validateAreaInsideCity([
    { lat: 28.52, lng: 77.32 },
    { lat: 28.54, lng: 77.32 },
    { lat: 28.54, lng: 77.34 },
    { lat: 28.52, lng: 77.34 },
  ], city), true);
});

test('rejects an Area extending outside City', () => {
  assert.throws(() => validateAreaInsideCity([
    { lat: 28.55, lng: 77.35 },
    { lat: 28.62, lng: 77.35 },
    { lat: 28.62, lng: 77.38 },
    { lat: 28.55, lng: 77.38 },
  ], city), /fully inside/);
});

test('rejects an Area crossing a concave City notch', () => {
  const concaveCity = [
    { lat: 0, lng: 0 }, { lat: 0, lng: 4 }, { lat: 1, lng: 4 },
    { lat: 1, lng: 1 }, { lat: 4, lng: 1 }, { lat: 4, lng: 0 },
  ];
  const areaCrossingNotch = [
    { lat: 0.5, lng: 0.5 }, { lat: 0.5, lng: 2 },
    { lat: 2, lng: 2 }, { lat: 2, lng: 0.5 },
  ];
  assert.throws(() => validateAreaInsideCity(areaCrossingNotch, concaveCity));
});
