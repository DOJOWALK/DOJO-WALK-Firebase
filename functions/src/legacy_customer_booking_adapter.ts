import {
  BookingNormalizationResult,
  normalizeBookingRequest,
} from "./booking_request_normalizer";

export interface LegacyTimestampLike {
  toDate?: () => Date;
}
export type ServiceDateResolver = (timestamp: LegacyTimestampLike) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function legacyDateTimestamp(value: unknown): value is LegacyTimestampLike {
  return isRecord(value) && typeof value.toDate === "function";
}
function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function normalizeLegacyTime(walk: Record<string, unknown>, field: string): string {
  const hour = walk.startHour;
  const minute = walk.startMinute;
  if (Number.isInteger(hour) && Number.isInteger(minute)) {
    if ((hour as number) < 0 || (hour as number) > 23 ||
        (minute as number) < 0 || (minute as number) > 59) {
      throw new Error(`${field} has invalid startHour/startMinute.`);
    }
    return formatClock(hour as number, minute as number);
  }

  const raw = typeof walk.time === "string" ? walk.time.trim() : "";
  const twentyFourHour = /^(?:[01]?\d|2[0-3]):[0-5]\d$/.exec(raw);
  if (twentyFourHour) {
    const [h, m] = raw.split(":").map(Number);
    return formatClock(h, m);
  }
  const twelveHour = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(raw);
  if (twelveHour) {
    let h = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toUpperCase() === "PM") h += 12;
    return formatClock(h, Number(twelveHour[2]));
  }
  throw new Error(`${field}.time must be a valid 12-hour or 24-hour clock value.`);
}
function normalizeLegacyWalks(value: unknown, field: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list.`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${field}[${index}] must be an object.`);
    return {
      time: normalizeLegacyTime(item, `${field}[${index}]`),
      duration: item.duration,
    };
  });
}

/**
 * Adapts the current Customer booking document shape to the candidate callable DTO.
 * It deliberately does not write to Firestore or infer a date from a Timestamp
 * unless the caller supplies an approved service-timezone resolver.
 */
export function adaptLegacyCustomerBooking(
  legacy: unknown,
  resolveServiceDateKey?: ServiceDateResolver,
): BookingNormalizationResult {
  if (!isRecord(legacy)) throw new Error("Legacy booking must be an object.");
  const plan = legacy.bookingPlan;
  if (plan !== "one_time" && plan !== "customize" && plan !== "regular") {
    throw new Error("Unsupported legacy bookingPlan.");
  }
  if (legacy.preferredTime === "ASAP") {
    return normalizeBookingRequest({ bookingPlan: plan, preferredTime: "ASAP" });
  }
  if (plan === "regular") {
    return normalizeBookingRequest({ bookingPlan: "regular" });
  }

  if (plan === "one_time") {
    if (!legacyDateTimestamp(legacy.scheduledAt)) {
      throw new Error("Legacy one-time booking requires scheduledAt Timestamp.");
    }
    if (!resolveServiceDateKey) {
      throw new Error("Service timezone resolver is required for legacy scheduledAt.");
    }
    const serviceDateKey = resolveServiceDateKey(legacy.scheduledAt);
    return normalizeBookingRequest({
      bookingPlan: "one_time",
      serviceDateKey,
      walkSchedules: normalizeLegacyWalks(legacy.walkSchedules, "walkSchedules"),
    });
  }

  if (!Array.isArray(legacy.selectedDates) ||
      !Array.isArray(legacy.dateSchedules) ||
      legacy.selectedDates.length === 0 ||
      legacy.selectedDates.length !== legacy.dateSchedules.length) {
    throw new Error("Legacy selectedDates and dateSchedules must be non-empty and have matching lengths.");
  }
  const dateSchedules = legacy.dateSchedules.map((day, index) => {
    if (!isRecord(day) || !legacyDateTimestamp(day.date)) {
      throw new Error(`Legacy dateSchedules[${index}].date must be a Timestamp.`);
    }
    const dateKey = legacy.selectedDates![index];
    if (typeof dateKey !== "string") {
      throw new Error(`Legacy selectedDates[${index}] must be YYYY-MM-DD.`);
    }
    return {
      serviceDateKey: dateKey,
      walks: normalizeLegacyWalks(day.walks, `dateSchedules[${index}].walks`),
    };
  });
  return normalizeBookingRequest({ bookingPlan: "customize", dateSchedules });
}
