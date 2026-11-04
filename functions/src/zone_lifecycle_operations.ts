import { createHash } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const db = getFirestore();
const REGION = "asia-south1";
type Actor = { uid: string; authority: "central_admin" };
type Data = Record<string, unknown>;
function obj(value: unknown): Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpsError("invalid-argument", "Request data must be an object.");
  return value as Data;
}
function keys(data: Data, allowed: string[]) {
  const extra = Object.keys(data).filter((key) => !allowed.includes(key));
  if (extra.length) throw new HttpsError("invalid-argument", `Unknown request fields: ${extra.join(", ")}`);
}
function str(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new HttpsError("invalid-argument", `${field} must contain 1–${max} characters.`);
  return value.trim();
}
function safeId(value: unknown, field: string): string {
  const result = str(value, field, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError("invalid-argument", `${field} is invalid.`);
  return result;
}
function numberRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new HttpsError("invalid-argument", "expectedRevision must be a non-negative integer.");
  return Number(value);
}
function env(data: Data) { return { requestId: str(data.requestId, "requestId", 128), expectedRevision: numberRevision(data.expectedRevision) }; }
function uidOf(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  return request.auth.uid;
}
async function central(uid: string, permission: "zoneOperations" | "zoneEmergencySuspend"): Promise<Actor> {
  const member = await db.doc(`admin_users/${uid}`).get();
  const permissions = member.get("permissions") as Record<string, unknown> | undefined;
  if (!member.exists || member.get("isActive") !== true || member.get("role") !== "central_admin" || permissions?.[permission] !== true) {
    throw new HttpsError("permission-denied", `Active Central Admin ${permission} permission is required.`);
  }
  return { uid, authority: "central_admin" };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function idemRef(uid: string, operation: string, requestId: string) {
  return db.doc(`service_zone_idempotency/${createHash("sha256").update(`${uid}|${operation}|${requestId}`).digest("hex")}`);
}
function replay(snap: FirebaseFirestore.DocumentSnapshot, hash: string): Data | null {
  if (!snap.exists) return null;
  if (snap.get("payloadFingerprint") !== hash) throw new HttpsError("already-exists", "requestId was already used with a different payload.");
  const response = snap.get("response");
  if (!response || typeof response !== "object") throw new HttpsError("internal", "Stored idempotency response is invalid.");
  return { ...(response as Data), replayed: true };
}
function idemWrite(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, uid: string,
  operation: string, requestId: string, hash: string, response: Data) {
  const now = FieldValue.serverTimestamp();
  tx.create(ref, { actorUid: uid, callableName: operation, requestId, payloadFingerprint: hash, response,
    createdAt: now, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) });
}
function writeAudit(tx: FirebaseFirestore.Transaction, zoneId: string, action: string, actor: Actor, requestId: string,
  fromRevision: number, toRevision: number, fromStatus: string, toStatus: string, reason?: string) {
  tx.create(db.collection("service_zone_audit").doc(), { zoneId, action, actorUid: actor.uid, actorAuthority: actor.authority,
    requestId, fromRevision, toRevision, fromStatus, toStatus, reason: reason ?? null, createdAt: FieldValue.serverTimestamp() });
}
function requireVerifiedBoundary(zone: FirebaseFirestore.DocumentData, zoneId: string) {
  if (typeof zone.verifiedBoundaryId !== "string" || !zone.verifiedBoundaryId ||
      typeof zone.verifiedBoundaryHash !== "string" || !/^[a-f0-9]{64}$/.test(zone.verifiedBoundaryHash) ||
      !Number.isSafeInteger(zone.verifiedBoundaryRevision)) {
    throw new HttpsError("failed-precondition", `Zone ${zoneId} has no verified current Boundary.`);
  }
}

async function createApprovalRequest(uid: string, operation: string, requestId: string, expectedRevision: number,
  zoneId: string, reason: string, requestType: "routine_deactivation" | "reactivation") {
  const actor = await central(uid, "zoneOperations");
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const idempotencyRef = idemRef(uid, operation, requestId);
  const payloadHash = fingerprint({ expectedRevision, zoneId, reason });
  const approvalRef = db.collection("service_zone_approval_requests").doc();
  return db.runTransaction(async (tx) => {
    const [idem, zoneSnap, pending] = await Promise.all([
      tx.get(idempotencyRef), tx.get(zoneRef),
      tx.get(db.collection("service_zone_approval_requests").where("zoneId", "==", zoneId)
        .where("requestType", "==", requestType).where("status", "==", "pending")),
    ]);
    const prior = replay(idem, payloadHash);
    if (prior) return prior;
    if (!zoneSnap.exists) throw new HttpsError("not-found", "Zone was not found.");
    const zone = zoneSnap.data() ?? {};
    if (zone.revision !== expectedRevision) throw new HttpsError("failed-precondition", "Zone revision is stale.");
    requireVerifiedBoundary(zone, zoneId);
    const allowed = requestType === "routine_deactivation" ? zone.workflowStatus === "active" && zone.isServiceActive === true
      : ["inactive", "suspended"].includes(String(zone.workflowStatus)) && zone.isServiceActive === false;
    if (!allowed) throw new HttpsError("failed-precondition", `Zone is not eligible for ${requestType}.`);
    if (pending.docs.length) throw new HttpsError("failed-precondition", `A pending ${requestType} approval request already exists.`);
    const nextRevision = expectedRevision + 1;
    const nextStatus = requestType === "routine_deactivation" ? "deactivation_pending" : "reactivation_pending";
    const now = FieldValue.serverTimestamp();
    const response = { ok: true, requestId, zoneId, approvalRequestId: approvalRef.id,
      revision: nextRevision, workflowStatus: nextStatus, replayed: false };
    tx.create(approvalRef, { zoneId, revision: nextRevision, boundaryId: zone.verifiedBoundaryId,
      boundaryHash: zone.verifiedBoundaryHash, requestType, status: "pending", requestedBy: uid,
      reason, requestedAt: now, createdAt: now, updatedAt: now });
    tx.update(zoneRef, { workflowStatus: nextStatus, revision: nextRevision,
      currentApprovalRequestId: approvalRef.id, updatedBy: uid, updatedAt: now });
    writeAudit(tx, zoneId, requestType === "routine_deactivation" ? "zone_deactivation_requested" : "zone_reactivation_requested",
      actor, requestId, expectedRevision, nextRevision, String(zone.workflowStatus), nextStatus, reason);
    idemWrite(tx, idempotencyRef, uid, operation, requestId, payloadHash, response);
    return response;
  });
}

export const requestServiceZoneDeactivation = onCall({ region: REGION }, async (request) => {
  const uid = uidOf(request), data = obj(request.data);
  keys(data, ["requestId", "expectedRevision", "zoneId", "notes"]);
  const requestId = str(data.requestId, "requestId", 128), expectedRevision = numberRevision(data.expectedRevision);
  const zoneId = safeId(data.zoneId, "zoneId"), notes = str(data.notes, "notes", 2000);
  return createApprovalRequest(uid, "requestServiceZoneDeactivation", requestId, expectedRevision, zoneId, notes, "routine_deactivation");
});

export const requestServiceZoneReactivation = onCall({ region: REGION }, async (request) => {
  const uid = uidOf(request), data = obj(request.data);
  keys(data, ["requestId", "expectedRevision", "zoneId", "reason"]);
  const requestId = str(data.requestId, "requestId", 128), expectedRevision = numberRevision(data.expectedRevision);
  const zoneId = safeId(data.zoneId, "zoneId"), reason = str(data.reason, "reason", 2000);
  return createApprovalRequest(uid, "requestServiceZoneReactivation", requestId, expectedRevision, zoneId, reason, "reactivation");
});

export const suspendServiceZoneForEmergency = onCall({ region: REGION }, async (request) => {
  const uid = uidOf(request), data = obj(request.data);
  keys(data, ["requestId", "expectedRevision", "zoneId", "reason", "severity"]);
  const requestId = str(data.requestId, "requestId", 128), expectedRevision = numberRevision(data.expectedRevision);
  const zoneId = safeId(data.zoneId, "zoneId"), reason = str(data.reason, "reason", 2000);
  if (!["SEV-1", "SEV-2", "SEV-3", "SEV-4"].includes(String(data.severity))) throw new HttpsError("invalid-argument", "severity must be SEV-1 through SEV-4.");
  const severity = String(data.severity);
  const actor = await central(uid, "zoneEmergencySuspend");
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const idempotencyRef = idemRef(uid, "suspendServiceZoneForEmergency", requestId);
  const payloadHash = fingerprint({ expectedRevision, zoneId, reason, severity });
  const outboxRef = db.collection("service_zone_notification_outbox").doc();
  return db.runTransaction(async (tx) => {
    const [idem, zoneSnap] = await Promise.all([tx.get(idempotencyRef), tx.get(zoneRef)]);
    const prior = replay(idem, payloadHash);
    if (prior) return prior;
    if (!zoneSnap.exists) throw new HttpsError("not-found", "Zone was not found.");
    const zone = zoneSnap.data() ?? {};
    if (zone.revision !== expectedRevision) throw new HttpsError("failed-precondition", "Zone revision is stale.");
    if (!["active", "approved", "deactivation_pending", "inactive", "reactivation_pending"].includes(String(zone.workflowStatus))) {
      throw new HttpsError("failed-precondition", "Zone cannot be emergency-suspended from its current state.");
    }
    const nextRevision = expectedRevision + 1, now = FieldValue.serverTimestamp();
    const response = { ok: true, requestId, zoneId, revision: nextRevision, workflowStatus: "suspended", notificationId: outboxRef.id, replayed: false };
    tx.update(zoneRef, { workflowStatus: "suspended", isServiceActive: false, revision: nextRevision,
      suspensionReason: reason, suspensionSeverity: severity, updatedBy: uid, updatedAt: now });
    tx.create(outboxRef, { zoneId, eventId: requestId, recipientAuthority: "founder", channel: "deferred_provider",
      status: "pending", attemptCount: 0, nextAttemptAt: now, retryScheduleMinutes: [1, 5, 15, 60],
      escalationAfterFailures: 5, lastErrorCode: null, createdAt: now });
    writeAudit(tx, zoneId, "zone_emergency_suspended", actor, requestId, expectedRevision, nextRevision,
      String(zone.workflowStatus), "suspended", reason);
    idemWrite(tx, idempotencyRef, uid, "suspendServiceZoneForEmergency", requestId, payloadHash, response);
    return response;
  });
});

export const reactivateServiceZone = onCall({ region: REGION }, async (request) => {
  const uid = uidOf(request), data = obj(request.data);
  keys(data, ["requestId", "expectedRevision", "zoneId"]);
  const requestId = str(data.requestId, "requestId", 128), expectedRevision = numberRevision(data.expectedRevision);
  const zoneId = safeId(data.zoneId, "zoneId");
  const actor = await central(uid, "zoneOperations");
  const zoneRef = db.doc(`service_zones/${zoneId}`);
  const idempotencyRef = idemRef(uid, "reactivateServiceZone", requestId);
  const payloadHash = fingerprint({ expectedRevision, zoneId });
  return db.runTransaction(async (tx) => {
    const [idem, zoneSnap] = await Promise.all([tx.get(idempotencyRef), tx.get(zoneRef)]);
    const prior = replay(idem, payloadHash);
    if (prior) return prior;
    if (!zoneSnap.exists) throw new HttpsError("not-found", "Zone was not found.");
    const zone = zoneSnap.data() ?? {};
    if (zone.revision !== expectedRevision || zone.workflowStatus !== "reactivation_pending" ||
      zone.isServiceActive !== false || zone.approvedRevision !== expectedRevision - 1 ||
      typeof zone.approvedRequestId !== "string") {
      throw new HttpsError("failed-precondition", "A current exact Founder reactivation approval is required.");
    }
    const approvalRef = db.doc(`service_zone_approval_requests/${zone.approvedRequestId}`);
    const approvalSnap = await tx.get(approvalRef);
    if (!approvalSnap.exists || approvalSnap.get("status") !== "approved" ||
      approvalSnap.get("requestType") !== "reactivation" || approvalSnap.get("zoneId") !== zoneId ||
      approvalSnap.get("revision") !== zone.approvedRevision ||
      approvalSnap.get("boundaryId") !== zone.approvedBoundaryId ||
      approvalSnap.get("boundaryHash") !== zone.approvedBoundaryHash) {
      throw new HttpsError("failed-precondition", "Exact Founder reactivation approval is missing or stale.");
    }
    const nextRevision = expectedRevision + 1, now = FieldValue.serverTimestamp();
    const response = { ok: true, requestId, zoneId, revision: nextRevision, workflowStatus: "active", replayed: false };
    tx.update(zoneRef, { workflowStatus: "active", isServiceActive: true, revision: nextRevision,
      suspensionReason: FieldValue.delete(), suspensionSeverity: FieldValue.delete(), updatedBy: uid, updatedAt: now });
    writeAudit(tx, zoneId, "zone_reactivated", actor, requestId, expectedRevision, nextRevision, "reactivation_pending", "active");
    idemWrite(tx, idempotencyRef, uid, "reactivateServiceZone", requestId, payloadHash, response);
    return response;
  });
});
