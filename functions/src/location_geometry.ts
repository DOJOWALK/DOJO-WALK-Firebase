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
    const p = item as Partial<BoundaryPoint>;
    if (typeof p.lat !== "number" || typeof p.lng !== "number" ||
        !Number.isFinite(p.lat) || !Number.isFinite(p.lng) ||
        p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) {
      throw new Error("BOUNDARY_COORDINATE_INVALID");
    }
    ring.push([p.lng, p.lat]);
  }

  const distinct = new Set(ring.map(([lng, lat]) => `${lng},${lat}`));
  if (distinct.size < 3) throw new Error("BOUNDARY_NEEDS_THREE_DISTINCT_POINTS");
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);

  let candidate: Feature<Polygon>;
  try {
    candidate = polygon([ring]);
  } catch {
    throw new Error("BOUNDARY_POLYGON_INVALID");
  }
  if (!booleanValid(candidate)) throw new Error("BOUNDARY_POLYGON_INVALID");
  return candidate;
}

export function assertAreaCoveredByCity(areaBoundary: BoundaryDoc, cityBoundary: BoundaryDoc): void {
  const area = polygonFromBoundary(areaBoundary);
  const city = polygonFromBoundary(cityBoundary);
  if (!booleanContains(city, area)) throw new Error("AREA_NOT_FULLY_WITHIN_PARENT_CITY");
}
