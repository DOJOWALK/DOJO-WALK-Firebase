import { createHash } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { polygonFromBoundary } from "./location_geometry";
import { canonicalBoundary } from "./zone_lifecycle_boundary";

const db = getFirestore();
const REGION = "asia-south1";
type Actor = { uid: string; authority: "central_admin" | "founder" | "boundary_reviewer" };
type Data = Record<string, unknown>;

function objectData(value: unknown): Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  return value as Data;
}
function exactKeys(data: Data, allowed: string[]): void {
  const extra = Object.keys(data).filter((key) => !allowed.includes(key));
  if (extra.length) throw new HttpsError("invalid-argument", `Unknown request fields: ${extra.join(", ")}`);
}
function safeId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  return value;
}
function requiredText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new HttpsError("invalid-argument", `${field} must contain 1–${max} characters.`);
  }
  return value.trim();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new HttpsError("invalid-argument", "expectedRevision must be a non-negative integer.");
  }
  return Number(value);
}
function requestEnvelope(data: Data): { requestId: string; expectedRevision: number } {
  return {
    requestId: requiredText(data.requestId, "requestId", 128),
    expectedRevision: revision(data.expectedRevision),
  };
}
function fingerprint(data: Data): string {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };
  return createHash("sha256").update(stable(data)).digest("hex");
}
function idemRef(uid: string, operation: string, requestId: string) {
  const id = createHash("sha256").update(`${uid}|${operation}|${requestId}`).digest("hex");
  return db.doc(`service_zone_idempotency/${id}`);
}
function normalizeName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
function nameIndexId(cityId: string, normalizedName: string): string {
  return `${cityId}_${createHash("sha256").update(normalizedName).digest("hex")}`;
}
function permissions(data: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  return data?.permissions && typeof data.permissions === "object" ? data.permissions : {};
}
async function requireCentral(uid: string): Promise<Actor> {
  const snap = await db.doc(`admin_users/${uid}`).get();
  if (!snap.exists || snap.get("isActive") !== true || snap.get("role") !== "central_admin" ||
      permissions(snap.data()).zoneOperations !== true) {
    throw new HttpsError("permission-denied", "Active Central Admin Zone Operations permission is required.");
  }
  return { uid, authority: "central_admin" };
}
async function requireFounder(uid: string): Promise<Actor> {
  const snap = await db.doc(`founder_users/${uid}`).get();
  if (!snap.exists || snap.get("isActive") !== true || snap.get("authorityType") !== "founder_ceo" ||
      permissions(snap.data()).founderApproval !== true) {
    throw new HttpsError("permission-denied", "Active Founder approval authority is required.");
  }
  return { uid, authority: "founder" };
}
function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  return request.auth.uid;
}
function audit(tx: FirebaseFirestore.Transaction, zoneId: string, action: string, actor: Actor,
  requestId: string, fromRevision: number, toRevision: number, fromStatus: string, toStatus: string, reason?: string) {
  tx.create(db.collection("service_zone_audit").doc(), {
    zoneId, action, actorUid: actor.uid, actorAuthority: actor.authority, requestId,
    fromRevision, toRevision, fromStatus, toStatus, reason: reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}
function replayOrConflict(
  snap: FirebaseFirestore.DocumentSnapshot, payloadFingerprint: string,
): Data | null {
  if (!snap.exists) return null;
  if (snap.get("payloadFingerprint") !== payloadFingerprint) {
    throw new HttpsError("already-exists", "requestId was already used with a different payload.");
  }
  const response = snap.get("response");
  if (!response || typeof response !== "object") throw new HttpsError("internal", "Stored idempotency response is invalid.");
  return { ...(response as Data), replayed: true };
}
function success(requestId: string, zoneId: string, revisionNo: number, status: string, extra: Data = {}) {
  return { ok: true, requestId, zoneId, revision: revisionNo, workflowStatus: status, replayed: false, ...extra };
}

export const createServiceZoneDraft = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const data = objectData(request.data);
  exactKeys(data, ["requestId", "expectedRevision", "stateId", "districtId", "cityId", "name"]);
  const env = requestEnvelope(data);
  if (env.expectedRevision !== 0) throw new HttpsError("invalid-argument", "Zone creation requires expectedRevision: 0.");
  const stateId = safeId(data.stateId, "stateId");
  const districtId = safeId(data.districtId, "districtId");
  const cityId = safeId(data.cityId, "cityId");
  const name = requiredText(data.name, "name", 120);
  const normalizedName = normalizeName(name);
  if (!normalizedName) throw new HttpsError("invalid-argument", "Zone name is empty after normalization.");
  const actor = await requireCentral(uid);
  const operation = "createServiceZoneDraft";
  const payload = { expectedRevision: 0, stateId, districtId, cityId, name };
  const payloadFingerprint = fingerprint(payload);
  const idempotencyRef = idemRef(uid, operation, env.requestId);
  const indexRef = db.doc(`service_zone_name_indexes/${nameIndexId(cityId, normalizedName)}`);
  const zoneRef = db.collection("service_zones").doc();
  const auditRef = db.collection("service_zone_audit").doc();

  return db.runTransaction(async (tx) => {
    const [idem, index] = await Promise.all([tx.get(idempotencyRef), tx.get(indexRef)]);
    const replay = replayOrConflict(idem, payloadFingerprint);
    if (replay) return replay;
    if (index.exists) throw new HttpsError("already-exists", "A Zone with this normalized name already exists in this City.");
    const timestamp = FieldValue.serverTimestamp();
    const response = success(env.requestId, zoneRef.id, 1, "draft");
    tx.create(zoneRef, {
      schemaVersion: 1, zoneId: zoneRef.id, stateId, districtId, cityId, name, normalizedName,
      workflowStatus: "draft", isServiceActive: false, revision: 1,
      createdBy: uid, updatedBy: uid, createdAt: timestamp, updatedAt: timestamp,
    });
    tx.create(indexRef, { cityId, normalizedName, zoneId: zoneRef.id, createdAt: timestamp, updatedAt: timestamp });
    tx.create(auditRef, {
      zoneId: zoneRef.id, action: "zone_draft_created", actorUid: uid, actorAuthority: actor.authority,
      requestId: env.requestId, fromRevision: 0, toRevision: 1, fromStatus: null, toStatus: "draft",
      createdAt: timestamp,
    });
    tx.create(idempotencyRef, {
      actorUid: uid, callableName: operation, requestId: env.requestId,
      payloadFingerprint, response, createdAt: timestamp,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return response;
  });
});

export const reviewServiceZoneBoundary = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const data = objectData(request.data);
  exactKeys(data, ["requestId", "expectedRevision", "zoneId", "boundaryId", "decision", "notes"]);
  const env = requestEnvelope(data);
  const zoneId = safeId(data.zoneId, "zoneId");
  const boundaryId = safeId(data.boundaryId, "boundaryId");
  if (data.decision !== "verified" && data.decision !== "rejected") throw new HttpsError("invalid-argument", "decision must be verified or rejected.");
  const decision = data.decision;
  const notes = requiredText(data.notes, "notes", 2000);
  const reviewerSnap = await db.doc(`admin_users/${uid}`).get();
  if (!reviewerSnap.exists || reviewerSnap.get("isActive") !== true || permissions(reviewerSnap.data()).zoneBoundaryReview !== true) {
    throw new HttpsError("permission-denied", "Active boundary-review permission is required.");
  }
  const assignmentQuery = await db.collection("zone_boundary_review_assignments")
    .where("reviewerUid", "==", uid).where("zoneId", "==", zoneId).where("boundaryId", "==", boundaryId).get();
  if (!assignmentQuery.docs.some((doc) => doc.get("status") === "assigned" && doc.get("isActive") !== false)) {
    throw new HttpsError("permission-denied", "An active exact Boundary review assignment is required.");
  }
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const boundaryRef = db.doc(`service_location_boundaries/${boundaryId}`);
  const idempotencyRef = idemRef(uid, "reviewServiceZoneBoundary", env.requestId);
  const payloadFingerprint = fingerprint({ expectedRevision: env.expectedRevision, zoneId, boundaryId, decision, notes });
  return db.runTransaction(async (tx) => {
    const [idem, zoneSnap, boundarySnap, assignmentSnaps] = await Promise.all([
      tx.get(idempotencyRef), tx.get(zoneRef), tx.get(boundaryRef),
      tx.get(db.collection("zone_boundary_review_assignments").where("reviewerUid", "==", uid)
        .where("zoneId", "==", zoneId).where("boundaryId", "==", boundaryId)),
    ]);
    const replay = replayOrConflict(idem, payloadFingerprint);
    if (replay) return replay;
    if (!zoneSnap.exists || !boundarySnap.exists) throw new HttpsError("not-found", "Zone or Boundary was not found.");
    const zone = zoneSnap.data() ?? {};
    const boundary = boundarySnap.data() ?? {};
    if (zone.revision !== env.expectedRevision) throw new HttpsError("failed-precondition", "Zone revision is stale.");
    if (boundary.locationType !== "zone" || boundary.locationId !== zoneId || boundary.zoneId !== zoneId ||
        boundary.verificationStatus !== "pending" || zone.currentBoundaryId !== boundaryId) {
      throw new HttpsError("failed-precondition", "Boundary is not the current pending Boundary for this Zone.");
    }
    if (boundary.submittedBy === uid || boundary.createdBy === uid) {
      throw new HttpsError("permission-denied", "A Boundary submitter cannot review their own submission.");
    }
    if (!assignmentSnaps.docs.some((doc) => doc.get("status") === "assigned" && doc.get("isActive") !== false)) {
      throw new HttpsError("permission-denied", "Boundary review assignment is no longer active.");
    }
    if (decision === "verified") {
      try {
        polygonFromBoundary(boundary as never);
        const canonical = canonicalBoundary(boundary.points);
        if (canonical.geometryHash !== boundary.geometryHash) {
          throw new HttpsError("failed-precondition", "Stored Boundary geometry hash does not match its canonical coordinates.");
        }
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Boundary geometry is invalid.");
      }
    }
    const nextRevision = env.expectedRevision + 1;
    const nextStatus = decision === "verified" ? "boundary_verified" : "draft";
    const timestamp = FieldValue.serverTimestamp();
    const response = success(env.requestId, zoneId, nextRevision, nextStatus, { boundaryId });
    tx.update(boundaryRef, {
      verificationStatus: decision, reviewedBy: uid, reviewedAt: timestamp, reviewNotes: notes, updatedAt: timestamp,
      ...(decision === "verified" ? { verifiedAt: timestamp } : {}),
    });
    tx.update(zoneRef, {
      workflowStatus: nextStatus, revision: nextRevision, updatedBy: uid, updatedAt: timestamp,
      ...(decision === "verified" ? { verifiedBoundaryId: boundaryId, verifiedBoundaryRevision: boundary.revision, verifiedBoundaryHash: boundary.geometryHash ?? null } : {}),
    });
    audit(tx, zoneId, `boundary_${decision}`, { uid, authority: "boundary_reviewer" }, env.requestId,
      env.expectedRevision, nextRevision, String(zone.workflowStatus), nextStatus, notes);
    tx.create(idempotencyRef, {
      actorUid: uid, callableName: "reviewServiceZoneBoundary", requestId: env.requestId,
      payloadFingerprint, response, createdAt: timestamp,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return response;
  });
});

export const decideServiceZoneFounderApproval = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const data = objectData(request.data);
  exactKeys(data, ["requestId", "expectedRevision", "approvalRequestId", "zoneId", "revision", "boundaryId", "boundaryHash", "requestType", "decision", "notes"]);
  const env = requestEnvelope(data);
  const approvalRequestId = safeId(data.approvalRequestId, "approvalRequestId");
  const zoneId = safeId(data.zoneId, "zoneId");
  const targetRevision = revision(data.revision);
  const boundaryId = safeId(data.boundaryId, "boundaryId");
  const boundaryHash = requiredText(data.boundaryHash, "boundaryHash", 64);
  if (!/^[a-f0-9]{64}$/.test(boundaryHash)) throw new HttpsError("invalid-argument", "boundaryHash must be a SHA-256 hex digest.");
  if (!["activation", "routine_deactivation", "reactivation"].includes(String(data.requestType))) throw new HttpsError("invalid-argument", "requestType is invalid.");
  if (!["approved", "rejected", "changes_required"].includes(String(data.decision))) throw new HttpsError("invalid-argument", "decision is invalid.");
  const requestType = String(data.requestType);
  const decision = String(data.decision);
  const notes = requiredText(data.notes, "notes", 2000);
  const actor = await requireFounder(uid);
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const approvalRef = db.doc(`service_zone_approval_requests/${approvalRequestId}`);
  const idempotencyRef = idemRef(uid, "decideServiceZoneFounderApproval", env.requestId);
  const payloadFingerprint = fingerprint({
    expectedRevision: env.expectedRevision, approvalRequestId, zoneId, revision: targetRevision,
    boundaryId, boundaryHash, requestType, decision, notes,
  });
  return db.runTransaction(async (tx) => {
    const [idem, zoneSnap, approvalSnap] = await Promise.all([tx.get(idempotencyRef), tx.get(zoneRef), tx.get(approvalRef)]);
    const replay = replayOrConflict(idem, payloadFingerprint);
    if (replay) return replay;
    if (!zoneSnap.exists || !approvalSnap.exists) throw new HttpsError("not-found", "Zone or approval request was not found.");
    const zone = zoneSnap.data() ?? {};
    const approval = approvalSnap.data() ?? {};
    if (zone.revision !== env.expectedRevision || targetRevision !== env.expectedRevision ||
        zone.workflowStatus !== (requestType === "activation" ? "founder_review_pending" : requestType === "routine_deactivation" ? "deactivation_pending" : "reactivation_pending") ||
        approval.zoneId !== zoneId || approval.revision !== targetRevision ||
        approval.boundaryId !== boundaryId || approval.boundaryHash !== boundaryHash ||
        approval.requestType !== requestType || approval.status !== "pending" ||
        zone.verifiedBoundaryId !== boundaryId || zone.verifiedBoundaryHash !== boundaryHash) {
      throw new HttpsError("failed-precondition", "Founder approval tuple is stale or does not match the current Zone and Boundary.");
    }
    const nextStatus = decision === "approved"
      ? (requestType === "activation" ? "approved" : requestType === "routine_deactivation" ? "inactive" : "reactivation_pending")
      : (requestType === "activation" ? "boundary_verified" : requestType === "routine_deactivation" ? "active" : (zone.suspensionReason ? "suspended" : "inactive"));
    const nextRevision = env.expectedRevision + 1;
    const timestamp = FieldValue.serverTimestamp();
    const response = success(env.requestId, zoneId, nextRevision, nextStatus, { approvalRequestId });
    tx.update(approvalRef, { status: decision, decision, decidedBy: uid, decidedAt: timestamp, notes, updatedAt: timestamp });
    tx.update(zoneRef, {
      workflowStatus: nextStatus, revision: nextRevision, updatedBy: uid, updatedAt: timestamp,
      ...(requestType === "routine_deactivation" && decision === "approved" ? { isServiceActive: false } : {}),
      ...(requestType === "routine_deactivation" && decision !== "approved" ? { isServiceActive: true } : {}),
      ...(decision === "approved" ? {
        approvedRevision: targetRevision, approvedBoundaryId: boundaryId,
        approvedBoundaryHash: boundaryHash, approvedRequestId: approvalRequestId,
      } : {}),
    });
    audit(tx, zoneId, "founder_approval_decided", actor, env.requestId, env.expectedRevision, nextRevision,
      String(zone.workflowStatus), nextStatus, notes);
    tx.create(idempotencyRef, {
      actorUid: uid, callableName: "decideServiceZoneFounderApproval", requestId: env.requestId,
      payloadFingerprint, response, createdAt: timestamp,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return response;
  });
});

export const activateServiceZone = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const data = objectData(request.data);
  exactKeys(data, ["requestId", "expectedRevision", "zoneId"]);
  const env = requestEnvelope(data);
  const zoneId = safeId(data.zoneId, "zoneId");
  const actor = await requireCentral(uid);
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const idempotencyRef = idemRef(uid, "activateServiceZone", env.requestId);
  const payloadFingerprint = fingerprint({ expectedRevision: env.expectedRevision, zoneId });
  return db.runTransaction(async (tx) => {
    const [idem, zoneSnap] = await Promise.all([tx.get(idempotencyRef), tx.get(zoneRef)]);
    const replay = replayOrConflict(idem, payloadFingerprint);
    if (replay) return replay;
    if (!zoneSnap.exists) throw new HttpsError("not-found", "Zone was not found.");
    const zone = zoneSnap.data() ?? {};
    if (zone.revision !== env.expectedRevision || zone.workflowStatus !== "approved" ||
        zone.isServiceActive === true || (zone.approvedRevision !== zone.revision && zone.approvedRevision !== zone.revision - 1) ||
        zone.approvedBoundaryId !== zone.verifiedBoundaryId ||
        zone.approvedBoundaryHash !== zone.verifiedBoundaryHash ||
        typeof zone.approvedRequestId !== "string") {
      throw new HttpsError("failed-precondition", "Zone revision or exact Founder approval is stale.");
    }
    const approvalRef = db.doc(`service_zone_approval_requests/${zone.approvedRequestId}`);
    const approvalSnap = await tx.get(approvalRef);
    if (!approvalSnap.exists || approvalSnap.get("status") !== "approved" ||
        approvalSnap.get("requestType") !== "activation" || approvalSnap.get("zoneId") !== zoneId ||
        approvalSnap.get("revision") !== zone.approvedRevision ||
        approvalSnap.get("boundaryId") !== zone.approvedBoundaryId ||
        approvalSnap.get("boundaryHash") !== zone.approvedBoundaryHash) {
      throw new HttpsError("failed-precondition", "A current exact Founder activation approval is required.");
    }
    const nextRevision = env.expectedRevision + 1;
    const timestamp = FieldValue.serverTimestamp();
    const response = success(env.requestId, zoneId, nextRevision, "active");
    tx.update(zoneRef, { workflowStatus: "active", isServiceActive: true, revision: nextRevision, updatedBy: uid, updatedAt: timestamp });
    audit(tx, zoneId, "zone_activated", actor, env.requestId, env.expectedRevision, nextRevision, "approved", "active");
    tx.create(idempotencyRef, {
      actorUid: uid, callableName: "activateServiceZone", requestId: env.requestId,
      payloadFingerprint, response, createdAt: timestamp,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return response;
  });
});
