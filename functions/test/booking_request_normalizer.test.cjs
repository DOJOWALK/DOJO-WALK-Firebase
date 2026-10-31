const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBookingRequest,
  BookingRequestValidationError,
} = require("../lib/booking_request_normalizer");

test("one-time request expands each selected walk into a dated occurrence", () => {
  const result = normalizeBookingRequest({
    bookingPlan: "one_time",
    serviceDateKey: "2026-11-02",
    walkSchedules: [
      { time: "06:30", duration: 30 },
      { time: "18:00", duration: 45 },
    ],
  });
  assert.equal(result.outcome, "ready_for_confirmation");
  assert.equal(result.occurrences.length, 2);
  assert.deepEqual(result.occurrences.map((x) => [x.serviceDateKey, x.time, x.durationMinutes]), [
    ["2026-11-02", "06:30", 30],
    ["2026-11-02", "18:00", 45],
  ]);
});

test("choose-dates expands every walk across every selected date", () => {
  const result = normalizeBookingRequest({
    bookingPlan: "customize",
    dateSchedules: [
      { serviceDateKey: "2026-11-02", walks: [{ time: "06:00", duration: 30 }, { time: "19:00", duration: 20 }] },
      { serviceDateKey: "2026-11-04", walks: [{ time: "07:15", duration: 60 }] },
    ],
  });
  assert.equal(result.outcome, "ready_for_confirmation");
  assert.equal(result.occurrences.length, 3);
  assert.deepEqual(result.occurrences.map((x) => x.serviceDateKey), [
    "2026-11-02", "2026-11-02", "2026-11-04",
  ]);
});

test("regular request remains non-scheduled pending period contract approval", () => {
  const result = normalizeBookingRequest({ bookingPlan: "regular", dailyWalkTemplate: [{ time: "06:30", duration: 30 }] });
  assert.deepEqual(result, {
    outcome: "awaiting_operations_confirmation",
    reason: "regular_period_not_approved",
    occurrences: [],
  });
});

test("ASAP immediate request never becomes a scheduled occurrence", () => {
  const result = normalizeBookingRequest({
    bookingPlan: "one_time", preferredTime: "ASAP",
    serviceDateKey: "2026-11-02", walkSchedules: [{ time: "06:30", duration: 30 }],
  });
  assert.equal(result.outcome, "awaiting_operations_confirmation");
  assert.equal(result.reason, "immediate_time_not_fixed");
  assert.deepEqual(result.occurrences, []);
});

test("rejects impossible calendar dates", () => {
  assert.throws(() => normalizeBookingRequest({
    bookingPlan: "one_time", serviceDateKey: "2026-02-30",
    walkSchedules: [{ time: "06:30", duration: 30 }],
  }), BookingRequestValidationError);
});

test("rejects malformed 12-hour time strings until DTO conversion is defined", () => {
  assert.throws(() => normalizeBookingRequest({
    bookingPlan: "one_time", serviceDateKey: "2026-11-02",
    walkSchedules: [{ time: "6:30 AM", duration: 30 }],
  }), /24-hour HH:mm/);
});

test("rejects duration below 20 or above 60 and non-integer duration", () => {
  for (const duration of [19, 61, 30.5, "30"]) {
    assert.throws(() => normalizeBookingRequest({
      bookingPlan: "one_time", serviceDateKey: "2026-11-02",
      walkSchedules: [{ time: "06:30", duration }],
    }), /duration must be an integer/);
  }
});

test("rejects more than three walks on a date", () => {
  assert.throws(() => normalizeBookingRequest({
    bookingPlan: "one_time", serviceDateKey: "2026-11-02",
    walkSchedules: [
      { time: "06:00", duration: 30 }, { time: "10:00", duration: 30 },
      { time: "16:00", duration: 30 }, { time: "20:00", duration: 30 },
    ],
  }), /1–3 walks/);
});

test("rejects duplicate date entries and duplicate times within a date", () => {
  assert.throws(() => normalizeBookingRequest({
    bookingPlan: "customize",
    dateSchedules: [
      { serviceDateKey: "2026-11-02", walks: [{ time: "06:00", duration: 30 }] },
      { serviceDateKey: "2026-11-02", walks: [{ time: "07:00", duration: 30 }] },
    ],
  }), /duplicate date/);
  assert.throws(() => normalizeBookingRequest({
    bookingPlan: "customize",
    dateSchedules: [{
      serviceDateKey: "2026-11-02",
      walks: [{ time: "06:00", duration: 30 }, { time: "06:00", duration: 45 }],
    }],
  }), /duplicate walk time/);
});

test("rejects empty or malformed custom date schedules", () => {
  for (const dateSchedules of [[], [{}], [{ serviceDateKey: "2026-11-02", walks: [] }]]) {
    assert.throws(() => normalizeBookingRequest({ bookingPlan: "customize", dateSchedules }));
  }
});

test("rejects unknown booking plans and non-object payloads", () => {
  assert.throws(() => normalizeBookingRequest(null), /must be an object/);
  assert.throws(() => normalizeBookingRequest({ bookingPlan: "weekly" }), /bookingPlan/);
});
