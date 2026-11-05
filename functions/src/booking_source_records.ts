import type { Firestore } from "firebase-admin/firestore";

export interface OwnedBookingSourceRecords {
  petRecord: FirebaseFirestore.DocumentData;
  addressRecord: FirebaseFirestore.DocumentData;
}

/**
 * Loads booking source records only from the authenticated customer's namespace.
 * The caller MUST pass request.auth.uid, never a client-supplied customerId.
 * Missing and cross-customer IDs intentionally share the same not-found result.
 */
export async function loadOwnedBookingSourceRecords(
  db: Firestore,
  authenticatedUid: string,
  dogId: string,
  pickupAddressId: string,
): Promise<OwnedBookingSourceRecords> {
  const validId = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,150}$/.test(value);

  if (!validId(authenticatedUid)) {
    throw new Error("BOOKING_AUTH_UID_INVALID");
  }
  if (!validId(dogId)) {
    throw new Error("BOOKING_DOG_ID_INVALID");
  }
  if (!validId(pickupAddressId)) {
    throw new Error("BOOKING_ADDRESS_ID_INVALID");
  }

  const petRef = db.doc(`users/${authenticatedUid}/pets/${dogId}`);
  const addressRef = db.doc(`users/${authenticatedUid}/addresses/${pickupAddressId}`);
  const [petSnap, addressSnap] = await Promise.all([petRef.get(), addressRef.get()]);

  if (!petSnap.exists) throw new Error("BOOKING_DOG_NOT_FOUND");
  if (!addressSnap.exists) throw new Error("BOOKING_ADDRESS_NOT_FOUND");

  return {
    petRecord: petSnap.data()!,
    addressRecord: addressSnap.data()!,
  };
}
