'use strict';

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { validateBoundaryPolygon, validateAreaInsideCity } = require('./geometry');

admin.initializeApp();
const db = admin.firestore();

const LOCATION_COLLECTIONS = {
  city: 'service_cities',
  area: 'service_areas',
};

exports.verifyServiceLocationBoundary = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in as an administrator first.');
  }

  const uid = request.auth.uid;
  const adminSnapshot = await db.doc(`admin_users/${uid}`).get();
  if (!adminSnapshot.exists
    || adminSnapshot.get('isActive') !== true
    || adminSnapshot.get('role') !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Active super_admin access is required.');
  }

  const boundaryId = request.data && request.data.boundaryId;
  const decision = request.data && request.data.decision;
  const notes = request.data && request.data.notes;
  if (typeof boundaryId !== 'string' || boundaryId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'boundaryId is required.');
  }
  if (!['verified', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be verified or rejected.');
  }
  if (typeof notes !== 'string' || notes.trim().length === 0 || notes.length > 2000) {
    throw new HttpsError('invalid-argument', 'A review note of 1–2000 characters is required.');
  }

  const boundaryRef = db.doc(`service_location_boundaries/${boundaryId}`);
  const auditRef = db.collection('audit_logs').doc();

  try {
    return await db.runTransaction(async (tx) => {
      const boundarySnap = await tx.get(boundaryRef);
      if (!boundarySnap.exists) {
        throw new HttpsError('not-found', 'Boundary record was not found.');
      }
      const boundary = boundarySnap.data();
      if (boundary.verificationStatus !== 'pending') {
        throw new HttpsError('failed-precondition', 'Only pending boundaries can be reviewed.');
      }
      if (!['city', 'area'].includes(boundary.locationType)
        || typeof boundary.locationId !== 'string'
        || !Array.isArray(boundary.points)) {
        throw new HttpsError('failed-precondition', 'Boundary type or geometry is not supported.');
      }

      let geometry;
      if (decision === 'verified') {
        try {
          geometry = validateBoundaryPolygon(boundary.points);
          if (boundary.locationType === 'area') {
            const areaRef = db.doc(`service_areas/${boundary.locationId}`);
            const areaSnap = await tx.get(areaRef);
            if (!areaSnap.exists || typeof areaSnap.get('cityId') !== 'string') {
              throw new Error('Owning Area or its parent City reference is missing.');
            }
            const cityRef = db.doc(`service_cities/${areaSnap.get('cityId')}`);
            const citySnap = await tx.get(cityRef);
            if (!citySnap.exists || citySnap.get('isServiceActive') !== true) {
              throw new Error('Parent City must exist and be active.');
            }
            const cityBoundaryId = citySnap.get('verifiedBoundaryId');
            if (typeof cityBoundaryId !== 'string' || cityBoundaryId.length === 0) {
              throw new Error('Parent City has no verified boundary reference.');
            }
            const cityBoundaryRef = db.doc(`service_location_boundaries/${cityBoundaryId}`);
            const cityBoundarySnap = await tx.get(cityBoundaryRef);
            if (!cityBoundarySnap.exists) {
              throw new Error('Parent City verified boundary record is missing.');
            }
            const cityBoundary = cityBoundarySnap.data();
            if (cityBoundary.locationType !== 'city'
              || cityBoundary.locationId !== citySnap.id
              || cityBoundary.verificationStatus !== 'verified') {
              throw new Error('Parent City boundary is not verified for this City.');
            }
            validateAreaInsideCity(boundary.points, cityBoundary.points);
          } else if (boundary.locationType === 'city') {
            const cityRef = db.doc(`service_cities/${boundary.locationId}`);
            const citySnap = await tx.get(cityRef);
            if (!citySnap.exists) {
              throw new Error('Owning City record was not found.');
            }
          }
        } catch (error) {
          throw new HttpsError('failed-precondition', error.message || 'Boundary geometry validation failed.');
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const updates = {
        verificationStatus: decision,
        verifiedBy: uid,
        verifiedAt: decision === 'verified' ? now : null,
        verificationNotes: notes.trim(),
        updatedAt: now,
      };
      if (decision === 'verified') {
        updates.validationMethod = 'trusted-server-turf';
        updates.validationVersion = 1;
      }
      tx.update(boundaryRef, updates);
      tx.set(auditRef, {
        actorUid: uid,
        actorRole: 'super_admin',
        action: decision === 'verified'
          ? 'service_location_boundary_verified'
          : 'service_location_boundary_rejected',
        targetType: 'service_location_boundary',
        targetId: boundaryId,
        reason: notes.trim(),
        afterStatus: decision,
        createdAt: now,
        metadata: {
          locationId: boundary.locationId,
          locationType: boundary.locationType,
          validationMethod: decision === 'verified' ? 'trusted-server-turf' : null,
          validationVersion: decision === 'verified' ? 1 : null,
        },
      });
      return { success: true, boundaryId, decision };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Trusted boundary review failed', { boundaryId, uid, message: error.message });
    throw new HttpsError('internal', 'Boundary review failed. No successful verification was confirmed.');
  }
});
