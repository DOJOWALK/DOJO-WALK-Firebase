const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAndNormalizeBookingRequest } = require("../lib/booking_request_validator");

const petRecord = {
  name: "Milo",
  breed: "Indie",
  age: "3 years",
  size: "Medium",
  gender: "Male",
  behaviour: ["Friendly"],
  specialCare: ["Avoid hot pavement"],
  notes: "Nervous around loud traffic",
  privateMedicalDocument: "must-not-copy",
  unrelatedAccountField: "must-not-copy",
};

const addressRecord = {
  label: "Home",
  flatHouse: "A-1204",
  buildingSociety: "Gaur City 2",
  area: "Greater Noida West",
  city: "Greater Noida",
  pincode: "201009",
  latitude: "28.61",
  longitude: "77.43",
  privateField: "must-not-copy",
};

test("composes canonical dog, pickup and One-Time schedule from trusted source records", () => {
  const result = validateAndNormalizeBookingRequest({
    bookingPlan: "one_time",
    dogId: "pet-001",
    pickupAddressId: "address-001",
    schedule: {
      date: "2026-11-10",
      walks: [{ time: "06:30", durationMinutes: 30 }],
    },
  }, { petRecord, addressRecord });

  assert.equal(result.dog.dogId, "pet-001");
  assert.equal(result.dog.dogName, "Milo");
  assert.deepEqual(result.dog.dogDetails, {
    breed: "Indie",
    age: "3 years",
    size: "Medium",
    gender: "Male",
    behaviour: ["Friendly"],
    specialCare: ["Avoid hot pavement"],
    careNotes: "Nervous around loud traffic",
  });
  assert.equal(result.pickup.pickupAddressId, "address-001");
  assert.equal(result.pickup.pickupAddress.latitude, 28.61);
  assert.equal(result.pickup.pickupAddress.longitude, 77.43);
  assert.deepEqual(result.schedule, {
    kind: "scheduled_occurrences",
    occurrences: [{
      localDate: "2026-11-10",
      localTime: "06:30",
      durationMinutes: 30,
      walkNumber: 1,
    }],
  });
  assert.equal("privateMedicalDocument" in result.dog.dogDetails, false);
  assert.equal("privateField" in result.pickup.pickupAddress, false);
});

test("uses canonical dogName and dogDetails only; no legacy aliases emitted", () => {
  const result = validateAndNormalizeBookingRequest({
    bookingPlan: "one_time",
    dogId: "pet-001",
    pickupAddressId: "address-001",
    schedule: { date: "2026-11-10", walks: [{ time: "06:30", durationMinutes: 30 }] },
  }, { petRecord, addressRecord });

  assert.deepEqual(Object.keys(result.dog).sort(), ["dogDetails", "dogId", "dogName"]);
  assert.equal("petName" in result.dog, false);
  assert.equal("petDetails" in result.dog, false);
  assert.equal("dog" in result.dog, false);
});

test("Immediate remains an operations-confirmation request, never a fixed occurrence", () => {
  const result = validateAndNormalizeBookingRequest({
    bookingPlan: "immediate",
    dogId: "pet-001",
    pickupAddressId: "address-001",
    schedule: { preferredWindow: "Next 60 minutes" },
  }, { petRecord, addressRecord });

  assert.deepEqual(result.schedule, {
    kind: "awaiting_operations_confirmation",
    preferredWindow: "Next 60 minutes",
  });
});

test("rejects client-authored trusted snapshot fields and legacy aliases", () => {
  for (const extra of [
    { dogName: "Forged name" },
    { dogDetails: { breed: "Forged" } },
    { pickupAddress: { city: "Forged" } },
    { serviceZoneId: "client-zone" },
    { customerId: "client-customer" },
    { petName: "Legacy name" },
  ]) {
    assert.throws(() => validateAndNormalizeBookingRequest({
      bookingPlan: "one_time",
      dogId: "pet-001",
      pickupAddressId: "address-001",
      schedule: { date: "2026-11-10", walks: [{ time: "06:30", durationMinutes: 30 }] },
      ...extra,
    }, { petRecord, addressRecord }), /BOOKING_REQUEST_FIELD_INVALID/);
  }
});

test("rejects missing trusted pet or pickup source records", () => {
  const request = {
    bookingPlan: "one_time",
    dogId: "pet-001",
    pickupAddressId: "address-001",
    schedule: { date: "2026-11-10", walks: [{ time: "06:30", durationMinutes: 30 }] },
  };
  assert.throws(() => validateAndNormalizeBookingRequest(request, {
    petRecord: null, addressRecord,
  }), /BOOKING_DOG_RECORD_INVALID/);
  assert.throws(() => validateAndNormalizeBookingRequest(request, {
    petRecord, addressRecord: null,
  }), /BOOKING_ADDRESS_RECORD_INVALID/);
});

test("rejects partial coordinates before any normalized request is returned", () => {
  assert.throws(() => validateAndNormalizeBookingRequest({
    bookingPlan: "one_time",
    dogId: "pet-001",
    pickupAddressId: "address-001",
    schedule: { date: "2026-11-10", walks: [{ time: "06:30", durationMinutes: 30 }] },
  }, {
    petRecord,
    addressRecord: { ...addressRecord, longitude: undefined },
  }), /BOOKING_ADDRESS_COORDINATES_INCOMPLETE/);
});
