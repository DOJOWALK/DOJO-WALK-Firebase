'use strict';

const turf = require('@turf/turf');

function normalizeRing(points) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('Boundary needs at least three points.');
  }

  const coordinates = points.map((point) => {
    if (!point || typeof point !== 'object') {
      throw new Error('Boundary contains an invalid point.');
    }
    const lat = point.lat;
    const lng = point.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Boundary contains an out-of-range coordinate.');
    }
    return [lng, lat];
  });

  const distinct = new Set(coordinates.map(([lng, lat]) => `${lng.toFixed(8)},${lat.toFixed(8)}`));
  if (distinct.size < 3) {
    throw new Error('Boundary needs at least three distinct points.');
  }

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([...first]);
  }
  if (coordinates.length < 4) {
    throw new Error('Boundary ring is degenerate.');
  }
  return coordinates;
}

function toValidPolygon(points) {
  const ring = normalizeRing(points);
  let polygon;
  try {
    polygon = turf.polygon([ring]);
  } catch {
    throw new Error('Boundary is not a valid polygon.');
  }
  const validity = turf.booleanValid(polygon);
  if (!validity) {
    throw new Error('Boundary polygon is invalid or self-intersecting.');
  }
  const areaSquareMeters = turf.area(polygon);
  if (!Number.isFinite(areaSquareMeters) || areaSquareMeters <= 0) {
    throw new Error('Boundary polygon must have non-zero area.');
  }
  return polygon;
}

function validateBoundaryPolygon(points) {
  return toValidPolygon(points);
}

function validateAreaInsideCity(areaPoints, cityPoints) {
  const area = toValidPolygon(areaPoints);
  const city = toValidPolygon(cityPoints);
  if (!turf.booleanWithin(area, city)) {
    throw new Error('Area boundary must be fully inside its verified City boundary.');
  }
  return true;
}

module.exports = { normalizeRing, validateBoundaryPolygon, validateAreaInsideCity };
