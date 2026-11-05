const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBookingScheduleRequest } = require("../lib/booking_schedule_normalizer");

test("One-Time normalizes one occurrence using canonical durationMinutes", () => {
  assert.deepEqual(
    normalizeBookingScheduleRequest("one_time", {
      date: "2026-11-10",
      walks: [{ time: "06:30", durationMinutes: 30 }],
    }),
    {
      kind: "scheduled_occurrences",
      occurrences: [{ localDate: "2026-11-10", localTime: "06:30", durationMinutes: 30, walkNumber: 1 }],
    },
  );
});

test("Choose-Dates expands every selected date and walk", () => {
  const result = normalizeBookingScheduleRequest("choose_dates", {
    dateSchedules: [
      { date: "2026-11-10", walks: [{ time: "06:30", durationMinutes: 30 }, { time: "18:00", durationMinutes: 45 }] },
      { date: "2026-11-12", walks: [{ time: "07:00", durationMinutes: 20 }] },
    ],
  });
  assert.equal(result.kind, "scheduled_occurrences");
  assert.equal(result.occurrences.length, 3);
  assert.deepEqual(result.occurrences.map(x => x.localDate), ["2026-11-10", "2026-11-10", "2026-11-12"]);
});

test("Regular expands only an explicit finite inclusive period", () => {
  const result = normalizeBookingScheduleRequest("regular", {
    startDate: "2026-11-07",
    endDate: "2026-11-09",
    walks: [{ time: "06:30", durationMinutes: 30 }],
  });
  assert.equal(result.occurrences.length, 3);
  assert.deepEqual(result.occurrences.map(x => x.localDate), ["2026-11-07", "2026-11-08", "2026-11-09"]);
});

test("Regular rejects a missing end date", () => {
  assert.throws(() => normalizeBookingScheduleRequest("regular", {
    startDate: "2026-11-07",
    walks: [{ time: "06:30", durationMinutes: 30 }],
  }), /BOOKING_SCHEDULE_FIELD_INVALID/);
});

test("Regular rejects reversed and over-31-day periods", () => {
  assert.throws(() => normalizeBookingScheduleRequest("regular", {
    startDate: "2026-11-09", endDate: "2026-11-07",
    walks: [{ time: "06:30", durationMinutes: 30 }],
  }), /BOOKING_DATE_RANGE_INVALID/);
  assert.throws(() => normalizeBookingScheduleRequest("regular", {
    startDate: "2026-11-01", endDate: "2026-12-02",
    walks: [{ time: "06:30", durationMinutes: 30 }],
  }), /BOOKING_PERIOD_LIMIT_EXCEEDED/);
});

test("Immediate never creates a fixed occurrence from device time", () => {
  assert.deepEqual(normalizeBookingScheduleRequest("immediate", { preferredWindow: "Next 60 minutes" }), {
    kind: "awaiting_operations_confirmation",
    preferredWindow: "Next 60 minutes",
  });
});

test("Immediate rejects client-supplied fixed date/time fields", () => {
  assert.throws(() => normalizeBookingScheduleRequest("immediate", {
    scheduledAt: "2026-11-10T06:30:00",
  }), /BOOKING_SCHEDULE_FIELD_INVALID/);
});

test("Rejects impossible calendar dates", () => {
  assert.throws(() => normalizeBookingScheduleRequest("one_time", {
    date: "2026-02-30", walks: [{ time: "06:30", durationMinutes: 30 }],
  }), /BOOKING_DATE_INVALID/);
});

test("Rejects ambiguous non-ISO date strings", () => {
  assert.throws(() => normalizeBookingScheduleRequest("one_time", {
    date: "10/11/2026", walks: [{ time: "06:30", durationMinutes: 30 }],
  }), /BOOKING_DATE_INVALID/);
});

test("Rejects invalid 24-hour times", () => {
  assert.throws(() => normalizeBookingScheduleRequest("one_time", {
    date: "2026-11-10", walks: [{ time: "25:30", durationMinutes: 30 }],
  }), /BOOKING_TIME_INVALID/);
});

test("Rejects duration outside 20–60 minutes and non-integer duration", () => {
  for (const durationMinutes of [19, 61, 30.5, "30"]) {
    assert.throws(() => normalizeBookingScheduleRequest("one_time", {
      date: "2026-11-10", walks: [{ time: "06:30", durationMinutes }],
    }), /BOOKING_DURATION_INVALID/);
  }
});

test("Rejects empty, overfull, and duplicate-time daily schedules", () => {
  assert.throws(() => normalizeBookingScheduleRequest("one_time", { date: "2026-11-10", walks: [] }), /BOOKING_WALKS_COUNT_INVALID/);
  assert.throws(() => normalizeBookingScheduleRequest("one_time", { date: "2026-11-10", walks: [
    { time: "06:00", durationMinutes: 30 }, { time: "07:00", durationMinutes: 30 },
    { time: "08:00", durationMinutes: 30 }, { time: "09:00", durationMinutes: 30 },
  ] }), /BOOKING_WALKS_COUNT_INVALID/);
  assert.throws(() => normalizeBookingScheduleRequest("one_time", { date: "2026-11-10", walks: [
    { time: "06:00", durationMinutes: 30 }, { time: "06:00", durationMinutes: 45 },
  ] }), /BOOKING_DUPLICATE_OCCURRENCE/);
});

test("Rejects duplicate dates in Choose-Dates", () => {
  assert.throws(() => normalizeBookingScheduleRequest("choose_dates", { dateSchedules: [
    { date: "2026-11-10", walks: [{ time: "06:30", durationMinutes: 30 }] },
    { date: "2026-11-10", walks: [{ time: "18:00", durationMinutes: 30 }] },
  ] }), /BOOKING_DUPLICATE_DATE/);
});

test("Rejects unknown fields so legacy aliases cannot silently enter the new DTO", () => {
  assert.throws(() => normalizeBookingScheduleRequest("one_time", {
    date: "2026-11-10", duration: 30, walks: [{ time: "06:30", durationMinutes: 30 }],
  }), /BOOKING_SCHEDULE_FIELD_INVALID/);
  assert.throws(() => normalizeBookingScheduleRequest("one_time", {
    date: "2026-11-10", walks: [{ time: "06:30", durationMinutes: 30, duration: 30 }],
  }), /BOOKING_WALK_FIELD_INVALID/);
});

test("Rejects more than 90 occurrences", () => {
  const dateSchedules = Array.from({ length: 31 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, index + 1)).toISOString().slice(0, 10);
    return { date, walks: [
      { time: "06:00", durationMinutes: 20 },
      { time: "12:00", durationMinutes: 30 },
      { time: "18:00", durationMinutes: 40 },
    ] };
  });
  assert.throws(() => normalizeBookingScheduleRequest("choose_dates", { dateSchedules }), /BOOKING_OCCURRENCE_LIMIT_EXCEEDED/);
});

test("Rejects unknown plan", () => {
  assert.throws(() => normalizeBookingScheduleRequest("monthly", {}), /BOOKING_PLAN_UNSUPPORTED/);
});
