const test = require("node:test");
const assert = require("node:assert/strict");
const { adaptLegacyCustomerBooking } = require("../lib/legacy_customer_booking_adapter");

const timestamp = (iso) => ({ toDate: () => new Date(iso) });

test("adapts legacy one-time Timestamp using explicit service timezone resolver", () => {
  const result = adaptLegacyCustomerBooking({
    bookingPlan: "one_time",
    scheduledAt: timestamp("2026-11-01T00:00:00.000Z"),
    walkSchedules: [{ time: "6:30 AM", duration: 30, startHour: 6, startMinute: 30 }],
  }, () => "2026-11-01");
  assert.equal(result.outcome, "ready_for_confirmation");
  assert.deepEqual(result.occurrences, [{
    serviceDateKey: "2026-11-01", time: "06:30", durationMinutes: 30, walkNumber: 1,
  }]);
});

test("does not infer a service date from Timestamp without explicit resolver", () => {
  assert.throws(() => adaptLegacyCustomerBooking({
    bookingPlan: "one_time",
    scheduledAt: timestamp("2026-11-01T00:00:00.000Z"),
    walkSchedules: [{ time: "6:30 AM", duration: 30 }],
  }), /timezone resolver/);
});

test("adapts Choose-Dates using explicit selectedDates keys and every nested walk", () => {
  const result = adaptLegacyCustomerBooking({
    bookingPlan: "customize",
    selectedDates: ["2026-11-01", "2026-11-03"],
    dateSchedules: [
      { date: timestamp("2026-11-01T00:00:00.000Z"), walks: [
        { time: "6:00 AM", duration: 30 }, { time: "18:30", duration: 45 },
      ] },
      { date: timestamp("2026-11-03T00:00:00.000Z"), walks: [
        { time: "7:15 PM", duration: 20 },
      ] },
    ],
  });
  assert.equal(result.occurrences.length, 3);
  assert.deepEqual(result.occurrences.map((x) => [x.serviceDateKey, x.time]), [
    ["2026-11-01", "06:00"], ["2026-11-01", "18:30"], ["2026-11-03", "19:15"],
  ]);
});

test("ASAP remains pending operations confirmation and creates no occurrence", () => {
  const result = adaptLegacyCustomerBooking({
    bookingPlan: "one_time", preferredTime: "ASAP",
  });
  assert.equal(result.outcome, "awaiting_operations_confirmation");
  assert.deepEqual(result.occurrences, []);
});

test("Regular remains pending period approval and creates no occurrence", () => {
  const result = adaptLegacyCustomerBooking({ bookingPlan: "regular" });
  assert.equal(result.outcome, "awaiting_operations_confirmation");
  assert.deepEqual(result.occurrences, []);
});

test("rejects selectedDates/dateSchedules length mismatch", () => {
  assert.throws(() => adaptLegacyCustomerBooking({
    bookingPlan: "customize", selectedDates: ["2026-11-01"], dateSchedules: [],
  }), /matching lengths/);
});

test("rejects invalid legacy display time when no numeric clock parts exist", () => {
  assert.throws(() => adaptLegacyCustomerBooking({
    bookingPlan: "one_time",
    scheduledAt: timestamp("2026-11-01T00:00:00.000Z"),
    walkSchedules: [{ time: "tomorrow morning", duration: 30 }],
  }, () => "2026-11-01"), /valid 12-hour or 24-hour/);
});

test("rejects legacy schedule durations outside approved 20–60 minute range", () => {
  assert.throws(() => adaptLegacyCustomerBooking({
    bookingPlan: "one_time",
    scheduledAt: timestamp("2026-11-01T00:00:00.000Z"),
    walkSchedules: [{ time: "6:00 AM", duration: 15 }],
  }, () => "2026-11-01"), /20 to 60 minutes/);
});

test("rejects partial numeric time components instead of silently falling back to display text", () => {
  assert.throws(() => adaptLegacyCustomerBooking({
    bookingPlan: "one_time",
    scheduledAt: timestamp("2026-11-01T00:00:00.000Z"),
    walkSchedules: [{ time: "6:30 AM", duration: 30, startHour: 6 }],
  }, () => "2026-11-01"), /both startHour and startMinute/);
});
