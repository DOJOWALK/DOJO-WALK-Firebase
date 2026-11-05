import { createHash } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { polygonFromBoundary } from "./location_geometry";

const db = getFirestore();
const REGION = "asia-south1";
type Actor = { uid: string; authority: "central_admin" };
type Data = Record<string, unknown>;

function dataObject(value: unknown): Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpsError("invalid-argument", "Request data must be an object.");
  return value as Data;
}
function exact(data: Data, keys: string[]) {
  const extra = Object.keys(data).filter((key) => !keys.includes(key));
  if (extra.length) throw new HttpsError("invalid-argument", `Unknown request fields: ${extra.join(", ")}`);
}
function text(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new HttpsError("invalid-argument", `${field} must contain 1–${max} characters.`);
  return value.trim();
}
function id(value: unknown, field: string): string {
  const result = text(value, field, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError("invalid-argument", `${field} is invalid.`);
  return result;
}
function rev(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new HttpsError("invalid-argument", "expectedRevision must be a non-negative integer.");
  return Number(value);
}
function envelope(data: Data) {
  return { requestId: text(data.requestId, "requestId", 128), expectedRevision: rev(data.expectedRevision) };
}
function authUid(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  return request.auth.uid;
}
async function central(uid: string): Promise<Actor> {
  const member = await db.doc(`admin_users/${uid}`).get();
  const perms = member.get("permissions") as Record<string, unknown> | undefined;
  if (!member.exists || member.get("isActive") !== true || member.get("role") !== "central_admin" || perms?.zoneOperations !== true) {
    throw new HttpsError("permission-denied", "Active Central Admin Zone Operations permission is required.");
  }
  return { uid, authority: "central_admin" };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function hash(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function idem(uid: string, operation: string, requestId: string) {
  return db.doc(`service_zone_idempotency/${createHash("sha256").update(`${uid}|${operation}|${requestId}`).digest("hex")}`);
}
function replay(snapshot: FirebaseFirestore.DocumentSnapshot, payloadHash: string): Data | null {
  if (!snapshot.exists) return null;
  if (snapshot.get("payloadFingerprint") !== payloadHash) throw new HttpsError("already-exists", "requestId was already used with a different payload.");
  const response = snapshot.get("response");
  if (!response || typeof response !== "object") throw new HttpsError("internal", "Stored idempotency response is invalid.");
  return { ...(response as Data), replayed: true };
}
function idempotencyWrite(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, uid: string,
  operation: string, requestId: string, payloadHash: string, response: Data) {
  const now = FieldValue.serverTimestamp();
  tx.create(ref, { actorUid: uid, callableName: operation, requestId, payloadFingerprint: payloadHash, response,
    createdAt: now, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) });
}
function audit(tx: FirebaseFirestore.Transaction, zoneId: string, action: string, actor: Actor, requestId: string,
  fromRevision: number, toRevision: number, fromStatus: string, toStatus: string) {
  tx.create(db.collection("service_zone_audit").doc(), { zoneId, action, actorUid: actor.uid, actorAuthority: actor.authority,
    requestId, fromRevision, toRevision, fromStatus, toStatus, reason: null, createdAt: FieldValue.serverTimestamp() });
}

export function canonicalBoundary(value: unknown): { points: Array<{lat: number; lng: number}>; geometryHash: string } {
  if (!Array.isArray(value) || value.length < 4) throw new HttpsError("invalid-argument", "points must be a closed polygon ring with at least four positions.");
  const points = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new HttpsError("invalid-argument", `points[${index}] is invalid.`);
    const point = item as Record<string, unknown>;
    const lat = point.lat;
    const lng = point.lng;
    if (Object.keys(point).some((key) => key !== "lat" && key !== "lng") ||
      typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new HttpsError("invalid-argument", `points[${index}] coordinates are invalid.`);
    }
    return { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) };
  });
  const first = points[0], last = points[points.length - 1];
  if (first.lat !== last.lat || first.lng !== last.lng) throw new HttpsError("invalid-argument", "Polygon ring must be explicitly closed.");
  const compact = points.filter((point, index) => index === 0 || point.lat !== points[index - 1].lat || point.lng !== points[index - 1].lng);
  if (compact.length < 4 || compact[0].lat !== compact[compact.length - 1].lat || compact[0].lng !== compact[compact.length - 1].lng) {
    throw new HttpsError("invalid-argument", "Polygon ring is degenerate after canonicalization.");
  }
  try { polygonFromBoundary({ points: compact }); }
  catch (error) { throw new HttpsError("invalid-argument", error instanceof Error ? error.message : "Polygon geometry is invalid."); }

  const open = compact.slice(0, -1);
  let area = 0;
  for (let i = 0; i < open.length; i++) {
    const a = open[i], b = open[(i + 1) % open.length];
    area += a.lng * b.lat - b.lng * a.lat;
  }
  if (area < 0) open.reverse();
  let start = 0;
  for (let i = 1; i < open.length; i++) {
    if (open[i].lng < open[start].lng || (open[i].lng === open[start].lng && open[i].lat < open[start].lat)) start = i;
  }
  const rotated = [...open.slice(start), ...open.slice(0, start)];
  rotated.push({ ...rotated[0] });
  const serialized = `[${rotated.map((point) => `[${point.lng.toFixed(7)},${point.lat.toFixed(7)}]`).join(",")}]`;
  return { points: rotated, geometryHash: createHash("sha256").update(serialized, "utf8").digest("hex") };
}

export const createServiceZoneBoundaryDraft = onCall({ region: REGION }, async (request) => {
  const uid = authUid(request);
  const data = dataObject(request.data);
  exact(data, ["requestId", "expectedRevision", "zoneId", "points", "sourceType", "sourceName", "sourceReference"]);
  const env = envelope(data);
  const zoneId = id(data.zoneId, "zoneId");
  if (!["governmentGis", "governmentCadastralMap", "importedGeoJson", "manuallyDrawn"].includes(String(data.sourceType))) {
    throw new HttpsError("invalid-argument", "sourceType is invalid.");
  }
  const sourceType = String(data.sourceType);
  const sourceName = text(data.sourceName, "sourceName", 160);
  const sourceReference = text(data.sourceReference, "sourceReference", 500);
  const geometry = canonicalBoundary(data.points);
  const actor = await central(uid);
  const operation = "createServiceZoneBoundaryDraft";
  const payload = { expectedRevision: env.expectedRevision, zoneId, points: geometry.points, sourceType, sourceName, sourceReference };
  const payloadHash = hash(payload);
  const idemRef = idem(uid, operation, env.requestId);
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const boundaryRef = db.collection("service_location_boundaries").doc();
  return db.runTransaction(async (tx) => {
    const [idemSnap, zoneSnap] = await Promise.all([tx.get(idemRef), tx.get(zoneRef)]);
    const previous = replay(idemSnap, payloadHash);
    if (previous) return previous;
    if (!zoneSnap.exists) throw new HttpsError("not-found", "Zone was not found.");
    const zone = zoneSnap.data() ?? {};
    if (zone.revision !== env.expectedRevision) throw new HttpsError("failed-precondition", "Zone revision is stale.");
    if (!["draft", "boundary_verified"].includes(String(zone.workflowStatus))) throw new HttpsError("failed-precondition", "Zone is not eligible for a new Boundary draft.");
    const nextRevision = env.expectedRevision + 1;
    const boundaryRevision = Number.isSafeInteger(zone.boundaryRevision) ? Number(zone.boundaryRevision) + 1 : 1;
    const status = "boundary_review_pending";
    const response = { ok: true, requestId: env.requestId, zoneId, boundaryId: boundaryRef.id, revision: nextRevision, workflowStatus: status, replayed: false };
    const now = FieldValue.serverTimestamp();
    tx.create(boundaryRef, {
      locationType: "zone", locationId: zoneId, zoneId, zoneRevision: nextRevision, revision: boundaryRevision,
      points: geometry.points, sourceType, sourceName, sourceReference, verificationStatus: "pending",
      geometryHash: geometry.geometryHash, geometryCanonicalizationVersion: 1, submittedBy: uid,
      createdBy: uid, createdAt: now, updatedAt: now,
    });
    tx.update(zoneRef, {
      workflowStatus: status, isServiceActive: false, revision: nextRevision, boundaryRevision,
      currentBoundaryId: boundaryRef.id, verifiedBoundaryId: FieldValue.delete(),
      verifiedBoundaryRevision: FieldValue.delete(), verifiedBoundaryHash: FieldValue.delete(),
      approvedRevision: FieldValue.delete(), approvedBoundaryId: FieldValue.delete(),
      approvedBoundaryHash: FieldValue.delete(), approvedRequestId: FieldValue.delete(),
      updatedBy: uid, updatedAt: now,
    });
    audit(tx, zoneId, "zone_boundary_draft_created", actor, env.requestId, env.expectedRevision, nextRevision, String(zone.workflowStatus), status);
    idempotencyWrite(tx, idemRef, uid, operation, env.requestId, payloadHash, response);
    return response;
  });
});

export const submitServiceZoneForFounderReview = onCall({ region: REGION }, async (request) => {
  const uid = authUid(request);
  const data = dataObject(request.data);
  exact(data, ["requestId", "expectedRevision", "zoneId", "boundaryId"]);
  const env = envelope(data);
  const zoneId = id(data.zoneId, "zoneId");
  const boundaryId = id(data.boundaryId, "boundaryId");
  const actor = await central(uid);
  const operation = "submitServiceZoneForFounderReview";
  const payload = { expectedRevision: env.expectedRevision, zoneId, boundaryId };
  const payloadHash = hash(payload);
  const idemRef = idem(uid, operation, env.requestId);
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const boundaryRef = db.doc(`service_location_boundaries/${boundaryId}`);
  const approvalRef = db.collection("service_zone_approval_requests").doc();
  return db.runTransaction(async (tx) => {
    const [idemSnap, zoneSnap, boundarySnap, pending] = await Promise.all([
      tx.get(idemRef), tx.get(zoneRef), tx.get(boundaryRef),
      tx.get(db.collection("service_zone_approval_requests").where("zoneId", "==", zoneId)
        .where("requestType", "==", "activation").where("status", "==", "pending")),
    ]);
    const previous = replay(idemSnap, payloadHash);
    if (previous) return previous;
    if (!zoneSnap.exists || !boundarySnap.exists) throw new HttpsError("not-found", "Zone or Boundary was not found.");
    const zone = zoneSnap.data() ?? {}, boundary = boundarySnap.data() ?? {};
    if (zone.revision !== env.expectedRevision || zone.workflowStatus !== "boundary_verified" ||
      zone.verifiedBoundaryId !== boundaryId || zone.currentBoundaryId !== boundaryId ||
      boundary.locationType !== "zone" || boundary.locationId !== zoneId || boundary.zoneId !== zoneId ||
      boundary.verificationStatus !== "verified" || boundary.geometryHash !== zone.verifiedBoundaryHash ||
      boundary.revision !== zone.verifiedBoundaryRevision || boundary.zoneRevision > env.expectedRevision) {
      throw new HttpsError("failed-precondition", "Only the exact current verified Boundary can be submitted.");
    }
    if (pending.docs.length) throw new HttpsError("failed-precondition", "A pending activation approval request already exists.");
    const nextRevision = env.expectedRevision + 1;
    const response = { ok: true, requestId: env.requestId, zoneId, approvalRequestId: approvalRef.id,
      revision: nextRevision, workflowStatus: "founder_review_pending", replayed: false };
    const now = FieldValue.serverTimestamp();
    tx.create(approvalRef, {
      zoneId, revision: nextRevision, boundaryId, boundaryHash: boundary.geometryHash, requestType: "activation",
      status: "pending", requestedBy: uid, requestedAt: now, createdAt: now, updatedAt: now,
    });
    tx.update(zoneRef, {
      workflowStatus: "founder_review_pending", revision: nextRevision, updatedBy: uid, updatedAt: now,
      currentApprovalRequestId: approvalRef.id,
    });
    audit(tx, zoneId, "zone_submitted_for_founder_review", actor, env.requestId, env.expectedRevision,
      nextRevision, "boundary_verified", "founder_review_pending");
    idempotencyWrite(tx, idemRef, uid, operation, env.requestId, payloadHash, response);
    return response;
  });
});
