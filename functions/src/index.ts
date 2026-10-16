import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAreaCoveredByCity, polygonFromBoundary, type BoundaryDoc } from "./location_geometry";

initializeApp();
const db = getFirestore();

function asBoundary(data: FirebaseFirestore.DocumentData | undefined): BoundaryDoc {
  return (data ?? {}) as BoundaryDoc;
}

function requireVerifiedBoundary(
  boundaryData: FirebaseFirestore.DocumentData | undefined,
  boundaryId: string,
  locationId: string,
  locationType: "city" | "area",
): BoundaryDoc {
  const boundary = asBoundary(boundaryData);
  if (boundary.locationId !== locationId || boundary.locationType !== locationType ||
      boundary.verificationStatus !== "verified" ||
      typeof boundary.sourceName !== "string" || !boundary.sourceName.trim() ||
      typeof boundary.sourceReference !== "string" || !boundary.sourceReference.trim() ||
      typeof boundary.verifiedBy !== "string" || !boundary.verifiedBy.trim() ||
      !boundary.verifiedAt) {
    throw new HttpsError("failed-precondition", "A matching verified boundary is required.");
  }
  try {
    polygonFromBoundary(boundary);
  } catch (error) {
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Invalid boundary polygon.");
  }
  if (!boundaryId) throw new HttpsError("failed-precondition", "Boundary ID is missing.");
  return boundary;
}

export const activateServiceLocation = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const uid = request.auth.uid;
  const locationType = request.data?.locationType;
  const locationId = request.data?.locationId;

  if (!["city", "area"].includes(locationType) ||
      typeof locationId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(locationId)) {
    throw new HttpsError("invalid-argument", "Provide a valid locationType and locationId.");
  }

  const actorRef = db.doc(`admin_users/${uid}`);
  const actorSnap = await actorRef.get();
  if (!actorSnap.exists || actorSnap.get("isActive") !== true || actorSnap.get("role") !== "super_admin") {
    throw new HttpsError("permission-denied", "An active super_admin account is required.");
  }

  const collection = locationType === "city" ? "service_cities" : "service_areas";
  const locationRef = db.doc(`${collection}/${locationId}`);
  const initial = await locationRef.get();
  if (!initial.exists) throw new HttpsError("not-found", "Service location was not found.");
  const boundaryId = initial.get("verifiedBoundaryId");
  if (typeof boundaryId !== "string" || !boundaryId) {
    throw new HttpsError("failed-precondition", "Location must reference its verified boundary.");
  }
  const boundaryRef = db.doc(`service_location_boundaries/${boundaryId}`);
  const boundarySnap = await boundaryRef.get();
  const boundary = requireVerifiedBoundary(boundarySnap.data(), boundaryId, locationId, locationType);

  let parentRef: FirebaseFirestore.DocumentReference | undefined;
  let parentBoundaryRef: FirebaseFirestore.DocumentReference | undefined;
  if (locationType === "area") {
    const cityId = initial.get("cityId");
    if (typeof cityId !== "string" || !cityId) {
      throw new HttpsError("failed-precondition", "Area must have a parent City.");
    }
    parentRef = db.doc(`service_cities/${cityId}`);
    const parentSnap = await parentRef.get();
    if (!parentSnap.exists || parentSnap.get("isServiceActive") !== true) {
      throw new HttpsError("failed-precondition", "Parent City must be active.");
    }
    const parentBoundaryId = parentSnap.get("verifiedBoundaryId");
    if (typeof parentBoundaryId !== "string" || !parentBoundaryId) {
      throw new HttpsError("failed-precondition", "Parent City must reference a verified boundary.");
    }
    parentBoundaryRef = db.doc(`service_location_boundaries/${parentBoundaryId}`);
    const parentBoundarySnap = await parentBoundaryRef.get();
    const parentBoundary = requireVerifiedBoundary(parentBoundarySnap.data(), parentBoundaryId, cityId, "city");
    try {
      assertAreaCoveredByCity(boundary, parentBoundary);
    } catch (error) {
      throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Area must fit inside parent City.");
    }
  }

  // Re-read the relevant documents transactionally to reject stale IDs/revisions before activation.
  await db.runTransaction(async (tx) => {
    const refs = [locationRef, boundaryRef, ...(parentRef ? [parentRef] : []), ...(parentBoundaryRef ? [parentBoundaryRef] : [])];
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const currentLocation = snaps[0];
    const currentBoundary = snaps[1];
    if (!currentLocation.exists || currentLocation.get("verifiedBoundaryId") !== boundaryId || !currentBoundary.exists) {
      throw new HttpsError("aborted", "Location or boundary changed during validation. Retry.");
    }
    const currentBoundaryData = requireVerifiedBoundary(currentBoundary.data(), boundaryId, locationId, locationType);
    if (JSON.stringify(currentBoundaryData.points) !== JSON.stringify(boundary.points)) {
      throw new HttpsError("aborted", "Boundary geometry changed during validation. Retry.");
    }
    if (locationType === "area") {
      const currentParent = snaps[2];
      const currentParentBoundary = snaps[3];
      if (!currentParent?.exists || currentParent.get("isServiceActive") !== true || !currentParentBoundary?.exists) {
        throw new HttpsError("aborted", "Parent City changed during validation. Retry.");
      }
      const currentParentBoundaryId = currentParent.get("verifiedBoundaryId");
      if (typeof currentParentBoundaryId !== "string" || currentParentBoundaryId !== currentParentBoundary.id) {
        throw new HttpsError("aborted", "Parent City boundary changed during validation. Retry.");
      }
      const currentParentBoundaryData = requireVerifiedBoundary(currentParentBoundary.data(), currentParentBoundaryId, currentParent.id, "city");
      try { assertAreaCoveredByCity(currentBoundaryData, currentParentBoundaryData); }
      catch { throw new HttpsError("failed-precondition", "Area is not fully within the current parent City boundary."); }
    }
    tx.update(locationRef, { isServiceActive: true, updatedAt: FieldValue.serverTimestamp() });
    const auditRef = db.collection("service_location_activation_audit").doc();
    tx.create(auditRef, {
      actorUid: uid, locationId, locationType, boundaryId,
      result: "activated", createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, locationId, locationType };
});
