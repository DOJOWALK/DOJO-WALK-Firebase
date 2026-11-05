const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCanonicalDogSnapshot,
  buildCanonicalPickupSnapshot,
} = require("../lib/booking_trusted_snapshots");

test("dog snapshot uses trusted document ID and canonical dogName/dogDetails", () => {
  const result = buildCanonicalDogSnapshot("dog-123", {
    name: "  Bruno ",
    breed: "Indie",
    age: "3 years",
    size: "Medium",
    gender: "Male",
    behaviour: ["Friendly", "Pulls on leash"],
    specialCare: ["Medication needed"],
    notes: "Give water after the walk",
    privateMedicalAttachment: "must-not-copy",
    ownerPhone: "+910000000000",
    dogId: "client-controlled-id",
  });
  assert.deepEqual(result, {
    dogId: "dog-123",
    dogName: "Bruno",
    dogDetails: {
      breed: "Indie",
      age: "3 years",
      size: "Medium",
      gender: "Male",
      behaviour: ["Friendly", "Pulls on leash"],
      specialCare: ["Medication needed"],
      careNotes: "Give water after the walk",
    },
  });
  assert.equal("privateMedicalAttachment" in result.dogDetails, false);
});

test("dog snapshot supports historical petName read fallback without writing alias", () => {
  const result = buildCanonicalDogSnapshot("dog-456", { petName: "Milo" });
  assert.deepEqual(result, {
    dogId: "dog-456",
    dogName: "Milo",
    dogDetails: {},
  });
  assert.equal("petName" in result, false);
});

test("dog snapshot rejects missing ID, malformed record, and missing name", () => {
  assert.throws(() => buildCanonicalDogSnapshot("", { name: "Bruno" }), /BOOKING_DOG_ID_INVALID/);
  assert.throws(() => buildCanonicalDogSnapshot("dog-1", null), /BOOKING_DOG_RECORD_INVALID/);
  assert.throws(() => buildCanonicalDogSnapshot("dog-1", { breed: "Indie" }), /BOOKING_DOG_NAME_REQUIRED/);
});

test("dog snapshot rejects malformed operational lists and oversized care notes", () => {
  assert.throws(() => buildCanonicalDogSnapshot("dog-1", {
    name: "Bruno", behaviour: "Friendly",
  }), /BOOKING_SNAPSHOT_LIST_INVALID/);
  assert.throws(() => buildCanonicalDogSnapshot("dog-1", {
    name: "Bruno", notes: "x".repeat(1001),
  }), /BOOKING_SNAPSHOT_FIELD_TOO_LONG/);
});

test("pickup snapshot keeps one structured canonical address shape", () => {
  const result = buildCanonicalPickupSnapshot("address-1", {
    label: "Home",
    flatHouse: "A-101",
    buildingSociety: "Green Residency",
    area: "Crossings Republik",
    landmark: "Park",
    city: "Ghaziabad",
    pincode: "201016",
    pickupInstructions: "Call on arrival",
    latitude: 28.6,
    longitude: 77.4,
    isDefault: true,
    privateOwnerNote: "must-not-copy",
  });
  assert.deepEqual(result, {
    pickupAddressId: "address-1",
    pickupAddress: {
      label: "Home",
      flatHouse: "A-101",
      buildingSociety: "Green Residency",
      area: "Crossings Republik",
      landmark: "Park",
      city: "Ghaziabad",
      pincode: "201016",
      pickupInstructions: "Call on arrival",
      latitude: 28.6,
      longitude: 77.4,
    },
  });
});

test("pickup snapshot maps legacy address line into canonical flatHouse", () => {
  const result = buildCanonicalPickupSnapshot("address-2", {
    address: "Flat 12, Tower B",
    area: "Sector 4",
  });
  assert.deepEqual(result, {
    pickupAddressId: "address-2",
    pickupAddress: {
      flatHouse: "Flat 12, Tower B",
      area: "Sector 4",
    },
  });
});

test("pickup snapshot permits absent coordinates but rejects a partial pair", () => {
  assert.deepEqual(
    buildCanonicalPickupSnapshot("address-3", { area: "Sector 4" }),
    { pickupAddressId: "address-3", pickupAddress: { area: "Sector 4" } },
  );
  assert.throws(() => buildCanonicalPickupSnapshot("address-3", {
    area: "Sector 4", latitude: 28.6,
  }), /BOOKING_ADDRESS_COORDINATES_INCOMPLETE/);
});

test("pickup snapshot rejects invalid coordinates and invalid identifiers", () => {
  assert.throws(() => buildCanonicalPickupSnapshot("address-4", {
    latitude: 91, longitude: 77,
  }), /BOOKING_ADDRESS_COORDINATES_INVALID/);
  assert.throws(() => buildCanonicalPickupSnapshot(" ", {}), /BOOKING_ADDRESS_ID_INVALID/);
  assert.throws(() => buildCanonicalPickupSnapshot("address-4", []), /BOOKING_ADDRESS_RECORD_INVALID/);
});

test("pickup snapshot rejects blank, non-numeric, and non-scalar coordinates", () => {
  assert.throws(() => buildCanonicalPickupSnapshot("address-5", {
    latitude: " ", longitude: "77.4",
  }), /BOOKING_ADDRESS_COORDINATES_INVALID/);
  assert.throws(() => buildCanonicalPickupSnapshot("address-5", {
    latitude: "", longitude: "77.4",
  }), /BOOKING_ADDRESS_COORDINATES_INVALID/);
  assert.throws(() => buildCanonicalPickupSnapshot("address-5", {
    latitude: true, longitude: 77.4,
  }), /BOOKING_ADDRESS_COORDINATES_INVALID/);
  assert.throws(() => buildCanonicalPickupSnapshot("address-5", {
    latitude: "north", longitude: "77.4",
  }), /BOOKING_ADDRESS_COORDINATES_INVALID/);
});

test("pickup snapshot accepts valid numeric coordinate strings", () => {
  assert.deepEqual(
    buildCanonicalPickupSnapshot("address-6", {
      latitude: "28.6", longitude: "77.4",
    }),
    {
      pickupAddressId: "address-6",
      pickupAddress: { latitude: 28.6, longitude: 77.4 },
    },
  );
});
