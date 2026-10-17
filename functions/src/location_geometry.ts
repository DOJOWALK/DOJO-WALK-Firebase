import { booleanValid } from "@turf/boolean-valid";
import { booleanContains } from "@turf/boolean-contains";
import { polygon } from "@turf/helpers";
import type { Feature, Polygon } from "geojson";

export interface BoundaryPoint { lat: number; lng: number }
export interface BoundaryDoc {
  locationId?: unknown;
  locationType?: unknown;
  verificationStatus?: unknown;
  points?: unknown;
  sourceName?: unknown;
  sourceReference?: unknown;
  verifiedBy?: unknown;
  verifiedAt?: unknown;
}

export function polygonFromBoundary(boundary: BoundaryDoc): Feature<Polygon> {
  if (!Array.isArray(boundary.points) || boundary.points.length < 3) {
    throw new Error("BOUNDARY_NEEDS_THREE_POINTS");
  }

  const ring: number[][] = [];
  for (const item of boundary.points) {
    if (!item || typeof item !== "object") throw new Error("BOUNDARY_POINT_INVALID");
    // Admin persists points as Firestore GeoPoint values. Firestore returns
    // those as objects with latitude/longitude; older/imported documents may
    // use lat/lng. Accept both shapes, but validate coordinates identically.
    const p = item as Partial<BoundaryPoint> & {
      latitude?: unknown;
      longitude?: unknown;
    };
    const lat = typeof p.lat === "number" ? p.lat : p.latitude;
    const lng = typeof p.lng === "number" ? p.lng : p.longitude;
    if (typeof lat !== "number" || typeof lng !== "number" ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("BOUNDARY_COORDINATE_INVALID");
    }
    ring.push([lng, lat]);
  }

  const distinct = new Set(ring.map(([lng, lat]) => `${lng},${lat}`));
  if (distinct.size < 3) throw new Error("BOUNDARY_NEEDS_THREE_DISTINCT_POINTS");
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);

  // This service currently stores ordinary longitude/latitude polygons and does
  // not unwrap antimeridian-crossing rings. Reject a longitude jump over 180°
  // so a dateline-crossing boundary cannot silently become a near-world polygon.
  for (let i = 0; i < ring.length - 1; i++) {
    if (Math.abs(ring[i + 1][0] - ring[i][0]) > 180) {
      throw new Error("BOUNDARY_ANTIMERIDIAN_CROSSING_UNSUPPORTED");
    }
  }

  // Turf's validity helper does not consistently reject degenerate rings
  // across supported dependency versions. Apply deterministic ring checks first.
  assertSimpleNonZeroAreaRing(ring);

  let candidate: Feature<Polygon>;
  try {
    candidate = polygon([ring]);
  } catch {
    throw new Error("BOUNDARY_POLYGON_INVALID");
  }
  if (!booleanValid(candidate)) throw new Error("BOUNDARY_POLYGON_INVALID");
  return candidate;
}

function assertSimpleNonZeroAreaRing(ring: number[][]): void {
  // A zero-length edge is malformed even when the overall ring has non-zero area.
  for (let i = 0; i < ring.length - 1; i++) {
    if (ring[i][0] === ring[i + 1][0] && ring[i][1] === ring[i + 1][1]) {
      throw new Error("BOUNDARY_POLYGON_INVALID");
    }
  }

  // ring is closed at this point. Shoelace area catches collinear/zero-area rings.
  let twiceArea = 0;
  let areaProductMagnitude = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const left = x1 * y2;
    const right = x2 * y1;
    twiceArea += left - right;
    areaProductMagnitude += Math.abs(left) + Math.abs(right);
  }
  // Compare area against accumulated floating-point round-off, not a fixed
  // degree-squared epsilon that rejects small but representable polygons.
  const areaErrorBound = Number.EPSILON * 16 * areaProductMagnitude;
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= areaErrorBound) {
    throw new Error("BOUNDARY_POLYGON_INVALID");
  }

  const segmentCount = ring.length - 1;
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: number[], b: number[], p: number[]) =>
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
  const crossIsNumericallyZero = (a: number[], b: number[], c: number[]) => {
    const left = (b[0] - a[0]) * (c[1] - a[1]);
    const right = (b[1] - a[1]) * (c[0] - a[0]);
    const errorBound = Number.EPSILON * 16 * (Math.abs(left) + Math.abs(right));
    return Math.abs(left - right) <= errorBound;
  };
  const intersects = (a: number[], b: number[], c: number[], d: number[]) => {
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
        ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return (crossIsNumericallyZero(a, b, c) && onSegment(a, b, c)) ||
      (crossIsNumericallyZero(a, b, d) && onSegment(a, b, d)) ||
      (crossIsNumericallyZero(c, d, a) && onSegment(c, d, a)) ||
      (crossIsNumericallyZero(c, d, b) && onSegment(c, d, b));
  };

  for (let i = 0; i < segmentCount; i++) {
    for (let j = i + 1; j < segmentCount; j++) {
      // Consecutive edges share their intended endpoint; first and last do too.
      if (j === i + 1 || (i === 0 && j === segmentCount - 1)) continue;
      if (intersects(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        throw new Error("BOUNDARY_POLYGON_INVALID");
      }
    }
  }
}

export function assertAreaCoveredByCity(areaBoundary: BoundaryDoc, cityBoundary: BoundaryDoc): void {
  const area = polygonFromBoundary(areaBoundary);
  const city = polygonFromBoundary(cityBoundary);
  if (!booleanContains(city, area)) throw new Error("AREA_NOT_FULLY_WITHIN_PARENT_CITY");
}
