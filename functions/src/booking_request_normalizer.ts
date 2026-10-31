export type BookingPlan = "one_time" | "customize" | "regular";
export interface NormalizedWalkOccurrence {
  serviceDateKey: string;
  time: string;
  durationMinutes: number;
  walkNumber: number;
}
export type BookingNormalizationResult =
  | { outcome: "ready_for_confirmation"; bookingPlan: "one_time" | "customize"; occurrences: NormalizedWalkOccurrence[] }
  | { outcome: "awaiting_operations_confirmation"; reason: "regular_period_not_approved" | "immediate_time_not_fixed"; occurrences: [] };

export class BookingRequestValidationError extends Error {
  constructor(message: string) { super(message); this.name = "BookingRequestValidationError"; }
}
const DATE_KEY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const CLOCK_TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function assertDateKey(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new BookingRequestValidationError(`${field} must be YYYY-MM-DD.`);
  const match = DATE_KEY.exec(value);
  if (!match) throw new BookingRequestValidationError(`${field} must be YYYY-MM-DD.`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BookingRequestValidationError(`${field} is not a real calendar date.`);
  }
}
function normalizeWalks(value: unknown, field: string): NormalizedWalkOccurrence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new BookingRequestValidationError(`${field} must contain 1–3 walks.`);
  }
  const seenTimes = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) throw new BookingRequestValidationError(`${field}[${index}] must be an object.`);
    const time = item.time, duration = item.duration;
    if (typeof time !== "string" || !CLOCK_TIME.test(time)) {
      throw new BookingRequestValidationError(`${field}[${index}].time must use 24-hour HH:mm format.`);
    }
    if (seenTimes.has(time)) throw new BookingRequestValidationError(`${field} contains duplicate walk time ${time}.`);
    seenTimes.add(time);
    if (!Number.isSafeInteger(duration) || (duration as number) < 20 || (duration as number) > 60) {
      throw new BookingRequestValidationError(`${field}[${index}].duration must be an integer from 20 to 60 minutes.`);
    }
    return { serviceDateKey: "", time, durationMinutes: duration as number, walkNumber: index + 1 };
  });
}
/**
 * Pure proposed callable-DTO validator. No Firestore writes, availability,
 * pricing, assignment, lifecycle or timezone conversion occurs here.
 * Date keys are explicit service-local YYYY-MM-DD values; do not infer them
 * from client timestamps before the service-zone timezone policy is approved.
 */
export function normalizeBookingRequest(input: unknown): BookingNormalizationResult {
  if (!isRecord(input)) throw new BookingRequestValidationError("Booking request must be an object.");
  const plan = input.bookingPlan;
  if (plan !== "one_time" && plan !== "customize" && plan !== "regular") {
    throw new BookingRequestValidationError("bookingPlan must be one_time, customize, or regular.");
  }
  if (input.requestMode === "immediate" || input.preferredTime === "ASAP") {
    return { outcome: "awaiting_operations_confirmation", reason: "immediate_time_not_fixed", occurrences: [] };
  }
  if (plan === "regular") {
    return { outcome: "awaiting_operations_confirmation", reason: "regular_period_not_approved", occurrences: [] };
  }
  const occurrences: NormalizedWalkOccurrence[] = [];
  if (plan === "one_time") {
    assertDateKey(input.serviceDateKey, "serviceDateKey");
    const walks = normalizeWalks(input.walkSchedules, "walkSchedules");
    for (const walk of walks) occurrences.push({ ...walk, serviceDateKey: input.serviceDateKey });
  } else {
    if (!Array.isArray(input.dateSchedules) || input.dateSchedules.length < 1) {
      throw new BookingRequestValidationError("dateSchedules must contain at least one selected date.");
    }
    const seenDates = new Set<string>();
    input.dateSchedules.forEach((day, dayIndex) => {
      if (!isRecord(day)) throw new BookingRequestValidationError(`dateSchedules[${dayIndex}] must be an object.`);
      assertDateKey(day.serviceDateKey, `dateSchedules[${dayIndex}].serviceDateKey`);
      const dateKey = day.serviceDateKey;
      if (seenDates.has(dateKey)) throw new BookingRequestValidationError(`dateSchedules contains duplicate date ${dateKey}.`);
      seenDates.add(dateKey);
      const walks = normalizeWalks(day.walks, `dateSchedules[${dayIndex}].walks`);
      for (const walk of walks) occurrences.push({ ...walk, serviceDateKey: dateKey });
    });
  }
  const occurrenceKeys = new Set<string>();
  for (const occurrence of occurrences) {
    const key = `${occurrence.serviceDateKey}T${occurrence.time}`;
    if (occurrenceKeys.has(key)) throw new BookingRequestValidationError(`Duplicate walk occurrence ${key}.`);
    occurrenceKeys.add(key);
  }
  return { outcome: "ready_for_confirmation", bookingPlan: plan, occurrences };
}
