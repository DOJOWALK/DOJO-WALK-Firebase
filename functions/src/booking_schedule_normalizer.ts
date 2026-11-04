export type CanonicalBookingPlan = "one_time" | "choose_dates" | "regular" | "immediate";

export interface NormalizedLocalOccurrence {
  localDate: string;
  localTime: string;
  durationMinutes: number;
  walkNumber: number;
}

export type BookingScheduleNormalization =
  | { kind: "scheduled_occurrences"; occurrences: NormalizedLocalOccurrence[] }
  | { kind: "awaiting_operations_confirmation"; preferredWindow?: string };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, code: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], code: string): void {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw new Error(code);
}

function validDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("BOOKING_DATE_INVALID");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("BOOKING_DATE_INVALID");
  }
  return value;
}

function validTime(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("BOOKING_TIME_INVALID");
  }
  return value;
}

function normalizeWalks(value: unknown): Array<{ localTime: string; durationMinutes: number; walkNumber: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error("BOOKING_WALKS_COUNT_INVALID");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const walk = record(item, "BOOKING_WALK_INVALID");
    exactKeys(walk, ["time", "durationMinutes"], "BOOKING_WALK_FIELD_INVALID");
    const localTime = validTime(walk.time);
    if (seen.has(localTime)) throw new Error("BOOKING_DUPLICATE_OCCURRENCE");
    seen.add(localTime);
    if (!Number.isInteger(walk.durationMinutes) || (walk.durationMinutes as number) < 20 ||
        (walk.durationMinutes as number) > 60) {
      throw new Error("BOOKING_DURATION_INVALID");
    }
    return { localTime, durationMinutes: walk.durationMinutes as number, walkNumber: index + 1 };
  });
}

function daysInclusive(start: string, end: string): string[] {
  const startMs = Date.parse(start + "T00:00:00.000Z");
  const endMs = Date.parse(end + "T00:00:00.000Z");
  if (endMs < startMs) throw new Error("BOOKING_DATE_RANGE_INVALID");
  const dayMs = 24 * 60 * 60 * 1000;
  const count = Math.floor((endMs - startMs) / dayMs) + 1;
  if (count > 31) throw new Error("BOOKING_PERIOD_LIMIT_EXCEEDED");
  return Array.from({ length: count }, (_, index) =>
    new Date(startMs + index * dayMs).toISOString().slice(0, 10),
  );
}

/**
 * Pure schedule-shape validator/normalizer.
 *
 * It deliberately does not resolve a timezone, create a Firestore Timestamp,
 * read trusted pet/address/Zone records, check availability, write documents,
 * or create Walk Tasks. Those operations belong to the later callable layer.
 */
export function normalizeBookingScheduleRequest(
  bookingPlan: CanonicalBookingPlan,
  input: unknown,
): BookingScheduleNormalization {
  const schedule = record(input, "BOOKING_SCHEDULE_INVALID");

  if (bookingPlan === "immediate") {
    exactKeys(schedule, ["preferredWindow"], "BOOKING_SCHEDULE_FIELD_INVALID");
    const preferredWindow = schedule.preferredWindow;
    if (preferredWindow !== undefined &&
        (typeof preferredWindow !== "string" || !preferredWindow.trim() || preferredWindow.length > 80)) {
      throw new Error("BOOKING_PREFERRED_WINDOW_INVALID");
    }
    return {
      kind: "awaiting_operations_confirmation",
      ...(preferredWindow === undefined ? {} : { preferredWindow: preferredWindow.trim() }),
    };
  }

  if (bookingPlan === "one_time") {
    exactKeys(schedule, ["date", "walks"], "BOOKING_SCHEDULE_FIELD_INVALID");
    const localDate = validDate(schedule.date);
    const walks = normalizeWalks(schedule.walks);
    return {
      kind: "scheduled_occurrences",
      occurrences: walks.map((walk) => ({ localDate, ...walk })),
    };
  }

  if (bookingPlan === "choose_dates") {
    exactKeys(schedule, ["dateSchedules"], "BOOKING_SCHEDULE_FIELD_INVALID");
    if (!Array.isArray(schedule.dateSchedules) || schedule.dateSchedules.length < 1 ||
        schedule.dateSchedules.length > 31) {
      throw new Error("BOOKING_DATE_SCHEDULES_INVALID");
    }
    const seenDates = new Set<string>();
    const occurrences: NormalizedLocalOccurrence[] = [];
    for (const item of schedule.dateSchedules) {
      const day = record(item, "BOOKING_DATE_SCHEDULE_INVALID");
      exactKeys(day, ["date", "walks"], "BOOKING_DATE_SCHEDULE_FIELD_INVALID");
      const localDate = validDate(day.date);
      if (seenDates.has(localDate)) throw new Error("BOOKING_DUPLICATE_DATE");
      seenDates.add(localDate);
      for (const walk of normalizeWalks(day.walks)) occurrences.push({ localDate, ...walk });
    }
    if (occurrences.length > 90) throw new Error("BOOKING_OCCURRENCE_LIMIT_EXCEEDED");
    return { kind: "scheduled_occurrences", occurrences };
  }

  if (bookingPlan === "regular") {
    exactKeys(schedule, ["startDate", "endDate", "walks"], "BOOKING_SCHEDULE_FIELD_INVALID");
    if (typeof schedule.startDate !== "string" || typeof schedule.endDate !== "string") {
      throw new Error("BOOKING_SCHEDULE_FIELD_INVALID");
    }
    const startDate = validDate(schedule.startDate);
    const endDate = validDate(schedule.endDate);
    const dates = daysInclusive(startDate, endDate);
    const walks = normalizeWalks(schedule.walks);
    const occurrenceCount = dates.length * walks.length;
    if (occurrenceCount > 90) throw new Error("BOOKING_OCCURRENCE_LIMIT_EXCEEDED");
    const occurrences = dates.flatMap((localDate) =>
      walks.map((walk) => ({ localDate, ...walk })),
    );
    return { kind: "scheduled_occurrences", occurrences };
  }

  throw new Error("BOOKING_PLAN_UNSUPPORTED");
}
