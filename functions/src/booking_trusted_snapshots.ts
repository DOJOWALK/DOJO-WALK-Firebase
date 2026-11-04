export interface CanonicalDogSnapshot {
  dogId: string;
  dogName: string;
  dogDetails: {
    breed?: string;
    age?: string;
    size?: string;
    gender?: string;
    behaviour?: string[];
    specialCare?: string[];
    careNotes?: string;
  };
}

export interface CanonicalPickupSnapshot {
  pickupAddressId: string;
  pickupAddress: {
    label?: string;
    flatHouse?: string;
    buildingSociety?: string;
    area?: string;
    landmark?: string;
    city?: string;
    pincode?: string;
    pickupInstructions?: string;
    latitude?: number;
    longitude?: number;
  };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, code: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as UnknownRecord;
}

function requiredId(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160) {
    throw new Error(code);
  }
  return value.trim();
}

function optionalText(
  source: UnknownRecord,
  key: string,
  maxLength: number,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("BOOKING_SNAPSHOT_FIELD_INVALID");
  }
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.length > maxLength) throw new Error("BOOKING_SNAPSHOT_FIELD_TOO_LONG");
  return text;
}

function optionalStringList(
  source: UnknownRecord,
  key: string,
): string[] | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("BOOKING_SNAPSHOT_LIST_INVALID");
  }
  const result = value.map((item) => {
    if (typeof item !== "string") throw new Error("BOOKING_SNAPSHOT_LIST_INVALID");
    const text = item.trim();
    if (!text || text.length > 80) throw new Error("BOOKING_SNAPSHOT_LIST_INVALID");
    return text;
  });
  return result;
}

function requiredCoordinate(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    return Number(value.trim());
  }
  throw new Error("BOOKING_ADDRESS_COORDINATES_INVALID");
}

/**
 * Builds a minimal operational dog snapshot from the trusted pet document.
 * Unknown/private pet fields are deliberately ignored. The document ID is
 * supplied separately and never trusted from a field inside the pet document.
 */
export function buildCanonicalDogSnapshot(
  dogIdInput: unknown,
  petInput: unknown,
): CanonicalDogSnapshot {
  const dogId = requiredId(dogIdInput, "BOOKING_DOG_ID_INVALID");
  const pet = asRecord(petInput, "BOOKING_DOG_RECORD_INVALID");
  const dogName = optionalText(pet, "name", 100) ??
    optionalText(pet, "petName", 100);
  if (!dogName) throw new Error("BOOKING_DOG_NAME_REQUIRED");

  const dogDetails: CanonicalDogSnapshot["dogDetails"] = {};
  const breed = optionalText(pet, "breed", 100);
  const age = optionalText(pet, "age", 40);
  const size = optionalText(pet, "size", 30);
  const gender = optionalText(pet, "gender", 20);
  const behaviour = optionalStringList(pet, "behaviour");
  const specialCare = optionalStringList(pet, "specialCare");
  const careNotes = optionalText(pet, "notes", 1000);

  if (breed) dogDetails.breed = breed;
  if (age) dogDetails.age = age;
  if (size) dogDetails.size = size;
  if (gender) dogDetails.gender = gender;
  if (behaviour) dogDetails.behaviour = behaviour;
  if (specialCare) dogDetails.specialCare = specialCare;
  if (careNotes) dogDetails.careNotes = careNotes;

  return { dogId, dogName, dogDetails };
}

/**
 * Builds the shared structured pickup snapshot from a trusted saved-address
 * document. Coordinates are optional here because older saved addresses may
 * lack them; the later Zone resolver must fail closed until valid coordinates
 * are available. A half-populated coordinate pair is always rejected.
 */
export function buildCanonicalPickupSnapshot(
  addressIdInput: unknown,
  addressInput: unknown,
): CanonicalPickupSnapshot {
  const pickupAddressId = requiredId(addressIdInput, "BOOKING_ADDRESS_ID_INVALID");
  const address = asRecord(addressInput, "BOOKING_ADDRESS_RECORD_INVALID");
  const pickupAddress: CanonicalPickupSnapshot["pickupAddress"] = {};

  const fields: Array<[keyof CanonicalPickupSnapshot["pickupAddress"], string, number]> = [
    ["label", "label", 80],
    ["flatHouse", "flatHouse", 160],
    ["buildingSociety", "buildingSociety", 160],
    ["area", "area", 160],
    ["landmark", "landmark", 160],
    ["city", "city", 100],
    ["pincode", "pincode", 12],
    ["pickupInstructions", "pickupInstructions", 500],
  ];
  for (const [target, source, limit] of fields) {
    const value = optionalText(address, source, limit);
    if (value) Object.assign(pickupAddress, { [target]: value });
  }

  // Historical saved-address documents sometimes store the first address
  // line in "address"; map it into the one canonical flatHouse field.
  if (!pickupAddress.flatHouse) {
    const legacyAddressLine = optionalText(address, "address", 160);
    if (legacyAddressLine) pickupAddress.flatHouse = legacyAddressLine;
  }

  const rawLatitude = address.latitude;
  const rawLongitude = address.longitude;
  const hasLatitude = rawLatitude !== undefined && rawLatitude !== null;
  const hasLongitude = rawLongitude !== undefined && rawLongitude !== null;
  if (hasLatitude !== hasLongitude) {
    throw new Error("BOOKING_ADDRESS_COORDINATES_INCOMPLETE");
  }
  if (hasLatitude && hasLongitude) {
    const latitude = requiredCoordinate(rawLatitude);
    const longitude = requiredCoordinate(rawLongitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("BOOKING_ADDRESS_COORDINATES_INVALID");
    }
    pickupAddress.latitude = latitude;
    pickupAddress.longitude = longitude;
  }

  return { pickupAddressId, pickupAddress };
}
