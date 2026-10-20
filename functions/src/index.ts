import { initializeApp } from "firebase-admin/app";
import { createHash } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAreaCoveredByCity, polygonFromBoundary, type BoundaryDoc } from "./location_geometry";
import {
  SERVICE_LOCATION_COLLECTIONS,
  serviceLocationNameIndexId,
  validateServiceLocationPayload,
  type ServiceLocationType,
} from "./location_name_index";
import { classifyDistrictIndexPair, type NameIndexSnapshot } from "./district_index_pair_preflight";

initializeApp();
const db = getFirestore();

function asNameIndexSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): NameIndexSnapshot {
  if (!snapshot.exists) return { exists: false };
  return {
    exists: true,
    documentId: snapshot.get("documentId"),
    collectionPath: snapshot.get("collectionPath"),
    parentIds: snapshot.get("parentIds"),
    name: snapshot.get("name"),
  };
}

function asBoundary(data: FirebaseFirestore.DocumentData | undefined): BoundaryDoc {
  return (data ?? {}) as BoundaryDoc;
}

function isValidVerificationTimestamp(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (!value || typeof value !== "object") return false;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return false;
  try {
    const date = toDate.call(value);
    return date instanceof Date && Number.isFinite(date.getTime());
  } catch {
    return false;
  }
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
      !isValidVerificationTimestamp(boundary.verifiedAt)) {
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

export const reviewServiceLocationBoundary = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const uid = request.auth.uid;
  const boundaryId = request.data?.boundaryId;
  const decision = request.data?.decision;
  const notes = request.data?.notes;

  if (typeof boundaryId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(boundaryId)) {
    throw new HttpsError("invalid-argument", "A valid boundaryId is required.");
  }
  if (decision !== "verified" && decision !== "rejected") {
    throw new HttpsError("invalid-argument", "Decision must be verified or rejected.");
  }
  if (typeof notes !== "string" || !notes.trim() || notes.trim().length > 2000) {
    throw new HttpsError("invalid-argument", "A review note of 1–2000 characters is required.");
  }

  const actorRef = db.doc(`admin_users/${uid}`);
  const boundaryRef = db.doc(`service_location_boundaries/${boundaryId}`);
  const actor = await actorRef.get();
  if (!actor.exists || actor.get("isActive") !== true || actor.get("role") !== "super_admin") {
    throw new HttpsError("permission-denied", "An active super_admin account is required.");
  }

  // Read the boundary once to identify its owning document. All values that
  // influence the decision are re-read and checked again inside the transaction.
  const initialBoundary = await boundaryRef.get();
  if (!initialBoundary.exists) throw new HttpsError("not-found", "Boundary was not found.");
  const initial = initialBoundary.data()!;
  const locationType = initial.locationType;
  const locationId = initial.locationId;
  if ((locationType !== "city" && locationType !== "area") ||
      typeof locationId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(locationId)) {
    throw new HttpsError("failed-precondition", "Only City and Area boundaries with valid owner IDs can be reviewed.");
  }

  const locationRef = db.doc(`${locationType === "city" ? "service_cities" : "service_areas"}/${locationId}`);
  const auditRef = db.collection("service_location_boundary_review_audit").doc();

  return db.runTransaction(async (tx) => {
    const [currentActor, currentBoundary, currentLocation] = await Promise.all([
      tx.get(actorRef), tx.get(boundaryRef), tx.get(locationRef),
    ]);
    if (!currentActor.exists || currentActor.get("isActive") !== true ||
        currentActor.get("role") !== "super_admin") {
      throw new HttpsError("permission-denied", "Admin access changed during review.");
    }
    if (!currentBoundary.exists || !currentLocation.exists) {
      throw new HttpsError("not-found", "Boundary or owning location was not found.");
    }
    const boundary = asBoundary(currentBoundary.data());
    if (boundary.locationId !== locationId || boundary.locationType !== locationType ||
        currentBoundary.get("verificationStatus") !== "pending") {
      throw new HttpsError("failed-precondition", "Only the current pending boundary for its owner can be reviewed.");
    }
    if (decision === "verified" && currentLocation.get("isServiceActive") === true) {
      throw new HttpsError("failed-precondition", "Deactivate the location before replacing its verified boundary.");
    }

    let parentBoundary: BoundaryDoc | undefined;
    if (decision === "verified") {
      try {
        if (typeof boundary.sourceName !== "string" || !boundary.sourceName.trim() ||
            typeof boundary.sourceReference !== "string" || !boundary.sourceReference.trim()) {
          throw new Error("Boundary source name and reference are required.");
        }
        polygonFromBoundary(boundary);
        if (locationType === "area") {
          const cityId = currentLocation.get("cityId");
          if (typeof cityId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(cityId)) {
            throw new Error("Area must reference a valid parent City.");
          }
          const cityRef = db.doc(`service_cities/${cityId}`);
          const citySnapshot = await tx.get(cityRef);
          if (!citySnapshot.exists || citySnapshot.get("isServiceActive") !== true) {
            throw new Error("Parent City must exist and be active before Area verification.");
          }
          const cityBoundaryId = citySnapshot.get("verifiedBoundaryId");
          if (typeof cityBoundaryId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(cityBoundaryId)) {
            throw new Error("Parent City must reference a verified boundary.");
          }
          const cityBoundarySnapshot = await tx.get(db.doc(`service_location_boundaries/${cityBoundaryId}`));
          parentBoundary = asBoundary(cityBoundarySnapshot.data());
          if (!cityBoundarySnapshot.exists ||
              parentBoundary.locationId !== cityId ||
              parentBoundary.locationType !== "city" ||
              parentBoundary.verificationStatus !== "verified") {
            throw new Error("Parent City boundary is not verified for that City.");
          }
          assertAreaCoveredByCity(boundary, parentBoundary);
        }
      } catch (error) {
        throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Boundary geometry validation failed.");
      }
    }

    const timestamp = FieldValue.serverTimestamp();
    tx.update(boundaryRef, {
      verificationStatus: decision,
      verifiedBy: uid,
      verifiedAt: decision === "verified" ? timestamp : null,
      verificationNotes: notes.trim(),
      updatedAt: timestamp,
      ...(decision === "verified" ? { validationMethod: "trusted-server-turf", validationVersion: 1 } : {}),
    });
    if (decision === "verified") {
      // Bind the reviewed polygon to its owning inactive location atomically.
      tx.update(locationRef, {
        verifiedBoundaryId: boundaryId,
        updatedAt: timestamp,
      });
    }
    tx.create(auditRef, {
      actorUid: uid,
      locationId,
      locationType,
      boundaryId,
      decision,
      notes: notes.trim(),
      validationMethod: decision === "verified" ? "trusted-server-turf" : null,
      validationVersion: decision === "verified" ? 1 : null,
      createdAt: timestamp,
    });
    return { ok: true, boundaryId, locationId, locationType, decision };
  });
});

export const activateServiceLocation = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const uid = request.auth.uid;
  const locationType = request.data?.locationType;
  const locationId = request.data?.locationId;

  if ((locationType !== "city" && locationType !== "area") ||
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
  if (typeof boundaryId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(boundaryId)) {
    throw new HttpsError("failed-precondition", "Location must reference a valid verified boundary ID.");
  }
  const boundaryRef = db.doc(`service_location_boundaries/${boundaryId}`);
  const boundarySnap = await boundaryRef.get();
  const boundary = requireVerifiedBoundary(boundarySnap.data(), boundaryId, locationId, locationType);

  const countryId = initial.get("countryId");
  const stateId = initial.get("stateId");
  if (typeof countryId !== "string" || !countryId || typeof stateId !== "string" || !stateId) {
    throw new HttpsError("failed-precondition", "Location must reference its Country and State.");
  }
  const countryRef = db.doc(`service_countries/${countryId}`);
  const stateRef = db.doc(`service_states/${stateId}`);
  const districtId = locationType === "city" ? initial.get("districtId") : undefined;
  let districtRef: FirebaseFirestore.DocumentReference | undefined;
  if (districtId !== undefined) {
    if (typeof districtId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(districtId)) {
      throw new HttpsError("failed-precondition", "City District reference is invalid.");
    }
    districtRef = db.doc(`service_districts/${districtId}`);
  }
  const countrySnap = await countryRef.get();
  const stateSnap = await stateRef.get();
  const districtSnap = districtRef ? await districtRef.get() : undefined;
  if (!countrySnap.exists || countrySnap.get("isActive") !== true) {
    throw new HttpsError("failed-precondition", "Location Country must exist and be active.");
  }
  if (!stateSnap.exists || stateSnap.get("isActive") !== true || stateSnap.get("countryId") !== countryId) {
    throw new HttpsError("failed-precondition", "Location State must exist, be active, and belong to its Country.");
  }
  if (districtRef && (!districtSnap?.exists || districtSnap.get("isServiceActive") !== true ||
      districtSnap.get("countryId") !== countryId || districtSnap.get("stateId") !== stateId)) {
    throw new HttpsError("failed-precondition", "City District must exist, be active, and match the City's Country/State.");
  }

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
    if (parentSnap.get("countryId") !== countryId || parentSnap.get("stateId") !== stateId) {
      throw new HttpsError("failed-precondition", "Area Country and State must match its parent City.");
    }
    const parentBoundaryId = parentSnap.get("verifiedBoundaryId");
    if (typeof parentBoundaryId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(parentBoundaryId)) {
      throw new HttpsError("failed-precondition", "Parent City must reference a valid verified boundary ID.");
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

  // Re-read all relevant documents transactionally to reject stale ancestry,
  // status, boundary references, and geometry before activation.
  await db.runTransaction(async (tx) => {
    const refs = [
      actorRef, locationRef, boundaryRef, countryRef, stateRef,
      ...(parentRef ? [parentRef] : []),
      ...(parentBoundaryRef ? [parentBoundaryRef] : []),
      ...(districtRef ? [districtRef] : []),
    ];
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const currentActor = snaps[0];
    const currentLocation = snaps[1];
    const currentBoundary = snaps[2];
    const currentCountry = snaps[3];
    const currentState = snaps[4];

    if (!currentActor.exists || currentActor.get("isActive") !== true || currentActor.get("role") !== "super_admin") {
      throw new HttpsError("permission-denied", "Admin access changed during validation.");
    }
    if (!currentLocation.exists || currentLocation.get("verifiedBoundaryId") !== boundaryId ||
        currentLocation.get("countryId") !== countryId || currentLocation.get("stateId") !== stateId ||
        (locationType === "area" && currentLocation.get("cityId") !== initial.get("cityId")) || !currentBoundary.exists) {
      throw new HttpsError("aborted", "Location or boundary changed during validation. Retry.");
    }
    if (!currentCountry.exists || currentCountry.get("isActive") !== true) {
      throw new HttpsError("failed-precondition", "Location Country must still be active.");
    }
    if (!currentState.exists || currentState.get("isActive") !== true || currentState.get("countryId") !== countryId) {
      throw new HttpsError("failed-precondition", "Location State must still be active and belong to its Country.");
    }
    if (districtRef) {
      const currentDistrict = snaps[refs.length - 1];
      if (!currentDistrict?.exists || currentDistrict.get("isServiceActive") !== true ||
          currentDistrict.get("countryId") !== countryId || currentDistrict.get("stateId") !== stateId ||
          currentLocation.get("districtId") !== districtRef.id) {
        throw new HttpsError("failed-precondition", "City District must remain active and match the City's Country/State.");
      }
    }

    const currentBoundaryData = requireVerifiedBoundary(currentBoundary.data(), boundaryId, locationId, locationType);
    if (JSON.stringify(currentBoundaryData.points) !== JSON.stringify(boundary.points)) {
      throw new HttpsError("aborted", "Boundary geometry changed during validation. Retry.");
    }

    if (locationType === "area") {
      const currentParent = snaps[5];
      const currentParentBoundary = snaps[6];
      if (!currentParent?.exists || currentParent.get("isServiceActive") !== true ||
          currentParent.get("countryId") !== countryId || currentParent.get("stateId") !== stateId ||
          !currentParentBoundary?.exists) {
        throw new HttpsError("failed-precondition", "Parent City must remain active and match the Area's Country/State.");
      }
      const currentParentBoundaryId = currentParent.get("verifiedBoundaryId");
      if (typeof currentParentBoundaryId !== "string" || currentParentBoundaryId !== currentParentBoundary.id) {
        throw new HttpsError("aborted", "Parent City boundary changed during validation. Retry.");
      }
      const currentParentBoundaryData = requireVerifiedBoundary(
        currentParentBoundary.data(), currentParentBoundaryId, currentParent.id, "city",
      );
      try {
        assertAreaCoveredByCity(currentBoundaryData, currentParentBoundaryData);
      } catch {
        throw new HttpsError("failed-precondition", "Area is not fully within the current parent City boundary.");
      }
    }

    // Touch every ancestor in this transaction so a concurrent ancestor
    // deactivation conflicts and retries against the newly active descendant.
    tx.update(countryRef, { activationGuardAt: FieldValue.serverTimestamp() });
    tx.update(stateRef, { activationGuardAt: FieldValue.serverTimestamp() });
    if (districtRef) tx.update(districtRef, { activationGuardAt: FieldValue.serverTimestamp() });
    if (parentRef) tx.update(parentRef, { activationGuardAt: FieldValue.serverTimestamp() });
    tx.update(locationRef, { isServiceActive: true, updatedAt: FieldValue.serverTimestamp() });
    const auditRef = db.collection("service_location_activation_audit").doc();
    tx.create(auditRef, {
      actorUid: uid, locationId, locationType, boundaryId,
      result: "activated", createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, locationId, locationType };
});


/**
 * Server-authoritative status changes for Country, State, City, Area and Locality.
 * City/Area activation remains geometry-validated by activateServiceLocation.
 * Every descendant activation writes all ancestor guard fields in the same
 * transaction, serializing it against concurrent ancestor deactivation.
 */
export const setServiceLocationStatus = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const uid = request.auth.uid;
  const { locationType, locationId, isActive } = request.data ?? {};
  const validTypes = ["country", "state", "district", "city", "area", "locality"];
  if (!validTypes.includes(locationType) ||
      typeof locationId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(locationId) ||
      typeof isActive !== "boolean") {
    throw new HttpsError("invalid-argument", "Provide locationType, locationId and boolean isActive.");
  }
  const actorRef = db.doc(`admin_users/${uid}`);
  const actor = await actorRef.get();
  if (!actor.exists || actor.get("isActive") !== true || actor.get("role") !== "super_admin") {
    throw new HttpsError("permission-denied", "An active super_admin account is required.");
  }
  if ((locationType === "city" || locationType === "area") && isActive) {
    throw new HttpsError("failed-precondition", "Use activateServiceLocation to activate a City or Area.");
  }

  const collectionByType: Record<string, string> = {
    country: "service_countries", state: "service_states", district: "service_districts", city: "service_cities",
    area: "service_areas", locality: "service_localities",
  };
  const targetRef = db.doc(`${collectionByType[locationType]}/${locationId}`);
  const statusField = locationType === "country" || locationType === "state" ? "isActive" : "isServiceActive";
  const parentFieldByType: Record<string, string> = {
    country: "", state: "countryId", district: "stateId", city: "stateId", area: "cityId", locality: "areaId",
  };
  const parentCollectionByType: Record<string, string> = {
    state: "service_countries", district: "service_states", city: "service_states", area: "service_cities", locality: "service_areas",
  };
  const childConfig: Record<string, { collection: string; field: string; activeField: string } | null> = {
    country: { collection: "service_states", field: "countryId", activeField: "isActive" },
    state: { collection: "service_cities", field: "stateId", activeField: "isServiceActive" },
    district: { collection: "service_cities", field: "districtId", activeField: "isServiceActive" },
    city: { collection: "service_areas", field: "cityId", activeField: "isServiceActive" },
    area: { collection: "service_localities", field: "areaId", activeField: "isServiceActive" },
    locality: null,
  };

  await db.runTransaction(async (tx) => {
    const [currentActor, target] = await Promise.all([tx.get(actorRef), tx.get(targetRef)]);
    if (!currentActor.exists || currentActor.get("isActive") !== true || currentActor.get("role") !== "super_admin") {
      throw new HttpsError("permission-denied", "Admin access changed during validation.");
    }
    if (!target.exists) throw new HttpsError("not-found", "Service location was not found.");
    if (target.get(statusField) === isActive) return;

    const parentField = parentFieldByType[locationType];
    let parentRef: FirebaseFirestore.DocumentReference | undefined;
    let parentSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    if (parentField) {
      const parentId = target.get(parentField);
      if (typeof parentId !== "string" || !parentId) {
        throw new HttpsError("failed-precondition", "Required parent location is missing.");
      }
      parentRef = db.doc(`${parentCollectionByType[locationType]}/${parentId}`);
      parentSnap = await tx.get(parentRef);
      if (!parentSnap.exists) throw new HttpsError("failed-precondition", "Parent location was not found.");
      const parentStatusField = locationType === "state" || locationType === "district" ? "isActive" : "isServiceActive";
      if (isActive && parentSnap.get(parentStatusField) !== true) {
        throw new HttpsError("failed-precondition", "Parent location must be active first.");
      }
    }

    // Resolve District's Country before any transaction writes. Firestore
    // transactions require every read to finish before the first write.
    let districtCountryRef: FirebaseFirestore.DocumentReference | undefined;
    if (locationType === "district" && isActive && parentSnap) {
      const countryId = parentSnap.get("countryId");
      if (typeof countryId !== "string" || !countryId) {
        throw new HttpsError("failed-precondition", "District State parent is invalid.");
      }
      districtCountryRef = db.doc(`service_countries/${countryId}`);
      const districtCountrySnap = await tx.get(districtCountryRef);
      if (!districtCountrySnap.exists || districtCountrySnap.get("isActive") !== true) {
        throw new HttpsError("failed-precondition", "District Country must be active first.");
      }
    }

    // For Locality activation, validate the complete persisted ancestry and
    // read every ancestor in this transaction before writing any guard field.
    let countryRef: FirebaseFirestore.DocumentReference | undefined;
    let stateRef: FirebaseFirestore.DocumentReference | undefined;
    let cityRef: FirebaseFirestore.DocumentReference | undefined;
    let countrySnap: FirebaseFirestore.DocumentSnapshot | undefined;
    let stateSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    let citySnap: FirebaseFirestore.DocumentSnapshot | undefined;
    if (locationType === "locality" && isActive) {
      const countryId = target.get("countryId");
      const stateId = target.get("stateId");
      const cityId = target.get("cityId");
      const areaId = target.get("areaId");
      if ([countryId, stateId, cityId, areaId].some((v) => typeof v !== "string" || !v)) {
        throw new HttpsError("failed-precondition", "Locality must reference Country, State, City and Area.");
      }
      countryRef = db.doc(`service_countries/${countryId}`);
      stateRef = db.doc(`service_states/${stateId}`);
      cityRef = db.doc(`service_cities/${cityId}`);
      [countrySnap, stateSnap, citySnap] = await Promise.all([
        tx.get(countryRef), tx.get(stateRef), tx.get(cityRef),
      ]);
      if (!countrySnap.exists || countrySnap.get("isActive") !== true) {
        throw new HttpsError("failed-precondition", "Locality Country must be active.");
      }
      if (!stateSnap.exists || stateSnap.get("isActive") !== true || stateSnap.get("countryId") !== countryId) {
        throw new HttpsError("failed-precondition", "Locality State must be active and belong to its Country.");
      }
      if (!citySnap.exists || citySnap.get("isServiceActive") !== true ||
          citySnap.get("countryId") !== countryId || citySnap.get("stateId") !== stateId) {
        throw new HttpsError("failed-precondition", "Locality City must be active and match its Country/State.");
      }
      if (!parentSnap?.exists || parentSnap.get("isServiceActive") !== true ||
          parentSnap.get("countryId") !== countryId || parentSnap.get("stateId") !== stateId ||
          parentSnap.get("cityId") !== cityId) {
        throw new HttpsError("failed-precondition", "Locality Area must be active and match its parent hierarchy.");
      }
    }

    const child = childConfig[locationType];
    if (!isActive && child) {
      const children = await tx.get(db.collection(child.collection)
        .where(child.field, "==", locationId)
        .where(child.activeField, "==", true).limit(1));
      if (!children.empty) {
        throw new HttpsError("failed-precondition", "Deactivate active child locations first.");
      }
      // District is a direct child of State in the canonical hierarchy.
      // The client-side Admin guard is only UX; enforce this invariant here
      // so direct callable requests cannot deactivate a State with active Districts.
      if (locationType === "state") {
        const districts = await tx.get(db.collection("service_districts")
          .where("stateId", "==", locationId)
          .where("isServiceActive", "==", true).limit(1));
        if (!districts.empty) {
          throw new HttpsError("failed-precondition", "Deactivate active Districts first.");
        }
      }
      if (locationType === "district") {
        const cities = await tx.get(db.collection("service_cities").where("districtId", "==", locationId).where("isServiceActive", "==", true).limit(1));
        const areas = await tx.get(db.collection("service_areas").where("districtId", "==", locationId).where("isServiceActive", "==", true).limit(1));
        if (!cities.empty || !areas.empty) throw new HttpsError("failed-precondition", "Deactivate active District descendants first.");
      } else if (locationType === "country") {
        const cities = await tx.get(db.collection("service_cities").where("countryId", "==", locationId).where("isServiceActive", "==", true).limit(1));
        const areas = await tx.get(db.collection("service_areas").where("countryId", "==", locationId).where("isServiceActive", "==", true).limit(1));
        if (!cities.empty || !areas.empty) throw new HttpsError("failed-precondition", "Deactivate active descendant locations first.");
      } else if (locationType === "state") {
        const areas = await tx.get(db.collection("service_areas").where("stateId", "==", locationId).where("isServiceActive", "==", true).limit(1));
        if (!areas.empty) throw new HttpsError("failed-precondition", "Deactivate active descendant locations first.");
      }
    }

    if (isActive && locationType === "city" && parentRef) {
      const countryId = target.get("countryId");
      if (typeof countryId !== "string" || parentSnap?.get("countryId") !== countryId) {
        throw new HttpsError("failed-precondition", "City State must belong to the City Country.");
      }
      countryRef = db.doc(`service_countries/${countryId}`);
      countrySnap = await tx.get(countryRef);
      if (!countrySnap.exists || countrySnap.get("isActive") !== true) {
        throw new HttpsError("failed-precondition", "City Country must be active first.");
      }
    }

    tx.update(targetRef, {
      [statusField]: isActive,
      activationGuardAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (isActive && locationType === "state" && parentRef) {
      tx.update(parentRef, { activationGuardAt: FieldValue.serverTimestamp() });
    }
    if (isActive && locationType === "district" && parentRef && districtCountryRef) {
      tx.update(parentRef, { activationGuardAt: FieldValue.serverTimestamp() });
      tx.update(districtCountryRef, { activationGuardAt: FieldValue.serverTimestamp() });
    }
    if (isActive && locationType === "city" && parentRef) {
      tx.update(countryRef!, { activationGuardAt: FieldValue.serverTimestamp() });
      tx.update(parentRef, { activationGuardAt: FieldValue.serverTimestamp() });
    }
    if (isActive && locationType === "locality") {
      // Parent Area and all ancestors are guard-written to serialize with
      // concurrent Area/City/State/Country deactivation.
      tx.update(parentRef!, { activationGuardAt: FieldValue.serverTimestamp() });
      tx.update(cityRef!, { activationGuardAt: FieldValue.serverTimestamp() });
      tx.update(stateRef!, { activationGuardAt: FieldValue.serverTimestamp() });
      tx.update(countryRef!, { activationGuardAt: FieldValue.serverTimestamp() });
    }

    const auditRef = db.collection("service_location_status_audit").doc();
    tx.create(auditRef, {
      actorUid: uid, locationId, locationType,
      result: isActive ? "activated" : "deactivated",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, locationId, locationType, isActive };
});


/**
 * Save a service location and its canonical name index atomically.
 * Creation always starts inactive; boundary verification and activation remain
 * separate trusted workflows. This callable intentionally does not accept
 * boundary geometry or activation flags as mutable input.
 */
export const saveServiceLocationWithNameIndex = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const uid = request.auth.uid;
  const { locationType, locationId, payload } = request.data ?? {};
  const validTypes: ServiceLocationType[] = ["country", "state", "district", "city", "area", "locality"];
  if (!validTypes.includes(locationType)) {
    throw new HttpsError("invalid-argument", "A valid locationType is required.");
  }
  const type = locationType as ServiceLocationType;
  if (locationId !== undefined &&
      (typeof locationId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(locationId))) {
    throw new HttpsError("invalid-argument", "locationId is invalid.");
  }

  let proposed: Record<string, unknown>;
  try {
    proposed = validateServiceLocationPayload(type, payload);
  } catch (error) {
    throw new HttpsError("invalid-argument", error instanceof Error ? error.message : "Invalid location payload.");
  }
  // Prevent clients from bypassing the reviewed-boundary and activation callables.
  const mutableFields: Record<ServiceLocationType, readonly string[]> = {
    country: ["name", "code"],
    state: ["countryId", "name"],
    district: ["countryId", "stateId", "name"],
    city: ["countryId", "stateId", "districtId", "name"],
    area: ["countryId", "stateId", "cityId", "name"],
    locality: ["countryId", "stateId", "cityId", "areaId", "name", "pincode"],
  };
  for (const key of Object.keys(proposed)) {
    if (!mutableFields[type].includes(key)) {
      throw new HttpsError("invalid-argument", `Field ${key} must be managed by a trusted workflow.`);
    }
  }
  const collection = SERVICE_LOCATION_COLLECTIONS[type];
  const docRef = locationId
    ? db.collection(collection).doc(locationId)
    : db.collection(collection).doc();
  const actorRef = db.doc(`admin_users/${uid}`);
  const parentFieldsByType: Record<ServiceLocationType, string[]> = {
    country: [],
    state: ["countryId"],
    district: ["countryId", "stateId"],
    city: proposed.districtId === undefined ? ["countryId", "stateId"] : ["countryId", "stateId", "districtId"],
    area: ["countryId", "stateId", "cityId"],
    locality: ["countryId", "stateId", "cityId", "areaId"],
  };
  const parentIds = parentFieldsByType[type].map((field) => {
    const value = proposed[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new HttpsError("invalid-argument", `A valid ${field} is required.`);
    }
    return value.trim();
  });
  const parentRefs = parentIds.map((id, i) => {
    const parentType: ServiceLocationType[] = type === "city" && proposed.districtId !== undefined
      ? ["country", "state", "district"]
      : ["country", "state", "city", "area"];
    return db.collection(SERVICE_LOCATION_COLLECTIONS[parentType[i]]).doc(id);
  });
  const normalizedName = (proposed.name as string).trim().toLowerCase().replace(/\s+/g, " ");
  const indexId = serviceLocationNameIndexId(collection, parentIds, normalizedName);
  const indexRef = db.doc(`service_location_name_indexes/${indexId}`);

  return db.runTransaction(async (tx) => {
    const [actorSnap, targetSnap, ...parentSnaps] = await Promise.all([
      tx.get(actorRef), tx.get(docRef), ...parentRefs.map((ref) => tx.get(ref)),
    ]);
    if (!actorSnap.exists || actorSnap.get("isActive") !== true ||
        !["super_admin", "admin"].includes(actorSnap.get("role"))) {
      throw new HttpsError("permission-denied", "An active admin account is required.");
    }
    if (locationId && !targetSnap.exists) {
      throw new HttpsError("not-found", "Service location was not found.");
    }
    if (targetSnap.exists) {
      const current = targetSnap.data() ?? {};
      if (type === "city" && (current.districtId !== undefined) !== (proposed.districtId !== undefined)) {
        throw new HttpsError("failed-precondition", "Adding or removing a City District requires a separate migration.");
      }
      const effectiveParentFields = type === "city"
        ? (proposed.districtId === undefined ? ["countryId", "stateId"] : ["countryId", "stateId", "districtId"])
        : parentFieldsByType[type];
      const currentParents = effectiveParentFields.map((field) => current[field]);
      const proposedParents = effectiveParentFields.map((field) => proposed[field]);
      if (currentParents.some((value, i) => value !== proposedParents[i])) {
        throw new HttpsError("failed-precondition", "Moving a location to a different parent is not supported.");
      }
    }
    for (let i = 0; i < parentSnaps.length; i++) {
      if (!parentSnaps[i].exists) throw new HttpsError("failed-precondition", "A required parent location does not exist.");
    }
    const parentData = parentSnaps.map((snap) => snap.data() ?? {});
    if (type === "state" && parentData[0].name === undefined) {
      throw new HttpsError("failed-precondition", "Country parent is invalid.");
    }
    if (type === "district" && parentData[1].countryId !== parentIds[0]) {
      throw new HttpsError("failed-precondition", "State does not belong to the selected Country.");
    }
    if (type === "city" && parentData[1].countryId !== parentIds[0]) {
      throw new HttpsError("failed-precondition", "State does not belong to the selected Country.");
    }
    if (type === "city" && proposed.districtId !== undefined &&
        (parentData[2].countryId !== parentIds[0] || parentData[2].stateId !== parentIds[1])) {
      throw new HttpsError("failed-precondition", "District does not belong to the selected State and Country.");
    }
    if (type === "area" && (parentData[1].countryId !== parentIds[0] ||
        parentData[2].stateId !== parentIds[1] || parentData[2].countryId !== parentIds[0])) {
      throw new HttpsError("failed-precondition", "City does not belong to the selected State and Country.");
    }
    if (type === "locality" && (parentData[1].countryId !== parentIds[0] ||
        parentData[2].stateId !== parentIds[1] || parentData[2].countryId !== parentIds[0] ||
        parentData[3].cityId !== parentIds[2] || parentData[3].stateId !== parentIds[1] ||
        parentData[3].countryId !== parentIds[0])) {
      throw new HttpsError("failed-precondition", "Area does not belong to the selected City, State and Country.");
    }

    // A District-linked City must still point to a real District in the same
    // Country/State before an Area or Locality can be saved. Keep the legacy
    // name-index tuple unchanged until the coordinated index migration.
    if (type === "area" || type === "locality") {
      const cityData = parentData[2];
      const districtId = cityData.districtId;
      if (districtId !== undefined && districtId !== null && districtId !== "") {
        if (typeof districtId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(districtId)) {
          throw new HttpsError("failed-precondition", "City District link is invalid.");
        }
        const districtSnap = await tx.get(db.doc(`service_districts/${districtId}`));
        if (!districtSnap.exists ||
            districtSnap.get("countryId") !== parentIds[0] ||
            districtSnap.get("stateId") !== parentIds[1]) {
          throw new HttpsError("failed-precondition", "City District must belong to the selected State and Country.");
        }
      }
    }

    const newIndexSnap = await tx.get(indexRef);
    const old = targetSnap.data() ?? {};
    const effectiveParentFields = type === "city"
      ? (proposed.districtId === undefined ? ["countryId", "stateId"] : ["countryId", "stateId", "districtId"])
      : parentFieldsByType[type];
    const oldParentIds = targetSnap.exists
      ? effectiveParentFields.map((field) => String(old[field] ?? ""))
      : parentIds;

    // District-linked Areas and Localities keep the legacy index and also
    // write a District-aware index. Validate both before staging any writes.
    const cityDataForIndex = (type === "area" || type === "locality") ? parentData[2] : undefined;
    const districtIdForIndex = cityDataForIndex?.districtId;
    let districtAwareParentIds: string[] | undefined;
    let districtAwareIndexRef: FirebaseFirestore.DocumentReference | undefined;
    let districtAwareIndexSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    let districtAwareIndexId: string | undefined;
    if (typeof districtIdForIndex === "string" && districtIdForIndex) {
      districtAwareParentIds = [parentIds[0], parentIds[1], districtIdForIndex, parentIds[2], ...parentIds.slice(3)];
      districtAwareIndexId = serviceLocationNameIndexId(collection, districtAwareParentIds, normalizedName);
      districtAwareIndexRef = db.doc("service_location_name_indexes/" + districtAwareIndexId);
      districtAwareIndexSnap = await tx.get(districtAwareIndexRef);
      const pair = classifyDistrictIndexPair({
        expectedCollection: collection,
        expectedDocumentId: docRef.id,
        expectedName: normalizedName,
        legacyParentIds: parentIds,
        districtParentIds: districtAwareParentIds,
        legacy: asNameIndexSnapshot(newIndexSnap),
        districtAware: asNameIndexSnapshot(districtAwareIndexSnap),
      });
      const oldNormalizedName = typeof old.name === "string"
        ? old.name.trim().toLowerCase().replace(/\s+/g, " ")
        : "";
      const newNameOnExistingDocument = targetSnap.exists && oldNormalizedName !== normalizedName;
      if (pair.status === "MISSING_BOTH") {
        // Missing new keys are expected for creates/renames, but not for an
        // unchanged existing name; that case needs manual repair.
        if (targetSnap.exists && !newNameOnExistingDocument) {
          throw new HttpsError("failed-precondition", "Both name indexes are missing for this existing location; manual review is required.");
        }
      } else if (!pair.safeToMigrate) {
        throw new HttpsError("failed-precondition", "Name index preflight blocked save: " + pair.status + ".");
      }
    }

    let oldIndexRef: FirebaseFirestore.DocumentReference | undefined;
    let oldIndexSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    let oldDistrictAwareIndexRef: FirebaseFirestore.DocumentReference | undefined;
    let oldDistrictAwareIndexSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    let oldDistrictAwareIndexId: string | undefined;
    if (targetSnap.exists) {
      const oldIndexId = serviceLocationNameIndexId(collection, oldParentIds, String(old.name ?? ""));
      if (oldIndexId !== indexId) {
        oldIndexRef = db.doc("service_location_name_indexes/" + oldIndexId);
        oldIndexSnap = await tx.get(oldIndexRef);
      }
      if (districtAwareParentIds) {
        oldDistrictAwareIndexId = serviceLocationNameIndexId(
          collection,
          districtAwareParentIds,
          String(old.name ?? ""),
        );
        if (oldDistrictAwareIndexId !== districtAwareIndexId) {
          oldDistrictAwareIndexRef = db.doc("service_location_name_indexes/" + oldDistrictAwareIndexId);
          oldDistrictAwareIndexSnap = await tx.get(oldDistrictAwareIndexRef);
        }
      }
      if (districtAwareParentIds &&
          ((oldIndexSnap?.exists ?? false) || (oldDistrictAwareIndexSnap?.exists ?? false))) {
        const oldLegacySnapshot = oldIndexId === indexId ? newIndexSnap : oldIndexSnap;
        const oldDistrictSnapshot = oldDistrictAwareIndexId === districtAwareIndexId
          ? districtAwareIndexSnap
          : oldDistrictAwareIndexSnap;
        const oldPair = classifyDistrictIndexPair({
          expectedCollection: collection,
          expectedDocumentId: docRef.id,
          expectedName: String(old.name ?? ""),
          legacyParentIds: oldParentIds,
          districtParentIds: districtAwareParentIds,
          legacy: oldLegacySnapshot ? asNameIndexSnapshot(oldLegacySnapshot) : { exists: false },
          districtAware: oldDistrictSnapshot ? asNameIndexSnapshot(oldDistrictSnapshot) : { exists: false },
        });
        if (!oldPair.safeToMigrate) {
          throw new HttpsError("failed-precondition", "Existing name index preflight blocked rename: " + oldPair.status + ".");
        }
      }
    }
    if (newIndexSnap.exists && newIndexSnap.get("documentId") !== docRef.id) {
      throw new HttpsError("already-exists", "Another location already uses this name under the selected parent.");
    }

    const nowFields = { updatedAt: FieldValue.serverTimestamp() };
    const locationData: Record<string, unknown> = {
      ...proposed,
      ...(targetSnap.exists ? {} : (
        type === "country" ? { isActive: false } :
        type === "state" ? { isActive: false } : { isServiceActive: false }
      )),
      ...(targetSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      ...nowFields,
    };
    if (targetSnap.exists) {
      // Do not permit client saves to change activation/boundary state.
      delete locationData.isActive;
      delete locationData.isServiceActive;
    }
    if (oldIndexRef && oldIndexSnap?.exists && oldIndexSnap.get("documentId") !== docRef.id) {
      throw new HttpsError(
        "failed-precondition",
        "The existing name index does not match the location being updated.",
      );
    }
    if (oldIndexRef && oldIndexSnap?.exists) {
      tx.delete(oldIndexRef);
    }
    if (oldDistrictAwareIndexRef && oldDistrictAwareIndexSnap?.exists) {
      if (oldDistrictAwareIndexSnap.get("documentId") !== docRef.id) {
        throw new HttpsError(
          "failed-precondition",
          "The existing District-aware name index does not match the location being updated.",
        );
      }
      tx.delete(oldDistrictAwareIndexRef);
    }
    tx.set(indexRef, {
      collectionPath: collection,
      documentId: docRef.id,
      name: normalizedName,
      parentIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (districtAwareIndexRef && districtAwareParentIds) {
      tx.set(districtAwareIndexRef, {
        collectionPath: collection,
        documentId: docRef.id,
        name: normalizedName,
        parentIds: districtAwareParentIds,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(docRef, locationData, { merge: true });
    return { ok: true, locationId: docRef.id, locationType: type };
  });
});



/**
 * Trusted state machine for CSV import attempts.
 *
 * The durable run document is written before hierarchy writes. It is not
 * client-writable under Firestore rules. Existing run IDs are deliberately
 * blocked until a separate authoritative reconciliation flow is implemented.
 */
export const manageServiceLocationImportRun = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const uid = request.auth.uid;
  const data = request.data ?? {};
  const action = data.action;
  const runId = data.runId;
  const inputFingerprint = data.inputFingerprint;

  if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(runId)) {
    throw new HttpsError("invalid-argument", "A valid import runId is required.");
  }
  if (typeof inputFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(inputFingerprint)) {
    throw new HttpsError("invalid-argument", "A canonical SHA-256 input fingerprint is required.");
  }

  const actorRef = db.doc(`admin_users/${uid}`);
  const actor = await actorRef.get();
  if (!actor.exists || actor.get("isActive") !== true || actor.get("role") !== "super_admin") {
    throw new HttpsError("permission-denied", "An active super_admin account is required.");
  }

  const runRef = db.doc(`service_location_import_runs/${runId}`);
  if (action === "inspect") {
    const run = await runRef.get();
    if (!run.exists) throw new HttpsError("not-found", "Import run was not found.");
    if (run.get("inputFingerprint") !== inputFingerprint) {
      throw new HttpsError("failed-precondition", "Import run fingerprint does not match.");
    }
    if (run.get("importedBy") !== uid) {
      throw new HttpsError("permission-denied", "Only the admin who started this import can inspect its run marker.");
    }
    // Return only reconciliation-relevant fields; never expose internal data
    // or allow a client to mutate the durable run marker.
    return {
      runId,
      countryId: run.get("countryId"),
      fileName: run.get("fileName"),
      status: run.get("status"),
      plannedRecords: run.get("plannedRecords"),
      createdRecords: run.get("createdRecords"),
      reusedRecords: run.get("reusedRecords"),
      importedBy: run.get("importedBy"),
      inputFingerprint: run.get("inputFingerprint"),
      createdAt: run.get("createdAt")?.toDate?.().toISOString?.() ?? null,
      updatedAt: run.get("updatedAt")?.toDate?.().toISOString?.() ?? null,
      finishedAt: run.get("finishedAt")?.toDate?.().toISOString?.() ?? null,
      reconciliationRequired: run.get("status") !== "completed",
    };
  }

  if (action === "begin") {
    const countryId = data.countryId;
    const fileName = data.fileName;
    if (typeof countryId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(countryId)) {
      throw new HttpsError("invalid-argument", "A valid countryId is required.");
    }
    if (typeof fileName !== "string" || !fileName.trim() || fileName.trim().length > 180) {
      throw new HttpsError("invalid-argument", "A file name of 1–180 characters is required.");
    }
    return db.runTransaction(async (tx) => {
      const [currentActor, existing] = await Promise.all([tx.get(actorRef), tx.get(runRef)]);
      if (!currentActor.exists || currentActor.get("isActive") !== true ||
          currentActor.get("role") !== "super_admin") {
        throw new HttpsError("permission-denied", "Admin access changed during import start.");
      }
      if (existing.exists) {
        if (existing.get("inputFingerprint") !== inputFingerprint) {
          throw new HttpsError("failed-precondition", "This runId belongs to a different CSV fingerprint.");
        }
        throw new HttpsError("already-exists", "This import run already exists and requires reconciliation before retry.");
      }
      const now = FieldValue.serverTimestamp();
      tx.create(runRef, {
        runId,
        countryId,
        fileName: fileName.trim(),
        inputFingerprint,
        importedBy: uid,
        status: "started",
        schemaVersion: 1,
        plannedRecords: 0,
        createdRecords: 0,
        reusedRecords: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, runId, status: "started" };
    });
  }

  if (action === "recordPlan") {
    const nodes = data.nodes;
    if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 300) {
      throw new HttpsError("invalid-argument", "A plan must contain 1–300 nodes.");
    }
    const allowedTypes = new Set(["state", "district", "city", "area"]);
    const seenIds = new Set<string>();
    const canonicalNodes: Array<{
      id: string; type: string; name: string; parentId: string;
      alreadyExists: boolean; sourceLine: number;
    }> = [];
    for (const node of nodes) {
      if (!node || typeof node !== "object" ||
          typeof node.id !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(node.id) ||
          typeof node.type !== "string" || !allowedTypes.has(node.type) ||
          typeof node.name !== "string" || !node.name.trim() || node.name.trim().length > 180 ||
          typeof node.parentId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(node.parentId) ||
          typeof node.alreadyExists !== "boolean" ||
          !Number.isSafeInteger(node.sourceLine) || node.sourceLine < 1) {
        throw new HttpsError("invalid-argument", "The plan contains an invalid node descriptor.");
      }
      if (seenIds.has(node.id)) {
        throw new HttpsError("invalid-argument", "The plan contains duplicate document IDs.");
      }
      seenIds.add(node.id);
      canonicalNodes.push({
        id: node.id, type: node.type, name: node.name.trim(),
        parentId: node.parentId, alreadyExists: node.alreadyExists,
        sourceLine: node.sourceLine,
      });
    }
    const nodeById = new Map(canonicalNodes.map((node) => [node.id, node]));
    const ordinalById = new Map(canonicalNodes.map((node, index) => [node.id, index]));
    const expectedParentType: Record<string, string> = {
      district: "state", city: "district", area: "city",
    };
    for (const node of canonicalNodes) {
      const parentType = expectedParentType[node.type];
      if (!parentType) continue; // State parent is the country document.
      const parent = nodeById.get(node.parentId);
      const parentOrdinal = ordinalById.get(node.parentId);
      const nodeOrdinal = ordinalById.get(node.id);
      if (!parent || parent.type !== parentType || parentOrdinal === undefined ||
          nodeOrdinal === undefined || parentOrdinal >= nodeOrdinal) {
        throw new HttpsError(
          "invalid-argument",
          `The ${node.type} node ${node.id} must reference a planned ${parentType} parent that appears earlier in the import plan.`,
        );
      }
    }
    const planHash = createHash("sha256")
      .update(JSON.stringify(canonicalNodes)).digest("hex");
    return db.runTransaction(async (tx) => {
      const [currentActor, run] = await Promise.all([tx.get(actorRef), tx.get(runRef)]);
      if (!currentActor.exists || currentActor.get("isActive") !== true ||
          currentActor.get("role") !== "super_admin") {
        throw new HttpsError("permission-denied", "Admin access changed while recording the import plan.");
      }
      if (!run.exists || run.get("status") !== "started" ||
          run.get("importedBy") !== uid || run.get("inputFingerprint") !== inputFingerprint) {
        throw new HttpsError("failed-precondition", "A matching started import run is required.");
      }
      const runCountryId = run.get("countryId");
      if (canonicalNodes.some((node) => node.type === "state" && node.parentId !== runCountryId)) {
        throw new HttpsError(
          "invalid-argument",
          "Every planned state must reference the country selected for this import run.",
        );
      }
      if (run.get("planHash")) {
        throw new HttpsError("already-exists", "This import run already has an immutable plan.");
      }
      tx.update(runRef, {
        planHash,
        plannedRecords: canonicalNodes.length,
        planSchemaVersion: 1,
        planRecordedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, runId, plannedRecords: canonicalNodes.length, planHash };
    }).then(async (result) => {
      // The plan is immutable and written in bounded chunks. If a chunk fails,
      // the marker retains planHash and must be reconciled manually; never replay.
      const collection = runRef.collection("planned_nodes");
      for (let offset = 0; offset < canonicalNodes.length; offset += 200) {
        const batch = db.batch();
        for (const [localIndex, node] of canonicalNodes.slice(offset, offset + 200).entries()) {
          const ordinal = offset + localIndex;
          batch.create(collection.doc(node.id), { ...node, ordinal, planHash, recordedAt: FieldValue.serverTimestamp() });
        }
        await batch.commit();
      }
      return result;
    });
  }

  if (action === "reconcilePlan") {
    const run = await runRef.get();
    if (!run.exists) throw new HttpsError("not-found", "Import run was not found.");
    if (run.get("inputFingerprint") !== inputFingerprint || run.get("importedBy") !== uid) {
      throw new HttpsError("failed-precondition", "Import run owner or fingerprint does not match.");
    }
    const plannedRecords = run.get("plannedRecords");
    const expectedHash = run.get("planHash");
    if (!Number.isSafeInteger(plannedRecords) || plannedRecords < 1 ||
        plannedRecords > 300 || typeof expectedHash !== "string") {
      return { ok: false, runId, status: "plan_missing_or_invalid", readOnly: true };
    }
    const planSnapshot = await runRef.collection("planned_nodes").get();
    if (planSnapshot.size !== plannedRecords) {
      return {
        ok: false, runId, status: "plan_incomplete", expectedRecords: plannedRecords,
        storedRecords: planSnapshot.size, readOnly: true,
      };
    }
    const planned = planSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string }))
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
    if (planned.some((node, index) => !Number.isSafeInteger(node.ordinal) || node.ordinal !== index)) {
      return { ok: false, runId, status: "plan_order_unverifiable", readOnly: true };
    }
    const canonical = planned.map((node) => ({
      id: node.id, type: node.type, name: node.name, parentId: node.parentId,
      alreadyExists: node.alreadyExists, sourceLine: node.sourceLine,
    }));
    const actualHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    if (actualHash !== expectedHash || planned.some((node) => node.planHash !== expectedHash)) {
      return { ok: false, runId, status: "plan_hash_mismatch", readOnly: true };
    }

    const collectionByType: Record<string, string> = {
      state: "service_states", district: "service_districts",
      city: "service_cities", area: "service_areas",
    };
    const plannedById = new Map(planned.map((node) => [node.id, node]));
    const countryId = run.get("countryId");
    const missingIds: string[] = [];
    const mismatchIds: string[] = [];
    let matching = 0;
    for (const node of planned) {
      const collectionName = collectionByType[String(node.type)];
      if (!collectionName || typeof countryId !== "string") {
        mismatchIds.push(String(node.id));
        continue;
      }
      const expectedFields: Record<string, unknown> = { countryId };
      // Newly created imports must remain inactive until an administrator
      // separately verifies boundaries and explicitly activates service.
      // Reused records preserve their existing activation state.
      if (node.alreadyExists !== true) {
        expectedFields[node.type === "state" ? "isActive" : "isServiceActive"] = false;
      }
      if (node.type === "state") {
        if (node.parentId !== countryId) {
          mismatchIds.push(String(node.id));
          continue;
        }
      } else if (node.type === "district") {
        expectedFields.stateId = node.parentId;
      } else if (node.type === "city") {
        const district = plannedById.get(node.parentId);
        if (!district || district.type !== "district") {
          mismatchIds.push(String(node.id));
          continue;
        }
        expectedFields.districtId = node.parentId;
        expectedFields.stateId = district.parentId;
      } else if (node.type === "area") {
        const city = plannedById.get(node.parentId);
        const district = city ? plannedById.get(city.parentId) : undefined;
        if (!city || city.type !== "city" || !district || district.type !== "district") {
          mismatchIds.push(String(node.id));
          continue;
        }
        expectedFields.cityId = node.parentId;
        expectedFields.stateId = district.parentId;
      } else {
        mismatchIds.push(String(node.id));
        continue;
      }
      const actual = await db.doc(`${collectionName}/${node.id}`).get();
      if (!actual.exists) {
        missingIds.push(String(node.id));
        continue;
      }
      const actualName = typeof actual.get("name") === "string" ? actual.get("name").trim() : "";
      const fieldsMatch = Object.entries(expectedFields).every(
        ([field, expected]) => actual.get(field) === expected,
      );
      if (actualName !== node.name || !fieldsMatch) {
        mismatchIds.push(String(node.id));
      } else {
        matching++;
      }
    }
    return {
      ok: missingIds.length === 0 && mismatchIds.length === 0,
      runId,
      status: missingIds.length === 0 && mismatchIds.length === 0 ? "reconciled_match" : "reconciliation_mismatch",
      plannedRecords,
      matchingRecords: matching,
      missingCount: missingIds.length,
      mismatchCount: mismatchIds.length,
      missingIds: missingIds.slice(0, 50),
      mismatchIds: mismatchIds.slice(0, 50),
      truncated: missingIds.length > 50 || mismatchIds.length > 50,
      readOnly: true,
    };
  }

  if (action === "finalize") {
    const allowedStatuses = ["completed", "failed", "partial_failure", "audit_failed"];
    const status = data.status;
    const counts = ["plannedRecords", "createdRecords", "reusedRecords"] as const;
    if (typeof status !== "string" || !allowedStatuses.includes(status)) {
      throw new HttpsError("invalid-argument", "A valid terminal import status is required.");
    }
    for (const field of counts) {
      if (!Number.isSafeInteger(data[field]) || data[field] < 0) {
        throw new HttpsError("invalid-argument", `${field} must be a non-negative integer.`);
      }
    }
    // Every planned node must be accounted for exactly once: either created
    // by this run or matched to an existing canonical path. Reject inconsistent
    // client summaries before touching the durable run state.
    // A completed run must account for every planned node. Failure states
    // intentionally allow fewer accounted nodes because a callable may have
    // stopped midway through the hierarchy writes.
    if (status === "completed" &&
        data.createdRecords + data.reusedRecords !== data.plannedRecords) {
      throw new HttpsError(
        "invalid-argument",
        "For completed runs, createdRecords plus reusedRecords must equal plannedRecords.",
      );
    }
    if (data.createdRecords + data.reusedRecords > data.plannedRecords) {
      throw new HttpsError(
        "invalid-argument",
        "Created and reused counts cannot exceed plannedRecords.",
      );
    }
    return db.runTransaction(async (tx) => {
      const [currentActor, run] = await Promise.all([tx.get(actorRef), tx.get(runRef)]);
      if (!currentActor.exists || currentActor.get("isActive") !== true ||
          currentActor.get("role") !== "super_admin") {
        throw new HttpsError("permission-denied", "Admin access changed during import finalization.");
      }
      if (!run.exists) throw new HttpsError("not-found", "Import run was not started.");
      if (run.get("importedBy") !== uid || run.get("inputFingerprint") !== inputFingerprint) {
        throw new HttpsError("failed-precondition", "Import run owner or fingerprint does not match.");
      }
      // A completed run must be backed by the immutable server-recorded plan.
      // Never let a client overwrite the plan's canonical record count during
      // finalization or mark an empty/unplanned run as completed.
      if (status === "completed" &&
          (typeof run.get("planHash") !== "string" ||
           !Number.isSafeInteger(run.get("plannedRecords")) ||
           run.get("plannedRecords") < 1 ||
           run.get("plannedRecords") !== data.plannedRecords)) {
        throw new HttpsError(
          "failed-precondition",
          "A completed import must match its immutable recorded plan. Reconcile the run before finalizing.",
        );
      }
      const currentStatus = run.get("status");
      if (currentStatus !== "started") {
        if (currentStatus === status &&
            run.get("plannedRecords") === data.plannedRecords &&
            run.get("createdRecords") === data.createdRecords &&
            run.get("reusedRecords") === data.reusedRecords) {
          return { ok: true, runId, status, alreadyFinalized: true };
        }
        throw new HttpsError("failed-precondition", "Import run is already finalized or needs manual reconciliation.");
      }
      const now = FieldValue.serverTimestamp();
      tx.update(runRef, {
        status,
        plannedRecords: data.plannedRecords,
        createdRecords: data.createdRecords,
        reusedRecords: data.reusedRecords,
        updatedAt: now,
        finishedAt: now,
      });
      return { ok: true, runId, status };
    });
  }

  throw new HttpsError("invalid-argument", "Action must be begin, inspect, recordPlan, reconcilePlan, or finalize.");
});
